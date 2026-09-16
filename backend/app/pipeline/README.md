# Recording analysis

MIRRA accepts recordings and imports up to 24 hours and 2 GiB through the resumable
`/recordings` API. Capture uses mono 24 kHz, 64 kbps audio on iOS and Android.
The existing `OPENAI_API_KEY` powers transcription, debrief coaching and Reflect.

1. The app durably saves stopped/imported audio before uploading. Native uploads
   read at most 4 MiB at a time from an open file handle. Each authenticated request
   refreshes the session and checks the account and device consent. Upload offsets
   survive lost responses, reconnection and backend restart.
2. Completing an upload queues a disk-backed background job. The app polls progress
   and can close after upload completes. One process, worker and persistent private
   volume are required. Set `RECORDING_STORAGE_DIR`, mount at least 32 GB, and exclude
   it from backups and public serving. The queue permits four pending recordings per
   account and 16 GiB of declared pending uploads globally. These are operational
   ceilings, not an audio archive.
3. FFmpeg decodes to disk-backed mono 16 kHz float PCM with allowlisted audio
   demuxers, no network/playlist loading, and a 900-second timeout. A full day uses
   approximately 5.5 GB of temporary PCM in addition to the compressed upload.
   Read-only memory mapping and ten-minute analysis chunks bound array allocations.
4. Silero VAD skips silent chunks. Speech-bearing chunks preserve all their samples
   and pauses; a nearby detected pause is preferred at boundaries. Continuous speech
   may cross a chunk boundary. Each PCM16 WAV sent to `gpt-4o-transcribe-diarize` is
   under the provider's 25 MB limit, using `diarized_json` and automatic server
   chunking. Chunk-relative timestamps are shifted back to the original timeline.
5. Up to four clean 2 to 8 second voice excerpts help match speakers across requests.
   These references exist only for the current analysis, not as saved enrollment.
   Anonymous labels are prefixed by their chunk and never merged solely because
   two requests return the same letter. Unmatched labels can still represent one
   person; speaker splitting, mixed voices and matching errors affect estimates.
6. Overlapping same-speaker intervals are merged. The highest duration-weighted RMS
   speaker is the estimated user, without confirmed identity or a correction UI.
   All of that label's turns contribute to word, question and speaking-time stats.
   RMS calculations are bounded. Pitch samples at most 64 five-second excerpts per
   speaker group. Diarization metadata records matching and sampling limitations.
7. Structured coaching uses `responses.parse`, `CoachingOutput`, `store=False`, and
   the saved goal at processing time. Long transcripts are summarized in bounded
   sections that cover the whole recording before final coaching. The complete
   labeled transcript is saved only if transcript storage is still enabled at
   commit time. Summarized coaching is identified in statistics metadata. Empty
   speech returns a neutral debrief without calling the coaching model.
8. `complete_recording` atomically stores the debrief and increments monthly usage.
   Replays cannot charge twice, failed processing consumes no allowance, and deletion
   tombstones prevent cancelled or deleted recordings from being recreated. Apply
   `20260916010000_long_recordings.sql` before deploying. `/ready` checks its RPC.

The app retains its original until a saved debrief is acknowledged or cancellation
is acknowledged by the backend. Uploading needs the app foregrounded; server analysis
continues independently. Transient job failures receive three attempts, then a 15-minute
cooldown. The foreground app can automatically resume them afterward without reuploading.
Invalid media does not trigger repeated analysis. Restarted jobs
reprocess the recording, since per-chunk transcription checkpoints are not implemented.
Do not run multiple workers or replicas against this local queue. Shared object storage
and a database lease are required before scaling horizontally.

The running worker removes completed audio, cancelled jobs and abandoned analysis files.
Incomplete/failed uploads expire after 24 hours without progress. A stopped service
cannot perform expiry cleanup; restart runs cleanup again. Account export includes job
metadata and account deletion cancels its jobs. Do not log audio, transcripts or tokens.
The legacy synchronous `/sessions` endpoint retains its 25 MiB request limit; current
mobile and web clients use resumable uploads for both short and long recordings.

Validation from `backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
# Optional paid requests using synthetic voices only:
.\.venv\Scripts\python.exe scripts/smoke_ai.py --live --chunked
```

Provider limits and voice-reference options follow the
[OpenAI speech-to-text documentation](https://developers.openai.com/api/docs/guides/speech-to-text).
Coaching uses [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
