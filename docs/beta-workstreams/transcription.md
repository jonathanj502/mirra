# Full-length transcription workstream

Candidate worktree: `/Users/jonathanj/.codex/worktrees/b07f/mirra`.
Branch: `codex/beta-transcription-1400`.
Starting commit: `773d35f3e554f8c8353f17c81b7bd847cc9078a1`.
Evidence date: 2026-09-18 UTC (2026-09-17 America/New_York).
Production is unchanged; no push, deployment, configuration, billing, or quota-limit change.

## Scope and fixture

Validate one complete transcription request at the agreed 1400-second maximum.
Longer conversations and speaker reconciliation across requests remain deferred.

The synthetic fixture uses macOS Samantha and Daniel voices, 70 alternating turns
placed every 20 seconds, with 603.249 seconds of synthesized speech across the
1400-second timeline. It is stereo 44.1 kHz AAC/M4A at target 128 kbps, matching
the app's codec settings. Encoded input: 10,344,364 bytes. This is synthetic
backend evidence, not a physical recording or a natural-conversation accuracy study.

Distinctive markers (synthetic, no personal content):

| Position | Source interval | Phrase |
| --- | --- | --- |
| Beginning | 0.500–8.529 s | copper lantern |
| Beginning | 20.500–29.060 s | silver compass |
| Middle | 680.500–689.181 s | velvet bicycle |
| Middle | 700.500–710.372 s | golden teapot |
| End | 1360.500–1369.237 s | purple lighthouse |
| End | 1380.500–1390.406 s | orange telescope |

Temporary artifacts are isolated under `/private/tmp/mirra-transcription-b07f/`:
`make_fixture.py`, `fixture.json`, `boundary.m4a`, `conversation.mp3`,
`server.py`, `server.log`, `smoke.log`, and the synthetic provider response.
These files may expire. No audio, transcript, credentials, or environment files
are committed. The candidate server binds only `127.0.0.1:8784` and loads the
existing main checkout's ignored configuration without printing it.

## Verification

The live smoke uses a new disposable account and retains the existing
Supabase-admin check that its UUID and freshly generated test email match before
cleanup. New smoke options verify saved duration, expected transcript markers,
minimum speakers, the transcription model label, and optional overlong input
rejection without a saved debrief or quota charge.

The baseline decoder produces exactly 1400 seconds. The real transcription
upload is one 8,400,716-byte gapless MP3, locally decoded as exactly 1400 seconds.
No mocked transcription or coaching response is used in the live run.

### Real API run 1 — baseline timeout

On 2026-09-18 UTC, the real SDK exhausted its 180-second attempt plus one retry
and raised `APITimeoutError` after **362.16 seconds**. The session returned 500.
The disposable account was verified and deleted. No provider duration rejection
was received; this result establishes a timeout failure, not successful provider
acceptance or transcription quality. Logs: `server-baseline-180.log` and
`smoke-baseline-180.log` in the temporary directory.

Minimal candidate fix: transcription read timeout increased to **600 seconds per
attempt**, preserving one retry. The smoke client now waits up to 2100 seconds
(35 minutes), matching the
provisional mobile queue deadline owned by the reliability workstream. Run 2
started with the earlier 1800-second smoke timeout; any observed completion time
below that deadline also fits 2100 seconds.
This changes how long the caller waits; it does not make inference faster.

Two transcription attempts (1200 s), encoding (120 s), and all possible coaching
attempts (540 s) sum to 1860 s before decoding, metrics, network transfer, DB work,
and retry backoff. The 2100-second caller deadline is provisional headroom, not a
guarantee or a hard overall backend deadline. A timed-out queued recording must
remain saved and replay the same recording ID; the reliability workstream owns
that recovery check and the queue timer edit.

### Real API run 2 — longer timeout

The live authenticated rejection check passed: 1400.1-second M4A returns HTTP 413,
no history row, and unchanged real Supabase usage. The subsequent valid 1400-second
request **passed** with real OpenAI and Supabase:

- Transcription: HTTP 200 after **336.94 s**, one successful attempt, provider
  duration **1400.0 s**, **179 segments**, exactly two labels (`A`, `B`).
- All 70 expected 20-second source slots contain returned speech. Every returned
  segment's label matches the synthetic voice assigned to its source slot.
  This fixture result does not establish accuracy for natural speech or overlap.
- All six distinctive markers survive compression and transcription. Their
  returned segment times/labels are below. Speech reaches 1390.076 s; the fixture's
  final approximately ten seconds are silence, preserved in the 1400-second file.
- Full `POST /sessions` including decode, speech detection, actual transcription,
  metrics, coaching and Supabase persistence: **351.5 s** (about 5m52s).
- Saved model label: `gpt-4o-transcribe-diarize`. Saved duration: 23.333 minutes
  (1399.98 s when converted back, from rounding minutes to three decimal places).
  The provider received and returned exactly 1400.0 s; this is not audio loss.
- Nonempty saved coaching (`gpt-4.1`), history list/detail, idempotent replay of the
  same recording ID with exactly one quota charge: **PASS**.
- Real Reflect reply (`gpt-4.1-mini`, `used_model=true`): **PASS**.
- Conversation deletion, empty history, preserved usage, verified disposable
  account deletion: **PASS**. Successful live run exited 0. Both runs' disposable
  accounts were deleted; the temporary localhost backend was stopped afterward.

| Marker | Returned interval | Label |
| --- | --- | --- |
| copper lantern | 0.412–3.362 s | A |
| silver compass | 21.476–24.776 s | B |
| velvet bicycle | 681.240–689.040 s | A |
| golden teapot | 701.276–705.776 s | B |
| purple lighthouse | 1361.376–1363.726 s | A |
| orange telescope | 1381.476–1385.626 s | B |

The successful run proves the exact 1400-second single-request provider boundary
for this fixture. It does not justify lowering the agreed product limit.
The measured almost-six-minute local completion time remains a beta latency
concern. Render resource limits, upload bandwidth, device background behavior,
and natural speech can change latency or outcomes.

Reproduction against a separately started candidate backend with the authorized
configuration loaded (run from `backend/`):

```sh
python -m scripts.smoke_beta --url http://127.0.0.1:8784 \
  --audio /private/tmp/mirra-transcription-b07f/boundary.m4a \
  --reject-audio /private/tmp/mirra-transcription-b07f/overlong.m4a \
  --expect-seconds 1400 --min-speakers 2 \
  --expect-text 'copper lantern' --expect-text 'silver compass' \
  --expect-text 'velvet bicycle' --expect-text 'golden teapot' \
  --expect-text 'purple lighthouse' --expect-text 'orange telescope'
```

Full backend suite: 161 passed, with one existing Starlette/httpx deprecation warning.
A real local decoder check rejects the 1400.1-second stereo AAC/M4A fixture.

Fixture SHA-256: `043d40f2642066e575b92a4f6f5f73f993f451b65851efeb6c8aec89baaacb6c`.
Outgoing MP3 SHA-256: `c90db36c269131b3d0bdd996dcc987aa37b5ec3272763936b72d67d934936c04`.

The simulated SDK timeout test verifies the real SDK's configured 600-second
read timeout and one retry, both recovery and exhausted-retry paths. This uses
`httpx.MockTransport`; it does not simulate 600 seconds of wall-clock waiting
or establish provider latency.

## Integration dependencies

The provider timeout change must be paired with reliability's queue deadline and
recovery changes: `cbeb38242a52f75b263f52879ec21932df40b043` (depends on
`ea2c446`). That task verifies an aborted upload retains the original recording ID
and recovers an acknowledged result without deleting audio early. This workstream
does not modify the queue, `main.py`, decoder, shared acceptance ledger, or
production configuration.

## References and boundaries

The [official file-transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text#speaker-diarization)
confirms a 25 MB file limit, `diarized_json` speaker segments, and automatic
chunking for audio over 30 seconds. The 1400-second ceiling comes from the
previous real provider rejection, not an explicit guarantee on that page.

Physical iPhone capture/auto-stop, real-device imports, production capacity and
latency, and production deployment remain separate open checks. TF-1 through
TF-7 are not closed by this local workstream.
