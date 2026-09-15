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
  const { RecordingProvider } = load('hooks/useRecordAudio.ts', {
    react: state.react, 'react-native': { Platform: { OS: 'web' }, NativeModules: {} },
    '@/auth/AuthContext': { useAuth: () => ({ user: { id: 'owner' }, accessToken: null }) }, '@/api/http': http,
    '@/storage/pendingRecordings': { recordingId: () => `recording-${starts}` },
    './usePendingRecordings': { usePendingRecordings: () => ({ async enqueue(recording) {
      saved.push(recording);
      if (diskFull) throw new Error('Storage full');
    } }) },
    '@/privacy/aiConsent': consentGranted,
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

test('profile loads account data without a plan request', () => {
  const state = hooks();
  let summaryState = { summary: null, error: 'Offline' };
  const { ProfileScreen } = load('screens/ProfileScreen.tsx', {
    react: state.react, 'react-native': { StyleSheet: { create: styles => styles } },
    'expo-linear-gradient': {}, 'react-native-svg': {}, '@/components/Screen': {},
    '@/components/ui': {}, '@/components/Typography': {}, '@/components/Icon': { Icon: {} },
    '@/theme/tokens': { colors: {}, fonts: {} }, '@/api/client': {}, '@/auth/AuthContext': auth,
    '@/privacy/aiConsent': {},
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

test('audio import handles metadata becoming ready before its listener is attached', async () => {
  const state = hooks();
  let released = 0;
  let unsubscribed = 0;
  const player = {
    isLoaded: false, duration: 8,
    addListener() {
      this.isLoaded = true; // The native ready event was already emitted.
      return { remove() { unsubscribed++; } };
    },
    remove() { released++; },
  };
  const { useImportAudio } = load('hooks/useImportAudio.ts', {
    react: state.react, '@/auth/AuthContext': auth, '@/api/http': http,
    '@/privacy/aiConsent': consentGranted,
    '@/utils/timeFormat': { titleFromFilename: () => 'Conversation' },
    '@/api/client': { async uploadSession(_, audio, metadata) {
      assert.equal(metadata.clientDurationSeconds, 8);
      return { debrief: { id: 'imported' } };
    } },
    'expo-audio': { createAudioPlayer: () => player },
    'expo-document-picker': { async getDocumentAsync() {
      return { canceled: false, assets: [{ uri: 'file:///clip.m4a', name: 'clip.m4a', size: 100 }] };
    } },
  });
  assert.deepEqual(await state.render(useImportAudio).importAudio(), { id: 'imported' });
  assert.equal(released, 1);
  assert.equal(unsubscribed, 1);
});

test('native uploads preserve the supplied filename, MIME and bytes independently of the cache filename', async (t) => {
  let inferredType;
  const { uploadSession } = load('api/client.ts', {
    '@/api/http': http,
    // Expo's filesystem File implements Blob without extending it. FormData only
    // honors the third filename argument for real Blobs, so model that distinction.
    'expo-file-system': { File: class {
      constructor(uri) {
        assert.equal(uri, 'file:///cache/cached-uuid');
        this.name = 'cached-uuid';
        this.type = inferredType;
        this.size = 11;
      }
      slice(start, end, type) {
        return new Blob(['audio bytes']).slice(start, end, type);
      }
    } },
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://test.invalid/sessions');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const audio = options.body.get('audio');
    assert.equal(audio.type, 'audio/mpeg');
    assert.equal(audio.name, 'provider-audio');
    assert.equal(await audio.text(), 'audio bytes');
    return Response.json({ debrief: { id: 'saved', stats: {} }, used_this_month: 1, remaining: 4 });
  });
  for (inferredType of ['', 'application/octet-stream', 'audio/mpeg']) {
    assert.equal((await uploadSession('test-token', {
      uri: 'file:///cache/cached-uuid', name: 'provider-audio', type: 'audio/mpeg',
    }, {})).debrief.id, 'saved');
  }
});

test('native interruptions do not force resume; notification stop retains one clip and native errors clear recording', async () => {
  const state = hooks();
  const effects = [];
  const saved = [];
  let account = 'test-user';
  let listener;
  let starts = 0;
  let stops = 0;
  let status = { durationMillis: 0, isRecording: false, canRecord: false };
  const recorder = {
    uri: null,
    async prepareToRecordAsync() { this.uri = `file:///clip-${starts + 1}.m4a`; },
    record() { starts++; status = { durationMillis: 0, isRecording: true, canRecord: true }; },
    async stop() {
      stops++;
      status = { durationMillis: 0, isRecording: false, canRecord: false };
      listener({ isFinished: true, hasError: false, url: this.uri });
    },
    getStatus: () => status,
  };
  const { RecordingProvider } = load('hooks/useRecordAudio.ts', {
    react: { ...state.react, useEffect: effect => effects.push(effect) },
    'react-native': { Platform: { OS: 'android' } },
    '@/auth/AuthContext': { useAuth: () => ({ user: { id: account } }) }, '@/api/http': http, '@/privacy/aiConsent': consentGranted,
    '@/storage/pendingRecordings': { recordingId: () => `recording-${starts}` },
    './usePendingRecordings': { usePendingRecordings: () => ({ async enqueue(clip) { saved.push(clip); } }) },
    'expo-audio': {
      AudioModule: { requestRecordingPermissionsAsync: async () => ({ granted: true }) },
      setAudioModeAsync: async () => {}, RecordingPresets: { HIGH_QUALITY: {} },
      // SDK 57 retains the first callback for the lifetime of this recorder.
      useAudioRecorder: (_, callback) => { listener ??= callback; return recorder; },
      useAudioRecorderState: () => status,
    },
  });
  function render() {
    const result = state.render(() => RecordingProvider({ children: null })).props.value;
    effects.splice(0).forEach(effect => effect());
    return result;
  }
  await render().startRecording();
  status = { durationMillis: 7500, isRecording: false, canRecord: true };
  render(); // A phone call has paused the recorder; Expo owns its eventual resume.
  assert.equal(starts, 1);
  const completed = { isFinished: true, hasError: false, url: recorder.uri };
  status = { durationMillis: 0, isRecording: false, canRecord: false };
  account = 'other';
  render();
  listener(completed); // Android's notification Stop bypasses the app Stop button.
  assert.equal(render().isRecording, false);
  await render().startRecording(); // Cannot start over a clip still being saved.
  assert.equal(starts, 1);
  await flush();
  assert.equal(saved.length, 1);
  assert.equal(stops, 0);
  assert.equal(saved[0].audio.uri, completed.url);
  assert.equal(saved[0].seconds, 7.5);
  assert.equal(saved[0].userId, 'test-user', 'A switched account never owns the earlier recording');
  listener(completed);
  assert.equal(render().hasUnsavedRecording, false);

  await render().startRecording();
  listener(completed); // A late event for the previous file cannot stop the new clip.
  assert.equal(render().isRecording, true);
  listener({ isFinished: true, hasError: true, url: null, error: 'Microphone disconnected' });
  assert.equal(render().isRecording, false);
  assert.equal(render().hasUnsavedRecording, false);
  assert.equal(render().error, 'Microphone disconnected');

  await render().startRecording();
  status = { durationMillis: 2500, isRecording: true, canRecord: true };
  await render().stopRecording();
  listener({ isFinished: true, hasError: false, url: recorder.uri });
  assert.equal(render().hasUnsavedRecording, false);
  assert.equal(stops, 1);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].seconds, 2.5);

  await render().startRecording();
  listener({ isFinished: true, hasError: false, mediaServicesDidReset: true, url: null });
  assert.equal(render().isRecording, false);
  assert.equal(render().hasUnsavedRecording, false);
  assert.match(render().error, /microphone stopped unexpectedly/);
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

test('declining blocks recording and import; withdrawal still allows the stopped clip to be saved locally', async () => {
  const state = hooks();
  let allowed = false;
  let permissions = 0;
  let uploads = 0;
  const saved = [];
  let picks = 0;
  const privacy = { async requestAIConsent(userId) {
    assert.equal(userId, 'test-user');
    return allowed;
  } };
  const { RecordingProvider } = load('hooks/useRecordAudio.ts', {
    react: state.react, 'react-native': { Platform: { OS: 'ios' } },
    '@/auth/AuthContext': auth, '@/api/http': http, '@/privacy/aiConsent': privacy,
    '@/storage/pendingRecordings': { recordingId: () => 'recording' },
    './usePendingRecordings': { usePendingRecordings: () => ({ async enqueue(clip) { saved.push(clip); } }) },
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
  const render = () => state.render(() => RecordingProvider({ children: null })).props.value;
  await render().startRecording();
  assert.equal(permissions, 0);
  assert.equal(render().isStartingRecording, false);
  allowed = true;
  await render().startRecording();
  allowed = false;
  await render().stopRecording();
  assert.equal(uploads, 0);
  assert.equal(render().isRecording, false);
  assert.equal(saved.length, 1, 'Consent withdrawal must not discard the locally recorded audio');
  assert.equal(saved[0].seconds, 5);

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
  assert.equal(uploads, 0); // Consent withdrawn while reading metadata prevents the import upload.
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
