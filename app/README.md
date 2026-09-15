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

> Fonts (Instrument Serif + Inter) are fetched from `@expo-google-fonts` at
> first launch — the splash holds until they load.

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/` (tab: Record) | `HomeScreen` | Greeting, breathing record button, recents, import action |
| `/insights` (tab) | `InsightsIndexScreen` | Swipeable week index, conversations grouped by day |
| `/progress` (tab) | `ProgressScreen` | Daily-minutes bars + 6 expandable weekly metric cards + strengths/nudges |
| `/profile` (tab) | `ProfileScreen` | Identity, stats, subscription card, settings |
| `/conversation` | `AnalyticsScreen` | Single-conversation deep-dive (Talk/Listen, Questions, Turn-floor offset, Energy, LSM radar, Vocabulary) |
| `/reflect` | `ReflectScreen` | OpenAI reflection chat with a local fallback when unavailable |

## Layout

```
app/                    expo-router routes (thin wrappers)
  (tabs)/               bottom-tab group + custom floating glass bar
  conversation.tsx
  reflect.tsx
src/
  theme/tokens.ts       dawn palette, fonts, radii, shadows (from tokens.css)
  data/                 Reflect starter prompts and fallback copy
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
  and subscription card use `expo-linear-gradient`.
- Tweaks-panel theming (alt palettes / aesthetics / coaching tone) was a
  design-canvas affordance and is not part of the shipped app; the `dawn` /
  `soft` / `warm` defaults are applied directly.

## SDK 57 development

This app uses Expo SDK 57, React Native 0.86.3, and React 19.2.3.
Use a matching SDK 57 Expo Go on your phone and run `npx expo start --go --lan`.
The phone and backend must be reachable on the same network; set
`EXPO_PUBLIC_MIRRA_BACKEND_URL` in `.env` to the backend's LAN URL.

Recording uses `expo-audio`; native uploads use `expo-file-system` File objects
with SDK 57's fetch implementation. Test microphone permission, record/stop,
failed upload retry, and file import on a real device.

Native projects are maintained in Git. Their startup/build templates have been
updated for SDK 57, preserving app identifiers and custom native files. A native
iOS build requires Xcode 26.4 or later and iOS 16.4 or later. Run `pod update`
from `ios/` before building to regenerate the SDK 54 Podfile.lock/installed pods.
Native compilation has not been verified on the current Mac (full Xcode is absent).
Do not run `expo prebuild` blindly: SDK 57 clears native folders by default.
If applying config plugins to existing native projects, use `--no-clean` and
review the diff for custom extensions. The Expo Go build does not exercise those
extensions or confirm standalone background recording behavior.

Checks: `npm run typecheck`, `node --test tests/*.test.mjs`,
`npx expo install --check`, and `npx expo export --platform all`.
