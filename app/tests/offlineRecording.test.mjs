import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import ts from 'typescript';
import React from 'react';

function load(file, dependencies, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), outputText)(name => {
    assert.ok(name in dependencies, `Missing dependency ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

function hooks() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  return {
    react: { ...React,
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
      },
      useRef(initial) { return slots[cursor++] ??= { current: initial }; },
      useEffect(callback, deps) {
        const i = cursor++;
        if (!slots[i] || deps.some((dep, n) => dep !== slots[i].deps[n])) {
          effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; });
        }
      },
      useCallback: callback => callback,
      useMemo: callback => callback(),
    },
    render(callback) { cursor = 0; const result = callback(); const run = effects; effects = []; run.forEach(effect => effect()); return result; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

const http = load('api/http.ts', { '@/config/env': { env: { backendUrl: 'http://test.invalid' } } });
async function until(check) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail('Timed out waiting for recovery');
}

test('durable native queue survives restart, isolates accounts, serializes reconnect uploads and deletes only acknowledged audio', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'mirra-recording-test-'));
  const disk = {
    documentDirectory: root.replaceAll('\\', '/') + '/',
    makeDirectoryAsync: path => fs.mkdir(path, { recursive: true }),
    copyAsync: ({ from, to }) => fs.copyFile(from, to),
    writeAsStringAsync: (path, text) => fs.writeFile(path, text),
    moveAsync: ({ from, to }) => fs.rename(from, to),
    readAsStringAsync: path => fs.readFile(path, 'utf8'),
    readDirectoryAsync: path => fs.readdir(path),
    async getInfoAsync(path) { try { await fs.stat(path); return { exists: true }; } catch { return { exists: false }; } },
    async deleteAsync(path) {
      assert.ok(resolve(path).startsWith(resolve(root) + sep));
      await fs.rm(path, { recursive: true, force: true });
    },
  };
  const storage = () => load('storage/pendingRecordings.ts', { 'expo-file-system/legacy': disk });
  const source = join(root, 'capture.m4a');
  await fs.writeFile(source, 'actual saved audio bytes');
  const clip = (id, userId = 'owner') => ({ id, userId, startedAt: '2026-09-13T12:00:00Z', seconds: 7.5,
    audio: { uri: source, name: 'recording.m4a', type: 'audio/mp4' } });
  let mounted;
  try {
    await storage().savePendingRecording(clip('one'));
    await storage().savePendingRecording({ ...clip('two'), title: 'Imported meeting' });
    await storage().savePendingRecording(clip('private', 'other'));
    await fs.unlink(source); // Temporary recording cache is gone after restart.
    const uploads = [];
    let offline = true;
    let releaseUpload;
    let account = 'owner';
    let sessionAccount = 'owner';
    let foreground;
    let tick;
    function mount() {
      const state = hooks();
      const { usePendingRecordings } = load('hooks/usePendingRecordings.ts', {
        react: state.react, 'react-native': { Platform: { OS: 'ios' }, AppState: {
          currentState: 'active', addEventListener: (_, callback) => { foreground = callback; return { remove() {} }; },
        } },
        '@/auth/AuthContext': { useAuth: () => ({ user: { id: account }, accessToken: 'expired-token' }) },
        '@/api/supabase': { supabase: { auth: { getSession: async () => ({ data: {
          session: { user: { id: sessionAccount }, access_token: 'refreshed-token' },
        } }) } } },
        '@/api/http': http, '@/storage/pendingRecordings': storage(),
        '@/privacy/aiConsent': { hasAIConsent: async () => true },
        '@/api/client': { async uploadSession(token, audio, metadata) {
          uploads.push({ token, metadata });
          assert.equal(await fs.readFile(audio.uri, 'utf8'), 'actual saved audio bytes');
          if (offline) throw new TypeError('Network request failed');
          if (metadata.recordingId === 'one') await new Promise(r => { releaseUpload = r; });
          return { debrief: { id: metadata.recordingId } };
        } },
      }, { setInterval: callback => { tick = callback; return 1; }, clearInterval() {} });
      const render = () => state.render(usePendingRecordings);
      render();
      return { render, unmount: state.unmount };
    }
    mounted = mount();
    await until(() => mounted.render().pendingRecordings[0]?.error);
    assert.equal((await storage().listPendingRecordings('owner')).length, 2);
    const originalRequest = uploads[0];
    mounted.unmount();

    account = 'other'; sessionAccount = 'other';
    mounted = mount();
    await until(() => mounted.render().pendingRecordings[0]?.error);
    assert.deepEqual(mounted.render().pendingRecordings.map(row => row.id), ['private']);
    mounted.unmount();

    account = 'owner'; // A mismatched refreshed session must never receive this owner's audio.
    mounted = mount();
    await until(() => mounted.render().pendingRecordings.length === 2);
    const attempts = uploads.length;
    tick();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(uploads.length, attempts);
    sessionAccount = 'owner'; offline = false;
    foreground('active');
    await until(() => releaseUpload);
    tick(); foreground('active');
    await mounted.render().discard(mounted.render().pendingRecordings[0]);
    assert.equal((await storage().listPendingRecordings('owner')).length, 2);
    assert.equal(uploads.length, attempts + 1);
    assert.deepEqual(uploads.at(-1), originalRequest);
    await mounted.render().enqueue({ ...(await storage().listPendingRecordings('owner'))[0], id: 'three' });
    assert.equal(mounted.render().pendingRecordings.length, 3, 'New saved clips must appear while an earlier upload is running');
    releaseUpload();
    await until(() => mounted.render().latestDebrief?.id === 'two');
    tick();
    await until(async () => (await storage().listPendingRecordings('owner')).length === 0);
    await until(() => mounted.render().latestDebrief?.id === 'three');
    assert.deepEqual(uploads.slice(-3).map(row => row.metadata.recordingId), ['one', 'two', 'three']);
    assert.equal(uploads.find(row => row.metadata.recordingId === 'two').metadata.title, 'Imported meeting');
    assert.equal(uploads.find(row => row.metadata.recordingId === 'one').metadata.title, 'Recorded conversation');
    assert.equal((await storage().listPendingRecordings('other')).length, 1);
    assert.equal(uploads.at(-1).token, 'refreshed-token');
  } finally {
    mounted?.unmount();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'mirra-recording-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native save failures preserve source bytes; restart recovers a temporary manifest and legacy filenames', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'mirra-storage-reliability-'));
  const cache = join(root, 'cache');
  await fs.mkdir(cache);
  const source = join(cache, 'original.m4a');
  let failAt;
  const disk = {
    documentDirectory: `${root}/`, cacheDirectory: `${cache}/`,
    makeDirectoryAsync: path => fs.mkdir(path, { recursive: true }),
    async copyAsync({ from, to }) { if (failAt === 'copy') throw new Error('Storage full'); await fs.copyFile(from, to); },
    async writeAsStringAsync(path, text) { if (failAt === 'write') throw new Error('Storage full'); await fs.writeFile(path, text); },
    async moveAsync({ from, to }) { if (failAt === 'move') throw new Error('Storage full'); await fs.rename(from, to); },
    readAsStringAsync: path => fs.readFile(path, 'utf8'), readDirectoryAsync: path => fs.readdir(path),
    async getInfoAsync(path) { return { exists: await fs.stat(path).then(() => true, () => false) }; },
    deleteAsync: path => fs.rm(path, { recursive: true, force: true }),
  };
  const storage = () => load('storage/pendingRecordings.ts', { 'expo-file-system/legacy': disk });
  const clip = id => ({ id, userId: 'owner', startedAt: '2026-09-18T00:00:00Z', seconds: 4,
    audio: { uri: source, name: '../recording.json', type: 'audio/mp4' } });
  try {
    await fs.writeFile(source, 'original audio');
    for (failAt of ['copy', 'write', 'move']) {
      await assert.rejects(storage().savePendingRecording(clip(failAt)), /Storage full/);
      assert.equal(await fs.readFile(source, 'utf8'), 'original audio');
    }
    const recovered = await storage().listPendingRecordings('owner');
    assert.deepEqual(recovered.map(row => row.id), ['move']);
    assert.equal(await fs.readFile((await storage().readPendingAudio(recovered[0])).uri, 'utf8'), 'original audio');
    failAt = undefined;
    const saved = await storage().savePendingRecording(clip('saved'));
    assert.equal(saved.audio.name, '../recording.json');
    assert.equal(saved.audio.uri, `${root}/pending-recordings/owner/saved/audio`);
    assert.equal(await fs.readFile(saved.audio.uri, 'utf8'), 'original audio');
    await assert.rejects(fs.access(source)); // Only the cache copy is removed after commit.
    const folder = `${root}/pending-recordings/owner/saved`;
    await fs.rename(saved.audio.uri, `${folder}/legacy.m4a`);
    await fs.writeFile(`${folder}/recording.json`, JSON.stringify({ ...saved,
      audio: { ...saved.audio, name: 'legacy.m4a', uri: 'file:///previous-ios-container/legacy.m4a' },
    }));
    const restored = (await storage().listPendingRecordings('owner')).find(row => row.id === 'saved');
    assert.equal(await fs.readFile(restored.audio.uri, 'utf8'), 'original audio');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('queued recordings wait for consent and remain saved when consent is withdrawn during preparation or between uploads', async () => {
  const state = hooks();
  const choices = new Map();
  const dialogs = [];
  const privacy = load('privacy/aiConsent.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async key => choices.get(key) ?? null,
      setItem: async (key, value) => { choices.set(key, value); },
      removeItem: async key => { choices.delete(key); },
    },
    'react-native': { Platform: { OS: 'ios' }, Alert: {
      alert: (_, __, buttons) => dialogs.push(buttons),
    } },
  });
  let rows = ['one', 'two'].map(id => ({ id, userId: 'owner', seconds: 5,
    startedAt: '2026-09-13T12:00:00Z', audio: { uri: `file:///${id}.m4a`, name: `${id}.m4a`, type: 'audio/mp4' } }));
  const uploads = [];
  let withdrawOnRead = true;
  let released = 0;
  let tick;
  const { usePendingRecordings } = load('hooks/usePendingRecordings.ts', {
    react: state.react,
    'react-native': { Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' } }) },
    '@/api/supabase': { supabase: { auth: { getSession: async () => ({ data: {
      session: { user: { id: 'owner' }, access_token: 'token' },
    } }) } } },
    '@/privacy/aiConsent': privacy, '@/api/http': http,
    '@/storage/pendingRecordings': {
      listPendingRecordings: async () => [...rows],
      async readPendingAudio(row) {
        if (withdrawOnRead) { withdrawOnRead = false; await privacy.withdrawAIConsent('owner'); }
        return row.audio;
      },
      releasePendingAudio() { released++; },
      async removePendingRecording(row) { rows = rows.filter(item => item.id !== row.id); },
    },
    '@/api/client': { async uploadSession(_, audio, metadata) {
      uploads.push(metadata.recordingId);
      if (metadata.recordingId === 'one') await privacy.withdrawAIConsent('owner');
      return { debrief: { id: metadata.recordingId } };
    } },
  }, { setInterval: callback => { tick = callback; return 1; }, clearInterval() {} });
  const render = () => state.render(usePendingRecordings);
  async function choose(allow) {
    const action = render().resumeUploads();
    const count = dialogs.length;
    await until(() => dialogs.length > count);
    dialogs.at(-1)[allow ? 1 : 0].onPress();
    await action;
  }
  try {
    render();
    await until(() => render().needsAIConsent);
    assert.equal(dialogs.length, 0, 'Automatic retries must not open consent dialogs');
    assert.equal(uploads.length, 0);
    assert.equal(rows.length, 2);
    await choose(false);
    tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(uploads.length, 0);
    assert.equal(dialogs.length, 1);

    await choose(true);
    await until(() => released === 1 && render().needsAIConsent);
    assert.equal(uploads.length, 0, 'Withdrawing while loading audio must prevent the request');
    assert.equal(rows.length, 2);
    await choose(true);
    await until(() => uploads.length === 1 && render().needsAIConsent);
    assert.deepEqual(rows.map(row => row.id), ['two']);
    assert.equal(dialogs.length, 3, 'Withdrawal pauses remaining uploads without prompting');
    await choose(true);
    await until(() => rows.length === 0);
    assert.deepEqual(uploads, ['one', 'two']);
  } finally {
    state.unmount();
  }
});

test('expired cached sign-in opens offline and a later sign-out wins over initialization', async () => {
  const state = hooks();
  const cached = { user: { id: 'owner' }, access_token: 'expired', refresh_token: 'refresh', expires_at: 1 };
  let finishSession;
  let authEvent;
  const { AuthProvider } = load('auth/AuthContext.tsx', {
    react: state.react, 'react-native': { Platform: { OS: 'ios' }, Linking: {
      getInitialURL: async () => null, addEventListener: () => ({ remove() {} }),
    } },
    '@react-native-async-storage/async-storage': { getItem: async () => JSON.stringify(cached) },
    'expo-auth-session': {}, 'expo-auth-session/build/QueryParams': {},
    'expo-web-browser': { maybeCompleteAuthSession() {} }, '@/api/auth': {},
    '@/api/supabase': { authStorageKey: 'test', supabase: { auth: {
      getSession: () => new Promise(r => { finishSession = r; }),
      onAuthStateChange: callback => { authEvent = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    } } },
  });
  const render = () => state.render(() => AuthProvider({ children: null })).props.value;
  render();
  await until(() => !render().initializing);
  assert.equal(render().user.id, 'owner');
  authEvent('INITIAL_SESSION', null);
  finishSession({ data: { session: null }, error: new TypeError('Network request failed') });
  await new Promise(r => setImmediate(r));
  assert.equal(render().user.id, 'owner');
  authEvent('SIGNED_OUT', null);
  assert.equal(render().session, null);
  state.unmount();
});
