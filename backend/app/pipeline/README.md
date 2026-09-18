# Recording analysis

The default transcription model is `gpt-4o-transcribe-diarize`, using the existing
`OPENAI_API_KEY` in `backend/.env`. The backend requires OpenAI Python SDK 2.44.0
or newer; the lockfile already resolves that version. The same key also powers
debrief coaching (`gpt-4.1`) and Reflect chat (`gpt-4.1-mini`). Optional model
overrides are `OPENAI_DEBRIEF_MODEL` and `OPENAI_REFLECT_MODEL`. Supabase still
requires its own server-side credential for database access.

1. Decode in blocks, downmixing and resampling directly to mono 16 kHz audio for
   acoustic analysis. M4A/AAC uses audioread and needs a supported decoder such as
   FFmpeg installed on the backend host. Full stereo PCM is never retained.
2. Use Silero VAD's bundled ONNX model only to skip recordings with no detected
   speech, preserving its default thresholds and minimum speech duration.
   Its recurrent state is separate for every recording. Send the entire
   timeline to OpenAI as PCM WAV, with `response_format="diarized_json"` and
   `chunking_strategy="auto"`. There is no speech concatenation or local splitting.
3. Use the returned speaker labels and segment timestamps. Merge overlapping
   intervals of the same speaker to avoid counting them twice; preserve overlap
   between different speakers.
4. Estimate the user as the speaker with the highest duration-weighted RMS audio
   energy. Keep **all** turns with that label, including quieter turns. This is
   still a microphone-placement assumption, not voice recognition or confirmed
   identity. No speaker enrollment or correction UI is included in this change.
5. Compute word, filler, question, speaking-rate, and acoustic statistics for that
   selected speaker. Other-speaker durations use the other labels. Interruption
   counts are only a heuristic for overlap initiated by the selected speaker;
   rapid responses after another speaker finishes are not counted. Pitch uses
   the original centered YIN frames in batches of 128 to bound FFT memory.
6. Send the complete speaker-labeled transcript and selected-speaker statistics
   to OpenAI using `responses.parse` and the `CoachingOutput` Pydantic schema.
   Coaching instructions explicitly describe identity and timing uncertainty.
   Invalid or missing output gets two retries before failing and refunding usage;
   the SDK handles transient API errors with two retries. Empty speech returns a
   neutral debrief without calling the coaching model. Text requests set
   `store=False`; Reflect includes transcripts only when enabled by the user.

The saved `transcript` now contains the full labeled conversation, for example
`Speaker A: Hello.`. `stats.metadata.diarization` records the model, speaker count,
estimated user label, selection method, and per-speaker durations. It contains no
transcript text. The session endpoint preserves these fields while adding upload
metadata. Disabling transcript saving still stores no transcript.

Speaker segment durations include pauses within a returned turn; word timestamps
are unavailable from this model. Speaker splitting, overlap, and acoustic measures
remain estimates. The model does not separate individual voices out of mixed audio.

Captured and imported conversations have a 23-minute-20-second (1400-second)
maximum and a 100 MiB upload cap. This matches the duration ceiling reported by
the provider in the one-hour test. Overlong input returns HTTP 413 and refunds
reserved usage. Client-provided duration is not trusted for enforcement.
Compressed containers whose decoded metadata fits may emit up to one second of
final-frame padding; decoded samples beyond 1400 seconds are removed. PCM and
containers reporting a duration over the limit are rejected, not shortened.

If decoded PCM exceeds the transcription API's separate 25 MB limit, the supported
original M4A, MP3, WAV, or WebM is sent instead when it fits and has at least one
second of duration headroom. Otherwise FFmpeg encodes the bounded mono timeline
to 48 kbps MP3, approximately 8.4 MB at the limit. It writes a seekable file so
gapless metadata preserves the actual duration without added encoder padding.
The generated file is size-checked before sending. FFmpeg with `libmp3lame` is
required; the deployment warm-up checks that encoder. Separately generated
speaker IDs are never joined. Longer conversations are deferred.

Only one audio request runs per server process. A competing request receives 503
with `Retry-After: 60` before reading its audio into memory or reserving usage;
the device queue keeps its clip and retries. Run a single Uvicorn worker on a
small instance. Decoding separately bounds duration to 1400 seconds. The 512 MB
hosting gate remains open pending deployment
and actual production measurement; local Linux checks are in
`docs/testflight-acceptance.md` at the repository root.

Run validation from `backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Request options and limits follow the
[OpenAI file-transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text#speaker-diarization).

Coaching uses [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
