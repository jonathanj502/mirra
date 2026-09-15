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

const auth = { useAuth: () => ({ accessToken: 'test-token', user: { id: 'test-user' } }) };
const consentGranted = { requestAIConsent: async () => true };
const http = load('api/http.ts', { '@/config/env': { env: { backendUrl: 'http://test.invalid' } } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('conversation deletion sends an authenticated DELETE and handles empty success and server errors', async (t) => {
  let status = 204;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://test.invalid/debriefs/conversation%2Fid');
    assert.equal(options.method, 'DELETE');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return new Response(status === 204 ? null : JSON.stringify({ detail: 'Deletion failed' }), { status });
  });
  const { deleteDebrief } = load('api/client.ts', { 'expo-file-system': {}, '@/api/http': http });
  assert.equal(await deleteDebrief('test-token', 'conversation/id'), undefined);
  status = 500;
  await assert.rejects(deleteDebrief('test-token', 'conversation/id'), /Deletion failed/);
});

test('deleting a conversation requires confirmation, targets the selected ID, and preserves it on failure', async () => {
  const state = hooks();
  const stats = {
    talkListenRatio: 1, questionCount: 2, interruptionCount: 0,
    sessionDurationMinutes: 5, userSpeechDurationMinutes: 2.5, estimatedWpm: 120,
    openQuestionCount: 1, closedQuestionCount: 1, totalWordCount: 300, uniqueWordCount: 100,
    fillerCounts: [], turnOffsetSeries: [], energyAxes: [], energyScore: 0,
    energySeriesUser: [], energySeriesOther: [], lsmScore: 0,
    lsmDimensionsUser: {}, lsmDimensionsReference: {},
  };
  const selected = { id: 'selected', observation: 'Selected conversation', stats };
  let debriefs = [{ id: 'newest', observation: 'Newest conversation', stats }, selected];
  let routeId = 'selected';
  const dialogs = [];
  const requests = [];
  const navigation = [];
  const platform = { OS: 'ios' };
  let confirmWeb = false;
  const { AnalyticsScreen } = load('screens/AnalyticsScreen.tsx', {
    react: state.react,
    'react-native': { Platform: platform, StyleSheet: { create: styles => styles },
      Alert: { alert(title, message, buttons, options) { dialogs.push({ title, message, buttons, options }); } },
    },
    'expo-router': { useLocalSearchParams: () => ({ id: routeId }), useRouter: () => ({ replace: path => navigation.push(path) }) },
    '@/components/Screen': {}, '@/components/ui': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/components/FloatingTabBar': {}, '@/components/ExpandableMetric': {}, '@/components/ReflectCTA': {},
    '@/components/charts': {}, '@/components/meters': {}, '@/theme/tokens': { colors: {}, fonts: {} },
    '@/auth/AuthContext': auth, '@/api/http': http, '@/utils/talkListen': { talkListenPercent: () => 50 },
    '@/hooks/useDebriefs': {
      useDebriefs: () => ({ debriefs, loading: false, setDebriefs: update => { debriefs = update(debriefs); } }),
      toConversationListItem: row => ({ title: row.observation, when: 'Today', duration: '5 min' }),
    },
    '@/api/client': { deleteDebrief: (token, id) => new Promise((resolve, reject) => requests.push({ token, id, resolve, reject })) },
  }, { confirm: () => confirmWeb });
  function deleteButton(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.accessibilityLabel === 'Delete conversation') return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = deleteButton(child);
      if (found) return found;
    }
  }
  const render = () => state.render(AnalyticsScreen);
  let action = deleteButton(render()).props.onPress();
  dialogs.at(-1).buttons.find(button => button.text === 'Cancel').onPress();
  await action;
  assert.equal(requests.length, 0);
  action = deleteButton(render()).props.onPress();
  dialogs.at(-1).options.onDismiss();
  await action;
  assert.equal(requests.length, 0);

  action = deleteButton(render()).props.onPress();
  dialogs.at(-1).buttons.find(button => button.text === 'Delete').onPress();
  await flush();
  assert.equal(requests[0].token, 'test-token');
  assert.equal(requests[0].id, 'selected');
  assert.equal(deleteButton(render()).props.disabled, true);
  await deleteButton(render()).props.onPress();
  assert.equal(requests.length, 1);
  requests[0].reject(new TypeError('Failed to fetch'));
  await action;
  assert.equal(debriefs.length, 2);
  assert.equal(navigation.length, 0);
  assert.equal(render().props.error, 'Could not reach Mirra. Please try again.');

  // An unresolved/deleted ID must never show a different conversation's Delete action.
  routeId = 'missing';
  assert.equal(deleteButton(render()), undefined);
  routeId = 'selected';
  platform.OS = 'web';
  await deleteButton(render()).props.onPress();
  assert.equal(requests.length, 1);
  confirmWeb = true;
  action = deleteButton(render()).props.onPress();
  await flush();
  requests[1].resolve();
  await action;
  assert.deepEqual(debriefs.map(row => row.id), ['newest']);
  assert.deepEqual(navigation, ['/insights']);
  assert.equal(deleteButton(render()), undefined);
});

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
    '@/privacy/aiConsent': consentGranted,
    '@/api/client': { async uploadSession(_, audio, metadata) {
      uploads.push({ audio, metadata });
      if (uploads.length === 1) throw new TypeError('Failed to fetch');
      return { debrief };
    } },
    'expo-audio': {
      AudioModule: { requestRecordingPermissionsAsync: async () => ({ granted: true }) },
      setAudioModeAsync: async () => {}, RecordingPresets: { HIGH_QUALITY: {} },
      useAudioRecorderState: () => ({ durationMillis: 7500 }),
      useAudioRecorder: () => ({
        async prepareToRecordAsync() {}, record() { starts++; },
        async stop() { stops++; }, uri: 'blob:test-recording',
        getStatus: () => ({ durationMillis: 7500 }),
      }),
    },
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
    '@/api/client': {}, '@/utils/timeFormat': {}, 'expo-audio': {},
    '@/privacy/aiConsent': consentGranted,
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
    '@/privacy/aiConsent': {},
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

test('audio import waits for metadata and releases the SDK 57 player without playback', async () => {
  const state = hooks();
  let released = 0;
  let unsubscribed = 0;
  let metadata;
  const player = {
    isLoaded: false, duration: 12.5,
    addListener(event, listener) {
      assert.equal(event, 'playbackStatusUpdate');
      setImmediate(() => listener({ isLoaded: true }));
      return { remove() { unsubscribed++; } };
    },
    remove() { released++; },
  };
  const { useImportAudio } = load('hooks/useImportAudio.ts', {
    react: state.react, '@/auth/AuthContext': auth, '@/api/http': http,
    '@/api/client': { async uploadSession(_, audio, details) {
      metadata = details;
      assert.equal(audio.type, 'audio/mp4');
      return { debrief: { id: 'imported' } };
    } },
    '@/utils/timeFormat': { titleFromFilename: () => 'Conversation' },
    '@/privacy/aiConsent': consentGranted,
    'expo-audio': { createAudioPlayer: () => player },
    'expo-document-picker': { async getDocumentAsync() {
      return { canceled: false, assets: [{ uri: 'file:///clip.m4a', name: 'clip.m4a', size: 100 }] };
    } },
  });
  assert.deepEqual(await state.render(useImportAudio).importAudio(), { id: 'imported' });
  assert.equal(metadata.clientDurationSeconds, 12.5);
  assert.equal(released, 1);
  assert.equal(unsubscribed, 1);
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

  const accepted = consent.requestAIConsent('alice', true);
  await flush();
  dialogs.at(-1).buttons.find(button => button.text === 'Allow').onPress();
  assert.equal(await accepted, true);
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

test('declining blocks recording and import; withdrawing before upload keeps the stopped clip for retry', async () => {
  const state = hooks();
  let allowed = false;
  let permissions = 0;
  let uploads = 0;
  let picks = 0;
  const privacy = { async requestAIConsent(userId) {
    assert.equal(userId, 'test-user');
    return allowed;
  } };
  const { useRecordAudio } = load('hooks/useRecordAudio.ts', {
    react: state.react, 'react-native': { Platform: { OS: 'ios' } },
    '@/auth/AuthContext': auth, '@/api/http': http, '@/privacy/aiConsent': privacy,
    '@/api/client': { async uploadSession() { uploads++; return { debrief: { id: 'saved' } }; } },
    'expo-audio': {
      AudioModule: { async requestRecordingPermissionsAsync() { permissions++; return { granted: true }; } },
      setAudioModeAsync: async () => {}, RecordingPresets: { HIGH_QUALITY: {} },
      useAudioRecorderState: () => ({ durationMillis: 5000 }),
      useAudioRecorder: () => ({
        async prepareToRecordAsync() {}, record() {}, async stop() {}, uri: 'file:///clip.m4a',
        getStatus: () => ({ durationMillis: 5000 }),
      }),
    },
  });
  await state.render(useRecordAudio).startRecording();
  assert.equal(permissions, 0);
  assert.equal(state.render(useRecordAudio).isStartingRecording, false);
  allowed = true;
  await state.render(useRecordAudio).startRecording();
  allowed = false;
  assert.equal(await state.render(useRecordAudio).stopRecording(), null);
  assert.equal(uploads, 0);
  assert.equal(state.render(useRecordAudio).isRecording, false);
  assert.equal(state.render(useRecordAudio).hasPendingRecording, true);
  allowed = true;
  assert.deepEqual(await state.render(useRecordAudio).stopRecording(), { id: 'saved' });
  assert.equal(uploads, 1);

  allowed = false;
  const importState = hooks();
  const { useImportAudio } = load('hooks/useImportAudio.ts', {
    react: importState.react, '@/auth/AuthContext': auth, '@/api/http': http,
    '@/privacy/aiConsent': privacy, '@/utils/timeFormat': { titleFromFilename: () => 'Conversation' },
    '@/api/client': { async uploadSession() { uploads++; return { debrief: { id: 'imported' } }; } },
    'expo-audio': { createAudioPlayer: () => ({ isLoaded: true, duration: 5, remove() { allowed = false; } }) },
    'expo-document-picker': { async getDocumentAsync() {
      picks++;
      return { canceled: false, assets: [{ uri: 'file:///clip.m4a', name: 'clip.m4a', size: 100 }] };
    } },
  });
  assert.equal(await importState.render(useImportAudio).importAudio(), null);
  assert.equal(picks, 0);
  assert.equal(importState.render(useImportAudio).importing, false);
  allowed = true;
  assert.equal(await importState.render(useImportAudio).importAudio(), null);
  assert.equal(picks, 1);
  assert.equal(uploads, 1); // Consent withdrawn while reading metadata prevents the import upload.
  assert.equal(importState.render(useImportAudio).error, null);
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
    '@/data/reflect': { SEED_MESSAGES: [], STARTER_PROMPTS: [], CANNED_REPLIES: ['fallback'] },
    '@/privacy/aiConsent': { async requestAIConsent() { if (choice instanceof Error) throw choice; return choice; } },
    '@/api/client': { async sendReflection(_, payload) { sent.push(payload); return 'reply'; } },
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
