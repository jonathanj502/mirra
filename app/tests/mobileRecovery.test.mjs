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

const goals = load('data/coachingGoals.ts', {});

const privacy = { requestAIConsent: async () => true, withdrawAIConsent: async () => {} };
const confirmation = { confirmAction: async () => true };

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
  let createFails = false;
  const audioModes = [];
  const { RecordingProvider } = load('hooks/useRecordAudio.ts', {
    react: state.react, 'react-native': { Platform: { OS: 'web' }, NativeModules: {} },
    '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' }, accessToken: null }) }, '@/api/http': http,
    '@/storage/pendingRecordings': { recordingId: () => `recording-${starts}` },
    '@/privacy/aiConsent': privacy, '@/utils/confirm': confirmation,
    './usePendingRecordings': { usePendingRecordings: () => ({ async enqueue(recording) {
      saved.push(recording);
      if (diskFull) throw new Error('Storage full');
    } }) },
    'expo-av': { InterruptionModeAndroid: {}, InterruptionModeIOS: {}, Audio: {
      requestPermissionsAsync: async () => ({ granted: true }), setAudioModeAsync: async mode => { audioModes.push(mode); },
      RecordingOptionsPresets: { HIGH_QUALITY: {} }, Recording: { async createAsync() {
        starts++;
        if (createFails) throw Error('Microphone is unavailable');
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
  createFails = true;
  await render().startRecording();
  assert.equal(render().isRecording, false);
  assert.equal(render().isStartingRecording, false);
  assert.equal(audioModes.at(-1).allowsRecordingIOS, false, 'A failed start must restore the audio session');
  assert.equal(render().error, 'Microphone is unavailable');
});

test('Android offers recording notifications once per launch and denial does not block capture', async () => {
  const state = hooks();
  const events = [];
  const { RecordingProvider } = load('hooks/useRecordAudio.ts', {
    react: state.react, 'react-native': { Platform: { OS: 'android', Version: 33 },
      PermissionsAndroid: { PERMISSIONS: { POST_NOTIFICATIONS: 'notifications' }, async request(permission) {
        assert.equal(permission, 'notifications'); events.push('permission'); return 'denied';
      } }, NativeModules: { RecordingService: {
        async startForegroundService() { events.push('service'); }, stopForegroundService() {},
      } } },
    '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' } }) }, '@/api/http': http,
    '@/storage/pendingRecordings': { recordingId: () => 'recording' },
    '@/privacy/aiConsent': privacy, '@/utils/confirm': confirmation,
    './usePendingRecordings': { usePendingRecordings: () => ({ async enqueue() {} }) },
    'expo-av': { InterruptionModeAndroid: {}, InterruptionModeIOS: {}, Audio: {
      requestPermissionsAsync: async () => ({ granted: true }), setAudioModeAsync: async () => {},
      RecordingOptionsPresets: { HIGH_QUALITY: {} }, Recording: { async createAsync() {
        events.push('capture');
        return { status: { durationMillis: 1000 }, recording: {
          stopAndUnloadAsync: async () => ({ durationMillis: 1000 }), getURI: () => 'file:///test.m4a',
        } };
      } },
    } },
  });
  const render = () => state.render(() => RecordingProvider({ children: null })).props.value;
  await render().startRecording();
  assert.deepEqual(events, ['permission', 'service', 'capture']);
  assert.equal(render().isRecording, true);
  await render().stopRecording();
  await render().startRecording();
  assert.deepEqual(events, ['permission', 'service', 'capture', 'service', 'capture']);
});

test('import failures are returned as visible error state on web', async () => {
  const state = hooks();
  const { useImportAudio } = load('hooks/useImportAudio.ts', {
    react: state.react, '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' } }) }, '@/api/http': http,
    '@/hooks/useRecordAudio': { useRecordAudio: () => ({}) }, '@/storage/pendingRecordings': {}, '@/utils/timeFormat': {}, 'expo-av': {},
    '@/privacy/aiConsent': privacy, '@/utils/confirm': confirmation,
    'expo-document-picker': { async getDocumentAsync() { throw new Error('Could not open audio file'); } },
  });
  assert.equal(await state.render(useImportAudio).importAudio(), null);
  assert.equal(state.render(useImportAudio).error, 'Could not open audio file');
  assert.equal(state.render(useImportAudio).importing, false);
});

test('import saves an account-owned copy to the offline queue and uses upstream AI consent', async () => {
  const state = hooks();
  let allowed = false;
  let asked = 0;
  let picks = 0;
  const saved = [];
  const { useImportAudio } = load('hooks/useImportAudio.ts', {
    react: state.react, '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' } }) }, '@/api/http': http,
    '@/privacy/aiConsent': { requestAIConsent: async () => { asked++; return allowed; } },
    '@/storage/pendingRecordings': { recordingId: () => 'stable-id' },
    '@/hooks/useRecordAudio': { useRecordAudio: () => ({ enqueue: async row => saved.push(row) }) },
    '@/utils/timeFormat': { titleFromFilename: () => 'Imported conversation' },
    'expo-av': { Audio: { Sound: { createAsync: async () => { throw Error('Browser cannot read duration'); } } } },
    'expo-document-picker': { getDocumentAsync: async () => { picks++; return { assets: [{ uri: 'file://original', name: '../unsafe.mp3', size: 40 }] }; } },
  });
  const render = () => state.render(useImportAudio);
  await render().importAudio();
  assert.equal(asked, 1); assert.equal(picks, 0);
  assert.equal(saved.length, 0);
  allowed = true;
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
    '@/data/coachingGoals': goals,
    react: state.react, 'react-native': { StyleSheet: { create: styles => styles } },
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({}) }, 'expo-linear-gradient': {}, 'react-native-svg': {}, '@/components/Screen': {},
    '@/components/ui': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/theme/tokens': { colors: {}, fonts: {} }, '@/api/client': {}, '@/auth/AuthContext': auth,
    '@/utils/exportData': {}, '@/utils/confirm': confirmation, '@/storage/pendingRecordings': {}, '@/config/legal': {},
    '@/privacy/aiConsent': privacy, '@/hooks/useRecordAudio': { useRecordAudio: () => ({}) },
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

test('conversation goals round-trip through the API and profile choices save the selected goal', async (t) => {
  const api = load('api/client.ts', { '@/api/http': http });
  let stored = {};
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'PATCH') stored = { ...stored, ...JSON.parse(options.body) };
    return new Response(JSON.stringify(stored));
  });
  assert.equal((await api.fetchUserSettings('owner')).coachingGoal, 'general');
  let settings = await api.updateUserSettings('owner', { coachingGoal: 'make_friends' });
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { coaching_goal: 'make_friends' });
  assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer owner');
  assert.equal((await api.fetchUserSettings('owner')).coachingGoal, 'make_friends');
  const state = hooks();
  let saving = false;
  const changes = [];
  const { ProfileScreen } = load('screens/ProfileScreen.tsx', {
    react: state.react, 'react-native': { StyleSheet: { create: styles => styles } },
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({}) },
    'expo-linear-gradient': {}, 'react-native-svg': {}, '@/components/Screen': {}, '@/components/ui': {},
    '@/components/Typography': {}, '@/components/Icon': { Icon: {} }, '@/theme/tokens': { colors: {}, fonts: {} },
    '@/api/client': api, '@/auth/AuthContext': auth, '@/data/coachingGoals': goals,
    '@/utils/exportData': {}, '@/utils/confirm': confirmation, '@/storage/pendingRecordings': {}, '@/config/legal': {},
    '@/privacy/aiConsent': privacy, '@/hooks/useRecordAudio': { useRecordAudio: () => ({}) },
    '@/hooks/useProfileSummary': { useProfileSummary: () => ({ summary: null }) },
    '@/hooks/useUserSettings': { useUserSettings: () => ({ settings, saving,
      updateSettings: async patch => { changes.push(patch); settings = await api.updateUserSettings('owner', patch); } }) },
  });
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
  }
  find(state.render(ProfileScreen), node => node.props?.label === 'Your conversation goal').props.onPress();
  const sheet = find(state.render(ProfileScreen), node => node.type?.name === 'SettingsSheet');
  assert.equal(sheet.props.panel, 'goal');
  const tree = sheet.type(sheet.props);
  for (const option of goals.COACHING_GOALS) {
    const choice = find(tree, node => node.props?.label === option.label);
    assert.equal(choice.props.selected, option.value === 'make_friends');
    choice.props.onPress();
    await flush();
    assert.equal(settings.coachingGoal, option.value);
  }
  assert.deepEqual(changes.map(patch => patch.coachingGoal), goals.COACHING_GOALS.map(goal => goal.value));
  saving = true;
  const busy = find(state.render(ProfileScreen), node => node.type?.name === 'SettingsSheet');
  const busyTree = busy.type(busy.props);
  assert.equal(find(busyTree, node => node.props?.children?.props?.children === 'Done').props.disabled, true);
});

test('account actions save audio before sign-out and clear local data only after confirmed server deletion', async () => {
  const state = hooks();
  const events = [];
  let recording = true;
  let canSave = false;
  let deleteSucceeds = false;
  const { ProfileScreen } = load('screens/ProfileScreen.tsx', {
    '@/data/coachingGoals': goals,
    react: state.react, 'react-native': { StyleSheet: { create: value => value } },
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({}) }, 'expo-linear-gradient': {}, 'react-native-svg': {},
    '@/components/Screen': {}, '@/components/ui': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/theme/tokens': { colors: {}, fonts: {} }, '@/utils/exportData': {}, '@/config/legal': {},
    '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' }, accessToken: 'owner-token', signOut: async () => events.push('sign-out') }) },
    '@/api/client': { deleteAccount: async token => { assert.equal(token, 'owner-token'); events.push('server-delete'); if (!deleteSucceeds) throw Error('Server unavailable'); } },
    '@/utils/confirm': { confirmAction: async () => true },
    '@/storage/pendingRecordings': { clearPendingRecordings: async user => { assert.equal(user, 'owner'); events.push('clear-local'); } },
    '@/privacy/aiConsent': { withdrawAIConsent: async () => events.push('clear-consent') },
    '@/hooks/useRecordAudio': { useRecordAudio: () => ({ isRecording: recording,
      stopRecording: async () => { events.push('save-recording'); return canSave; },
      pauseUploads: () => events.push('pause'), unpauseUploads: () => events.push('resume') }) },
    '@/hooks/useProfileSummary': { useProfileSummary: () => ({ summary: null }) },
    '@/hooks/useUserSettings': { useUserSettings: () => ({ settings: {} }) },
  });
  function findMenu(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.onDelete) return node.props;
    for (const child of [node.props?.children].flat(Infinity)) { const found = findMenu(child); if (found) return found; }
  }
  const menu = () => findMenu(state.render(ProfileScreen));
  function footerSignOut(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.accessibilityLabel === 'Sign out') return node.props;
    for (const child of [node.props?.children].flat(Infinity)) { const found = footerSignOut(child); if (found) return found; }
  }
  await footerSignOut(state.render(ProfileScreen)).onPress();
  assert.deepEqual(events, ['save-recording'], 'The secondary sign-out path must preserve unsaved audio too');
  events.length = 0;
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
    '@/data/coachingGoals': goals,
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

test('AI consent requires explicit approval, survives restart per account, and can be withdrawn', async () => {
  const saved = new Map();
  const dialogs = [];
  let storageFails = false;
  const storage = {
    async getItem(key) { return saved.get(key) ?? null; },
    async setItem(key, value) {
      if (storageFails) throw new Error('Storage full');
      saved.set(key, value);
    },
    async removeItem(key) { saved.delete(key); },
  };
  const dependencies = {
    '@react-native-async-storage/async-storage': storage,
    'react-native': { Platform: { OS: 'ios' }, Alert: { alert(title, message, buttons, options) {
      dialogs.push({ title, message, buttons, options });
    } } },
  };
  const consent = load('privacy/aiConsent.ts', dependencies);
  const denied = consent.requestAIConsent('alice', true);
  const duplicate = consent.requestAIConsent('alice', true);
  await flush();
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].message, /We don’t sell your data/);
  assert.match(dialogs[0].message, /audio, transcripts, metrics, and chats with OpenAI/);
  assert.match(dialogs[0].message, /Recording continues when your screen locks/);
  dialogs[0].options.onDismiss();
  assert.deepEqual(await Promise.all([denied, duplicate]), [false, false]);
  assert.equal(saved.size, 0);
  assert.equal(await consent.hasAIConsent('alice'), false);

  const accepted = consent.requestAIConsent('alice', true);
  await flush();
  dialogs.at(-1).buttons.find(button => button.text === 'Allow').onPress();
  assert.equal(await accepted, true);
  assert.equal(await consent.hasAIConsent('alice'), true);
  const restarted = load('privacy/aiConsent.ts', dependencies);
  assert.equal(await restarted.requestAIConsent('alice', true), true);
  assert.equal(dialogs.length, 2);

  const bob = restarted.requestAIConsent('bob');
  await flush();
  assert.doesNotMatch(dialogs.at(-1).message, /screen locks/);
  dialogs.at(-1).buttons[1].onPress();
  assert.equal(await bob, true);
  const firstRecording = restarted.requestAIConsent('bob', true);
  await flush();
  assert.equal(dialogs.at(-1).title, 'Background recording');
  dialogs.at(-1).buttons[0].onPress();
  assert.equal(await firstRecording, false);
  assert.equal(await restarted.requestAIConsent('bob'), true);

  await restarted.withdrawAIConsent('alice');
  assert.equal(await restarted.hasAIConsent('alice'), false);
  const revoked = restarted.requestAIConsent('alice');
  await flush();
  assert.equal(dialogs.at(-1).title, 'Privacy & AI');
  dialogs.at(-1).buttons[0].onPress();
  assert.equal(await revoked, false);
  assert.equal(await restarted.requestAIConsent(), false);

  storageFails = true;
  const failed = assert.rejects(restarted.requestAIConsent('alice'), /Could not save your privacy choice/);
  await flush();
  dialogs.at(-1).buttons[1].onPress();
  await failed;
  assert.equal(saved.size, 1); // Only Bob's earlier approval remains.

  storageFails = false;
  let allowWeb = false;
  const web = load('privacy/aiConsent.ts', {
    ...dependencies, 'react-native': { Platform: { OS: 'web' } },
  }, { confirm(message) { assert.match(message, /Privacy & AI/); return allowWeb; } });
  assert.equal(await web.requestAIConsent('web-user'), false);
  allowWeb = true;
  assert.equal(await web.requestAIConsent('web-user'), true);
});


test('Reflect preserves the draft and sends no message or fallback when consent is declined or unavailable', async () => {
  const state = hooks();
  let choice = false;
  const sent = [];
  const { ReflectScreen } = load('screens/ReflectScreen.tsx', {
    react: state.react,
    'react-native': { TextInput: 'TextInput', Platform: { OS: 'ios' }, StyleSheet: { create: styles => styles } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({}) },
    'react-native-svg': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/theme/tokens': { colors: {}, fonts: {} }, '@/auth/AuthContext': auth, '@/hooks/useDebriefs': {},
    '@/api/http': http,
    '@/data/reflect': { SEED_MESSAGES: [], STARTER_PROMPTS: [], CANNED_REPLIES: ['fallback'] },
    '@/privacy/aiConsent': { async requestAIConsent() { if (choice instanceof Error) throw choice; return choice; } },
    '@/api/client': { async sendReflection(_, payload) { sent.push(payload); return { usedModel: true, reply: 'reply' }; } },
  });
  function findInput(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'TextInput') return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const input = findInput(child);
      if (input) return input;
    }
  }
  const render = () => state.render(ReflectScreen);
  findInput(render()).props.onChangeText('Keep this draft');
  await findInput(render()).props.onSubmitEditing();
  assert.equal(sent.length, 0);
  assert.equal(findInput(render()).props.value, 'Keep this draft');
  assert.doesNotMatch(JSON.stringify(render()), /fallback/);
  choice = new Error('Privacy choice unavailable');
  await findInput(render()).props.onSubmitEditing();
  assert.equal(sent.length, 0);
  assert.equal(findInput(render()).props.value, 'Keep this draft');
  assert.match(JSON.stringify(render()), /Privacy choice unavailable/);
  choice = true;
  await findInput(render()).props.onSubmitEditing();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].prompt, 'Keep this draft');
  assert.deepEqual(sent[0].messages, []);
  assert.equal(findInput(render()).props.value, '');
});
