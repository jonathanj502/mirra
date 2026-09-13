import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import ts from 'typescript';

// Run the actual TS hooks with controlled native/network boundaries; no microphone or account is used.
function load(file, dependencies, window) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } });
  const module = { exports: {} };
  const require = (name) => {
    assert.ok(name in dependencies, `Missing test dependency: ${name}`);
    return dependencies[name];
  };
  new Function('require', 'module', 'exports', 'window', outputText)(require, module, module.exports, window);
  return module.exports;
}

function hooks() {
  const slots = [];
  let cursor = 0;
  let focus;
  return {
    react: { ...React,
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
      },
      useRef(initial) {
        const i = cursor++;
        return slots[i] ??= { current: initial };
      },
      useCallback: callback => callback,
      useEffect() {},
    },
    router: { useFocusEffect: callback => { focus = callback; } },
    render(callback) { cursor = 0; return callback(); },
    focus: () => focus(),
  };
}

const auth = { useAuth: () => ({ accessToken: 'test-token' }) };
const http = load('api/http.ts', { '@/config/env': { env: { backendUrl: 'http://test.invalid' } } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('OAuth callback removes credentials before session setup, preserves unrelated URL state, and cleans failed callbacks', async () => {
  const window = { location: { href: '' }, history: { state: { key: 'router' },
    replaceState(state, _, url) { assert.equal(state.key, 'router'); window.location.href = url; },
  } };
  let session;
  let fail = false;
  const { createSessionFromUrl } = load('auth/AuthContext.tsx', {
    react: React, 'react-native': { Platform: { OS: 'web' } },
    'expo-auth-session': {}, 'expo-web-browser': { maybeCompleteAuthSession() {} },
    'expo-auth-session/build/QueryParams': { getQueryParams(input) {
      const url = new URL(input);
      return { params: Object.fromEntries([...url.searchParams, ...new URLSearchParams(url.hash.slice(1))]) };
    } },
    '@/api/auth': {}, '@/api/supabase': { supabase: { auth: {
      async setSession(value) {
        assert.doesNotMatch(window.location.href, /access_token|refresh_token|provider_token/);
        session = value;
        return { error: fail ? new Error('expired') : null };
      },
      async exchangeCodeForSession(code) {
        assert.equal(code, 'test-code');
        assert.equal(new URL(window.location.href).searchParams.has('code'), false);
        return { error: null };
      },
    } } },
  }, window);
  const callback = 'http://localhost:8081/?checkout=success#access_token=test-access&refresh_token=test-refresh&provider_token=test-provider&expires_in=3600&tab=record';
  window.location.href = callback;
  await createSessionFromUrl(callback);
  assert.deepEqual(session, { access_token: 'test-access', refresh_token: 'test-refresh' });
  assert.equal(window.location.href, 'http://localhost:8081/?checkout=success#tab=record');
  window.location.href = 'http://localhost:8081/?code=test-code&checkout=success';
  await createSessionFromUrl(window.location.href);
  assert.equal(window.location.href, 'http://localhost:8081/?checkout=success');
  fail = true;
  window.location.href = callback;
  await assert.rejects(createSessionFromUrl(callback), /expired/);
  assert.doesNotMatch(window.location.href, /test-access|test-refresh|test-provider/);
});

test('a failed recording upload retains the same clip for retry and cannot be overwritten by a new recording', async () => {
  const state = hooks();
  let stops = 0;
  let starts = 0;
  const uploads = [];
  const debrief = { id: 'saved' };
  const { useRecordAudio } = load('hooks/useRecordAudio.ts', {
    react: state.react, 'react-native': { Platform: { OS: 'web' }, NativeModules: {} },
    '@/auth/AuthContext': auth, '@/api/http': http,
    '@/api/client': { async uploadSession(_, audio, metadata) {
      uploads.push({ audio, metadata });
      if (uploads.length === 1) throw new TypeError('Failed to fetch');
      return { debrief };
    } },
    'expo-av': { InterruptionModeAndroid: {}, InterruptionModeIOS: {}, Audio: {
      requestPermissionsAsync: async () => ({ granted: true }), setAudioModeAsync: async () => {},
      RecordingOptionsPresets: { HIGH_QUALITY: {} }, Recording: { async createAsync() {
        starts++;
        return { status: { durationMillis: 7500 }, recording: {
          async stopAndUnloadAsync() { stops++; }, getURI: () => 'blob:test-recording',
        } };
      } },
    } },
  });
  let hook = state.render(useRecordAudio);
  await Promise.all([hook.startRecording(), hook.startRecording()]);
  assert.equal(starts, 1);
  hook = state.render(useRecordAudio);
  assert.equal(await hook.stopRecording(), null);
  hook = state.render(useRecordAudio);
  assert.equal(hook.isRecording, false);
  assert.equal(hook.hasPendingRecording, true);
  assert.equal(hook.error, 'Could not reach Mirra. Please try again.');
  await hook.startRecording();
  assert.equal(starts, 1);
  const retry = hook.toggleRecording();
  hook.discardRecording(); // An in-flight retry must retain its clip.
  assert.equal(state.render(useRecordAudio).hasPendingRecording, true);
  assert.equal(await retry, debrief);
  assert.equal(stops, 1);
  assert.deepEqual(uploads[0], uploads[1]);
  assert.equal(uploads[1].metadata.clientDurationSeconds, 7.5);
  hook = state.render(useRecordAudio);
  assert.equal(hook.hasPendingRecording, false);
  assert.equal(hook.error, null);
});

test('import failures are returned as visible error state on web', async () => {
  const state = hooks();
  const { useImportAudio } = load('hooks/useImportAudio.ts', {
    react: state.react, '@/auth/AuthContext': auth, '@/api/http': http,
    '@/api/client': {}, '@/utils/timeFormat': {}, 'expo-av': {},
    'expo-document-picker': { async getDocumentAsync() { throw new Error('Could not open audio file'); } },
  });
  assert.equal(await state.render(useImportAudio).importAudio(), null);
  assert.equal(state.render(useImportAudio).error, 'Could not open audio file');
  assert.equal(state.render(useImportAudio).importing, false);
});

test('focus refresh recovers a failed tab and an older request cannot overwrite newer data', async () => {
  const state = hooks();
  const requests = [];
  const fetcher = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  const { useAuthedFetch } = load('hooks/useAuthedFetch.ts', {
    react: state.react, 'expo-router': state.router, '@/auth/AuthContext': auth, '@/api/http': http,
  });
  const render = () => state.render(() => useAuthedFetch(fetcher, [], 'Could not load data'));
  render();
  const blur = state.focus();
  requests[0].reject(new TypeError('Failed to fetch'));
  await flush();
  assert.equal(render().error, 'Could not reach Mirra. Please try again.');
  blur();
  state.focus();
  requests[1].resolve(['new conversation']);
  await flush();
  assert.deepEqual(render().data, ['new conversation']);
  assert.equal(render().error, null);
  const older = render().refresh();
  const newer = render().refresh();
  requests[3].resolve(['latest']);
  await newer;
  requests[2].resolve(['outdated']);
  await older;
  assert.deepEqual(render().data, ['latest']);
});

test('plan loading needs no manual plan retry and only offers actions for a verified plan', () => {
  const state = hooks();
  let billingState = { billing: null, error: 'Offline', loadError: 'Offline' };
  const { ProfileScreen } = load('screens/ProfileScreen.tsx', {
    react: state.react, 'react-native': { StyleSheet: { create: styles => styles } },
    'expo-linear-gradient': {}, 'react-native-svg': {}, '@/components/Screen': {},
    '@/components/ui': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/theme/tokens': { colors: {}, fonts: {} }, '@/api/client': {}, '@/auth/AuthContext': auth,
    '@/hooks/useProfileSummary': { useProfileSummary: () => ({ summary: null, error: 'Offline' }) },
    '@/hooks/useBilling': { useBilling: () => billingState },
    '@/hooks/useUserSettings': { useUserSettings: () => ({ settings: {}, loadError: 'Offline' }) },
  });
  const tree = state.render(ProfileScreen);
  function text(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(text).join(' ');
    return [node.props?.value, node.props?.hint, text(node.props?.children)].filter(Boolean).join(' ');
  }
  const rendered = text(tree);
  assert.match(rendered, /Plan unavailable/);
  assert.match(rendered, /—/);
  assert.doesNotMatch(rendered, /conversations remaining|Try Pro free|Transcripts saved|Retry plan|Retry to load/);

  billingState = { billing: null, loading: true };
  const loading = text(state.render(ProfileScreen));
  assert.match(loading, /Loading plan/);
  assert.doesNotMatch(loading, /Plan unavailable|Retry plan|Try Pro free/);

  billingState = { billing: { isPro: false, freeConversationsRemaining: 3 } };
  const free = text(state.render(ProfileScreen));
  assert.match(free, /3 conversations remaining/);
  assert.match(free, /Try Pro free for 14 days/);
  assert.doesNotMatch(free, /Retry plan|Plan unavailable/);

  billingState = { billing: { isPro: true, status: 'active' } };
  const pro = text(state.render(ProfileScreen));
  assert.match(pro, /Unlimited conversations/);
  assert.match(pro, /Manage plan/);
  assert.doesNotMatch(pro, /Retry plan|Try Pro free/);
});
