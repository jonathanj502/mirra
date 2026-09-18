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

> Fonts (Instrument Serif + Inter) are bundled from `@expo-google-fonts` — the
> splash holds until the local font assets load.

## Screens

| Route | Screen | Notes |
|---|---|---|
| `/` (tab: Record) | `HomeScreen` | Greeting, breathing record button, recents, import action |
| `/insights` (tab) | `InsightsIndexScreen` | Swipeable week index, conversations grouped by day |
| `/progress` (tab) | `ProgressScreen` | Daily-minutes bars + 6 expandable weekly metric cards + strengths/nudges |
| `/profile` (tab) | `ProfileScreen` | Identity, stats, settings, and account export |
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
  uses `expo-linear-gradient`.
- Tweaks-panel theming (alt palettes / aesthetics / coaching tone) was a
  design-canvas affordance and is not part of the shipped app; the `dawn` /
  `soft` / `warm` defaults are applied directly.

## Offline recording and recovery

After signing in once, recording works without connectivity, including when the saved access token has expired. Stopping a recording saves its audio and original timestamp on the device before any upload. Multiple recordings can wait in the queue shown on the Record tab.

`RecordingProvider` lives above the routes. Its queue restores at launch and uploads serially with refreshed credentials for the recording's original account. Native audio lives in the app's documents directory; web audio and metadata are committed together in IndexedDB. Failed uploads keep their audio. Queued uploads check AI consent before sending; withdrawing consent pauses them until the user reviews their privacy choice on the Record tab. A successful server acknowledgement removes the local copy. Each recording has a stable ID, so a repeated request returns its existing debrief without another usage charge.

Recovery runs while Mirra is open in the foreground: at launch, on returning to the app, on the browser's online event, and every 15 seconds. Server failures back off; a monthly limit is checked again after five minutes. Unsupported, oversized, or invalid recordings remain visible for the user to discard. Closing the app preserves completed recordings but pauses uploads until the next launch. An active recording must be stopped and saved before force-quitting. Browser site-data clearing or app uninstall removes local recordings; the web preview does not cache the app shell for offline launches.

Checks:

```sh
npm run typecheck
node --test tests/*.test.mjs
node tests/browserStorageCheck.mjs
```

The last command serves an isolated IndexedDB check at `http://localhost:8768`: save the synthetic samples, reload, then verify. For physical-device validation, use an installed native build, sign in, enable airplane mode, record and stop two clips, force-quit and reopen, then reconnect. Both clips should upload automatically exactly once. Repeat with an expired access token and with an account switch; another account must not see or upload the original account's clips. Expo Go may need its development server to load the app bundle, so it is not a substitute for the native offline-launch check.

## SDK 57 development

This app uses Expo SDK 57, React Native 0.86.3, and React 19.2.3.
Use a matching SDK 57 Expo Go on your phone and run `npx expo start --go --lan`.
The phone and backend must be reachable on the same network; set
`EXPO_PUBLIC_MIRRA_BACKEND_URL` in `.env` to the backend's LAN URL.

Recording uses `expo-audio`; native uploads use typed Blobs read from
`expo-file-system` Files to preserve the original filename and MIME type. Test microphone permission, record/stop,
failed upload retry, and file import on a real device.

Native projects are maintained in Git. Their startup/build templates have been
updated for SDK 57, preserving app identifiers and custom native files. A native
iOS build requires Xcode 26.4 or later and iOS 16.4 or later. The checked-in
Podfile.lock now matches SDK 57; use `pod install` from `ios/` to restore it.
Local Xcode and native build evidence is tracked in
[`docs/beta-workstreams/distribution.md`](../docs/beta-workstreams/distribution.md).
Do not run `expo prebuild` blindly: SDK 57 clears native folders by default.
If applying config plugins to existing native projects, use `--no-clean` and
review the diff for custom extensions. The Expo Go build does not exercise those
extensions or confirm standalone background recording behavior.

Checks: `npm run typecheck`, `node --test tests/*.test.mjs`,
`npx expo install --check`, and `npx expo export --platform all`.

## TestFlight beta

Track release and physical-device evidence in
[`docs/testflight-acceptance.md`](../docs/testflight-acceptance.md).
EAS project: [`@jjiang25/mirra`](https://expo.dev/accounts/jjiang25/projects/mirra).

The `production` EAS environment must contain these public build-time values:

- `EXPO_PUBLIC_MIRRA_BACKEND_URL=https://mirra-backend-wp2b.onrender.com`
- `EXPO_PUBLIC_SUPABASE_URL` for the same Supabase project as the backend.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable/anon only, never a server key).

For local release exports, put them in ignored `.env.production.local`. Run:

```sh
npm run check:production
npm run export:ios:production
npx eas-cli build --platform ios --profile production
```

The EAS post-install hook and Xcode Release bundle phase reject missing
configuration, HTTP/LAN endpoints, and privileged Supabase keys. Xcode Release
builds always embed their JavaScript bundle. The export command clears Metro's cache so an
earlier development URL cannot remain in a reused bundle. Check live backend
connectivity separately; config validation does not prove a working service.

The `simulator` profile checks native compilation without Apple signing while
credentials are being arranged. Only a signed `production` build submitted to
App Store Connect can satisfy the TestFlight install gate. After a successful
production build, submit that specific build with `eas submit --platform ios
--profile production --id BUILD_ID` and complete the recorded device checks.

## Free installation on your own iPhone

Apple's [Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account)
supports local device testing without a paid membership. Its provisioning expires
after seven days; rebuild/reinstall through Xcode to renew it. This does not
satisfy the TestFlight installation gate.

1. Install Xcode's iOS components. Sign in yourself under **Xcode → Settings →
   Accounts** and complete any Apple agreements yourself.
2. Connect and unlock the iPhone, trust the Mac, and enable **Settings → Privacy
   & Security → Developer Mode** on the phone when prompted.
3. Set the three public values above in ignored `app/.env.production.local`.
   From `app/`, run `npm ci`, `npm run check:production`, then
   `cd ios && pod install`. Do not run prebuild. Expo's precompiled pod checksum
   can change with the checkout path; use ordinary `pod install`, not
   `pod install --deployment`, when restoring in a different worktree.
4. Open `app/ios/Mirra.xcworkspace`. Select target **Mirra → Signing &
   Capabilities → Automatically manage signing**, then your **Personal Team**.
   If Apple reports the bundle ID unavailable, use a unique local testing ID;
   keep personal signing settings out of the shared release configuration.
5. Choose the iPhone as destination. Under **Product → Scheme → Edit Scheme →
   Run → Info**, set **Build Configuration: Release**. Run the app. Allow the
   development certificate on the phone if iOS requests it.
6. Disconnect the Mac and cold-launch Mirra to verify the embedded bundle.
   Continue the device acceptance checklist, recording the source commit,
   device/iOS version, bundle ID and build number. A successful compile alone
   does not establish recording, offline recovery, or working production APIs.

For compilation before account/device setup, this creates an **unsigned** iPhone
app; it cannot be installed until rebuilt with signing:

```sh
cd app
xcodebuild -workspace ios/Mirra.xcworkspace -scheme Mirra \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/mirra-distribution-device \
  CODE_SIGNING_ALLOWED=NO build
```
