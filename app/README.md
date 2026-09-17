# Mirra — App

React Native (Expo + TypeScript) implementation of the Mirra mobile design.
The six screens use native components and fetch live data through the FastAPI
backend. Transcription, debrief coaching, and Reflect use one server-side
`OPENAI_API_KEY`; this key never belongs in the app's public environment.

## Run

```bash
cd app
npm install
npx expo start          # then press i (iOS), a (Android), or scan in Expo Go
```

> Fonts (Instrument Serif + Inter) are bundled from `@expo-google-fonts`.
> The splash waits for font loading; a font error falls back to system fonts.

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/` (tab: Record) | `HomeScreen` | Greeting, record control, durable upload queue, recents, import action |
| `/insights` (tab) | `InsightsIndexScreen` | Swipeable week index, conversations grouped by day |
| `/progress` (tab) | `ProgressScreen` | Daily-minutes bars + 6 expandable weekly metric cards + strengths/nudges |
| `/profile` (tab) | `ProfileScreen` | Identity, stats, settings, consent, export and account deletion |
| `/conversation` | `AnalyticsScreen` | Single-conversation deep-dive (Talk/Listen, Questions, Turn-floor offset, Energy, LSM radar, Vocabulary) |
| `/reflect` | `ReflectScreen` | OpenAI reflection chat, labeled general guidance if unavailable, private response reports |

## Layout

```
app/                    expo-router routes (thin wrappers)
  (tabs)/               bottom-tab group + custom floating glass bar
  conversation.tsx
  reflect.tsx
src/
  theme/tokens.ts       dawn palette, fonts, radii, shadows (from tokens.css)
  data/                 Reflect starter prompts and introductory copy
  components/           Typography, Icon, ui (Card/Pip/Chip), Screen,
                        FloatingTabBar, charts (react-native-svg port),
                        meters (FillerBars/SyncBars/OffsetZoneLegend),
                        ExpandableMetric, WeekPaginator, ReflectCTA
  screens/              the six screens above
```

## Fidelity notes

- Charts are a 1:1 port of the prototype's pure-SVG charts to `react-native-svg`.
  The design's default "bold" chart style is baked in (thicker line strokes,
  rounded bars).
- The floating tab bar uses `expo-blur` for the glass effect (the web used
  `backdrop-filter`).
- The record button's radial gradient uses an SVG `RadialGradient`; the avatar
  uses `expo-linear-gradient`.
- Tweaks-panel theming (alt palettes / aesthetics / coaching tone) was a
  design-canvas affordance and is not part of the shipped app; the `dawn` /
  `soft` / `warm` defaults are applied directly.

## Offline recording and recovery

After signing in and granting AI-processing consent once, recording works without connectivity, including when the saved access token has expired. Stopping a recording saves its audio and original timestamp on the device before any upload. Multiple recordings can wait in the queue shown on the Record tab.

`RecordingProvider` lives above the routes. Its queue restores at launch and uploads serially with refreshed credentials for the recording's original account. Native audio lives in the app's documents directory; web audio and metadata are committed together in IndexedDB. Failed uploads keep their audio. A successful server acknowledgement removes the local copy. Each recording has a stable ID, so a repeated request returns its existing debrief without another usage charge.

Recovery runs while Mirra is open in the foreground: at launch, on returning to the app, on the browser's online event, and every 15 seconds. Server failures back off; a monthly limit is checked again after five minutes. Unsupported, oversized, or invalid recordings remain visible for the user to discard. Closing the app preserves completed recordings but pauses uploads until the next launch. An active recording must be stopped and saved before force-quitting. Browser site-data clearing or app uninstall removes local recordings; the web preview does not cache the app shell for offline launches.

Checks:

```sh
npm run typecheck
node --test tests/*.test.mjs
node tests/browserStorageCheck.mjs
```

The last command serves an isolated IndexedDB check at `http://localhost:8768`: save the synthetic samples, reload, then verify. For physical-device validation, use an installed native build, sign in, enable airplane mode, record and stop two clips, force-quit and reopen, then reconnect. Both clips should upload automatically exactly once. Repeat with an expired access token and with an account switch; another account must not see or upload the original account's clips. Expo Go may need its development server to load the app bundle, so it is not a substitute for the native offline-launch check.

## Release preparation

The [release record](../docs/RELEASE.md) tracks required migrations, provider setup, signing and device checks. `npx expo prebuild` regenerates native projects from the committed config plugins; manual edits to generated native folders do not survive. CI compiles Android and an unsigned iOS Release build, then installs and launches the iOS build in Simulator. A signed physical-device build is still required to verify locked-screen recording and recovery.
