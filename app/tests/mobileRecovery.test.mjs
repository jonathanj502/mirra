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

const privacy = { usePrivacy: () => ({ canProcess: true, reviewConsent() {}, withdrawLocally: async () => {} }) };
const confirmation = { confirmRecordingPermission: async () => true, confirmAction: async () => true };

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
    '@react-native-async-storage/async-storage': {},
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
  const callback = 'http://localhost:8081/?tab=profile#access_token=test-access&refresh_token=test-refresh&provider_token=test-provider&expires_in=3600&tab=record';
  window.location.href = callback;
  await createSessionFromUrl(callback);
  assert.deepEqual(session, { access_token: 'test-access', refresh_token: 'test-refresh' });
  assert.equal(window.location.href, 'http://localhost:8081/?tab=profile#tab=record');
  window.location.href = 'http://localhost:8081/?code=test-code&tab=profile';
  await createSessionFromUrl(window.location.href);
  assert.equal(window.location.href, 'http://localhost:8081/?tab=profile');
  fail = true;
  window.location.href = callback;
  await assert.rejects(createSessionFromUrl(callback), /expired/);
  assert.doesNotMatch(window.location.href, /test-access|test-refresh|test-provider/);
});

test('recording saves before upload, allows another offline clip, and retains the original if storage fails', async () => {
  const state = hooks();
  let stops = 0;
  let starts = 0;
  const saved = [];
  let diskFull = true;
  let stoppedByOS = false;
  const { RecordingProvider } = load('hooks/useRecordAudio.ts', {
    react: state.react, 'react-native': { Platform: { OS: 'web' }, NativeModules: {} },
    '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' }, accessToken: null }) }, '@/api/http': http,
    '@/storage/pendingRecordings': { recordingId: () => `recording-${starts}` },
    '@/auth/PrivacyContext': privacy, '@/utils/confirm': confirmation,
    './usePendingRecordings': { usePendingRecordings: () => ({ async enqueue(recording) {
      saved.push(recording);
      if (diskFull) throw new Error('Storage full');
    } }) },
    'expo-av': { InterruptionModeAndroid: {}, InterruptionModeIOS: {}, Audio: {
      requestPermissionsAsync: async () => ({ granted: true }), setAudioModeAsync: async () => {},
      RecordingOptionsPresets: { HIGH_QUALITY: {} }, Recording: { async createAsync() {
        starts++;
        return { status: { durationMillis: 7500 }, recording: {
          async stopAndUnloadAsync() { stops++; if (stoppedByOS) throw Error('Already stopped'); return { durationMillis: 7500 }; },
          getStatusAsync: async () => ({ isDoneRecording: stoppedByOS, durationMillis: 7500 }), getURI: () => 'blob:test-recording',
        } };
      } },
    } },
  });
  const render = () => state.render(() => RecordingProvider({ children: null })).props.value;
  let hook = render();
  await Promise.all([hook.startRecording(), hook.startRecording()]);
  assert.equal(starts, 1);
  hook = render();
  await hook.stopRecording();
  hook = render();
  assert.equal(hook.isRecording, false);
  assert.equal(hook.hasUnsavedRecording, true);
  assert.match(hook.error, /not saved yet/);
  await hook.startRecording();
  assert.equal(starts, 1);
  diskFull = false;
  await hook.toggleRecording();
  assert.equal(stops, 1);
  assert.deepEqual(saved[0], saved[1]);
  assert.equal(saved[1].seconds, 7.5);
  assert.equal(saved[1].userId, 'owner');
  hook = render();
  assert.equal(hook.hasUnsavedRecording, false);
  assert.equal(hook.error, null);
  await hook.startRecording();
  assert.equal(starts, 2);
  stoppedByOS = true;
  assert.equal(await render().stopRecording(), true);
  assert.equal(render().isRecording, false);
  assert.equal(saved.at(-1).seconds, 7.5);
});

test('import failures are returned as visible error state on web', async () => {
  const state = hooks();
  const { useImportAudio } = load('hooks/useImportAudio.ts', {
    react: state.react, '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' } }) }, '@/api/http': http,
    '@/hooks/useRecordAudio': { useRecordAudio: () => ({}) }, '@/storage/pendingRecordings': {}, '@/utils/timeFormat': {}, 'expo-av': {},
    '@/auth/PrivacyContext': privacy, '@/utils/confirm': confirmation,
    'expo-document-picker': { async getDocumentAsync() { throw new Error('Could not open audio file'); } },
  });
  assert.equal(await state.render(useImportAudio).importAudio(), null);
  assert.equal(state.render(useImportAudio).error, 'Could not open audio file');
  assert.equal(state.render(useImportAudio).importing, false);
});

test('import saves an account-owned copy to the offline queue and requires AI and participant consent', async () => {
  const state = hooks();
  let canProcess = false;
  let permission = false;
  let asked = 0;
  let picks = 0;
  const saved = [];
  const { useImportAudio } = load('hooks/useImportAudio.ts', {
    react: state.react, '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' } }) }, '@/api/http': http,
    '@/auth/PrivacyContext': { usePrivacy: () => ({ canProcess, reviewConsent: () => asked++ }) },
    '@/utils/confirm': { confirmRecordingPermission: async () => permission },
    '@/storage/pendingRecordings': { recordingId: () => 'stable-id' },
    '@/hooks/useRecordAudio': { useRecordAudio: () => ({ enqueue: async row => saved.push(row) }) },
    '@/utils/timeFormat': { titleFromFilename: () => 'Imported conversation' },
    'expo-av': { Audio: { Sound: { createAsync: async () => { throw Error('Browser cannot read duration'); } } } },
    'expo-document-picker': { getDocumentAsync: async () => { picks++; return { assets: [{ uri: 'file://original', name: '../unsafe.mp3', size: 40 }] }; } },
  });
  const render = () => state.render(useImportAudio);
  await render().importAudio();
  assert.equal(asked, 1); assert.equal(picks, 0);
  canProcess = true;
  await render().importAudio();
  assert.equal(saved.length, 0);
  permission = true;
  const hook = render();
  await Promise.all([hook.importAudio(), hook.importAudio()]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'stable-id');
  assert.equal(saved[0].userId, 'owner');
  assert.equal(saved[0].audio.name, 'mirra-import-stable-id.mp3');
  assert.equal(saved[0].audio.uri, 'file://original');
  assert.equal(render().error, null);
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

test('rapid privacy setting changes save in order and a failure restores actual server state', async () => {
  const state = hooks();
  let settings = { saveTranscripts: false, includeTranscriptInReflect: false };
  const server = { saveTranscripts: true, includeTranscriptInReflect: false };
  const requests = [];
  const { useUserSettings } = load('hooks/useUserSettings.ts', {
    react: state.react, '@/api/http': http,
    '@/api/client': { updateUserSettings: (token, patch) => new Promise((resolve, reject) => requests.push({ token, patch, resolve, reject })) },
    './useAuthedFetch': { useAuthedFetch: () => ({ data: settings,
      setData: value => { settings = typeof value === 'function' ? value(settings) : value; }, refresh: async () => { settings = server; } }) },
  });
  const render = () => state.render(() => useUserSettings('owner-token'));
  const hook = render();
  const first = hook.updateSettings({ saveTranscripts: true });
  const second = hook.updateSettings({ includeTranscriptInReflect: true });
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(settings.includeTranscriptInReflect, true);
  requests[0].resolve(server);
  await first; await flush();
  assert.equal(requests.length, 2);
  assert.equal(settings.includeTranscriptInReflect, true, 'Older response must not erase the newer choice');
  requests[1].reject(Error('Could not save privacy setting'));
  await second;
  assert.deepEqual(settings, server);
  assert.equal(render().saving, false);
  assert.match(render().error, /Could not save privacy setting/);
});

test('profile loads account data without a plan request', () => {
  const state = hooks();
  let summaryState = { summary: null, error: 'Offline' };
  const { ProfileScreen } = load('screens/ProfileScreen.tsx', {
    react: state.react, 'react-native': { StyleSheet: { create: styles => styles } },
    'expo-router': { useRouter: () => ({}) }, 'expo-linear-gradient': {}, 'react-native-svg': {}, '@/components/Screen': {},
    '@/components/ui': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/theme/tokens': { colors: {}, fonts: {} }, '@/api/client': {}, '@/auth/AuthContext': auth,
    '@/utils/exportData': {}, '@/utils/confirm': confirmation, '@/storage/pendingRecordings': {}, '@/config/legal': {},
    '@/auth/PrivacyContext': privacy, '@/hooks/useRecordAudio': { useRecordAudio: () => ({}) },
    '@/hooks/useProfileSummary': { useProfileSummary: () => summaryState },
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
  assert.match(rendered, /—/);
  assert.doesNotMatch(rendered, /Current plan|Try Pro|Manage plan|Transcripts saved/);

  summaryState = { summary: { totalConversations: 7, usedThisMonth: 2 } };
  const loaded = text(state.render(ProfileScreen));
  assert.match(loaded, /7/);
  assert.match(loaded, /2/);
  assert.doesNotMatch(loaded, /Current plan|Try Pro|Manage plan/);
});

test('account actions save audio before sign-out and clear local data only after confirmed server deletion', async () => {
  const state = hooks();
  const events = [];
  let recording = true;
  let canSave = false;
  let deleteSucceeds = false;
  const { ProfileScreen } = load('screens/ProfileScreen.tsx', {
    react: state.react, 'react-native': { StyleSheet: { create: value => value } },
    'expo-router': { useRouter: () => ({}) }, 'expo-linear-gradient': {}, 'react-native-svg': {},
    '@/components/Screen': {}, '@/components/ui': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/theme/tokens': { colors: {}, fonts: {} }, '@/utils/exportData': {}, '@/config/legal': {},
    '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' }, accessToken: 'owner-token', signOut: async () => events.push('sign-out') }) },
    '@/api/client': { deleteAccount: async token => { assert.equal(token, 'owner-token'); events.push('server-delete'); if (!deleteSucceeds) throw Error('Server unavailable'); } },
    '@/utils/confirm': { confirmAction: async () => true },
    '@/storage/pendingRecordings': { clearPendingRecordings: async user => { assert.equal(user, 'owner'); events.push('clear-local'); } },
    '@/auth/PrivacyContext': { usePrivacy: () => ({ canProcess: true, withdrawLocally: async () => events.push('clear-consent') }) },
    '@/hooks/useRecordAudio': { useRecordAudio: () => ({ isRecording: recording,
      stopRecording: async () => { events.push('save-recording'); return canSave; },
      pauseUploads: () => events.push('pause'), resumeUploads: () => events.push('resume') }) },
    '@/hooks/useProfileSummary': { useProfileSummary: () => ({ summary: null }) },
    '@/hooks/useUserSettings': { useUserSettings: () => ({ settings: {} }) },
  });
  function findMenu(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.onDelete) return node.props;
    for (const child of [node.props?.children].flat(Infinity)) { const found = findMenu(child); if (found) return found; }
  }
  const menu = () => findMenu(state.render(ProfileScreen));
  await menu().onSignOut();
  assert.deepEqual(events, ['save-recording']);
  assert.match(menu().error, /not saved yet/);
  canSave = true;
  await menu().onSignOut();
  assert.deepEqual(events.slice(-2), ['save-recording', 'sign-out']);
  events.length = 0;
  await menu().onDelete(); await flush();
  assert.equal(events.length, 0, 'Active capture blocks account deletion');
  recording = false;
  await menu().onDelete(); await flush();
  assert.deepEqual(events, ['pause', 'server-delete', 'resume']);
  assert.match(menu().error, /Server unavailable/);
  events.length = 0; deleteSucceeds = true;
  await menu().onDelete(); await flush();
  assert.deepEqual(events, ['pause', 'server-delete', 'clear-local', 'clear-consent', 'sign-out', 'resume']);
});

test('conversation deletion confirms on web and native, retains failures, and navigates only after success', async (t) => {
  const api = load('api/client.ts', { '@/api/http': http });
  const state = hooks();
  let id = 'saved-conversation';
  let confirmed = false;
  const requests = [];
  const destinations = [];
  const platform = { OS: 'web' };
  let buttons;
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({ url, options, resolve })));
  const debrief = api.toDebrief({
    id, session_id: 'session', created_at: '2026-09-13T00:00:00Z',
    observation: 'A conversation.', pattern_to_reduce: 'Interruptions', thing_to_try_next: 'Pause',
    stats: { talk_listen_ratio: 1, question_count: 1, interruption_count: 0,
      session_duration_minutes: 2, user_speech_duration_minutes: 1, estimated_wpm: 120 },
  });
  const { AnalyticsScreen } = load('screens/AnalyticsScreen.tsx', {
    react: state.react,
    'react-native': { Platform: platform, Alert: { alert: (_title, _message, actions) => { buttons = actions; } },
      StyleSheet: { create: styles => styles } },
    'expo-router': { useLocalSearchParams: () => ({ id }), useRouter: () => ({ replace: path => destinations.push(path) }) },
    '@/auth/AuthContext': auth, '@/api/client': api, '@/api/http': http,
    '@/hooks/useDebriefs': { useDebriefs: () => ({ debriefs: [debrief], loading: false }),
      toConversationListItem: () => ({ title: 'A conversation', when: 'Today', duration: '2 min' }) },
    '@/utils/talkListen': { talkListenPercent: () => 50 },
    '@/theme/tokens': { colors: {}, fonts: {} }, '@/components/Screen': {},
    '@/components/ui': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/components/FloatingTabBar': {}, '@/components/ExpandableMetric': {},
    '@/components/ReflectCTA': {}, '@/components/charts': {}, '@/components/meters': {},
  }, { confirm: () => confirmed });
  const render = () => state.render(AnalyticsScreen);
  function deleteButton(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.accessibilityLabel === 'Delete conversation') return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = deleteButton(child);
      if (found) return found;
    }
  }

  deleteButton(render()).props.onPress();
  assert.equal(requests.length, 0);
  confirmed = true;
  const button = deleteButton(render());
  button.props.onPress();
  button.props.onPress();
  assert.equal(requests.length, 1);
  assert.equal(deleteButton(render()).props.disabled, true);
  assert.equal(requests[0].url, 'http://test.invalid/debriefs/saved-conversation');
  assert.equal(requests[0].options.method, 'DELETE');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(destinations, []);
  requests[0].resolve(new Response('{"detail":"Could not delete"}', { status: 500 }));
  await flush();
  assert.equal(render().props.error, 'Could not delete');
  assert.equal(deleteButton(render()).props.disabled, false);
  assert.deepEqual(destinations, []);

  platform.OS = 'ios';
  deleteButton(render()).props.onPress();
  assert.equal(requests.length, 1);
  assert.equal(buttons[0].style, 'cancel');
  assert.equal(buttons[1].style, 'destructive');
  buttons[1].onPress();
  requests[1].resolve(new Response(null, { status: 204 }));
  await flush();
  assert.equal(render().props.error, null);
  assert.deepEqual(destinations, ['/insights']);

  // A missing/deleted ID must never silently select another conversation to delete.
  id = 'missing-conversation';
  assert.equal(deleteButton(render()), undefined);
});
