// Run `node tests/browserStorageCheck.mjs`, then open http://localhost:8768.
// Uses the real browser IndexedDB implementation on an isolated test origin.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const storage = ts.transpileModule(readFileSync(new URL('../src/storage/pendingRecordings.web.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline recording storage check</title><style>body{font:16px system-ui;max-width:36em;margin:40px auto;padding:20px}button{padding:12px;margin:8px 0;display:block}output{display:block;white-space:pre-wrap}</style>
<h1>Offline recording storage check</h1><p>Synthetic audio only. No microphone or account is used.</p>
<button id="save">Save sample recordings</button><p>After saving, reload this page to simulate an app restart.</p>
<button id="verify">Verify recovery and clean up samples</button><output id="result">Ready.</output>
<script type="module">
import * as storage from '/storage.js';
const result = document.querySelector('#result');
const assert = (value, message) => { if (!value) throw Error(message); };
const run = callback => async () => { try { await callback(); } catch (error) { result.textContent = 'FAIL: ' + error.message; } };
document.querySelector('#save').onclick = run(async () => {
  for (const [id, userId] of [['sample-1','test-owner'],['sample-2','test-owner'],['sample-3','other-owner']]) {
    const uri = URL.createObjectURL(new Blob(['synthetic audio ' + id], { type: 'audio/webm' }));
    await storage.savePendingRecording({ id, userId, startedAt:'2026-09-13T12:00:00Z', seconds:5,
      audio:{ uri, name:id+'.webm', type:'audio/webm' } });
    URL.revokeObjectURL(uri);
  }
  result.textContent = 'Saved 3 samples. Original blob URLs revoked. Reload this page, then verify recovery.';
});
document.querySelector('#verify').onclick = run(async () => {
  const rows = await storage.listPendingRecordings('test-owner');
  assert(rows.length === 2, 'Expected 2 recordings for this account');
  assert((await storage.listPendingRecordings('other-owner')).length === 1, 'Other account recording was lost');
  for (const row of rows) {
    const audio = await storage.readPendingAudio(row);
    assert(await (await fetch(audio.uri)).text() === 'synthetic audio ' + row.id, 'Audio bytes changed after restart');
    assert(row.startedAt === '2026-09-13T12:00:00Z' && row.seconds === 5, 'Recording metadata changed');
    storage.releasePendingAudio(audio);
    await storage.removePendingRecording(row);
  }
  assert((await storage.listPendingRecordings('test-owner')).length === 0, 'Acknowledged recordings were not removed');
  const other = await storage.listPendingRecordings('other-owner');
  assert(other.length === 1, 'Cleanup touched another account');
  await storage.removePendingRecording(other[0]);
  result.textContent = 'PASS: audio bytes and metadata survived restart; accounts stayed isolated; acknowledged samples were removed.';
});
</script></html>`;

createServer((request, response) => {
  if (request.url !== '/' && request.url !== '/storage.js') { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': request.url === '/' ? 'text/html' : 'text/javascript', 'Cache-Control': 'no-store' });
  response.end(request.url === '/' ? page : storage);
}).listen(8768, '127.0.0.1', () => console.log('Storage check: http://localhost:8768'));
