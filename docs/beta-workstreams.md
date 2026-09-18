# Parallel beta work — 2026-09-17

The user requested one independent Codex task and worktree per remaining issue,
with eventual integration. This supersedes the earlier implementation pause.
The original beta used a 23m20s maximum. The user subsequently selected the newer
main-branch implementation, including day-long support, as recorded below.
Keep the current upstream design and use minimal fixes.

## Release work resumed — 2026-09-18

The user authorized proceeding with review/GitHub backup, backend rollout,
remaining validation and TestFlight preparation in parallel worktrees, then
merging completed work. The clean starting candidate is `002e2ea`.

Fresh GitHub inspection found newer `origin/main` at `64db03b`, including
resumable day-long recording jobs, a disk-backed chunked pipeline, completion
and cancellation RPCs, and generated Expo native projects. The user explicitly
selected this newer version and requested reassessing which earlier work remains
necessary. Use main as canonical, retain only still-needed safeguards, and avoid
carrying obsolete 1400s limits, whole-request processing or duplicate accounting.
The old 23m20s device evidence does not validate the newer architecture.

| Task | ID | Branch / worktree | Ownership |
| --- | --- | --- | --- |
| Mirra release — reconcile upstream and beta fixes | `01a0b2d7-775c-7313-9832-b21542e7baa7` | `codex/beta-reconciliation`, `6258/mirra` | Source/config merge, minimal confirmed fixes and combined verification; `reconciliation.md` evidence |
| Mirra release — hosting and database rollout | `01a0b2d7-816c-72b1-830a-6553b704ae2d` | `codex/beta-deployment-readiness`, `ebf0/mirra` | Read-only infrastructure/migration discovery, capacity and rollout plan; `rollout.md` evidence |

Root owns shared ledgers, integration, independent pre-push review and GitHub
updates. Worktrees are under `/Users/jonathanj/.codex/worktrees/`. The first
critic pass reviews fixed snapshot `002e2ea`; the final reconciled candidate
requires a subsequent review before pushing. Draft PR #12 is still open on
`codex/testflight-beta` at `5131485`. No production mutation or purchase has
been made in this resumed phase. Keep phone clips offline pending a coordinated
backend and usage-baseline check.

## Shared base and integration

- Implementation base: `773d35f3e554f8c8353f17c81b7bd847cc9078a1`.
- Preserved checkpoint: `codex/beta-pause-2026-09-17`.
- Integration branch: `codex/beta-integration-2026-09-17`.
- Integration task: `01a0a651-7a8c-76c3-8429-0e86526e0096`
  (Prepare Mirra for TestFlight beta).
- Each task must confirm its private checkout starts from the shared base.
  Codex worktree creation may start at `main`; fast-forward that private branch
  to the base before implementation. Never reset an unrelated checkout.
- Each task commits locally and maintains its own evidence file under
  `docs/beta-workstreams/`. Only the integration task edits the shared acceptance
  ledger, this index, `CLAUDE.md`, and `docs/beta-pause.md`.

## Responsibilities

| Issue/task | Owned code or responsibility | Evidence file |
| --- | --- | --- |
| Mirra beta — server memory and hosting | Decoder/memory in `coordinator.py`, VAD/prosody, `speaker.py` RMS allocations, backend dependencies and memory/warm-up tools. Benchmark realistic maximum-length input; recommend capacity with evidence. | `memory.md` |
| Mirra beta — transcription at 23 minutes 20 seconds | `transcription.py`, provider/codec checks and smoke tools. Real maximum-length transcription → debrief/history/Reflect. | `transcription.md` |
| Mirra beta — audio imports and file limits | `useImportAudio.ts`, import tests, incoming file type/size validation in `main.py`. Formats, duration/size boundaries, visible failures and preserved originals. | `imports.md` |
| Mirra beta — concurrent uploads and offline recovery | Session admission/idempotency/quota in `main.py`, pending-recording queue/storage and retry tests. Coordinate import/recorder hooks with their owners. | `reliability.md` |
| Mirra beta — iPhone recording and recovery | `useRecordAudio.ts`, recording/permission UI and associated tests. Physical auth, mic, locked recording, auto-stop/save and offline checks with the user. | `device.md` |
| Mirra beta — iOS build and TestFlight signing | EAS/Expo build settings, `app/ios`, production build scripts, global Xcode/signing setup. Prepare a free own-device path and track remaining TestFlight requirements. | `distribution.md` |

Tasks may touch separate sections of an existing shared test/source file. Keep
diffs narrow, coordinate interface changes, and resolve conflicts during integration
without dropping either task's tests. Do not independently rewrite shared modules.

## Prior worktree cleanup

All six confirmed initialization at the shared `773d35f` implementation base.
Worktree paths are beneath `/Users/jonathanj/.codex/worktrees/`.

| Issue | Task ID | Branch | Worktree suffix | Current status |
| --- | --- | --- | --- | --- |
| Memory | `01a0b1d5-a406-7de2-9ef1-5932f835e3d1` | `codex/beta-memory` | `c3a6/mirra` | Worktree and local branch removed after integration |
| Transcription | `01a0b1d5-aa8e-70b3-a3a3-1e613af3f951` | `codex/beta-transcription-1400` | `b07f/mirra` | Worktree and local branch removed after integration |
| Imports | `01a0b1d5-b7e6-7f72-a84a-7f78482db974` | `codex/beta-imports` | `8b65/mirra` | Worktree and local branch removed after integration |
| Reliability | `01a0b1d5-c243-7e10-8ce5-8776f5f97780` | `codex/beta-reliability` | `0f48/mirra` | Worktree and local branch removed after integration |
| Device | `01a0b1d5-d76c-76c0-9ac4-e499b15bdc2a` | `codex/beta-device-capture` | `3a46/mirra` | Worktree removed; branch retained |
| Distribution | `01a0b1d5-ee26-7bb3-a253-c4c421279434` | `codex/beta-distribution-2026-09-17` | `7411/mirra` | Worktree removed; branch retained |

At the user's request on 2026-09-18, device removed the four completed implementation
worktrees and their local branches after verifying clean checkouts and that their
heads (`0f7adec`, `a907631`, `5a3ee41`, `108e07c`) were ancestors of integration
`39b1538`. Normal `git worktree remove` and `git branch -d` were used without force.
All commits remain in integration history. At the user's subsequent cleanup
request, the device and distribution worktrees were also removed without force,
after confirming clean checkouts, idle tasks and both heads merged into `1353d64`.
Their branch references remain available; only the main integration checkout
is registered as a worktree. Local Xcode/Expo settings were preserved under
`app/.expo/worktree-cleanup-2026-09-18-distribution/` (ignored by Git); production
environment configuration already had an identical copy in the main checkout.
Generated dependencies/build caches in the removed worktrees were cleaned up.
Phone recordings and separately preserved temporary audio/build artifacts were
not changed.

### Coordinated dependencies

- Imports owns extracting `app/src/utils/audioDuration.ts` from its existing
  duration reader; device consumes it to measure native completed clips.
- Imports owns routing its validated files into the existing recording queue and
  import-specific HomeScreen handling. Reliability owns optional queued title
  metadata and queue/storage changes. Device owns recording/permission HomeScreen
  sections. No second queue or duplicate duration reader is needed.
- Reliability is authorized to prepare a local durable quota-receipt migration
  and transactional reserve/refund fix for the discovered server-crash charge
  leak. Production schema changes remain deferred to coordinated integration;
  rollout/compatibility and database test evidence must accompany that work.
- Distribution and device coordinate free personal-team build installation and
  physical checks directly. Device received reliability's TF-4 recovery checklist.

## Received handoffs

| Issue | Local commits | Evidence and remaining work | Integration status |
| --- | --- | --- | --- |
| Shared duration reader (imports) | `b5bb77b6bf7a76d2a1f52301c919bd4d72d3930f` | Validated `getAudioDuration` helper; device has identical cherry-pick `34148ad3d889c0c46e35d00fb530be92c37121a8`. | Integrated once in the resulting source; original branch histories retained. |
| Memory | `0f7adec` | Two bounded-allocation changes, tests and reproducible offline benchmarks. 512 MiB still fails; 2 GB is the next production-test candidate. | Merged as `f7a88f8`; [evidence](beta-workstreams/memory.md). |
| Imports and queue dependencies | `4264627`, `5a3ee41`; equivalents of `ea2c446` and `cbeb382` | Durable imports, input boundaries, consent/account/MIME checks, known metadata quirks and terminal-error retention. | Merged as `f18f6c8`; [evidence](beta-workstreams/imports.md). |
| Device/capture | `b406afe`, docs through `5ce489c` | Fresh native files, actual saved duration with fallback, microphone Settings recovery and interruption UI. TF-2/TF-5 pass by user observation on Personal Team; TF-4 offline restart, TF-6 local locked capture/audio and TF-7 local native auto-stop/save/audio subchecks pass. Imports, interruption and end-to-end checks stay open. | Code merged as `c9eadd0`; later [device evidence](beta-workstreams/device.md) integrated. |
| Transcription | `a907631` | Real 1400s local provider flow passed: 336.94s transcription / 351.5s complete session, history/Reflect/replay/refund checks. | Merged as `6dead13`; [evidence](beta-workstreams/transcription.md). |
| Build/distribution | `13ae5d8`; evidence through `eda5c20` | Native Release source `a4b3c14` signed, installed and launch verified with the approved free Personal Team ID. TestFlight and complete recording-flow checks remain open; device auth/recovery results are above. | Guard merged as `62c5f61`; [build evidence](beta-workstreams/distribution.md) integrated. |
| Reliability/quota | `ecb3413`, `108e07c` (app dependencies above) | Durable quota receipts, SQL concurrency/crash checks and rollout instructions. Migration is local only. | Merged as `3fa5593`; [evidence](beta-workstreams/reliability.md). |

## Combined validation — 2026-09-18 UTC

- All six completed code areas are combined locally. Merges were clean, including
  shared app files; helper and queue equivalents produced one implementation.
- Import decoder tests were adapted to receipt identities and the atomic save RPC;
  actual invalid/overlong decoding, same-attempt refund and no-save checks remain.
- App: **44 tests passed**, TypeScript passed.
- Backend: **187 tests passed**, seven opt-in database tests skipped in that run.
- Separate integrated PostgreSQL 14.23 transaction run: **7 passed**, clean exit 0.
  Used disposable Unix-socket cluster `/private/tmp/mirra-integration-pg-20260917`,
  port 55449, no TCP listener. Its test database was removed and server stopped.
- Integrated unsigned iPhone Release build: **PASS**, exact source `a4b3c14`,
  Xcode exit 0. Preserved at
  `/private/tmp/mirra-distribution-artifacts/a4b3c14/Mirra.app`; identity and hashes
  are recorded in the distribution evidence. The subsequent signed install/launch
  is recorded below; source code is unchanged.
- Later physical preparation: signed Personal Team build installed and launched
  on iPhone 13 / iOS 26.6.2; user confirmed “Mirra opens.” Approved device-only
  ID `com.mirra.personal.dm85xzns55`; production ID unchanged. Developer Mode and
  profile trust are resolved. Profile expires 2026-09-25 01:09:36 UTC.
- User-observed **TF-2 and TF-5 PASS on the Personal Team build**: independent
  launch/sign-in, session restoration and cellular reads, microphone denial and
  Settings recovery with a stopped clip saved offline. Two stopped clips also
  survived offline restart (partial TF-4). These checks used the current old
  production backend; candidate audio processing is not validated. Repeat the
  release checks on TestFlight. TF-6 remains open: the first inspected clip was
  106.996100s; the repeat started 2026-09-18 02:50:36 UTC and independently
  measures **424.784399s (7m04.8s)**, with complete local decode passing.
  On 2026-09-18 03:08 UTC the user confirmed five continuous minutes locked and
  all three spoken markers audible. **Local locked capture/audio PASS**; lock
  time and listening are user-observed, not assistant-timed. Debrief delivery
  remains unverified. The user reports automatic stop exactly at 23:20 and saved
  clips surviving offline relaunch. Read-only inspection measured the maximum
  clip at **1399.952834s**, 17,425,982 bytes; full local decode passed. Six completed
  manifests are present and cached metadata confirms all six belong to one account,
  including a later separate 2.436644s clip; this supersedes the earlier reported
  count of five. The user confirmed the maximum clip's three audio markers audible
  at 2026-09-18 03:59 UTC, then confirmed the short clip was an accidental capture
  at 04:00 UTC. **TF-7 local native auto-stop/save/audio PASS**; the full gate remains
  open for import/provider/end-to-end and interruption checks. Reconnect planning must account for all six clips,
  observed usage and the five-debrief monthly cap without discarding originals.
  Originals remain queued and unchanged; no backend/provider upload occurred.
- No production migration, deployment, push or purchase. Independent pre-push
  review, actual Supabase/PostgREST validation, integrated real-provider memory,
  sustained load, TestFlight distribution and the remaining physical checks stay open.
- User-requested cleanup removed all six merged issue worktrees. The first four
  local branches were removed; device/distribution branch references remain.
  Only the main integration checkout remained at cleanup; all merged commits and
  evidence were preserved. The resumed release worktrees are listed above.

## Shared resources and boundaries

- Only distribution owns Xcode setup/signing/native build operations; device
  testing uses its artifact. The user completes sign-in and legal agreements.
- Use unique local ports, temp paths and container names. Do not stop other tasks'
  processes. Coordinate live API tests; do not load-test the free production server.
- Existing ignored configuration can support authorized tests; never print or
  commit credentials, environment files, private recordings or transcripts.
- Production remains the existing free Render service, with auto-deploy off.
  No paid hosting change or Apple membership purchase is authorized.
- Issue tasks prepare local changes. Integration coordinates any future push,
  production deployment and shared configuration changes. No issue task merges
  into the integration branch or changes production independently.

## Evidence and merge procedure

1. Each task records its branch, base/head commits, concrete fixes, commands and
   results, and unresolved checks. Mocked/local checks do not pass device or
   production gates. Send the handoff to the integration task.
2. Integrate dependency-ready branches one at a time. Merge backend memory,
   transcription and request handling carefully; then combine import/queue/device
   work and build settings. Actual dependencies determine order.
3. Resolve shared-file conflicts while preserving both behaviors and tests. Run
   relevant checks on the combined state; rerun full recording-to-debrief checks
   on that integrated candidate, not just individual branches.
4. Before any GitHub push, obtain the independent `code-critic` review required
   by `AGENTS.md` for the exact destination and outgoing base/head range. Review
   subsequent fixes before pushing.
5. Keep each gate open until its agreed evidence exists; qualify candidate passes
   by build/backend and repeat release checks on the final TestFlight candidate.
   Retain issue branches/worktrees until their integration has been verified.

The original release goal is not complete. Work in the six tasks is authorized;
the app's paused goal status is separately user-controlled.
