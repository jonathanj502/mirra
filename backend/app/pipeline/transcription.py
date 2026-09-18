"""Full-conversation transcription with speaker labels and original timestamps."""
from dataclasses import dataclass
import base64
import io
import math

import numpy as np
from openai import OpenAI
import soundfile as sf

from app.config import settings

TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize"
MAX_TRANSCRIPTION_BYTES = 25_000_000
SOURCE_SUFFIXES = {
    "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/mpeg": ".mp3",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/webm": ".webm",
}


class TranscriptionInputTooLarge(Exception):
    """The complete recording cannot fit in one transcription request."""


@dataclass(frozen=True)
class TranscribedTurn:
    start: float
    end: float
    speaker: str
    text: str


def _parse_turns(payload: dict, duration: float) -> list[TranscribedTurn]:
    # Fail visibly rather than treating an unlabelled response as the user's voice.
    segments = payload.get("segments")
    if not isinstance(segments, list):
        raise RuntimeError("Transcription did not include speaker segments")
    turns = []
    for segment in segments:
        try:
            start, end = float(segment["start"]), float(segment["end"])
            speaker, text = segment["speaker"], segment["text"]
            if not (math.isfinite(start) and math.isfinite(end) and end > start):
                raise ValueError("Invalid timestamps")
            if not isinstance(speaker, str) or not speaker.strip() or not isinstance(text, str):
                raise ValueError("Invalid speaker or text")
            start, end = max(0.0, start), min(duration, end)
            if end <= start:
                raise ValueError("Segment is outside the recording")
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise RuntimeError("Transcription returned an invalid speaker segment") from exc
        if text.strip():
            turns.append(TranscribedTurn(start, end, speaker.strip(), text.strip()))
    if not turns and payload.get("text", "").strip():
        raise RuntimeError("Transcription text has no usable speaker segments")
    return sorted(turns, key=lambda turn: turn.start)


def transcribe(
    audio: np.ndarray,
    sample_rate: int,
    *,
    source_audio: bytes | None = None,
    content_type: str | None = None,
    known_speakers: dict[str, str] | None = None,
) -> list[TranscribedTurn]:
    if not len(audio):
        return []
    # Preserve pauses and all speakers so timestamps refer to the original recording.
    buf = io.BytesIO()
    try:
        sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
        buf.name = "conversation.wav"
        if buf.tell() > MAX_TRANSCRIPTION_BYTES:
            suffix = SOURCE_SUFFIXES.get((content_type or "").split(";", 1)[0].strip().lower())
            if source_audio and suffix and len(source_audio) <= MAX_TRANSCRIPTION_BYTES:
                # A long M4A/WebM can fit when its decoded PCM does not. Keep one
                # request: anonymous speaker IDs cannot be joined across calls.
                buf.close()
                buf = io.BytesIO(source_audio)
                buf.name = "conversation" + suffix
            else:
                raise TranscriptionInputTooLarge("Recording exceeds the transcription upload limit")
        buf.seek(0)
        with OpenAI(api_key=settings.openai_api_key, timeout=180.0, max_retries=1) as client:
            response = client.audio.transcriptions.create(
                model=TRANSCRIPTION_MODEL, file=buf, response_format="diarized_json",
                chunking_strategy="auto",
                **({"extra_body": {"known_speaker_names": list(known_speakers),
                                  "known_speaker_references": list(known_speakers.values())}} if known_speakers else {}),
            )
        return _parse_turns(response.model_dump(), len(audio) / sample_rate)
    finally:
        buf.close()


def speaker_reference(audio: np.ndarray, sample_rate: int, turns: list[TranscribedTurn], speaker: str) -> str | None:
    """A short, non-overlapping voice excerpt, kept only for this recording's analysis."""
    for turn in sorted((t for t in turns if t.speaker == speaker), key=lambda t: t.end - t.start, reverse=True):
        spans = [(turn.start, turn.end)]
        for other in turns:
            if other.speaker == speaker:
                continue
            spans = [(a, b) for left, right in spans for a, b in
                     [(left, min(right, other.start)), (max(left, other.end), right)] if b > a]
        for start, end in spans:
            if end - start < 2:
                continue
            buf = io.BytesIO()
            sf.write(buf, audio[int(start * sample_rate):int(min(end, start + 8) * sample_rate)],
                     sample_rate, format="WAV", subtype="PCM_16")
            return "data:audio/wav;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return None
