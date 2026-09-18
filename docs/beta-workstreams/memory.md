# Server memory — 23m20s beta limit

Investigation date: 2026-09-17. Worktree `/Users/jonathanj/.codex/worktrees/c3a6/mirra`,
branch `codex/beta-memory`, starting commit
`773d35f3e554f8c8353f17c81b7bd847cc9078a1`.

This is local Linux/emulation evidence. Production remains the Free 512 MB Render
service running `f8cf5d7196654aff3ff578bb5503668aa3ff15cd`; no deployment, provider
migration, billing change, purchase, push, or shared-branch merge was performed.
TF-1 through TF-7 remain open.

## Findings and changes

Three exact-limit sequential requests on the baseline reached **948.0 MiB process
peak RSS**. Removing two temporary allocations reduced the same check to
**798.1 MiB**, a **149.9 MiB / 15.8% reduction**. This does not establish production
capacity or justify reducing the existing metrics to fit 512 MB.

- `speaker.audio_segments` accumulates the sum of squares in float64 using NumPy
  `einsum`, avoiding a full float64 copy/square of each merged turn. At 1400s,
  that temporary alone is about 170.9 MiB. Tests compare against the previous
  float64 result to relative tolerance `1e-12`.
- `prosody._pitch_for_segments` pads only each batch. It retains every original
  centered 2048-sample YIN frame, 512-sample hop, and median calculation, while
  avoiding a padded copy of the whole 85.4 MiB mono recording. Tests compare every
  frame at short and batch-boundary lengths; existing actual YIN median tests pass.
- No decoder, VAD, transcription, admission, dependency, model, or interface changes.
  No metric was removed or approximated. There is no new queue or process topology.

## Measurement method

`backend/scripts/benchmark_memory.py` runs actual mono decoding/resampling, Silero
ONNX speech detection, whole-timeline MP3 encoding, OpenAI SDK multipart request
construction, speaker selection and acoustic/text metrics. It imports `app.main`
so the service's import footprint is included. An HTTPX mock transport returns
synthetic diarization, and coaching is mocked. Docker networking is disabled and
dummy credentials override any environment settings. The transport buffers the
outgoing multipart body; this is conservative relative to a streaming upload.
No audio or transcript is written to its JSON-lines log.

These checks exclude incoming HTTP multipart parsing/spooling, real AI latency
and response sizes, database/auth traffic, Reflect, other API requests, native
capture, and simultaneous uploads. A synthetic full-length speaker turn stresses
the largest merged interval even though the fixture contains conversational pauses.
`--turn-seconds 20` supplies a separate alternating-speaker scenario.

Environment: Docker Desktop on macOS, **Linux amd64 under emulation**, Python
**3.14.3**, Linux `6.12.76-linuxkit`, one CPU quota, hard memory limit with swap
disabled. Reused image `mirra-memory-hour:latest` (`479e827253d3`) and its warmed
generic-CPU Librosa/Numba cache; candidate source mounted read-only. Baseline code
was exported from the starting commit, with only the benchmark script added.
Image and candidate `pyproject.toml` and `uv.lock` SHA-256 hashes match; lock hash
is `13aa7779dd4fe8ada70f4e1073b12b03410dc4a150199dafbae8172af3df773a`.
The first request still loads the acoustic libraries into the fresh process.
Do not compare these elapsed times with a real Render CPU or infer throughput.

Process peak RSS is `getrusage(RUSAGE_SELF).ru_maxrss`; current RSS is `/proc/self/status`.
Cgroup current/peak include charged child-process memory and page cache.
Shared mapped/cache pages can be charged to another cgroup, so cgroup and summed
RSS are different accounting views; neither should be presented as exact Render
usage. Each row uses a new container; request rows share one process without
forced garbage collection or allocator trimming.

## Results

| Candidate / fixture | Hard cap | Sequential requests | Process peak RSS | Cgroup peak | Per-request elapsed seconds | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline / boundary M4A | 2 GiB | 3 | 948.0 MiB | 854.0 MiB | 42.171, 19.563, 16.447 | Pass offline |
| Reduced / boundary M4A | 2 GiB | 3 | 798.1 MiB | 725.5 MiB | 43.184, 16.106, 18.112 | Pass offline |
| Reduced / boundary M4A | 512 MiB | 0 completed | Not captured at kill | Hard limit hit | Killed during first acoustic calculation | **Fail: exit 137, OOMKilled=true** |
| Reduced / dense stereo M4A | 1 GiB | 5 | 832.1 MiB | 797.3 MiB | 57.494, 34.809, 39.516, 37.139, 32.359 | Pass offline |
| Reduced / near-cap stereo WAV | 2 GiB | 3 | 855.9 MiB | 872.9 MiB | 38.154, 8.752, 12.837 | Pass offline |

Baseline current RSS after requests: 648.0, 687.5, 700.3 MiB. Reduced current RSS:
647.7, 673.6, 694.7 MiB. The changes remove peak temporaries; they do not eliminate
the retained library/allocator footprint. Three requests are not a long-running
leak or production soak test.

The dense M4A run completed five requests at 1 GiB; current RSS after requests
was 648.8, 685.0, 713.3, 738.7, 747.4 MiB. **1 GiB is the smallest passing cap
tested for that workload, not a production minimum or demonstrated steady state.**
No forced collection occurred between these requests. Remaining process growth
and larger uploads warrant a production soak and additional headroom.

The near-cap import's current RSS after requests was 649.7, 659.7, 667.8 MiB.
A **diagnostic-only full garbage collection after all measured requests** collected
46,133 objects but did not lower RSS (667.9 MiB afterward). This does not identify
the source of every retained allocation or prove a leak; it does rule out claiming
that adding request-end `gc.collect()` fixes the observed footprint. No allocator
trimming or forced-collection code was added to production.

The near-cap run also verifies the checked-in Docker recipe: image
`mirra-memory-1400:latest`, image config `b1454bb40572`, build-time speech/pitch/MP3
warm-up passed in 28.3s. Its source/dependencies match this candidate. Other rows
used the cached image described above. Host activity, emulation and warm-cache
differences affect timings; no latency improvement is claimed from this change.

Successful containers exited 0 with `OOMKilled=false`; the 512 MiB container
exited 137 with `OOMKilled=true`. Temporary JSON-lines logs:
`baseline-exact-2g.jsonl`, `reduced-2g.jsonl`, `reduced-512m.jsonl`,
`reduced-dense-1g.jsonl`, and `near-cap-2g-probe.jsonl` in the directory below.
The first near-cap probe invocation failed before imports because its external
wrapper lacked `PYTHONPATH=/work`; the corrected invocation supplies that path.

An initial exploratory loop of AAC input decoded to **1399.8149375s**, despite a
1400s container duration; the script correctly failed its exact-duration assertion.
Its 828.3 MiB RSS / 1080.5 MiB cgroup peak is not counted as an exact-limit pass.
The corrected dense fixture loops the PCM WAV source before AAC encoding.

## Fixtures and reproduction

Temporary directory: `/private/tmp/mirra-memory-1400`. Audio is synthetic and kept
outside Git. All successful fixtures decode to exactly 1400 seconds.

| Fixture | Bytes | Description | SHA-256 |
| --- | --- | --- | --- |
| `boundary.m4a` | 10,344,364 | Transcription task's 44.1 kHz stereo AAC, target 128 kbps; 70 alternating synthetic Samantha/Daniel turns, 603.249s speech and pauses, six beginning/middle/end markers | `043d40f2642066e575b92a4f6f5f73f993f451b65851efeb6c8aec89baaacb6c` |
| `dense-stereo-1400.m4a` | 22,521,009 | Repeated synthetic speech WAV encoded to 44.1 kHz stereo AAC at target 128 kbps | `f842c9eee3aeace3340164b61a71e18aaf37ed935baa80149416887197b85bb0` |
| `near-cap-1400.wav` | 104,854,478 | Boundary fixture resampled to stereo 18,724 Hz PCM16; 3,122 bytes below the 100 MiB input limit, to stress input retention independently of AAC compression | `4aeb1dcf0628e41e5708c55790005aa4f6d4bbe88bf349861a59625c30bc07dc` |

The boundary generator and placements are in the transcription task's temporary
`/private/tmp/mirra-transcription-b07f/make_fixture.py` and `fixture.json`; no private
recording is needed. Other speech-bearing M4A inputs of the same length work with
the benchmark. These temporary fixtures/logs can expire; measurements above are
retained here.

Build the checked-in image recipe from `backend/` (no secrets or fixtures copied):

```sh
docker build --platform linux/amd64 -f scripts/Dockerfile.memory -t mirra-memory .
docker run --name mirra-memory-check --platform linux/amd64 \
  --memory 2g --memory-swap 2g --cpus 1 --network none \
  --mount type=bind,src=/private/tmp/mirra-memory-1400,dst=/audio,readonly \
  mirra-memory /audio/boundary.m4a --runs 3
docker inspect --format '{{.State.ExitCode}} {{.State.OOMKilled}}' mirra-memory-check
```

Use a unique container name for each run. Use `--memory 1g --memory-swap 1g` or
`512m` for the other caps. Supply `--content-type audio/wav` for WAV. For a local
native comparison: `NUMBA_CPU_NAME=generic python -m scripts.benchmark_memory
/path/to/input.m4a`; its results must remain separate from Linux and production.

The added fixtures can be regenerated with an FFmpeg binary supporting AAC:

```sh
ffmpeg -nostdin -v error -stream_loop -1 -i /private/tmp/mirra-beta-five-minutes.wav \
  -t 1400 -ar 44100 -ac 2 -c:a aac -b:a 128k /private/tmp/mirra-memory-1400/dense-stereo-1400.m4a
ffmpeg -nostdin -v error -i /private/tmp/mirra-memory-1400/boundary.m4a \
  -t 1400 -ar 18724 -ac 2 -c:a pcm_s16le /private/tmp/mirra-memory-1400/near-cap-1400.wav
```

## Capacity and integration limits

Use **2 GB / one server worker** as the minimum next **production-test candidate**,
with one admitted audio job at a time. This is a headroom recommendation, not a
production pass or evidence for concurrent audio processing. Additional Uvicorn
workers each load their own library/model footprint and each have their own
process-local guard. Existing app retry/admission behavior is owned by reliability.
Incoming uploads may consume memory before reaching that guard; they require a
separate concurrent-upload check on the integrated endpoint.

Current primary-source Render comparison, checked 2026-09-17:

| Web-service plan | RAM / CPU | Compute price | Relevance |
| --- | --- | --- | --- |
| Free | 512 MB / 0.1 CPU | $0 | Existing confirmed production OOM; unsuitable for this candidate |
| `0.5c-512mb` (legacy Starter) | 512 MB / 0.5 CPU | $7/month | More CPU but no memory increase |
| `1c-2g` (legacy Standard) | 2 GB / 1 CPU | $25/month | Smallest Render memory upgrade; next test candidate |

Sources: [Render pricing](https://render.com/pricing),
[web-service compute plans](https://render.com/docs/compute-plans),
[plan-name update with unchanged prices](https://render.com/docs/compute-plans-update).
These are compute prices, excluding any separately billed services/usage. No plan
was selected or purchased, and no alternative provider was migrated to.

Before closing the memory blocker: integrate transcription/reliability changes,
independently review the final outgoing commit range, obtain any required hosting
authorization, and measure the deployed process/cgroup through repeated real
1400s recording/import → transcription → coaching → DB/history → Reflect flows.
Include near-cap input and competing uploads, cold/warm requests, sustained
sequential use, health responsiveness and retry/usage recovery. Physical iPhone
recording and auto-stop/save remain separate open gates.

## Validation and merge boundaries

- Full existing backend suite plus memory regressions: **160 passed**, one existing
  Starlette/httpx deprecation warning. No dependency or test-framework addition.
- Mac tests used the existing backend Python 3.13.5 environment read-only, with
  `NUMBA_CACHE_DIR=/private/tmp/mirra-memory-1400/numba-cache` to avoid writing the
  shared environment. The first attempt without that writable cache failed at
  Numba import; it was an environment-permission failure and passed after isolation.
- Production changes are limited to `prosody.py` and the RMS expression in
  `speaker.py` (ownership granted by integration). Tooling/tests/docs are additive.
  No merge dependency on the transcription or reliability branch; rerun benchmarks
  after integrating their changes. No pre-push review has been claimed.
