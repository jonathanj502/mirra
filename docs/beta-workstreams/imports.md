# Imported audio and file limits — 2026-09-17

Local candidate only. No GitHub push, deployment, production configuration,
billing change, real account, or provider request was made by this workstream.
TF-1 through TF-7 remain open. Production still serves `f8cf5d7` with the old
25 MiB input cap; this candidate retains 100 MiB and 1400 seconds.

## Branch and integration

- Worktree: `/Users/jonathanj/.codex/worktrees/8b65/mirra`.
- Branch: `codex/beta-imports`.
- Clean initial checkout `f628b73c09815af4895b744b6682c1a7ee8e1345` fast-forwarded
  to assigned baseline `773d35f3e554f8c8353f17c81b7bd847cc9078a1` before edits.
- Shared strict reader + four checks:
  `b5bb77b6bf7a76d2a1f52301c919bd4d72d3930f`. Device workstream cherry-picked it
  as `34148ad5`; integrate the helper once.
- Queue dependency owned by reliability:
  `ea2c446013c3d1e00251017fdbe76605483fe65d`, cherry-picked here as `bd90ab9`.
  It preserves imported titles, uses a safe internal native filename, retains
  originals on failed saves, and supports existing queue recovery.
- Queue follow-up `cbeb38242a52f75b263f52879ec21932df40b043`, cherry-picked here
  as `6acbcb9d07fd44fb3c5adcc1ffd2c5cae49a77b2`: omits unknown duration in the
  upload, retains terminal 400/410/413/415/422 failures, and tests timeout,
  lost acknowledgement, busy backoff, refreshed auth, and account switching.
  Reliability owns its 35-minute upload deadline and retry policy.
- Import changes: `4264627996f25b2c8cb46a006adcea50b849713e`.
  Files: `useImportAudio.ts`, import handling/pending-duration text in
  `HomeScreen.tsx`, the Blob MIME line in `api/client.ts`, import-specific app
  tests, incoming type/size validation in `backend/app/main.py`, and
  `backend/tests/test_import_limits.py`.
- Device owns other HomeScreen/recording-test changes; transcription owns any
  upload-timeout changes; reliability owns session handling/queue policy.
  Merge these sections without replacing whole files.
- Independent code-critic review of the final outgoing commit range is still
  required before any future GitHub push.
- Reliability's subsequent backend quota wrapper/migration work is not included
  here. During integration, adapt the reserve/refund call assertions in
  `test_actual_decode_rejects_overlong_or_corrupt_imports_regardless_of_client_metadata`
  to its identity-based API, preserving the actual decoder/no-save/refund checks.

## Confirmed fixes

- Imports now save through `RecordingProvider.enqueue`, using an account-owned
  stable recording ID and original title. Existing foreground retries refresh
  authentication, recheck consent, and retain audio until acknowledgement.
  HomeScreen receives completion through the existing `latestDebrief` path.
- Picker/metadata work cannot enqueue after account change or unmount. Repeated
  taps cannot create competing import operations. Consent is checked before
  picking and again before saving. Originals survive failed saving.
- MIME inference recognizes WebM and rejects unsupported extensions instead of
  guessing MP4. Blob uploads now apply the supplied MIME like native uploads,
  preserving original bytes and filename.
- Missing picker size uses native File/web File size; unreadable, empty, and
  oversized files get visible errors. Exact 100 MiB is allowed. Backend empty
  input returns 422 before usage reservation; unsupported/oversized errors list
  useful formats or the correct inclusive binary size limit.
- Shared `getAudioDuration` still waits for loaded metadata, handles the listener
  registration race, never starts playback, and always releases its player.
  Nonfinite/nonpositive duration throws; capture can retain its existing fallback.
- **Importer-only metadata tolerance:** at most one extra second may reach
  backend validation because Apple includes MP3 encoder padding in duration.
  The advertised and server/provider limit remains 1400 seconds. No audio is
  trimmed or modified by the importer. A recognized WebM whose native duration
  cannot be read uses the existing zero sentinel for unknown duration and shows
  “Duration checked during analysis.” Other unreadable metadata retains a local
  error. Actual corrupt/overlong data is rejected by the backend, with usage
  refunded and local audio retained for review/discard.

## Local verification

At import commit `4264627` with queue dependencies `bd90ab9` and `6acbcb9`:

- `cd app && node --test tests/*.test.mjs`: **41 passed**, including retained
  terminal files, explicit discard, unknown-duration omission, refreshed token,
  account-switch cancellation, and busy/lost-acknowledgement recovery. These are
  controlled native/network checks, not device or production acceptance.
- `cd app && npm run typecheck`: **passed**.
- `cd backend && NUMBA_CACHE_DIR=/private/tmp/mirra-imports-8b65/numba NUMBA_CPU_NAME=generic /Users/jonathanj/Projects/mirra/backend/.venv/bin/python -m pytest -q tests/test_import_limits.py tests/test_pipeline.py tests/test_diarization.py`:
  **92 passed**. Three dependency deprecation warnings. New cases verify actual
  decoder rejection/refund independently of absent, zero, or false short client
  duration. Existing decoder tests retain the configured 1400-second boundary.
- `git diff --check`: passed before commit.
- Dependencies were reused read-only; no install changed the main checkout.
  Initial backend testing hit a read-only Numba cache error; rerunning with the
  task-specific writable cache above passed. Node reports an existing module-type
  warning from `talkListen.ts`.

Actual local fixtures generated by FFmpeg from a 1400-second sine, with no AI:

| Format | Bytes | Apple AVPlayer duration when item is ready | Candidate decoded duration |
| --- | ---: | --- | ---: |
| AAC M4A, 44.1 kHz stereo, target 128 kbps | 22,641,428 | 1399.975328798186 s | 1400.0 s |
| MP3, 16 kHz mono, 48 kbps | 8,400,716 | 1400.076 s | 1400.0 s |
| PCM WAV, 16 kHz mono | 44,800,078 | 1400.0 s | 1400.0 s |
| Opus WebM, mono, 48 kbps target | 11,464,169 | item failed; unavailable duration | 1400.0 s |

Apple checks used macOS AVPlayer/currentItem, matching the installed Expo SDK's
native readiness and duration properties, without playback. This is **not an
iPhone, Expo hook, or picker acceptance pass**. The MP3 result justifies the
small client metadata tolerance; WebM confirms why server validation is needed.
All original hashes were unchanged after backend decoding. The local mpg123
decoder emitted bit-reservoir diagnostics on the MP3 fixture; this is duration
and file-integrity evidence, not a model/audio-quality claim.

An additional actual PCM WAV containing 1400 seconds plus one 16 kHz sample
(1400.0000625 s) raised `RecordingTooLong`. Actual sparse input sizes of 0,
104,857,600, and 104,857,601 bytes exercised the incoming read: empty 422,
exact-limit acceptance, and oversized 413, respectively. That check stopped at
a mocked usage reservation and made no model/database request.

Temporary reproducible fixtures, Swift/Python probes, and logs are in
`/private/tmp/mirra-imports-8b65/`. They contain synthetic audio only, may expire,
and are not committed. No private recordings, credentials, or environment files
are part of this branch.

## Remaining release evidence

- On the release iPhone build: pick actual at-limit M4A/MP3/WAV/WebM files,
  confirm readable metadata or truthful WebM fallback, intact originals, picker
  cancellation, cloud Files download, and storage-full errors/recovery.
- Verify offline import survives force-quit/relaunch and uploads once after
  reconnect. Check account switch/token expiry and consent withdrawal while
  picker, save, or upload is active. Exercise terminal corrupt/overlong failures
  and explicit discard on the device.
- On the candidate deployment: exact-limit import through transcription,
  debrief/history/Reflect, actual overlong rejection without net quota usage,
  competing uploads/retry, compression quality, memory, and latency. Live Render
  does not yet run this candidate and still has the known 512 MB capacity gap.
- Real provider boundary/timeout evidence belongs to transcription; production
  memory and physical capture belong to their respective workstreams. Local
  tests and synthetic codec checks do not close those gates.
