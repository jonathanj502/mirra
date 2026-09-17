import io
import logging
from pathlib import Path
import tempfile

import audioread
import numpy as np
import soundfile as sf
import soxr

from app.pipeline.coaching import analyze
from app.pipeline.prosody import compute_stats
from app.pipeline.speaker import audio_segments, select_user_speaker
from app.pipeline.transcription import TRANSCRIPTION_MODEL, transcribe
from app.pipeline.vad import has_speech

ANALYSIS_SAMPLE_RATE = 16000
MAX_RECORDING_SECONDS = 60 * 60
logger = logging.getLogger("uvicorn.error")
CONTENT_TYPE_SUFFIXES = {
    "audio/aac": ".aac",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-m4a": ".m4a",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
}


class RecordingTooLong(Exception):
    """The decoded recording exceeds the MVP duration limit."""


def _read_mono(blocks, sample_rate: int) -> tuple[np.ndarray, int]:
    # Downmix/resample each block before retaining it, not the full stereo input.
    resampler = soxr.ResampleStream(sample_rate, ANALYSIS_SAMPLE_RATE, 1, dtype="float32", quality="HQ")
    output = io.BytesIO()
    for block in blocks:
        mono = np.asarray(block, dtype=np.float32).mean(axis=1)
        np.nan_to_num(mono, copy=False, nan=0.0, posinf=0.0, neginf=0.0)
        output.write(resampler.resample_chunk(mono).tobytes())
        # Allow one second for container/encoder padding at the native stop limit.
        if output.tell() > (MAX_RECORDING_SECONDS + 1) * ANALYSIS_SAMPLE_RATE * 4:
            raise RecordingTooLong("Conversations must be no longer than one hour.")
    output.write(resampler.resample_chunk(np.empty(0, dtype=np.float32), last=True).tobytes())
    audio = np.frombuffer(output.getbuffer(), dtype=np.float32)
    if len(audio) > (MAX_RECORDING_SECONDS + 1) * ANALYSIS_SAMPLE_RATE:
        raise RecordingTooLong("Conversations must be no longer than one hour.")
    if not len(audio):
        raise ValueError("Could not decode audio")
    return audio, ANALYSIS_SAMPLE_RATE


def _decode_audio(audio_bytes: bytes, content_type: str | None = None) -> tuple[np.ndarray, int]:
    try:
        source = sf.SoundFile(io.BytesIO(audio_bytes))
    except sf.LibsndfileError:
        try:
            suffix = CONTENT_TYPE_SUFFIXES.get((content_type or "").lower(), ".audio")
            # Close the writer before decoding: reopening NamedTemporaryFile is
            # not supported on Windows with the default sharing flags.
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / ("recording" + suffix)
                path.write_bytes(audio_bytes)
                with audioread.audio_open(str(path)) as source:
                    blocks = (
                        np.frombuffer(block, dtype="<i2").reshape(-1, source.channels).astype(np.float32) / 32768
                        for block in source
                    )
                    return _read_mono(blocks, source.samplerate)
        except RecordingTooLong:
            raise
        except Exception as exc:
            raise ValueError("Could not decode audio") from exc
    with source:
        return _read_mono(source.blocks(blocksize=16384, dtype="float32", always_2d=True), source.samplerate)


def run(audio_bytes: bytes, content_type: str | None = None) -> dict:
    # Stage names only: never log the audio, transcript, or coaching content.
    logger.info("Audio pipeline: decoding")
    audio, sr = _decode_audio(audio_bytes, content_type)
    total_seconds = len(audio) / sr

    # Local VAD is only a no-speech check. The recognizer gets the complete
    # recording and handles its own chunking while retaining speaker identity.
    turns = []
    logger.info("Audio pipeline: checking speech")
    if has_speech(audio, sr):
        logger.info("Audio pipeline: transcribing")
        turns = transcribe(audio, sr, source_audio=audio_bytes, content_type=content_type)
    all_segs = audio_segments(turns, audio, sr)
    user_speaker = select_user_speaker(all_segs)
    user_segs = [segment for segment in all_segs if segment.speaker == user_speaker]
    user_transcript = " ".join(turn.text for turn in turns if turn.speaker == user_speaker)
    transcript = "\n".join(f"Speaker {turn.speaker}: {turn.text}" for turn in turns)
    logger.info("Audio pipeline: computing metrics")
    stats = compute_stats(all_segs, user_segs, user_transcript, total_seconds, audio=audio, sample_rate=sr)
    speakers = list(dict.fromkeys(segment.speaker for segment in all_segs))
    stats["metadata"] = {"diarization": {
        "model": TRANSCRIPTION_MODEL,
        "speaker_count": len(speakers),
        "user_speaker": user_speaker,
        "user_speaker_selection": "none" if not speakers else "only_speaker" if len(speakers) == 1 else "loudest_speaker",
        "user_speaker_confirmed": False,
        "timing_precision": "segment",
        "speaker_durations_seconds": {
            speaker: round(sum(s.end - s.start for s in all_segs if s.speaker == speaker), 3)
            for speaker in speakers
        },
    }}
    logger.info("Audio pipeline: coaching")
    coaching = analyze(transcript, stats) if turns else {
        "observation": "No speech was detected in this recording.",
        "pattern_to_reduce": "There is not enough speech to identify a conversational pattern.",
        "thing_to_try_next": "Try another recording with the microphone closer to the conversation.",
    }

    logger.info("Audio pipeline: complete")
    return {**coaching, "stats": stats, "transcript": transcript}
