# Beta investigation checkpoint — 2026-09-17

## State at the pause

The user requested a reset and planning discussion before further implementation.
The goal remains paused. This is an **experimental checkpoint, not a release**.

- Local checkpoint branch: `codex/beta-pause-2026-09-17`.
- Based on `5131485d2a1024fc0712f63c219d4142a54b3610` on `codex/testflight-beta`.
- Production is unchanged: Render deploy `dep-dakpvn61egvs73aqdb8g`, commit
  `f8cf5d7196654aff3ff578bb5503668aa3ff15cd`, free 512 MB service.
- No hosting purchase, merge, push, or deployment was made during this investigation.
- Render auto-deploy remains off after the earlier specific-commit deploy.
- The temporary localhost backend and memory-test containers are stopped.
  Docker test images may remain cached for reproducibility.
- Temporary test accounts from the live smoke runs were verified and deleted.
- The checkpoint has not received the independent pre-push code review required
  by `AGENTS.md`. Review the exact outgoing commits before any future push.

## Agreed product scope

The original TestFlight criteria remain open in [the acceptance ledger](testflight-acceptance.md).
The latest agreed MVP maximum is **one hour for both native recordings and imports**.
The candidate also sets a 100 MiB import limit, enough for an hour at Mirra's
current 128 kbps recording setting. No shorter-duration scope was approved.
The user reopened the hosting budget discussion but has not authorized a paid plan.

## Issues to resolve together

| Issue | What is confirmed | Next decision or validation |
| --- | --- | --- |
| Long-conversation transcription | `gpt-4o-transcribe-diarize` rejected a 3599.568-second recording because its maximum is 1400 seconds per request. Compression alone cannot enable one hour. | Choose an approach for the agreed one-hour scope: sections with validated speaker continuity, or evaluate a provider that supports the complete conversation. A 20-minute beta is an optional scope reduction, not the current agreement. |
| Server memory | Current Render 512 MB has crashed. The optimized five-minute Linux test also exceeded 512 MiB. One-hour decode/compression/acoustic analysis passed a 2 GiB Linux cap at 1151.0 MiB RSS, with AI mocked. | Treat 2 GB as a single-worker production test candidate. Validate the selected transcription approach and actual production memory before purchasing or promising capacity. |
| File size | An hour at the current recording setting produced a 58.13 MB M4A. The live backend's 25 MiB cap rejects it. | Candidate 100 MiB input cap and 48 kbps MP3 conversion produced a 21.60 MB transcription file. Reassess compression once the transcription strategy is chosen. |
| Concurrent users | Candidate limits processing to one request per process and returns retryable 503 to competitors before reserving usage. Saved native recordings already retry from the device queue. | Validate competing uploads, waiting time, failures, and recovery. Imports currently use a direct request and require manual retry on failure; there is no server job queue. |
| iPhone behavior | Unit tests and an EAS Simulator build passed. Physical recording/permissions/offline recovery/locked-screen behavior are unverified. | Set up a device build and perform the existing checklist, including one-hour native auto-stop/save. Xcode downloaded, but setup/signing/device installation remain open. |
| TestFlight distribution | No signed store build or active paid Apple membership has been verified. | Defer payment while validating on the user's own iPhone with free Xcode signing, or enroll when the user is ready. Free signing does not satisfy the TestFlight installation gate. |

## What the checkpoint contains

- Streaming decode directly to mono 16 kHz; bounded pitch-analysis batches.
- Same Silero speech model via ONNX Runtime, without importing PyTorch at runtime;
  CPU-only Linux Torch dependency wheels.
- One-at-a-time processing guard with retryable 503 and no extra quota reservation.
- Candidate one-hour native auto-stop/save and import checks, 100 MiB input cap,
  server-side decoded-duration enforcement and a one-second padding allowance.
- Candidate whole-conversation MP3 compression for the provider's 25 MB file cap.
- Updated tests, deployment warm-up, and acceptance evidence.

**Known limitation:** the single-request transcription implementation in this
checkpoint still fails above the model's 1400-second limit. Do not deploy this
as working one-hour support. The UI's one-hour capability is a candidate only.

## Verification at this exact code state

- Backend: **152 tests passed**; one existing Starlette/httpx deprecation warning.
- App: **25 tests passed**; TypeScript check passed.
- Deployment warm-up: passed speech/pitch checks and FFmpeg MP3 encoder probe.
- `git diff --check`: passed before checkpointing.
- One-hour synthetic codec/acoustic test: passed on macOS and in a 2 GiB Linux
  container, with transcription and coaching mocked.
- One-hour real API smoke: **failed at the provider's 1400-second duration limit**.
  Authentication/read checks and temporary-account cleanup passed.
- Speaker-reference feasibility probe: **inconclusive**. First request returned
  two speakers, but the prototype required a clean reference of at least three
  seconds and found none for one speaker. It stopped before the second request;
  it did not test cross-section voice matching. The official API permits 2–10
  second references for up to four voices.

## Resume order

1. Agree on the one-hour transcription/speaker-continuity approach and beta limits.
2. Validate that approach on a two-speaker conversation, including section
   boundaries and the beginning, middle, and end of the recording.
3. Measure complete-job memory and latency, then select hosting and concurrency.
4. Review the exact candidate, deploy, and run production/device acceptance.
5. Complete Apple signing and TestFlight delivery when the user is ready.

Do not treat passing unit tests, a larger server, or mocked one-hour results as
proof that the complete recording-to-debrief flow works.

## Evidence and temporary artifacts

Detailed measured evidence and all open gates are in
[testflight-acceptance.md](testflight-acceptance.md). Temporary raw logs and synthetic
fixtures are under `/private/tmp/mirra-*`; they may expire. No audio, account
credentials, private tokens, or environment files belong in the checkpoint.
The generated `backend/:memory:.ses` runtime artifact was moved out of the
working tree to `/private/tmp/mirra-pause-runtime/:memory:.ses`.

Useful existing checks when implementation resumes:

```sh
cd backend
.venv/bin/pytest -q
NUMBA_CPU_NAME=generic .venv/bin/python -m scripts.warm_audio
```

The warm-up now requires `ffmpeg` with `libmp3lame` on PATH. Linux test images
install it through the package manager. The current Mac test binary is available
through `/private/tmp/mirra-test-bin/ffmpeg`; it is not a project dependency.

```sh
cd app
npm run typecheck
node --test tests/*.test.mjs
```
