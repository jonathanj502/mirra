import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Execute the real import hook, replacing only native, storage, and auth boundaries.
function importer() {
  const state = {
    user: { id: 'owner' }, asset: { uri: 'file:///original.m4a', name: 'original.m4a', size: 100 },
    seconds: 86400, fileSize: 100, allowed: true, savedConsent: true, rows: [], pickCount: 0,
  };
  const slots = [];
  let cursor = 0;
  let cleanup;
  let effectUser;
  const dependencies = {
    react: {
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], value => { slots[i] = value; }];
      },
      useRef(initial) { return slots[cursor++] ??= { current: initial }; },
      useCallback: value => value,
      useEffect(effect, [id]) {
        if (effectUser !== id) { cleanup?.(); cleanup = effect(); effectUser = id; }
      },
    },
    '@/auth/AuthContext': { useAuth: () => ({ user: state.user }) },
    '@/hooks/useRecordAudio': { useRecordAudio: () => ({ async enqueue(row) {
      if (state.saveError) throw state.saveError;
      state.rows.push(row);
    } }) },
    '@/storage/pendingRecordings': { recordingId: () => `import-${state.rows.length}` },
    '@/privacy/aiConsent': {
      requestAIConsent: async id => { assert.equal(id, 'owner'); return state.allowed; },
      hasAIConsent: async id => { assert.equal(id, 'owner'); return state.savedConsent; },
    },
    '@/utils/timeFormat': { titleFromFilename: name => name.replace(/\.[^.]+$/, '') },
    '@/utils/audioDuration': { async getAudioDuration() {
      if (state.metadata) await state.metadata;
      if (state.metadataError) throw state.metadataError;
      return state.seconds;
    } },
    '@/config/env': { env: { backendUrl: 'http://test.invalid' } },
    'expo-file-system': { File: class { get size() { return state.fileSize; } } },
    'expo-document-picker': { async getDocumentAsync(options) {
      state.pickCount++;
      assert.equal(options.copyToCacheDirectory, true);
      assert.equal(options.multiple, false);
      assert.ok(options.type.includes('audio/webm'));
      if (state.pickError) throw state.pickError;
      if (state.picker) await state.picker;
      return state.canceled ? { canceled: true } : { canceled: false, assets: [state.asset] };
    } },
  };
  function load(path) {
    const source = readFileSync(new URL(`../src/${path}.ts`, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', outputText)(name => {
      if (name === '@/config/recording' || name === '@/api/http') return load(name.slice(2));
      assert.ok(name in dependencies, `Missing boundary ${name}`);
      return dependencies[name];
    }, module, module.exports);
    return module.exports;
  }
  const { useImportAudio } = load('hooks/useImportAudio');
  state.render = () => { cursor = 0; return useImportAudio(); };
  state.unmount = () => cleanup?.();
  return state;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('supported formats retain source, title, owner and exact limits in the existing queue', async () => {
  const state = importer();
  for (const [name, mimeType, expected] of [
    ['at-limit.M4A', undefined, 'audio/mp4'], ['clip.mp3', 'application/octet-stream', 'audio/mpeg'],
    ['clip.wav', 'audio/x-wav', 'audio/x-wav'], ['clip.webm', 'application/octet-stream', 'audio/webm'],
    ['clip.webm', 'Audio/WebM; codecs=opus', 'audio/webm'],
    ['interview.mp3', 'audio/mp3', 'audio/mpeg'], ['voice.wav', 'audio/vnd.wave', 'audio/wav'],
    ['conversation.ogg', 'application/ogg', 'audio/ogg'],
  ]) {
    state.asset = { ...state.asset, name, mimeType, size: 2 * 1024 * 1024 * 1024 };
    await state.render().importAudio();
    const row = state.rows.at(-1);
    assert.equal(row.audio.uri, 'file:///original.m4a');
    assert.equal(row.audio.type, expected);
    assert.match(row.audio.name, /^mirra-import-import-\d+\.(m4a|mp3|wav|webm|ogg)$/);
    assert.equal(row.title, name.replace(/\.[^.]+$/, ''));
    assert.equal(row.seconds, 86400);
    assert.equal(row.userId, 'owner');
    assert.ok(row.startedAt);
    assert.equal(state.render().error, null);
  }
  assert.equal(new Set(state.rows.map(row => row.id)).size, 8);
});

test('oversized, overlong, unreadable, empty, and unsupported files never enter the queue', async () => {
  for (const [change, error] of [
    [{ asset: { name: 'clip.wav', size: 2 * 1024 * 1024 * 1024 + 1 } }, /2 GiB/],
    [{ seconds: 86401.001 }, /24 hours/],
    [{ asset: { name: 'clip.txt', size: 10 } }, /Unsupported audio type/],
    [{ asset: { name: 'clip.unknown', mimeType: 'audio/mp3', size: 10 } }, /Unsupported audio type/],
    [{ asset: { name: 'clip.wav', size: 0 } }, /nonempty/],
    [{ asset: { name: 'clip.wav', size: NaN } }, /file size/],
    [{ asset: { name: 'clip.wav' }, fileSize: 0 }, /file size/],
    [{ pickError: new Error('Could not open audio file') }, /Could not open/],
  ]) {
    const state = Object.assign(importer(), change);
    await state.render().importAudio();
    assert.match(state.render().error, error);
    assert.equal(state.rows.length, 0);
    assert.equal(state.render().importing, false);
  }
});

test('Apple MP3 padding and unavailable native metadata defer to strict server validation', async () => {
  const state = importer();
  state.asset.name = 'clip.mp3';
  state.seconds = 86400.076;
  await state.render().importAudio();
  assert.equal(state.rows[0].seconds, 86400.076);
  state.asset.name = 'clip.webm';
  state.metadataError = new Error('Could not read the audio file. Try another format.');
  await state.render().importAudio();
  assert.equal(state.rows[1].seconds, 0, 'Zero denotes unknown until server decode');
  assert.equal(state.rows[1].audio.type, 'audio/webm');
  assert.equal(state.render().error, null);
});

test('missing picker size uses actual native file or web File size', async () => {
  for (const file of [undefined, { size: 2 * 1024 * 1024 * 1024 + 1 }]) {
    const state = importer();
    state.asset = { name: 'clip.wav', uri: 'file:///clip.wav', file };
    state.fileSize = 2 * 1024 * 1024 * 1024 + 1;
    await state.render().importAudio();
    assert.match(state.render().error, /2 GiB/);
    assert.equal(state.rows.length, 0);
  }
});

test('cancel, denied/withdrawn consent and sign-out never save an import', async () => {
  for (const change of [{ canceled: true }, { allowed: false }, { savedConsent: false }, { user: null }]) {
    const state = Object.assign(importer(), change);
    await state.render().importAudio();
    assert.equal(state.rows.length, 0);
    assert.equal(state.render().importing, false);
  }
});

test('account change or unmount during picker/metadata prevents enqueue; rapid taps pick once', async () => {
  for (const stage of ['picker', 'metadata']) {
    for (const leave of ['switch', 'unmount']) {
      const state = importer();
      let resolve;
      state[stage] = new Promise(done => { resolve = done; });
      const action = state.render().importAudio();
      await flush();
      await state.render().importAudio();
      assert.equal(state.pickCount, 1);
      if (leave === 'switch') { state.user = { id: 'other' }; state.render(); }
      else state.unmount();
      resolve();
      await action;
      assert.equal(state.rows.length, 0);
    }
  }
});

test('storage failure is visible and preserves the selected source for retry', async () => {
  const state = importer();
  state.saveError = new Error('Storage full');
  await state.render().importAudio();
  assert.match(state.render().error, /Could not save this import.*original file is unchanged/);
  assert.equal(state.rows.length, 0);
  assert.equal(state.asset.uri, 'file:///original.m4a');
  state.saveError = null;
  await state.render().importAudio();
  assert.equal(state.rows.length, 1);
  assert.equal(state.render().error, null);
});
