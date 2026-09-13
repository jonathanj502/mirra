# Recording analysis

The default transcription model is `gpt-4o-transcribe-diarize`, using the existing
`OPENAI_API_KEY` in `backend/.env`. The backend requires OpenAI Python SDK 2.44.0
or newer; the lockfile already resolves that version. The same key also powers
debrief coaching (`gpt-4.1`) and Reflect chat (`gpt-4.1-mini`). Optional model
overrides are `OPENAI_DEBRIEF_MODEL` and `OPENAI_REFLECT_MODEL`. Supabase still
requires its own server-side credential for database access.

1. Decode the recording and prepare mono 16 kHz audio for acoustic analysis.
   M4A/AAC decoding uses librosa's fallback and needs a supported decoder such as
   FFmpeg installed on the backend host.
2. Use Silero VAD only to skip recordings with no detected speech. Send the entire
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
   rapid responses after another speaker finishes are not counted.
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

If decoded PCM exceeds the API's 25 MB limit, the supported original M4A, MP3,
WAV, or WebM is sent instead when it fits. If neither representation fits, the
endpoint returns HTTP 413 and refunds the reserved free session. The recording is
never silently truncated, and separately generated speaker IDs are never joined.

Run validation from `backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Request options and limits follow the
[OpenAI file-transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text#speaker-diarization).

Coaching uses [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
