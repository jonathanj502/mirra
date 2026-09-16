import subprocess
from pathlib import Path
import tempfile

import librosa
import numpy as np

from app.pipeline.coaching import analyze
from app.models.settings import CoachingGoal
from app.pipeline.prosody import compute_stats
from app.pipeline.speaker import audio_segments, select_user_speaker
from app.pipeline.transcription import TRANSCRIPTION_MODEL, transcribe
from app.pipeline.vad import detect_segments

ANALYSIS_SAMPLE_RATE = 16000
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


MAX_AUDIO_SECONDS = 3600


class AudioDurationTooLong(ValueError):
    pass


def _decode_audio(audio_bytes: bytes, content_type: str | None = None) -> tuple[np.ndarray, int]:
    suffix = CONTENT_TYPE_SUFFIXES.get((content_type or "").lower(), ".audio")
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / ("recording" + suffix)
        path.write_bytes(audio_bytes)
        try:
            # Decode to bounded mono PCM before allocating analysis arrays. Disable playlist/network
            # demuxers: an uploaded file must not make the server fetch URLs or concatenate local files.
            result = subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-protocol_whitelist", "file,pipe", "-format_whitelist", "aac,wav,mp3,mov,ogg,matroska,webm",
                "-i", str(path), "-t", str(MAX_AUDIO_SECONDS + 1), "-vn",
                "-ac", "1", "-ar", str(ANALYSIS_SAMPLE_RATE), "-f", "f32le", "pipe:1",
            ], capture_output=True, check=True, timeout=120)
        except (subprocess.SubprocessError, OSError) as exc:
            raise ValueError("Could not decode audio") from exc
    audio = np.frombuffer(result.stdout, dtype="<f4")
    if len(audio) > MAX_AUDIO_SECONDS * ANALYSIS_SAMPLE_RATE:
        raise AudioDurationTooLong("Recordings must be no longer than 60 minutes.")
    if not len(audio):
        raise ValueError("Could not decode audio")
    return np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0), ANALYSIS_SAMPLE_RATE


def _analysis_audio(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    if sample_rate == ANALYSIS_SAMPLE_RATE:
        return audio.astype(np.float32), sample_rate
    resampled = librosa.resample(audio.astype(np.float32), orig_sr=sample_rate, target_sr=ANALYSIS_SAMPLE_RATE)
    return resampled.astype(np.float32), ANALYSIS_SAMPLE_RATE


def run(audio_bytes: bytes, content_type: str | None = None, coaching_goal: CoachingGoal = "general") -> dict:
    original_audio, original_sr = _decode_audio(audio_bytes, content_type)
    audio, sr = _analysis_audio(original_audio, original_sr)
    total_seconds = len(audio) / sr

    # Local VAD is only a no-speech check. The recognizer gets the complete
    # recording and handles its own chunking while retaining speaker identity.
    turns = []
    if detect_segments(audio, sr):
        turns = transcribe(audio, sr, source_audio=audio_bytes, content_type=content_type)
    all_segs = audio_segments(turns, audio, sr)
    user_speaker = select_user_speaker(all_segs)
    user_segs = [segment for segment in all_segs if segment.speaker == user_speaker]
    user_transcript = " ".join(turn.text for turn in turns if turn.speaker == user_speaker)
    transcript = "\n".join(f"Speaker {turn.speaker}: {turn.text}" for turn in turns)
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
    coaching = analyze(transcript, stats, coaching_goal=coaching_goal) if turns else {
        "observation": "No speech was detected in this recording.",
        "pattern_to_reduce": "There is not enough speech to identify a conversational pattern.",
        "thing_to_try_next": "Try another recording with the microphone closer to the conversation.",
    }

    return {**coaching, "stats": stats, "transcript": transcript}
