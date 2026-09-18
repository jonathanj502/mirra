"""Map diarized turns to audio and estimate the recording owner's speaker label."""
from collections import defaultdict
import math

import numpy as np

from app.pipeline.transcription import TranscribedTurn
from app.pipeline.vad import Segment


def audio_segments(turns: list[TranscribedTurn], audio: np.ndarray, sample_rate: int) -> list[Segment]:
    # Union overlapping spans of the same speaker to avoid double-counting speech.
    # Overlap between different speakers is preserved.
    by_speaker: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for turn in sorted(turns, key=lambda turn: turn.start):
        spans = by_speaker[turn.speaker]
        if spans and turn.start <= spans[-1][1]:
            spans[-1] = (spans[-1][0], max(spans[-1][1], turn.end))
        else:
            spans.append((turn.start, turn.end))
    segments = []
    for speaker, spans in by_speaker.items():
        for start, end in spans:
            chunk = audio[int(start * sample_rate):int(end * sample_rate)]
            # Accumulate in float64 without copying/squaring the entire turn.
            energy = float(np.sqrt(np.einsum("i,i->", chunk, chunk, dtype=np.float64) / len(chunk))) if len(chunk) else 0.0
            segments.append(Segment(start, end, energy, speaker))
    return sorted(segments, key=lambda segment: segment.start)


def select_user_speaker(segments: list[Segment]) -> str | None:
    """Choose the loudest speaker by duration-weighted RMS, not individual turns.

    This is a near-microphone assumption, not verified voice recognition. All
    turns of the chosen speaker are kept, including quiet ones.
    """
    totals: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for segment in segments:
        if segment.speaker is not None:
            duration = segment.end - segment.start
            totals[segment.speaker][0] += segment.energy ** 2 * duration
            totals[segment.speaker][1] += duration
    if not totals:
        return None
    return max(totals, key=lambda speaker: math.sqrt(totals[speaker][0] / totals[speaker][1]))
