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
