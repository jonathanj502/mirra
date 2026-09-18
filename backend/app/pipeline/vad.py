from dataclasses import dataclass

import numpy as np
import torch
from silero_vad import get_speech_timestamps, load_silero_vad

_model = None


@dataclass
class Segment:
    start: float  # seconds
    end: float    # seconds
    energy: float  # RMS
    speaker: str | None = None


def _get_model():
    global _model
    if _model is None:
        _model = load_silero_vad()
    return _model


def detect_segments(audio: np.ndarray, sample_rate: int) -> list[Segment]:
    model = _get_model()
    tensor = torch.from_numpy(audio.astype(np.float32))
    timestamps = get_speech_timestamps(tensor, model, sampling_rate=sample_rate, return_seconds=True)
    segments = []
    for ts in timestamps:
        start, end = ts["start"], ts["end"]
        seg = audio[int(start * sample_rate) : int(end * sample_rate)]
        energy = float(np.sqrt(np.mean(seg**2))) if len(seg) > 0 else 0.0
        segments.append(Segment(start=start, end=end, energy=energy))
    return segments
