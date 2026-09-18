# Beta source reconciliation, September 18, 2026

The user chose newer GitHub main as canonical, including 24-hour, 2 GiB resumable recordings. Prior work was reassessed against that implementation, rather than retained merely because it had been tested.

## Exact inputs and history

- Clean initial worktree: detached `64db03b524722e853a53810fcceef75347c268c4`.
- Created `codex/beta-reconciliation` at the exact previous candidate `002e2eac55bf236495c2fc7d0ae68b0fff087a7d`.
- Merged `64db03b524722e853a53810fcceef75347c268c4` without squashing. Common ancestor: `f628b73c09815af4895b744b6682c1a7ee8e1345`.
- The merge commit preserves both histories. Its first parent identifies the old candidate; its second parent identifies canonical upstream. Shared acceptance/handoff documents are owned by the coordinating task and receive a separate current-state pass.
- Installed-phone evidence belongs to source `a4b3c14`. The later `002e2ea` head accumulated the session handoff and evidence; it was not a newly installed app. No historical device pass establishes acceptance of this combined source.

## Disposition of earlier work

| Earlier work | Disposition | Result and reason |
|---|---|---|
| 1400-second limit, 100 MiB uploads, single-request fallback MP3, 600-second transcription attempt, 35-minute client deadline | Superseded | Main's disk-backed decoder, ten-minute requests, 180-second provider timeout, 120-second resumable HTTP requests, 24-hour/2 GiB boundary remain canonical. Native capture now passes `forDuration: 86400` to retain the agreed native auto-stop guarantee. |
| Streaming single-request decoder and presence-only ONNX VAD | Superseded | Main needs timestamped VAD segments to prefer pauses at chunk boundaries. Its decoder, VAD, Python dependencies and lockfile are retained. Removed obsolete `benchmark_memory.py`, `Dockerfile.memory`, `warm_audio.py`, and their obsolete checks. Historical measurements remain in the beta evidence documents. |
| Full-turn pitch batching and RMS allocation changes | Already covered upstream | Main bounds RMS slices and samples at most 64 five-second pitch excerpts. Those implementations replace the old full-turn allocation work. New architecture requires new memory measurements. |
| Durable receipt reservation/refund experiment | Superseded | Both background jobs and legacy `/sessions` now call main's `complete_recording` SQL transaction. Saving and charging occur once together, with cancellation/deletion tombstones and account-scoped IDs. The unused, undeployed receipt migration and old reservation API/tests are removed from active source; their commits and evidence remain in history. No transition migration was added. |
| Legacy replay and quota reliability requirements | Retained through main's mechanism | Stable-ID replay bypasses a busy pipeline, invalid processing cannot charge, transcript settings are fetched again before commit, and quota/cancellation races are tested against real SQL. Legacy uploads without a recording ID receive a server UUID. |
| Explicit native prepare options | Retained and adapted | `prepareToRecordAsync(RECORDING_OPTIONS)` creates a fresh iOS source file and preserves main's mono 24 kHz/64 kbps options. Passing the old HIGH_QUALITY preset would override those settings. |
| Stop-time duration helper and microphone recovery | Retained | Read duration from the native file after Stop because Expo resets its status timer, with fallback that never blocks saving. Keep microphone Settings recovery and paused-recording UI. A media reset now saves the active original URI before considering Expo's newly created recorder URI. |
| Account/consent-safe import validation | Retained and adapted | Recheck account and consent after picker/metadata waits, reject empty/unsupported/oversized sources, retain safe generated upload filenames and titles, and use main's 2 GiB/24-hour limits. Unknown metadata remains eligible for authoritative server decoding. Small encoder-padding metadata is bounded to the request schema without changing audio bytes. |
| Fixed internal queue filename and container rebasing | Retained | New entries use internal `audio`; restored entries rebase the persisted URI basename, supporting both that format and main's earlier filename format. Existing six phone clips must survive an overlay update. Reject empty/dot basenames; picker filenames never become storage paths. |
| EAS project identity and native Release validation | Retained and adapted | Preserve verified EAS project/owner and candidate production/simulator profiles alongside upstream preview/Android profiles. Move the Xcode Release guard into the canonical Expo config plugin. Keep main's archive, permissions, backup exclusions, notices and UI changes. CI supplies public-shaped build placeholders; it does not prove service connectivity. |
| Synthetic beta smoke helper | Retained, legacy only | `smoke_beta.py` explicitly exercises `/sessions` with its 25 MiB cap. It does not validate current resumable uploads or day-long acceptance. No live smoke was run during reconciliation. |
| Prior iPhone launch, lock, 1400-second auto-stop, marker and six-clip evidence | Evidence only | Preserved in historical documents with installed source `a4b3c14`. New builds require renewed device/provider validation; do not uninstall or clear the phone to make a test clean. |

## Merge resolutions

All 20 unmerged paths were resolved after tracing the actual flow. Main wins for coordinator/diarization and pipeline documentation. App API uses resumable upload/cancellation. Capture, import and queue tests combine current upstream cases with the still-relevant candidate regressions. Backend legacy sessions use the same atomic completion as jobs instead of either reservation/refund implementation. `app.json`, EAS profiles and package scripts retain legitimate settings from both sides.

Main deliberately removes tracked generated native projects and the duplicate `CLAUDE.md`; no generated Xcode/Podfile changes were resurrected. The coordinator owns the later shared-guidance normalization. Upstream website, Pro plan UI, conversation goals, privacy controls, notifications, accessibility and security changes are preserved.

## Expo interruption evidence

Inspected installed, lockfile-selected `expo-audio` 57.0.5 native source:

- iOS `AudioRecorder.prepare(options:)` creates a new recorder only when options are supplied. Finish resets duration tracking. Media-services reset prepares a new recorder before emitting a finished event with no URL.
- iOS `AudioModule.handleInterruptionBegan` pauses recorders. `handleInterruptionEnded` resumes eligible players, not recorders. The app therefore keeps Stop/save available and does not force resume.
- Android `recordWithOptions` uses a native coroutine delay for `forDuration`; its timer continues while paused. iOS calls AVAudioRecorder's native duration API. No JS-only timer is relied on while the screen is locked.
- Native maximum, interruption and overlay-update behavior still need a rebuilt physical-device test. The source inspection is not a device pass.

## Verification

- Clean checkout was confirmed before branch creation and merge.
- Locked npm dependencies installed in this worktree; app TypeScript check passed.
- App native/network-boundary suite: 50 tests passed, including 86400-second native options, media-reset original preservation, old/new queue formats, storage failures, import account changes, and duration padding.
- Backend suite: 170 tests passed with synthetic/local boundaries. Local FFmpeg and an isolated Numba cache were supplied. The four optional SQL checks were run separately after the filesystem sandbox blocked the Unix socket.
- Disposable PostgreSQL 14.23: all nine canonical migrations, `privacy.sql`, `long_recordings.sql`, and four additional transaction tests passed. The latter cover eight concurrent cap requests, concurrent stable-ID replays, process death after commit, failed-insert rollback, cross-account collision and cancellation racing completion. Test databases were dropped. No production database was changed.
- Expo prebuild for iOS and Android passed with the Release guard generated through the plugin. Generated files remain ignored. No native compilation, signing or device operation was performed here.
- iOS, Android and web Expo bundle export passed with build-only public-shaped placeholders.
- Website preview build and all five website checks passed. Launch approval remains false.
- `git diff --check` passed. No push was performed; the coordinator owns the exact outgoing independent review and integration.

## Open gates and schema evidence

The deployment-readiness task observed no live `debrief_receipts` or `debrief_deletions` table, no `coaching_goal` column and no receipt/completion/readiness/deletion RPCs through the service-role API. Direct migration history was unavailable. This agrees with the coordinator's record that the candidate receipt experiment was tested only in disposable local PostgreSQL, and means the canonical September 14/15/16 schema still needs operator-controlled rollout.

Open: authoritative deployment and readiness; persistent private volume/backups and memory/storage sizing; synthetic multi-chunk provider coverage and timing; a rebuilt app's overlay update with existing queued audio; actual lock/interruption, 24-hour boundary/auto-stop/save, foreground resume and cancellation behavior; current signing/distribution gates. Prior 1400-second passes remain historical. No real audio upload, production mutation, purchase or physical-phone operation was performed.
