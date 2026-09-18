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

**Personal Team installation and USB-connected launch passed. Complete TF-1
through TF-7 gates remain OPEN.**

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

This task has asked the user to disconnect USB, force-close Mirra, reopen it from
its icon, and report sign-in/home/error as the first TF-2 subcheck. That reply,
production sign-in, authenticated reads, cellular access, and session restoration
remain pending. Connected launch alone does not pass TF-2. Personal Team delivery
does not pass the TestFlight installation gate. Distribution retains native
signing/install ownership for any subsequent integrated candidate.

Production remains `https://mirra-backend-wp2b.onrender.com`, deployed commit
`f8cf5d7196654aff3ff578bb5503668aa3ff15cd`, Free 512 MB, not this candidate.
The prior capacity failure and deployed limits can block full debrief/provider
checks. A backend failure must not be reported as a failed local capture without
separate evidence; complete microphone, local-save/restart, and lock checks offline.

| Gate | Required physical evidence | Status |
| --- | --- | --- |
| TF-2 | Installed build cold launch, public production auth, restored correct account/history after force-quit, cellular read | OPEN — installed/connected launch passed; independent launch/auth/restore/cellular checks pending |
| TF-3 | Real 30–60s capture, one saved nonempty debrief, history after relaunch, model Reflect reply | OPEN — device and working backend needed |
| TF-4 | Two offline stopped clips survive restart; reconnect yields two debriefs and exactly +2 usage; expired token/account switch/consent recovery | OPEN — device and provider evidence needed |
| TF-5 | Deny mic, responsive error/Settings action, grant in Settings, return and record/Stop/save without stuck state | OPEN — mocked regression only |
| TF-6 | At least 5 minutes locked with beginning/during/after-lock audio intact | OPEN — actual audio required |
| TF-7 | Native 1400s auto-stop, one saved clip, beginning/middle/end audio, one debrief/history/Reflect result; equivalent at-limit import and over-limit rejection | OPEN — imports/provider checks coordinated separately |

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
