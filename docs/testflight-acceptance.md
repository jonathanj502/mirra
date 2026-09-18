# Mirra TestFlight beta acceptance

Updated: 2026-09-18 UTC. Starting commit: `f628b73`.

**Current direction: adopt newer main and reassess the earlier beta work.**
On 2026-09-18 the user selected `origin/main` at `64db03b`, including resumable
uploads and disk-backed, chunked processing for recordings up to 24 hours/2 GiB.
This supersedes the earlier single-request/23m20s product limit. Parallel tasks
are reconciling only still-needed fixes and validating rollout requirements; see
[beta-workstreams.md](beta-workstreams.md). The new combined candidate is not yet
reviewed, deployed, or installed. Historical device results below apply to the
earlier `a4b3c14` build, not automatically to this changed implementation.

## Current release acceptance

| ID | Required evidence on the new combined candidate | Status |
| --- | --- | --- |
| TF-1 | Reviewed production build, App Store Connect processing, TestFlight install and standalone cold launch. | OPEN |
| TF-2 | Public HTTPS sign-in, correct restored account, authenticated reads and cellular access. | OPEN; earlier build passed and must be rechecked |
| TF-3 | Actual iPhone recording uploads, produces a nonempty saved debrief, reopens in history, and receives a model Reflect reply. | OPEN |
| TF-4 | Existing clips survive the app update; resumable/offline uploads, process restart and cancellation preserve originals and prevent duplicate debriefs/charges or cross-account access. | OPEN; compatibility fixes and new transaction validation in progress |
| TF-5 | Microphone denial, Settings recovery, recording/Stop/save without a stuck recorder. | OPEN; earlier build passed and must be rechecked |
| TF-6 | At least five minutes continuously locked, intact before/during/after audio, then successful debrief delivery. | OPEN; earlier local capture/audio passed only |
| TF-7 | New 24-hour/2 GiB boundaries for capture/import, safe auto-stop/save, chunked transcription with timeline/speaker handling, clear over-limit errors, and eventual safe recovery under competing uploads. | OPEN; earlier 1400s checks do not establish this |

Also required for rollout: the actual new migration/RPC contracts, persistent
audio storage and a truthful backup/retention policy, measured capacity for the
canonical pipeline, and updated Render build/start/readiness configuration.
The old 512 MiB failure and 2 GB test suggestion are historical measurements of a
different implementation. Keep them as evidence, not new-architecture sizing.

## Earlier beta scope and evidence

The user agreed to the original gates on 2026-09-15. On 2026-09-17 they first
selected one hour, then reduced the maximum to **23 minutes 20 seconds (1400
seconds) for both capture and import**, deferring longer recordings. Preserve the existing design and
features. A passing unit test or JavaScript export does not close a production
or physical-device gate. Keep failures and untested steps open.

Hosting direction on 2026-09-17: investigate memory and validate recording first.
The user initially chose the current free Render plan and subsequently reopened
discussion of an upgrade or alternative host. No paid upgrade is authorized.
The confirmed 512 MB memory failure remains open.

## Parallel work integrated locally — 2026-09-18 UTC

Completed memory, transcription, import, queue/capture, native Release guard and
durable-quota code is combined on `codex/beta-integration-2026-09-17`.
[Workstream index](beta-workstreams.md) records exact commits and evidence.
No push, deployment, production migration or hosting purchase has occurred.

- **Combined app:** 44 tests and TypeScript passed.
- **Combined backend:** 187 passed; seven optional SQL tests skipped in that run.
  The separate integrated PostgreSQL 14.23 run passed all seven with exit 0;
  its disposable local server is stopped. This is not Supabase/PostgREST proof.
- **Real provider flow (transcription branch):** exact 1400 seconds passed with
  two speaker labels and beginning/middle/end speech retained. Transcription took
  336.94 seconds; session completion took 351.5 seconds. Saved debrief, history,
  real Reflect, same-ID replay with one usage charge, deletion, cleanup and
  1400.1-second HTTP 413/refund checks passed. This predates the new receipt
  migration and does not prove the whole integrated production flow.
- **Memory:** two allocation fixes reduced the offline exact-limit peak by 15.8%.
  The 512 MiB candidate still OOMs; five dense-audio jobs passed at 1 GiB, with
  growing retained RSS. Use 2 GB as a production-test candidate, not a capacity
  guarantee. Incoming multipart/concurrent load and sustained usage remain open.
- **Imports/capture:** imports now use the durable queue. Metadata padding and
  unsupported native WebM metadata reach strict backend validation safely.
  User-observed microphone denial/Settings recovery and short offline capture/save
  passed; two stopped clips survived offline restart. Local locked capture/audio
  passed on a 424.784399s file with user-confirmed lock time and all three markers.
  Native auto-stop/save/audio also passed at the 23m20s limit. Reconnect/debrief
  delivery, remaining import and interruption checks remain open.
- **Quota:** the new backend requires
  `20260918010000_durable_debrief_receipts.sql` before deployment and drained old
  writers. Receipts and reserve/refund/complete RPCs protect retries after crashes;
  abandoned pending receipts and old orphan charges remain recovery limitations.
- **Distribution:** Xcode/Personal Team setup progressed and the integrated
  unsigned iPhone Release build passed from exact source `a4b3c14` (Xcode exit 0).
  Artifact `/private/tmp/mirra-distribution-artifacts/a4b3c14/Mirra.app` retains
  the intended backend URL, background audio and microphone purpose text.
  Source, hashes and build logs are in the [distribution evidence](beta-workstreams/distribution.md).
  Subsequently, free Personal Team signing/install and connected launch passed
  on the verified iPhone 13 / iOS 26.6.2. The user confirmed “Mirra opens.” The
  approved device-only bundle ID is `com.mirra.personal.dm85xzns55`; the shared
  release ID remains unchanged. Standalone launch, sign-in, session restoration
  and authenticated cellular reads passed by user observation on this build.
  No TestFlight install or paid membership is verified.

**TF-2 and TF-5 pass on the installed Personal Team build; repeat them on the
final TestFlight candidate. TF-1, TF-3, TF-4, TF-6 and TF-7 remain OPEN.** Device
evidence is [recorded separately](beta-workstreams/device.md), with the build,
backend and user observations. A longer upload timeout does not fix
the nearly six-minute processing latency or establish a production deadline.

## Memory investigation — 2026-09-17

Local candidate changes stream decoding directly to mono 16 kHz, batch pitch
analysis into the original overlapping frames, and run the same Silero 6.2.1
speech model through ONNX Runtime without importing PyTorch. Concurrent audio
jobs receive a retryable 503 before reserving usage. These changes are not yet
reviewed, pushed, or deployed.

- Backend tests: **149 passed**. Streaming decode matches whole-file resampling;
  pitch medians match the original YIN calculation at frame boundaries; speech
  thresholds, model-state reset, and busy-request retry/usage behavior pass.
- The old and ONNX speech models differed by at most `5.96e-7` across 195 frames
  of synthetic speech. This is a fixture comparison, not a speech-quality study.
- Linux amd64 / Python 3.14.3 container, hard 512 MiB cap, no swap: **FAIL**;
  Docker confirmed `OOMKilled=true`, exit 137 during acoustic analysis.
- Same candidate at a 1 GiB cap: **PASS** for decoding, speech detection, and
  acoustic metrics on a 310.524-second stereo M4A, three sequential runs.
  Process peak RSS: **687.2 MiB**; CPU-stage elapsed time: **38.7 seconds** total.
  A single continuous speaker turn exercised the long-turn pitch path.
  This used x86 emulation on the Mac; timing and memory require Render validation.
  The memory run used dummy credentials and did not exercise live transcription,
  coaching, database writes, Reflect, or physical iPhone recording.
- Logs: `/private/tmp/mirra-linux-onnx.log` and
  `/private/tmp/mirra-linux-onnx-1gb.log` (temporary local evidence).
- Render compute screen verified: free = 512 MB; $7/month = 512 MB;
  the first memory upgrade is $25/month for 2 GB and 1 CPU. No plan was changed.
- Xcode downloaded successfully from the App Store for possible free own-device
  signing. Initial setup, signing, and physical-device tests remain open.

### Hours-long recording capacity — initial investigation

The user raised hours-long conversations as a realistic use case. The current
app uses Expo's HIGH_QUALITY preset: 44.1 kHz, stereo, target 128 kbps AAC.
At that target bitrate, an hour is approximately 57.6 MB before container
overhead; actual encoded size varies. The backend and file importer cap uploads
at 25 MiB, and the transcription endpoint accepts at most 25 MB. These limits
prevent ordinary hours-long captures from completing even with additional RAM.
That investigation did not change upload limits or recording settings. The user
subsequently selected one hour as the MVP maximum; the candidate changes below
initially implemented that scope; the later duration decision below supersedes it.

An isolated macOS / Python 3.13 test of the local candidate allocated synthetic
16 kHz float32 mono audio, encoded its PCM WAV, then calculated actual speaker
energy and acoustic metrics for one continuous speaker turn:

| Duration | Decoded audio alone | Measured process peak RSS |
| --- | --- | --- |
| 1 hour | 230.4 MB | 885.3 MiB (about 0.93 GB) |
| 2 hours | 460.8 MB | 1421.8 MiB (about 1.49 GB) |
| 4 hours | 921.6 MB | 2736.6 MiB (about 2.87 GB) |

This is a synthetic component benchmark, not a full recording-flow pass or
production capacity guarantee. It excludes compressed-file decode/upload,
real transcription, coaching, DB operations, and concurrent jobs. The VAD model
was loaded, but the synthetic tone was not run through full speech detection.
macOS memory measurements are not interchangeable with Render/Linux measurements.
The earlier Linux Docker image was no longer available, so these new checks ran
locally. Temporary reproduction script: `/private/tmp/mirra-profile-long.py`;
logs: `/private/tmp/mirra-profile-{60,120,240}m.log`.

Reliable hours-long support needs bounded audio processing, an upload/transcription
strategy within provider limits, consistent speaker labels across any separately
transcribed sections, and controlled processing concurrency. A larger instance
alone does not close these gaps. No hosting purchase or pipeline redesign was made.

### One-hour MVP experiment — 2026-09-17 (superseded)

The user explicitly confirmed one hour for **both captured and imported audio**.
Candidate changes (not yet deployed): native auto-stop/save at 3600 seconds;
import and server upload cap 100 MiB; decoded duration checked independently of
client metadata; one second of encoder-padding tolerance; overlong input gets
413 with usage refunded. The complete conversation stays in one transcription
request, using a 48 kbps mono MP3 when neither PCM nor the original fits 25 MB.

Local full-hour synthetic M4A: **58.13 MB input → 21,597,452-byte MP3**; decoding,
speech gate, actual compression, speaker energy, and pitch/metrics passed in
36.0 seconds, peak RSS **860.4 MiB** on macOS. Transcription/coaching were mocked;
this does not prove real model quality, production capacity, or native capture.
Evidence: `/private/tmp/mirra-profile-hour-flow.log`.

Linux amd64 / Python 3.14.3, 2 GiB hard limit, no swap, one CPU: the same
58.13 MB full-hour input passed actual decoding/compression/metrics with AI
mocked. Peak process RSS **1151.0 MiB** (about 1.12 GiB); elapsed **109.1 seconds**.
Evidence: `/private/tmp/mirra-linux-hour-2gb.log`; Docker image
`mirra-memory-hour:latest`, container `mirra-memory-hour-2gb`.
This supports testing a 2 GB single-worker service, not claiming full production
capacity or simultaneous processing of multiple jobs.

**Live API test: FAIL.** Production sign-up/sign-in and authenticated reads passed
through the candidate local backend. The one-hour transcription request was
rejected with OpenAI HTTP 400: `audio duration 3599.568 seconds is longer than
1400 seconds which is the maximum for this model`. This is a separate model
duration ceiling of 23 minutes 20 seconds, despite the compressed file fitting
25 MB. The temporary test account was verified and cleaned up. No debrief was
saved. Logs: `/private/tmp/mirra-hour-live-smoke.log` and
`/private/tmp/mirra-hour-server.log`.

The single-request one-hour candidate therefore **does not work end to end**.
The user subsequently chose the observed single-request maximum of 1400 seconds
and deferred longer recordings. Do not mark TF-7 passed on the strength of mocked
tests. Official documentation supports up to four
2–10-second speaker references per request; its suitability for preserving
speaker identity across sections is not yet validated.

Backend tests: **152 passed**. App TypeScript check passed; recording auto-stop
options, exactly-once native finish saving, valid one-hour import, oversized and
overlong import rejection are covered by the app hook tests. Existing visual
design is retained with a short limits note. Native screen-lock/auto-stop,
production one-hour processing, model quality after compression, and competing
uploads remain open. No paid hosting change is authorized or applied.

### Current beta limit — 23 minutes 20 seconds

The user explicitly authorized the single-request maximum, with longer recording
support deferred. The local candidate now uses 1400 seconds for native auto-stop,
import metadata checks, visible limit copy, and server duration enforcement.
The existing 100 MiB input cap is retained.

- Backend duration checks reject overlong PCM and compressed containers with
  HTTP 413 and refund reserved usage. Compressed containers within the limit may
  produce a padded final frame; decoding allows at most one extra second and
  removes samples beyond 1400 seconds before analysis/transcription.
- Near-limit audio is re-encoded to a seekable MP3 with gapless metadata, avoiding
  the original unseekable encoder's added duration. The saved original is unchanged.
- **PASS:** 70 targeted backend tests, 25 app tests, and TypeScript validation.
  Tests cover exact/just-over duration boundaries, bounded padding, HTTP 413/refund,
  import rejection before upload, native duration options, and saving once on finish.
- **PASS (codec only):** a synthetic 1400-second M4A decoded to 1400.00075 seconds
  before the fix; an unseekable MP3 encoded from 1400 seconds decoded to
  1400.0833125 seconds. The corrected path bounded audio and generated a
  **1400.0-second, 8,400,716-byte MP3**. Actual FFmpeg/libsndfile were exercised;
  OpenAI was mocked. Fixture: `/private/tmp/mirra-limit-1400.m4a` (temporary).
- **OPEN:** real OpenAI processing at the maximum, production memory/latency,
  compression quality, concurrent upload recovery, and physical native auto-stop.
  The shorter limit does not resolve the confirmed 512 MB memory failure.

## Historical acceptance ledger for the 23m20s candidate

| ID | Acceptance criterion | Status | Evidence / next check |
| --- | --- | --- | --- |
| TF-1 | Signed production build processes in App Store Connect, installs through TestFlight, and cold-launches without a development server. | OPEN | Integrated Release source `a4b3c14` signed/installed/launched through free Personal Team using approved local ID. User confirmed “Mirra opens.” This is not TestFlight; store membership/signing, available release ID and TestFlight install still required. |
| TF-2 | Installed build connects over public HTTPS to the intended backend; sign-up/sign-in, restored session, and authenticated reads work. | PASS (Personal Team; repeat on TestFlight) | User confirmed independent launch/sign-in, then same-account restoration and Profile/history reads with Wi-Fi off and cellular on, recorded 2026-09-18 01:21 UTC. Source `a4b3c14`, iPhone 13/iOS 26.6.2, current production backend. Sign-up was covered by earlier live backend checks; this device pass covers sign-in. Candidate audio/backend rollout remains unverified. |
| TF-3 | A real iPhone recording produces a saved, nonempty debrief; it reopens from history after relaunch and Reflect returns a model reply about it. | OPEN | Render processed synthetic M4A → saved debrief → history → real Reflect reply in the live test. The service then exceeded its 512 MB memory limit and restarted; final usage read returned 502. Hosting capacity and physical recording checks remain open. |
| TF-4 | Offline stopped clips survive force-quit/relaunch; reconnect uploads each exactly once without losing audio, duplicating debriefs, or charging usage twice. | OPEN | Two stopped physical clips survived offline force-close/relaunch, user-observed 2026-09-18 01:38 UTC on `a4b3c14`. Combined app and local SQL crash/retry/accounting tests pass. Reconnect, duplicates/usage, token/account recovery and candidate migration/PostgREST rollout remain open. |
| TF-5 | Denying microphone permission is recoverable; granting permission in Settings allows recording without a crash or stuck recorder. | PASS (Personal Team; repeat on TestFlight) | User saw Open microphone settings after denial, enabled access in Settings, returned, recorded/stopped about ten seconds offline, and confirmed one saved row. Recorded 2026-09-18 01:36 UTC, source `a4b3c14`, iPhone 13/iOS 26.6.2. Audio completeness/upload is separate. |
| TF-6 | Recording continues for at least five minutes with the iPhone locked; after unlock/Stop, audio from before, during, and after lock reaches the debrief. | OPEN (local capture/audio PASS) | Installed `a4b3c14`, iPhone 13/iOS 26.6.2: read-only inspection independently measured 424.784399s (7m04.8s), 5,429,285 bytes; complete decode passed. At 2026-09-18 03:08 UTC the user confirmed ≥5 continuous minutes locked and all three before/during/after-lock markers audible in local playback. Lock time/listening are user-observed, not assistant-timed. Delivery to a debrief remains unverified. Originals remain queued and unchanged, with no upload; repeat on the final TestFlight build. |
| TF-7 | Both native capture and import support conversations up to 23m20s (imports ≤100 MiB), producing a saved debrief/history/Reflect result. Native recording stops and saves at the limit; overlong input fails clearly without consuming usage. Competing uploads retry safely. | OPEN (local native auto-stop/save/audio PASS) | On installed `a4b3c14`, user reports automatic stop exactly at 23:20 and saved clips surviving offline relaunch. One distinct maximum file measures 1399.952834s (23m19.953s), 17,425,982 bytes; full decode passed and user confirmed all three markers audible. At 2026-09-18 04:00 UTC the user explained the later 2.436644s clip as an accidental capture, reconciling the six-clip baseline under one account. Real 1400s local provider flow passed on the transcription branch; integrated production, imports, interruption/resume, concurrent retry and debrief/history/Reflect checks remain required. One-hour support is deferred. |

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
- EAS Simulator build — PASS, finished 2026-09-15 18:54 UTC:
  [59076232-fd8c-4f0c-800f-bffc631d4bc3](https://expo.dev/accounts/jjiang25/projects/mirra/builds/59076232-fd8c-4f0c-800f-bffc631d4bc3).
  Downloaded artifact inspection confirms `com.mirra.app`, version 1.0.0 (1),
  minimum iOS 16.4, audio background mode, and microphone permission copy.
  Its actual `main.jsbundle` contains the Render URL and no old LAN URL.
  This proves native compilation/configuration; it is not a signed
  device/TestFlight build or a launch check.

Run from `backend/`:

- `.venv/bin/python -m pytest -q` — PASS, 132 tests, one existing Starlette/httpx
  deprecation warning. Auth, pipeline, storage, usage, settings, and API error
  behavior are covered with mocks; credentials and deployed services are not.

## Device test record

Device: **iPhone 13 (iPhone14,5) / iOS 26.6.2 (23G90)**, confirmed by device
inventory during the signed installation on 2026-09-18 UTC. Developer Mode is enabled.
Apple team: free Personal Team verified; **paid membership unverified**. The user has a personal Apple Account;
they confirmed Mirra is currently a personal project with company ambitions.
Paid enrollment/payment and store signing remain pending. The approved free
device-test app is `com.mirra.personal.dm85xzns55`, version 1.0.0 (1), source
`a4b3c14`. Its profile expires 2026-09-25 01:09:36 UTC; renew free provisioning
by rebuilding/reinstalling. Apple rejected the shared `com.mirra.app` identifier
for the current team; resolve the intended store identifier before a TestFlight build.
Earlier session-only iMessage coordination on 2026-09-15 is historical. Current
device questions are in the device/distribution tasks; no messaging automation is set up.

Expo account: `jjiang25`; [Mirra EAS project](https://expo.dev/accounts/jjiang25/projects/mirra),
project ID `20253166-6402-4548-bb4a-5084bcc0dc03`. EAS initialized build number 1;
the production attempt stopped at signing and did not create a binary.

Backend: [mirra-backend-wp2b.onrender.com](https://mirra-backend-wp2b.onrender.com),
[Render service](https://dashboard.render.com/web/srv-d9vp6orm8hqs73dvhd5g).
Initial deployment `dep-dakboh9srm7s73bt5ki0` served commit
`f628b73c09815af4895b744b6682c1a7ee8e1345`. Root directory `backend`, build command
`pip install uv && uv sync`, start command
`uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
Current instance is Free and sleeps when inactive. Cold-start behavior needs
device validation. No paid service upgrade has been made.

Diagnostic deploy `dep-dakpf615efls73d5h5t0` was started at 19:08 UTC from
independently reviewed commit `c4bb4591f86c5e81379978b4fe011c95d0c3c362`.
It became live at 19:12:56 UTC. The next synthetic request completed usage and
settings reads, then stalled at `Audio pipeline: decoding` from 19:13:33 UTC.
The client was interrupted after several minutes; verified temporary-account
cleanup succeeded. An isolated Python 3.14.3 decode completed locally in 30.8
seconds, with a timed stack trace showing Numba compilation during the first
call. The build-time warm-up below subsequently reduced production decoding to
26 seconds.
Render's specific-commit deploy disables auto-deploy; restore the original
setting once the tested release is integrated into `main`.
[Draft PR #12](https://github.com/jonathanj502/mirra/pull/12) tracks the changes.

Temporary diagnostic operation: the Render start command was changed to start
Uvicorn through Python with `faulthandler.dump_traceback_later(60, repeat=True)`.
The restart reused the earlier deployment's original start command, so no timed
trace ran. The temporary setting was removed before the next deploy; the live
start command is the normal Uvicorn command with the generic CPU prefix below.

At 19:22:14 UTC the original decoder advanced to Librosa's audioread fallback,
8 minutes 41 seconds after entering decode. Fix: precompile the
existing audio helpers during build using `scripts.warm_audio`. Local Python
3.14 experiment passed pitch verification and took 6.98 seconds with a new
generic CPU cache, then 1.01 seconds in a fresh process reusing that cache.
Production decoding improvement is verified below; the full smoke remains open
because the service subsequently exceeded its memory limit.

Current build command:
`pip install uv && uv sync && NUMBA_CPU_NAME=generic uv run python -m scripts.warm_audio`

Current start command:
`NUMBA_CPU_NAME=generic uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Candidate deploy `dep-dakpolrl550s73cprvtg`, commit
`f8cf5d7196654aff3ff578bb5503668aa3ff15cd`, became live at 19:33:24 UTC.
Build warm-up passed in 12.6 seconds. The independent reviewer also exercised
real M4A decoding and application resampling/pitch at 22.05/44.1/48 kHz in a new
local process: 40 cache loads, zero new compilations, 1.64 seconds.

First production request on this deploy reached decoding at 19:34:18 UTC,
resampling at 19:34:44, speech detection at 19:34:44, and transcription at
19:34:46. At 19:34:51 OpenAI returned 401 `invalid_api_key`: the Render key is
still the placeholder `FILL_IN`. The API returned 500 and temporary-account
cleanup succeeded. Log: `/private/tmp/mirra-render-warm-short-smoke.log`.
The user chose to enter a key themselves, then confirmed at 19:39 UTC that they
updated it and removed obsolete Anthropic/Stripe variables. Saved UI state was
confirmed without revealing the value. Redeploy `dep-dakpvn61egvs73aqdb8g` applies
that saved environment to the same reviewed commit and became live at
19:48:10 UTC. Build warm-up passed in 12.1 seconds.

Retest with the updated key: synthetic 10.103-second M4A processing passed in
46.5 seconds, including speech transcription, coaching, and persistence. Replay
returned the same debrief with one usage charge; history/detail reads and a
real Reflect model reply also passed. Conversation deletion returned 204 and empty history.
The final usage read returned 502; temporary-account cleanup passed. Render's
Events page confirmed at 19:53 UTC: instance `xz6ls` ran out of memory, using
over 512 MB. It recovered at 19:54 UTC. This run is a partial pass, not a stable
production acceptance pass. Log:
`/private/tmp/mirra-render-key-updated-short-smoke.log`.

Hosting option proposed by iMessage on 2026-09-15: move to the 2 GB / 1 CPU plan
at $25/month and rerun the short and five-minute production checks. The $7/month
plan still has 512 MB. On 2026-09-17 the user chose to keep the current plan;
no upgrade is authorized or pending. No paid upgrade has been made.
A local CPU-stage check of the 303-second stereo fixture peaked at 702.6 MiB
RSS after decoding, resampling, VAD, and acoustic statistics (4.4 seconds).
This is macOS evidence supporting the capacity concern, not a Linux/Render
measurement. Log: `/private/tmp/mirra-audio-memory-check.log`.

The live smoke command is `python -m scripts.smoke_beta --url
https://mirra-backend-wp2b.onrender.com --audio /private/tmp/mirra-beta-speech.m4a`
from `backend/`. It checks replay/usage/history/Reflect and cleans up its temporary
account only after Supabase confirms its ID and freshly generated test email.
An independent security review caught unsafe trust in the target backend's
account ID; authoritative verification and four regression cases now cover it.

Live service evidence on 2026-09-15:

- Corrected synthetic fixture: 10.103 seconds, mono AAC, 48,410-byte M4A. Local
  decoding and real OpenAI transcription/coaching passed.
- Local full HTTP smoke (`--url http://127.0.0.1:8773`) — PASS: production
  Supabase auth, M4A processing (10.8 seconds), persistence, replay with exactly
  one usage charge, history/detail, real Reflect reply, deletion, and cleanup.
  Log: `/private/tmp/mirra-local-http-smoke.log`.
  Repeated after the cleanup security fix: PASS, processing 9.7 seconds;
  `/private/tmp/mirra-local-http-smoke-verified-cleanup.log`.
- Local five-minute HTTP smoke — PASS with real Supabase/OpenAI: 303.093-second
  stereo AAC M4A at 44.1 kHz (Mirra's iOS preset), 3.97 MB. Full processing took
  168.9 seconds; replay, one usage charge, history/detail, real Reflect reply,
  deletion, and account cleanup passed. This checks backend handling of long
  input, not screen-lock capture. Log: `/private/tmp/mirra-local-five-minute-smoke.log`.
- Initial Render smoke — FAIL: auth/history/usage passed; valid M4A upload hit the
  600-second client read timeout. Temporary account cleanup succeeded.
  Log: `/private/tmp/mirra-beta-valid-smoke.log`. Health remained responsive.
  Later stage logs and build-time compilation isolated and improved the first
  decoding delay, as recorded above.
- Earlier `/private/tmp/mirra-beta-synthetic.m4a` had zero audio frames because
  speech generation was sandboxed. That run also timed out and cleaned up,
  but is invalid evidence for a speech-processing acceptance test.

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

6. **TF-7:** Record until native auto-stop at 23m20s, including speech near the
   beginning, middle, and end. Confirm one saved clip and debrief/history/Reflect
   result. Repeat with an imported file at the limit; reject a file just over it
   without consuming usage. Test competing uploads and their eventual recovery.

The default monthly cap is five debriefs. Cached metadata confirms all six
completed clips in the current phone queue belong to one account (including the
separate short clip after the maximum test, confirmed by the user as an accidental
capture). The reconciled count does not indicate a duplicate save from the maximum run.
Before reconnecting, observe current usage and agree which clips/account will
exercise each remaining check; six clips cannot all succeed in a fresh account's
five-debrief allowance. Preserve queued originals and keep uploads paused until
the candidate backend is ready. Use fresh disposable beta accounts for additional
runs; do not change product limits just to make the checks pass.

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
