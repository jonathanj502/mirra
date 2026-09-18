# Physical iPhone capture — 2026-09-17

## Scope and checkout

- Worktree: `/Users/jonathanj/.codex/worktrees/3a46/mirra`.
- Private branch: `codex/beta-device-capture`.
- Initial clean, detached checkout: `f628b73c09815af4895b744b6682c1a7ee8e1345`.
- Fast-forwarded before edits to assigned baseline
  `773d35f3e554f8c8353f17c81b7bd847cc9078a1`.
- This task owns capture hook, recording/permission UI, recording hook tests,
  and this evidence file. Native project/signing/build changes belong to distribution.
- The user authorized this workstream after the older pause banners. No push,
  shared-branch merge, deployment, production configuration, or payment occurred.

## Candidate changes and local evidence

Inspected the installed `expo-audio` **57.0.5** implementation, including
`ios/AudioRecorder.swift`, `ios/AudioModule.swift`, `src/ExpoAudio.ts`, and
the recorder state poller. Native source inspection is not a physical-device pass.

1. **Fresh native file for each capture.** iOS preparation without options reuses
   the native recorder/file. The app rejects stale finish events by comparing
   file URLs, so a reused URL defeats that guard. Preparation now passes the
   existing HIGH_QUALITY options, which creates a fresh native recorder/file.
   The hook test models the SDK's reuse when options are omitted and checks that
   an earlier clip's delayed finish cannot stop a subsequent capture.
2. **Finished-file duration.** iOS resets its native duration before emitting
   finish. A last JS poll can also be stale when the phone is locked. Before
   enqueueing a stopped native clip, read its actual file metadata using the
   import workstream's shared duration reader. If metadata fails or times out,
   retain the last observed duration and save the original audio anyway. Saving
   remains visible until the existing durable queue acknowledges the file.
3. **Microphone recovery.** Denial with `canAskAgain=false` explains the Settings
   action; Record displays an accessible button opening app Settings. If opening
   fails, show manual instructions. The next recording attempt requests current
   permission again and clears the recovery state when granted.
4. **Interruption feedback.** While Expo reports a paused recorder, Record says
   the microphone was interrupted and offers Stop/save. Expo continues to own
   native resume; the hook does not compete for the microphone. The existing
   limit note now explicitly states recording stops at 23m20s.

Shared helper dependency: import task commit
`b5bb77b6bf7a76d2a1f52301c919bd4d72d3930f`, cherry-picked here as
`34148ad3d889c0c46e35d00fb530be92c37121a8`. These contain the same helper and
tests; integrate **one** copy before the capture change. Capture and import both
touch separate sections of `HomeScreen.tsx` and `mobileRecovery.test.mjs`;
preserve both during integration. No import hook sections were changed here.

Local validation on 2026-09-17:

- Baseline: **25 app tests passed**, TypeScript passed.
- Candidate: `node --test app/tests/*.test.mjs` — **31 passed**.
- `cd app && npm run typecheck` — **PASS**.
- `git diff --check` — **PASS**.
- Existing Node module-type warning in `talkListen.ts` remains unrelated.
- Used the main checkout's existing `app/node_modules` via a temporary symlink;
  no install, main-checkout dependency mutation, environment file, credentials,
  or audio fixture was needed. The symlink is not committed.

Regression coverage includes duplicate finishes with exactly one enqueue;
native auto-stop without another Stop call; a last poll at 600s followed by
native timer reset and 1400s file metadata; preservation on metadata failure;
manual Stop; stale previous-file events; account ownership across finish;
media-service reset/error; storage-full retry retaining the original; microphone
denial followed by Settings permission recovery; and Settings-button fallback.
Existing filesystem/queue tests also cover restart, account isolation, auth
refresh, consent, serial upload, and deletion only after acknowledgement.
All native, permission, network and auth boundaries in these hook tests are mocked.

## Hardware and provider status

**TF-2 and TF-5 installed-device behavior PASS (user-observed on the Personal
Team build). TF-6 local locked capture/audio check PASS; its debrief-delivery
portion remains OPEN. TF-1, TF-3, TF-4, and TF-7 remain OPEN.**

Phone confirmed by distribution's device inventory: **iPhone 13 (`iPhone14,5`),
iOS 26.6.2 (23G90)**. The user replied "connected" in this task after cable,
unlock, and trust instructions. Developer Mode is enabled and device services
are available. No iMessage coordination was used.

Distribution task `01a0b1d5-ee26-7bb3-a253-c4c421279434` reports that capture
commit `b406afe7668809537efad4369ded7e037b915c4c` and helper `b5bb77b` are now
included in its build worktree (equivalent candidate HEAD `b32546e`), with local
Release guard commit `13ae5d8`. Xcode 26.6 and its downloaded iOS 26.5.1 platform
are installed. The user signed into Xcode and a Personal Team is visible.

Earlier capture-only candidate: **unsigned Release iPhone BUILD SUCCEEDED**:

- Artifact: `/private/tmp/mirra-distribution-device/Build/Products/Release-iphoneos/Mirra.app`.
- Source: `b32546e`, with distribution guard `13ae5d8`, helper cherry-pick
  `404838c`, and capture cherry-pick `b32546e` (equivalent to this task's `b406afe`).
- Identity: version 1.0.0, build 1, `com.mirra.app`, arm64 `iphoneos`.
- Intended Render URL confirmed in production bundle; production environment
  guard and 1883-module Hermes bundling passed. Distribution also reports 32 app
  tests and TypeScript validation passed on its candidate.

The earlier artifact was superseded by the integrated candidate below.

### Installed integrated candidate — 2026-09-18 01:15:51 UTC

Distribution reports **signed Release build, device installation, and connected
launch PASS** for source `a4b3c14dfaa8fa5950026aae173b901439ad02f1`:

- App: version 1.0.0 (1), local bundle ID `com.mirra.personal.dm85xzns55`.
  The shared release ID remains `com.mirra.app`.
- Artifact: `/private/tmp/mirra-distribution-artifacts/a4b3c14-personal/Mirra.app`.
- The user explicitly approved free Personal Team provisioning/signing/install
  and the new local bundle ID in the distribution task. Initial automatic-review
  blocks were resolved by those approvals. No paid membership was purchased.
- Deep/strict signature verification passed; the provisioning profile includes
  this iPhone and expires **2026-09-25 01:09:36 UTC**.
- `main.jsbundle` SHA256:
  `cdd96c87f3505c49c04b321290dbe6ea43da441282b55a8ffcfabffc78c43809`.
  The integrated bundle retains the intended production Render URL.
- An initial launch was blocked by iOS developer-profile trust. A subsequent
  `devicectl` launch succeeded at **2026-09-18 01:15:51 UTC**, PID 849, establishing
  that the trust blocker was resolved. No further signing approval is needed for
  the already authorized operation.

After this task asked the user to disconnect USB, force-close Mirra, and reopen
it from its icon, the user reported: **"i see the sign in screen. the signin
works"**. Independent launch to sign-in and successful sign-in are therefore
**PASS (user-observed)** on the installed candidate. After the next instruction
to turn Wi-Fi off, leave cellular on, force-close/reopen, verify the same account
is restored, and open Profile and conversation history without errors, the user
reported **"everything is good"**. Recorded at **2026-09-18 01:21 UTC**:
**TF-2 installed-device behavior PASS (user-observed)**, including independent
launch, sign-in, same-account restore, and authenticated cellular reads. This
checks the installed candidate's auth/read path against the current production
backend; it does not validate candidate audio processing or change deployment.
Personal Team delivery does not pass the TestFlight installation gate.
Distribution retains native signing/install ownership for subsequent candidates.

For TF-5, the user followed the offline microphone-denial check and reported
**"it shows open microphone settings"**. After instructions to tap that action,
enable Microphone in Settings, return to Mirra, record about ten seconds of
speech, and Stop with Airplane Mode on/Wi-Fi off, the user confirmed
**"it does say 1 recording saved on this device"**. Recorded at
**2026-09-18 01:36 UTC**: **TF-5 PASS (user-observed)** for denial, Settings
recovery, responsive recording/Stop, and one local saved row. This establishes
permission recovery/local saving, not the clip's audio completeness or an upload.

After instructions to remain offline, record/Stop a second short clip, verify
two saved recordings, then force-close/reopen, the user confirmed **"yes both
are still saved"**. Recorded at **2026-09-18 01:38 UTC**: **TF-4 offline restart
subcheck PASS (user-observed)**. Reconnect uploads, duplicate prevention, usage
deltas, account switching, and token-expiry checks remain pending; TF-4 is OPEN.

Next independent TF-6 check requested: remain offline, start a third capture,
speak "before lock," keep the phone locked for at least five minutes and speak
"during lock" partway through, then unlock, speak "after lock," and Stop. Ask
for three saved rows and newest duration of at least 300s. Actual saved audio
must still be checked for all three markers before TF-6 can pass. Reconnect and
candidate-backend validation are being coordinated with integration; no upload
or usage result has been observed from these physical clips yet.

The user subsequently replied "yes" after the reminder to keep clips offline.
This could acknowledge that reminder rather than confirm the completed lock
test. The task asked for the newest clip's exact displayed duration and whether
the phone was locked for five full minutes; **both the lock/save subcheck and
full TF-6 remain PENDING** until clarified. The initial interpretation of that
reply as a completed capture was corrected with integration and distribution.
The user answered the duration/lock-time follow-up with "its good," without a
numeric duration. Read-only USB copying of only the newest queued test clip was
planned for local duration/marker verification with Airplane Mode on/Wi-Fi off.
Distribution confirmed the phone is paired and connected over wired USB, with
Developer Mode/device services available. Automatic approval review rejected the
saved-recording metadata query before execution because access to private
recording metadata/audio needs explicit user permission; delegated instructions
were not accepted as sufficient. The user then explicitly approved the narrow
local inspection in the distribution task, resolving that blocker.

### Actual stopped-clip inspection — recorded 2026-09-18 02:16 UTC

Distribution's read-only inspection found three completed saved recordings:
**11.654966s, 10.493968s, and 106.996100s**. Only the newest/longest audio was
copied, along with the queued manifests needed for identification. Its details:

- Recording ID: `1789695530139-6wzy0iedzvs`.
- Start time: `2026-09-18T01:38:50.139Z`.
- Local copy: `/private/tmp/mirra-distribution-capture-review/recording-1789695530139-6wzy0iedzvs.m4a`.
- Native `afinfo`: **106.996100 seconds**, AAC, stereo, 44.1 kHz.
- Size: **1,436,648 bytes**.
- SHA256: `69e9e5d4438cdd05cfb6c12a09b184433d87999f96434590c6a0fdceaf680cd7`.
- Complete local FFmpeg decode: **PASS**, exit 0, no errors.
- Private temporary directory mode 0700 and audio mode 0600; raw manifests and
  audio remain outside the repository. Phone originals/queue were unchanged.
  No app launch, phone writes, backend/provider requests, or uploads occurred.

This is **1m47s**, so the **TF-6 five-minute duration requirement is NOT MET** by
the inspected clip. Marker listening is also unconfirmed. The user was told the
measured result and asked to start a new offline recording, say "before lock,"
lock the phone, and confirm on the Mac for an assisted five-minute timer. The
user instead completed another recording independently and reported **"done i
just did it. it should be more than 7 minutes"**. An assistant-timed locked
interval was therefore not established; the new file was inspected below.

### Longer repeat — recorded 2026-09-18 03:01 UTC

Distribution inspected/copied the new completed clip under the existing narrow
local-inspection approval. It is a different recording from the 106.9961s clip:

- Recording ID: `1789699836005-og44nw1fwsq`.
- Start: `2026-09-18T02:50:36.005Z`; completed manifest modified `02:57:41Z`.
- Manifest and native `afinfo` duration agree: **424.784399 seconds (7m04.8s)**.
- Copy size: **5,429,285 bytes**, matching the phone's file listing.
- Local audio: `/private/tmp/mirra-distribution-capture-review/retest-zt3h3e_y/recording-1789699836005-og44nw1fwsq.m4a`.
- Full local FFmpeg decode: **PASS**, exit 0, no errors.
- Only that completed manifest/audio were copied. No app launch, phone writes,
  queue changes, auth-data access, backend/provider requests, or uploads occurred.

The local audio was presented for playback on the computer. The user confirmed
the phone was continuously locked for at least five minutes (**"yes it was"**),
then explicitly confirmed all three before/during/after-lock phrases were audible
in playback (**"all heard"**). Recorded at **2026-09-18 03:08 UTC**:
**TF-6 local locked capture/audio subcheck PASS**, combining the measured
424.784399s file/full decode with the user's lock-time and listening observations.
Delivery of those markers to a debrief remains untested, so the full end-to-end
criterion is still OPEN. No assistant-timed interval is claimed.

### Native maximum test — user report 2026-09-18 03:41 UTC

After instructions to remain offline, record with beginning/middle/end phrases,
leave the phone locked, and let native capture stop without tapping Stop, the
user reported **"it stopped exactly at 23:20 minutes"**. The user then explicitly
confirmed **"Yes, 5 recordings remain saved"** after waiting for saving to finish
and force-closing/reopening offline. The prior four clips plus this new capture
therefore had a **user-reported** count of five after relaunch. The later actual
manifest count is six, as recorded below; preserve this distinction.

Distribution's narrow file query failed before returning files with CoreDevice
error 1011 (unable to locate the requested device). Fresh inventory retained
the paired iPhone but reported an unavailable tunnel and no wired transport.
No new manifest/audio was read or copied during that failed attempt. This task asked the user to unlock
and unplug/replug the USB cable, keep Airplane Mode on/Wi-Fi off, and leave Mirra
closed after save. Existing local-inspection approval remains valid; no new
permission was required. The user reported "it is reconnected," and distribution
successfully retried the narrow inspection under the existing approval.

### Measured maximum and actual queue — recorded 2026-09-18 03:52 UTC

The maximum-test audio is distinct from all four earlier recordings:

- Recording ID: `1789701357705-jgorzfemtal`.
- Start: `2026-09-18T03:15:57.705Z`; completed manifest modified `03:39:18Z`.
- Manifest duration: `1399.9528344671203s`; native `afinfo`: **1399.952834s**
  (**23m19.953s**, about 0.047s below the 1400s limit).
- Size: **17,425,982 bytes**, AAC stereo, 44.1 kHz.
- Local audio: `/private/tmp/mirra-distribution-capture-review/maximum-v2twgbgx/recording-1789701357705-jgorzfemtal.m4a`.
- Complete local FFmpeg decode: **PASS**, exit 0, no errors.

Actual completed manifest count: **six**, with six unique recording IDs. All
four earlier clips remain:

| Recording ID | Duration (seconds) |
| --- | ---: |
| `1789695221948-qcbjmfqiml` | 11.654966 |
| `1789695414571-eou2tx6e69h` | 10.493968 |
| `1789695530139-6wzy0iedzvs` | 106.996100 |
| `1789699836005-og44nw1fwsq` | 424.784399 |
| `1789701357705-jgorzfemtal` | 1399.952834 |
| `1789702768066-g44ul195j8` | 2.436644 |

The separate final short clip started `2026-09-18T03:39:28.066Z`, with its manifest
modified `03:39:30Z`, about ten seconds after the maximum clip was saved. Size:
84,995 bytes; its audio was not copied/decoded. The user has been asked whether
they started this short recording. **Do not infer a duplicate-save bug or a
manual extra recording until clarified.** Distribution confirmed from cached
metadata that there is one queue owner folder and all six completed manifests
belong to that same owner. Different account scope does not explain the count
difference. No additional device access was needed for that check.

Only the two new manifests needed to select the maximum run and that maximum
audio file were copied. No app launch, phone writes, queue changes, auth-data
access, backend/provider requests, or uploads occurred. The maximum duration
and full decode checks pass. After the maximum file was presented for playback
on the computer and the user was asked specifically about all three markers
(beginning, middle around 12 minutes, and end around 23 minutes), the user
confirmed **"i can hear everything"**. Recorded at **2026-09-18 03:59 UTC**:
**maximum-recording marker listening PASS (user-observed)**. This confirms local
audio preservation; delivery of these markers to a debrief remains untested.

TF-7 remains OPEN. Account for all six actual queued clips: even a zero baseline
would exceed the default five-debrief monthly cap. Keep originals offline and
unchanged until candidate deployment, an explicit clip/account plan, and an
observed usage baseline are ready. Do not reconnect or discard to force the
acceptance test to pass. No provider/backend upload is authorized by inspection.

Production remains `https://mirra-backend-wp2b.onrender.com`, deployed commit
`f8cf5d7196654aff3ff578bb5503668aa3ff15cd`, Free 512 MB, not this candidate.
The prior capacity failure and deployed limits can block full debrief/provider
checks. A backend failure must not be reported as a failed local capture without
separate evidence; complete microphone, local-save/restart, and lock checks offline.

| Gate | Required physical evidence | Status |
| --- | --- | --- |
| TF-2 | Installed build cold launch, public production auth, restored correct account/history after force-quit, cellular read | PASS — user-observed on installed a4b3c14 Personal Team build, iPhone 13/iOS 26.6.2; recorded 2026-09-18 01:21 UTC |
| TF-3 | Real 30–60s capture, one saved nonempty debrief, history after relaunch, model Reflect reply | OPEN — device and working backend needed |
| TF-4 | Two offline stopped clips survive restart; reconnect yields two debriefs and exactly +2 usage; expired token/account switch/consent recovery | OPEN — two clips survived offline restart (user-observed 2026-09-18 01:38 UTC); reconnect/usage/duplicate/token/account/consent checks pending |
| TF-5 | Deny mic, responsive error/Settings action, grant in Settings, return and record/Stop/save without stuck state | PASS — user confirmed Settings recovery and one stopped clip saved offline on a4b3c14; recorded 2026-09-18 01:36 UTC |
| TF-6 | At least 5 minutes locked with beginning/during/after-lock audio intact | Local capture/audio PASS — 424.784399s full decode, user confirms >=5min continuously locked and all 3 markers audible (2026-09-18 03:08 UTC); debrief delivery OPEN |
| TF-7 | Native 1400s auto-stop, one saved clip, beginning/middle/end audio, one debrief/history/Reflect result; equivalent at-limit import and over-limit rejection | OPEN — maximum file 1399.952834s/full decode and all three audible markers PASS (user-observed 2026-09-18 03:59 UTC); actual queue is 6 under one owner (includes separate later 2.436644s clip); extra-clip clarification, imports/provider/end-to-end checks pending |

Additional native check: Expo resumes interrupted iOS recorders with
`startRecording()` → `AVAudioRecorder.record()` without reapplying `forDuration`.
Whether the original native deadline survives that resume is **unverified**.
Test an interruption followed by resume and the full duration boundary. Reported
to integration and distribution; no native dependency patch was made here.
Also verify auto-stop saves while locked or on return before any force-quit;
JS callback/queue execution under iOS suspension is not proven by unit tests.

Import workstream reported a local macOS AVPlayer readiness check on synthetic
1400s fixtures: AAC (44.1 kHz, stereo, 128 kbps) metadata read
`1399.975328798186s`, WAV `1400.0s`, and a gapless MP3 that the backend decodes
to 1400s read `1400.076s`; WebM failed to load. This is reported desktop codec
evidence, not iPhone capture evidence. File metadata can differ slightly from
decoded audio, so a displayed duration alone cannot prove the native boundary
or complete audio. Capture preserves the original and falls back if metadata
cannot be read; imports owns its boundary handling. Temporary fixtures/logs:
`/private/tmp/mirra-imports-8b65`.

## UI follow-up requested by the user — deferred

- [ ] Simplify the saved-recording section on Record. On reaching **"1 recording
  saved on this device"**, the user reported that the phone shows too much text
  and asked to keep a note for a future simplification. Reduce the copy around
  that state while keeping the saved status and useful actions clear. No UI
  implementation change was requested for this test session.

## Device handoff: one check at a time

First, once distribution supplies the build, use a disposable beta account and
run **TF-2 only**: disconnect from the development computer/server, cold-launch
Mirra, sign in, open Profile/history, force-quit and reopen, then confirm the same
account returns and an authenticated read works on cellular. Report build/version,
device/iOS, timestamp, result, and exact visible failure text if any. Do not send
passwords or tokens. Continue with TF-5 after that result is recorded.

Subsequent checks, individually guided after each result:

1. TF-5: deny microphone on Record; open Settings from the new action, grant
   access, return, record a short consenting clip and Stop. If permission was
   already granted, turn it off in Settings first. Verify the saved-device row
   offline so backend capacity does not block the mic/recovery check.
2. TF-3: with connectivity and available usage, record a recognizable consenting
   30–60s sample. Verify one debrief, meaningful content, reopen from history after
   relaunch, and verify a model-backed Reflect reply rather than a canned fallback.
3. TF-6: offline if necessary, say distinct phrases before lock, during lock and
   after unlock; keep the phone locked for at least five minutes, then Stop/save.
   Local duration alone does not prove the middle audio is present. Inspect the
   actual clip through authorized local diagnostics or later successful analysis.
4. TF-4: airplane mode after account A is signed in; Stop/save two distinguishable
   clips, verify queue count 2, force-quit/relaunch offline, verify count 2. Reconnect
   foreground, verify two rows/+2 usage; relaunch again and verify no duplicates.
   Repeat after token expiry. Queue another A clip, switch to B (no exposure or
   upload), return to A; withdraw consent (retain/pause), restore (one upload).
5. TF-7: start offline after sign-in and include recognizable phrases near the
   beginning, midpoint and end of a full 23m20s capture. Let native auto-stop;
   verify one saved row, stable count after relaunch, and complete audio. Record
   actual file duration/size via authorized diagnostics. Reconnect only to a
   capable intended backend; verify one debrief/+1 usage, history and Reflect.
   Repeat the boundary after an interruption; coordinate import checks with
   the imports task. A queue row alone does not establish complete audio.

Use fresh disposable accounts when the five-debrief allowance is exhausted;
do not change product limits. Evidence should record build identity, device/iOS,
timestamps, local counts, non-sensitive recording/debrief IDs, usage deltas,
audio completeness result, and visible errors. Do not commit private audio,
transcripts, credentials, or environment files.
