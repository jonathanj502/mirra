# Deployment readiness for the upstream recording queue

Evidence date: 2026-09-18. No production writes, deployment, purchase, migration,
live AI call, real-audio upload, GitHub push, or device-file changes were performed.

## Scope and source identity

The user selected newer main, including 24-hour/2-GiB recordings and resumable
background jobs. Canonical source assessed here is
`64db03b524722e853a53810fcceef75347c268c4`. Reconciliation owns production changes,
including the installed phone's queue compatibility and a common atomic completion
path for jobs and legacy `/sessions`. Final integrated checks are still required.

This private worktree arrived clean at detached `64db03b`. Branch
`codex/beta-deployment-readiness` was created at common ancestor `f628b73` and
fast-forwarded to exact old beta candidate
`002e2eac55bf236495c2fc7d0ae68b0fff087a7d`, as requested. Upstream was inspected by
`git show`/`git diff` and exported to a unique temporary directory for testing.
This workstream's commit contains only this document and the offline probe script;
integrate that commit after reconciliation, not the superseded candidate history.

| Earlier work | Disposition for selected main |
| --- | --- |
| 1400-second capture/import limits, whole-request MP3 fallback and 2100-second request timeout | Superseded by 24-hour jobs and bounded upload/transcription chunks |
| `debrief_receipts`, reservation/refund/complete RPCs | Superseded local experiment, never deployed by beta work; do not apply its migration or invent a transition |
| ONNX presence-only VAD and whole-recording pitch/RMS optimizations | Superseded implementations; main needs VAD timestamps for pause boundaries and already bounds RMS/pitch work |
| Old 512-MiB failure and 2-GB recommendation | Historical evidence for different code; fresh measurements below apply only to their stated workload |
| Stable recording IDs, preserve unacknowledged audio, owner isolation, consent checks, replay/usage expectations | Still useful acceptance requirements; reconciliation reuses or repairs current implementations |
| Signed Personal Team build, old phone recording checks, real 1400-second AI smoke | Historical only; renewed acceptance required for final app/backend |

## Live infrastructure observations

[Render service](https://dashboard.render.com/web/srv-d9vp6orm8hqs73dvhd5g), read-only
dashboard check at approximately 04:40-04:50 UTC:

| Setting | Observed value |
| --- | --- |
| Successful deployed source | `f8cf5d7196654aff3ff578bb5503668aa3ff15cd` |
| Runtime / region / source | Python 3, Virginia, `jonathanj502/mirra`, branch `main`, root `backend` |
| Compute | Free, 0.1 CPU, 512 MB; no persistent disk supported |
| Auto-deploy | Disabled after specific-commit deployment |
| Build | `pip install uv && uv sync && NUMBA_CPU_NAME=generic uv run python -m scripts.warm_audio` |
| Start | `NUMBA_CPU_NAME=generic uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health-check path | Blank in service settings |
| Public checks | `GET /health` 200 `{"status":"ok"}`; `GET /ready` 404 |

**Confirmed build blocker:** upstream has no `scripts/warm_audio.py`, so the
current native build command cannot deploy it. Its CPU-wheel configuration also
differs from the old candidate. Do not merely deploy latest main with old settings.

Supabase project `qugmkzpfonhhrsyjghrx` was queried only for schema metadata and
zero-row selects, using the existing backend credential without printing it:

| Read-only check | Result |
| --- | --- |
| Service-role OpenAPI | HTTP 200; `debriefs` and `user_settings` visible |
| `debrief_receipts` and `debrief_deletions`, `select=debrief_id&limit=0` | HTTP 404, `PGRST205` |
| `user_settings`, `select=coaching_goal&limit=0` | HTTP 400, `42703` |
| `reserve_debrief`, `release_debrief`, `complete_debrief`, `complete_recording`, `recording_uploads_ready`, `delete_debrief_permanently` | Absent from service-role OpenAPI |

These prove the required API schema is unavailable. They are **not** direct
inspection of `supabase_migrations.schema_migrations` or proof against every
possible stale-cache/privilege condition. Integration reports the receipts
migration was never applied remotely, consistent with these observations.
No administrative SQL credential, Supabase MCP, CLI login or authenticated
Supabase dashboard session was available. The dashboard redirected to sign-in.

## Storage and hosting decision

Main stores received audio and `analysis-*` PCM beside durable job metadata under
`RECORDING_STORAGE_DIR`. The queue permits 16 GiB of received audio globally;
one day of mono float32 PCM adds 5,529,600,000 bytes, about 5.15 GiB. A 32-GB
private volume provides room for these together, filesystem overhead and cleanup.
Keep one process, one Uvicorn worker and one instance. A disk-backed worker is
part of this API process; do not add a second worker pointing at the same directory.

Current [Render prices](https://render.com/pricing) and
[compute specifications](https://render.com/docs/compute-plans), checked 2026-09-18:

| Compute option | Compute/month | 32-GB disk/month | Combined/month |
| --- | ---: | ---: | ---: |
| 0.5 CPU / 512 MB | $7 | $8 | $15, capacity not established |
| 1 CPU / 2 GB | $25 | $8 | $33, next bounded test candidate |
| 2 CPU / 4 GB | $85 | $8 | $93, upstream recommendation, not measured minimum |

These exclude AI, Supabase, taxes and excess usage. Disk price is $0.25/GB/month.
No option was selected. The old 512-MiB failure cannot establish this branch's
minimum; the new evidence below does not establish that 4 GB is necessary.

[Render disks](https://render.com/docs/disks) survive deploys/restarts, attach to
one service instance, and introduce deploy downtime. Adding a disk triggers a
deploy. Snapshots run every 24 hours and remain available for at least seven days.
The documented disk update API exposes no backup opt-out. Provider support must
confirm any exception; absence from documentation is not proof none exists.

That behavior conflicts with the explicit upstream operational requirement in
`docs/RELEASE.md:77` to exclude temporary audio from backups. The generated policy
in `website/build.mjs:69` describes removal after processing/cancellation and
24-hour expiry of inactive incomplete/failed uploads. Line 73 separately discloses
that backups/provider records can outlive live deletion and that the production
retention schedule is not yet documented. Snapshot retention must be resolved,
not silently treated as excluded. No policy wording was changed here.

Minimal choices: obtain confirmed Render backup exclusion; have the operator
explicitly settle/document the actual retention policy before release; or use a
managed volume with no configured backups. Ephemeral storage does not meet durable
job requirements. No custom encryption, object store or queue redesign is proposed.

### Bounded managed alternative: Railway

[Railway pricing](https://docs.railway.com/pricing/plans) bills actual container
usage: RAM $10/GB-month, CPU $20/vCPU-month, used volume $0.15/GB-month and egress
$0.05/GB. Pro has a $20 monthly minimum including $20 of usage. At sustained
2 GB, one fully used vCPU and 32 GB used storage, the estimate is **$44.80/month**
before egress; lower duty cycle can approach the $20 minimum. This is a scenario,
not a quote or measured monthly bill. Set resource limits and an approved spend
limit; [billing hard limits stop workloads](https://docs.railway.com/pricing/cost-control).

[Volume documentation](https://docs.railway.com/volumes/reference) gives Pro a
50-GB default volume. Hobby defaults to 5 GB; although paid resizing is mentioned,
32-GB Hobby availability was not verified, so do not promise a $5 plan for this
workload. Storage is billed on used bytes, including filesystem metadata. One
volume per service, no replicas, and brief deployment downtime fit the current
single-process model. Non-root images need mount-permission validation; the
canonical Docker image uses UID 10001. Do not default to root to hide that issue.

[Backups](https://docs.railway.com/volumes/backups) are manually triggered or
scheduled by the operator. Leaving every schedule off is the minimal candidate;
verify the actual new volume's settings and provider retention before real audio.
The docs describe no mandatory daily snapshot. If enabled, daily/weekly/monthly
backups retain data for 6/27/89 days. This does not establish zero provider retention.

Moving providers would require a new HTTPS backend URL in the final app build,
the same Supabase schema, a persistent mount, one worker, writable UID, `/ready`,
and fresh restart/reconnect checks. Keep the worker awake while queued jobs exist.
No Railway account or service was created.

## Fresh local validation

Exact unmodified source: `64db03b`. Tests used an exported copy, no production
credentials and no live provider calls. Evidence directory:
`/private/tmp/mirra-rollout-20260918` (temporary, not release storage).

- **157 backend tests passed** on macOS/Python 3.13.5 using the existing backend
  environment read-only, FFmpeg 7.1 from the existing `imageio_ffmpeg` bundle,
  and a private `NUMBA_CACHE_DIR`. Initial five failures were missing FFmpeg in
  PATH; the corrected run passed with one existing Starlette/httpx warning.
- **All nine upstream migrations applied** to a new local PostgreSQL 14.23
  database. Existing `supabase/tests/privacy.sql` and `long_recordings.sql` passed
  executable assertions as authenticated and service roles; their fixture
  transactions rolled back. The disposable Unix-socket-only cluster was stopped.
- Privacy assertions prove account-filtered reads, goal default/constraint,
  wrong-owner deletion isolation, repeat deletion, insert-trigger tombstone
  rejection and account-delete cascades. Completion assertions prove one row/
  one charge on replay, failed insert rolls back quota, cap rejection, pending
  cancellation blocks save, deletion does not refund, and completion execution is
  denied to anon/authenticated. These are sequential transaction assertions,
  **not** concurrent delete/complete proof or remote PostgREST validation.
- **Settings policy caveat:** July migrations retain owner INSERT/UPDATE policies.
  The above tests do not prove backend-only settings writes. Integration's critic
  found these owner writes match the backend-editable, constrained settings and
  expose no privileged fields. Reconciliation is correcting stale release wording;
  no restrictive migration is required for this documentary mismatch.

`backend/scripts/benchmark_rollout.py` supplies runnable offline assertions.
Speech mode uses actual FFmpeg, Torch VAD, WAV encoding, SDK multipart construction,
speaker references and acoustic statistics. Only external AI replies are mocked.
Day mode additionally stubs VAD, retains 4,320 turns and a synthetic full-day
transcript, and runs real final acoustic statistics over mapped PCM. Upload mode
exercises actual 2-GiB durable file writes in 512 chunks, rejects an extra byte and
reloads the saved queued status from a new `RecordingJobs` instance.

The following historical measurements used the original buffering
`httpx.MockTransport`. Corrected follow-up results appear below.

| Probe, hard limit 2 GiB, no swap | Process peak RSS | Cgroup peak | Result |
| --- | ---: | ---: | --- |
| Three dense 600-second speech jobs in one process | 1,033.3 MiB | 1,062.7 MiB | Pass; exit 0, not OOM-killed |
| One 24-hour mapped-PCM/retained-transcript job, VAD mocked | 353.9 MiB at decode, final unavailable | 2,048.0 MiB at decode | Exit 137, OOMKilled=true; mock-amplified, production capacity unresolved |
| Diagnostic repeat with anon/file counters | 354.2 MiB before decode | 1,635.1 MiB before decode | Environment failure: FFmpeg/cleanup EIO, exit 1, not OOM |
| Exact 2-GiB durable upload/reload | Unavailable | Unavailable | Not run: Docker image-blob I/O error before start |

Speech durations were 35.038/11.912/11.322 seconds under emulation. Current cgroup
memory after each request grew 854.5 -> 900.1 -> 918.4 MiB; three runs do not prove
steady state. Maximum mock multipart body was 19,200,548 bytes. The exact 600s
mono PCM16 fixture is 19,200,078 bytes, SHA-256
`7009d26e182cf20fa2e522b861bb2b89182c2a4f6267451014413f784c6c0bdc`.
An initial AAC fixture failed the exact-duration assertion due to encoder padding;
it is not counted as a workload failure or pass.

Environment: Linux amd64 under Docker Desktop emulation, one CPU, 2-GiB hard cap
with memory-swap also 2 GiB, network disabled. Cached image
`sha256:5a47cfbbe38cc2ab7dc9082b09bf7512b0250a7947792491566fa8a63810c997`
uses Python 3.14.3, Torch 2.12.1+cpu, Torchaudio 2.11.0+cpu, Silero 6.2.1,
Librosa 0.11.0, NumPy 2.4.6 and OpenAI 2.44.0. Canonical `backend/Dockerfile`
uses Python 3.11; these are exact-source tests, **not validation of that deployment
image**. The benchmark script is mounted in, never substitutes pipeline code.

Integration independently verified canonical `64db03b` passed app/backend/schema/
container/iOS/Android [GitHub CI run 35172377808](https://github.com/jonathanj502/mirra/actions/runs/35172377808).
Its [container job](https://github.com/jonathanj502/mirra/actions/runs/35172377808/job/105046592727)
proves that exact upstream Dockerfile built. Do not infer a dependency conflict
from differing Torch/Torchaudio version numbers. Final integrated CI and writable
production-volume validation remain necessary.

The first full-day OOM remains unresolved and does not prove production fails at
2 GiB. Integration's critic demonstrated that `MockTransport` calls
`Request.read()`, buffering each full multipart body on its request, and SDK
cycles can retain up to 34 requests until garbage collection. That amplifies
memory use independently of normal HTTP streaming. These original results
establish no production minimum or evidence that buying 4 GB solves the problem.

The corrected probe subclasses `httpx.BaseTransport`, consumes `request.stream`
incrementally, counts bytes and keeps only a short tail to recognize speaker
reference fields across chunk boundaries. It never reads `request.content` or
calls `request.read()`. Mock response content and assertions remain the same.
Current process RSS now accompanies peak RSS and cgroup anon/file counters;
decode and transcription-client stages emit diagnostics. No forced garbage
collection was added. Reconciliation owns the separate production fix that
closes WAV `BytesIO` buffers in `finally`.

The lightweight `transport-check` mode passes without Docker, pipeline imports,
audio fixtures or network access. It sends one-byte chunks through an HTTPX
client, verifies both speaker-label branches and byte counts, and fails if
`Request.read` or `Request.content` is accessed. From `backend/`, run:

```sh
python -m scripts.benchmark_rollout transport-check
```

After host-space recovery, one corrected full-day probe and one maximum-upload
probe both passed sequentially. They used exact reconciled source
`399f964f15c5effa511ad7a8d2ef996846fce3d0`, which closes production WAV buffers,
with script correction `f88e625` mounted separately. The cached Python 3.14.3
runtime and Docker limits above were unchanged; networking remained disabled.

| Corrected probe, hard limit 2 GiB, no swap | Process peak RSS | Cgroup peak | Result |
| --- | ---: | ---: | --- |
| One 24-hour job, VAD and AI mocked | 2,003.4 MiB | 2,048.0 MiB | Pass; 140.046 seconds, exit 0, OOMKilled=false |
| One exact 2-GiB durable upload/reload | 363.3 MiB | 2,048.0 MiB | Pass; exit 0, OOMKilled=false |

The day probe decoded 5,529,600,000 PCM bytes, completed all 144 transcription
requests, retained 4,320 turns and a 928,799-byte transcript, and verified temporary
PCM removal. Its largest streamed multipart was 19,883,808 bytes. At completion,
process RSS was 629.0 MiB and cgroup memory 656.1 MiB, split into 626.4 MiB anon
and 3.1 MiB file cache. Maximum sampled anon memory was 663.0 MiB; that is a sampled
counter, not an absolute peak. The upload probe wrote all 2,147,483,648 bytes in
512 chunks, rejected an extra byte and recovered queued status with a fresh
`RecordingJobs` object. Its final cgroup memory was 399.6 MiB, including
279.5 MiB anon and 103.1 MiB file cache. Upload mode performs one upload regardless
of the shared `--runs` default printed at startup.

Both cgroup peaks reached the limit while reclaimable file cache was present.
These single sequential offline passes do not establish production headroom,
sustained behavior or capacity alongside incoming uploads and Reflect. Integration
plans to repeat them in the existing GitHub container CI job using the exact
Python 3.11 deployment image after review, including writable-volume validation.
JSON logs and Docker exit/resource inspection are preserved at
`/private/tmp/mirra-rollout-20260918/{day,upload}-streaming-2g.{log,inspect}`.

The diagnostic repeat exhausted local host storage: `df` reported only 177 MiB
available. Docker subsequently returned EIO for image blobs and metadata writes,
including removal of this task's four containers. No third-party containers or
images were pruned. The stopped disposable PostgreSQL data, failed AAC fixture
and repeated NNPACK log noise were removed; JSON evidence was retained. Root was
notified to coordinate host-space recovery/Docker restart before heavy work.
Root subsequently recovered space from idle task Xcode caches, restarted Docker
and removed exactly these four task-owned containers: `mirra-rollout-speech-2g`,
`mirra-rollout-speech-wav-2g`, `mirra-rollout-day-2g` and
`mirra-rollout-day-diagnostic-2g`. No other Docker data was removed. Root reports
3.7 GiB initially available was still insufficient for the approximately 6.9 GB
full-day source/PCM files plus headroom. Deferred reclamation then recovered
15 GiB. Root authorized the two corrected probes above, performed one at a time
with a free-space check before each. Their exact containers,
`mirra-rollout-day-streaming-2g` and `mirra-rollout-upload-streaming-2g`, were each
removed after saving evidence and before the next run. Host space was 16 GiB
afterward. No workstream containers remain.

Exclusions: real AI latency/quality/cost, complete HTTP/auth/DB traffic, concurrent
incoming uploads and Reflect, a 16-GiB full queue, cold production deployment,
real volume I/O, sustained leak testing and real all-day mobile capture. Cgroup
memory includes reclaimable filesystem cache; RSS and cgroup peaks are different
measurements. Do not equate a synthetic 24-hour timeline with a complete live pass.

For the tested cached runtime, source was mounted read-only at `/candidate`,
`PYTHONPATH=/candidate`, with entrypoint `/work/.venv/bin/python` and working
directory `/candidate`. The speech fixture directory was mounted writable at
`/scratch` because the decoder writes beside a path source. Every container used
`--platform linux/amd64 --memory 2g --memory-swap 2g --cpus 1 --network none` and
`NUMBA_CACHE_DIR=/tmp/numba-rollout`. Commands inside the container were:

```sh
python -u -m scripts.benchmark_rollout speech --audio /scratch/dense-600.wav --runs 3
python -u -m scripts.benchmark_rollout day --runs 1
python -u -m scripts.benchmark_rollout upload
```

The speech fixture was generated from the existing synthetic dense M4A with
`ffmpeg -i dense-stereo-1400.m4a -t 600 -ar 16000 -ac 1 -c:a pcm_s16le dense-600.wav`.
Use the final image's own interpreter/dependencies when repeating for deployment;
mount the probe script separately because the production Docker context excludes
scripts. Retain JSON logs and `docker inspect` exit/OOM/cap values. Remove only
these disposable test containers after collecting evidence.

## Exact deployment-image validation (integration follow-up)

Source: reviewed integration `b0d59330e0747e9dda664e3f1dabb8fbd0f5ac51`.
The unchanged `backend/Dockerfile` built locally for Linux amd64 with Python
3.11.16. Image manifest:
`sha256:864c6ef554ed44cdf249b94b3e7b9a68972a779f19ec8fcb7b6356a0864eb909`.
A separate runtime check confirmed UID 10001 can create/write a file in the
mounted `/srv/mirra/.recordings` volume. This establishes local Docker-volume
permissions, not ownership of a future provider mount.

The actual container CI step was extracted from `.github/workflows/validate.yml`
and executed locally against this image, changing only its local image/container
names. Both modes passed with `--network none --memory 2g --memory-swap 2g
--cpus 1`, using the non-root persistent-volume path for temporary files:

| Deployment-image probe | Result |
| --- | --- |
| Full 24-hour pipeline, VAD/AI replies mocked | PASS: 144 chunks, 4,320 turns, 928,799-byte transcript, 141.956 seconds; cleanup succeeded |
| Full 2-GiB durable upload | PASS: 512 chunks, extra byte rejected, fresh job-object recovery retained queued status |
| Three 600-second synthetic speech jobs, real VAD/acoustics and mocked AI replies | PASS: 32.601 / 15.355 / 16.133 seconds; process peak RSS 1,001.3 MiB; cgroup peak 1,073.5 MiB |

All three containers exited 0 with `oom_killed=false`; their named volumes and
containers were removed. Speech post-job cgroup usage was 886.6 / 925.7 / 925.6
MiB. Three jobs do not establish long-term steady state. Emulation produced
NNPACK hardware warnings but completed the actual speech checks.

The day probe reported peak RSS 2,102.4 MiB and cgroup peak 2,048.0 MiB while
mapping 5.53 GB of disk-backed PCM; these counters account for mapped/shared/file
pages differently. At completion, cgroup usage fell to 613.3 MiB, including
601.6 MiB anonymous and 0.2 MiB file memory. The upload probe also reached the
2-GiB cgroup cap through file cache and fell to 278.0 MiB after cleanup. Do not
interpret file-cache-inclusive peaks as the application's irreducible RAM need.

Evidence: `/private/tmp/mirra-deployment-build-b0d5933.log` and
`/private/tmp/mirra-deployment-capacity-b0d5933/` (image identity, volume check,
JSON stage logs, exit/OOM states and full logs). These are synthetic offline
checks under Docker Desktop amd64 emulation. They close the local exact-image
build and bounded-probe gaps. Live providers, the actual host/volume, simultaneous
incoming traffic, sustained usage and physical recording quality remain open.
No cloud CI, deployment, migration, live AI call or purchase occurred.

## Ordered rollout after integration approval

1. Freeze the reconciled SHA and reviewed outgoing range. Preserve six phone
   originals and their recording IDs. Keep that installation offline until queue
   compatibility is verified. Record its account's usage baseline before any
   coordinated reconnect; five monthly debriefs cannot guarantee all six complete.
   Do not reset counters or discard the accidental clip as an automatic workaround.
2. Obtain Supabase administrative read access for the intended project. Inspect
   `schema_migrations`, PostgreSQL version, table/column/function definitions,
   policies, grants and foreign keys. Compare exact migration files. Never use
   service-role API absence as a substitute for migration-history reconciliation.
3. Finish local/CI build and smoke checks on the exact selected deployment image.
   Preferred replacement is the checked-in Dockerfile with context `backend`,
   one worker, concurrency 16, no access logs and port 8000. Render supports
   [changing runtime](https://render.com/docs/native-runtimes), but saving Source
   triggers deployment, so stage this only in the coordinated change window.
   Upstream Docker build passed the linked CI; final build/start/mount ownership
   still need final-artifact validation.
4. Choose and authorize capacity/storage/retention only after evidence review.
   Start the approved test service with one instance and worker. Mount at
   `/srv/mirra/.recordings` for canonical Docker, set `RECORDING_STORAGE_DIR` to
   that exact persistent path, verify at least 32 GB and UID 10001 write access.
   Check private permissions, no static serving and settled backup policy.
5. Pause incoming writes and drain/stop the old writer before switching accounting
   implementations. Keep existing counters and rows intact. Apply only missing
   canonical migrations in chronological order through an authorized migration
   connection: September 14 tombstones, September 15 coaching goals, September 16
   atomic completion, after verifying their June/July prerequisites. The older
   billing-removal migration deletes retired billing references; do not blindly
   rerun all migrations on production. Do **not** apply September 18 beta receipts.
6. Verify schema and roles before starting the new backend. `debrief_deletions`
   must have RLS/owner SELECT and cascade on account deletion; its delete RPC and
   `complete_recording` must be invoker functions executable only by service_role.
   Confirm the trigger rejects tombstoned inserts, goals are constrained, and the
   settings-write-policy decision is reflected in actual schema. Check PostgREST
   sees the new table, goal column and exact RPC signatures. Preserve ES256/JWKS
   verification and server-owned user IDs. No service key belongs in the app.
7. Configure server-only credentials, `ENVIRONMENT=production`, explicit HTTPS
   `CORS_ORIGINS`, and approved spending alerts. Deploy the exact reviewed SHA,
   keep auto-deploy off, and use `/ready` for traffic readiness. Confirm `/health`
   and `/ready` return 200. Readiness checks schema/credential presence; separately
   verify the worker, actual persistent mount, disk space and memory headroom.
8. With root coordination, run consented disposable-account provider checks:
   multi-chunk upload, expired-token resume, offset conflict, lost acknowledgement,
   same-ID replay, restart during processing, cancellation/deletion race and cap
   behavior. Compare history and usage before/after; retain originals until saved
   acknowledgement. Check long transcript coverage, Reflect, export and deletion.
   Monitor repeated cold/warm memory and disk cleanup. Do not use private queued
   phone recordings as the first load test.
9. Rebuild/install the final app only after its data-preserving upgrade path passes.
   Coordinate the six recordings against remaining allowance; a cap-blocked clip
   stays queued. Repeat the full final-device/TestFlight acceptance matrix for
   the new architecture. Existing Personal Team evidence does not close those gates.

## Rollback and remaining access

Prefer rollback to the last validated revision with the same queue and completion
contracts. Preserve volume contents, deletion markers and usage. Pause/drain writes
before reverting. Never drop new tables, reset counters, or restore an audio-disk
snapshot automatically: that can lose offsets or reintroduce deleted audio.

`f8cf5d7` is an observed earlier deployment, not a safe direct rollback for the new
clients. It lacks `/recordings`, tombstones and shared atomic completion. Reverting
to it needs a coordinated write pause and account/queue reconciliation, with local
originals retained. [Render rollback](https://render.com/docs/rollbacks) preserves
current disk state/compute plan while reusing several older deployment settings;
check environment, start command and health path explicitly.

Missing gates: an authenticated Supabase dashboard/SQL session or securely supplied
direct/pooler administrative connection; exact remote migration history/privileges;
provider choice and paid-capacity approval; verified raw-audio backup configuration;
final combined cloud CI and actual provider-mount validation;
authorized live provider validation and renewed physical/TestFlight acceptance.
Root coordinates these actions and shared-ledger updates.
