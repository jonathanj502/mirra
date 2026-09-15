# Mirra TestFlight beta acceptance

Updated: 2026-09-15. Starting commit: `f628b73`.

The user agreed to these gates on 2026-09-15. Preserve the existing design and
features. A passing unit test or JavaScript export does not close a production
or physical-device gate. Keep failures and untested steps open.

## Acceptance ledger

| ID | Acceptance criterion | Status | Evidence / next check |
| --- | --- | --- | --- |
| TF-1 | Signed production build processes in App Store Connect, installs through TestFlight, and cold-launches without a development server. | OPEN | CocoaPods updated successfully to Expo 57.0.22 / RN 0.86.3 / ExpoAudio 57.0.5. Production Hermes export passes (1,881 modules). EAS production build reached signing, then failed because distribution credentials are not configured. No TestFlight build yet. |
| TF-2 | Installed build connects over public HTTPS to the intended backend; sign-up/sign-in, restored session, and authenticated reads work. | OPEN | Live Render health, sign-up/sign-in, JWT verification, history, and usage reads passed. Public URL and Supabase values saved to EAS production. Installed-device connection/session restoration remain untested. |
| TF-3 | A real iPhone recording produces a saved, nonempty debrief; it reopens from history after relaunch and Reflect returns a model reply about it. | OPEN | 128 backend tests pass with mocked external services. No physical recording or live end-to-end result yet. |
| TF-4 | Offline stopped clips survive force-quit/relaunch; reconnect uploads each exactly once without losing audio, duplicating debriefs, or charging usage twice. | OPEN | App queue/recovery tests pass; backend replay/usage tests pass. Physical device, token refresh, and account-switch checks remain. |
| TF-5 | Denying microphone permission is recoverable; granting permission in Settings allows recording without a crash or stuck recorder. | OPEN | Device check pending. |
| TF-6 | Recording continues for at least five minutes with the iPhone locked; after unlock/Stop, audio from before, during, and after lock reaches the debrief. | OPEN | Native audio background mode and Expo recording configuration exist. Real-device check pending. |

## Automated baseline

Run from `app/`:

- `npm run typecheck` — PASS.
- `node --test tests/*.test.mjs` — PASS, 24 tests including the production-config guard.
- `npx expo install --check` — PASS against installed SDK dependency map;
  network version lookup was unavailable, so this is an offline check only.
- `npx expo export --platform ios --output-dir /private/tmp/mirra-ios-export-baseline`
  — PASS, Hermes bundle and bundled font assets. This export contains development
  endpoint configuration and is not a release candidate.
- `npm run check:production` — PASS with the configured Render URL and public
  Supabase key. The earlier LAN configuration correctly failed this gate.
- `npx expo export --platform ios --clear --output-dir /private/tmp/mirra-ios-export-production-clean`
  — PASS. Binary inspection confirms the Render URL is embedded and the old LAN
  URL is absent. An export without `--clear` retained the old URL in Metro's
  cache; use `npm run export:ios:production` for subsequent local release exports.
- `pod update --no-repo-update` — PASS, 108 pods installed. Xcode itself is absent,
  so this proves dependency resolution/integration, not native compilation.

Run from `backend/`:

- `.venv/bin/python -m pytest -q` — PASS, 128 tests, one existing Starlette/httpx
  deprecation warning. Auth, pipeline, storage, usage, settings, and API error
  behavior are covered with mocks; credentials and deployed services are not.

## Device test record

Device: **iPhone 13 / iOS 26.6.2**, reported by the user via iMessage on 2026-09-15.
Apple membership/team: **user unsure; checking developer.apple.com/account**.
Session-only coordination: questions sent to the user's own number ending 3399;
replies are checked through Messages. No ongoing messaging automation is set up.

Expo account: `jjiang25`; [Mirra EAS project](https://expo.dev/accounts/jjiang25/projects/mirra),
project ID `20253166-6402-4548-bb4a-5084bcc0dc03`. EAS initialized build number 1;
the production attempt stopped at signing and did not create a binary.

Backend: [mirra-backend-wp2b.onrender.com](https://mirra-backend-wp2b.onrender.com),
[Render service](https://dashboard.render.com/web/srv-d9vp6orm8hqs73dvhd5g).
Live deployment `dep-dakboh9srm7s73bt5ki0` serves commit
`f628b73c09815af4895b744b6682c1a7ee8e1345`. Root directory `backend`, build command
`pip install uv && uv sync`, start command
`uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
Current instance is Free and sleeps when inactive. Cold-start behavior needs
device validation. No paid service upgrade has been made.

The live smoke command is `python -m scripts.smoke_beta --url
https://mirra-backend-wp2b.onrender.com --audio /private/tmp/mirra-beta-synthetic.m4a`
from `backend/`. It uses synthetic speech, checks replay/usage/history/Reflect,
and deletes only the temporary account it creates. Local log:
`/private/tmp/mirra-beta-smoke.log`. Audio-flow result still pending.

Supabase read-only checks: public JWKS returned ES256; auth settings returned email
and Google enabled; `debriefs`, `debrief_usage`, and `user_settings` were reachable
with the server credential. These checks do not establish device OAuth or RLS
behavior on their own.

Once the build is installed, report each result with the gate ID, build number,
device/iOS version, and any failure text. Use a disposable beta account and
consenting participants. Keep private audio/transcripts out of this file.

1. **TF-1/2:** Install from TestFlight. Turn off the development computer/server.
   Launch, sign up or sign in, open Profile and history. Force-quit/relaunch;
   confirm the correct account and saved data return. Repeat backend access on
   cellular to rule out a hidden LAN dependency.
2. **TF-5:** Deny microphone access on first recording. Confirm a visible error
   and responsive UI. Enable microphone access in iOS Settings, return to Mirra,
   and record/stop successfully.
3. **TF-3:** Record a 30–60 second consenting conversation with a recognizable
   phrase. Stop; confirm one debrief, plausible duration, and nonempty coaching.
   Open it from history after relaunch. Ask Reflect a question about it; verify
   the backend used the model (a canned fallback does not pass).
4. **TF-6:** Start another conversation; speak a distinctive phrase before lock,
   during lock, and after unlock. Keep the phone locked for 5+ minutes, then
   unlock and Stop. Confirm duration and content across all three phases.
5. **TF-4:** Enable airplane mode after signing in. Record and Stop two clips;
   confirm both are queued. Force-quit/relaunch while offline and confirm both
   remain. Reconnect with Mirra foregrounded; confirm two new debriefs and a usage
   increase of exactly two. Relaunch again; no duplicate rows or extra usage.
   Repeat after access-token expiry and switch accounts while clips are queued;
   another account must not see or upload the original account's clips.

The default monthly cap is five debriefs. Use fresh disposable beta accounts for
additional runs; do not change product limits just to make the checks pass.

## Known boundaries

- User-speaker selection assumes microphone proximity; there is no confirmed
  identity or correction UI. Check the existing disclosure before beta release.
- Active recordings must be stopped before force-quit; only stopped/saved audio
  is durable. Upload recovery requires Mirra in the foreground.
- Other existing features (import, deletion, settings, Google sign-in when
  enabled) need smoke checks on the release build; failures affecting these
  agreed gates remain blockers. Unimplemented widgets/shortcuts are out of scope.

References: [Expo build setup](https://docs.expo.dev/build/setup/),
[Apple TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview).
