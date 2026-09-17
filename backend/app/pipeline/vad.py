from dataclasses import dataclass
from functools import lru_cache
from importlib.metadata import distribution

import numpy as np
import onnxruntime as ort


@dataclass
class Segment:
    start: float  # seconds
    end: float    # seconds
    energy: float  # RMS
    speaker: str | None = None


@lru_cache(maxsize=1)
def _get_model():
    options = ort.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    # Load the bundled model without importing Silero's PyTorch runtime.
    path = distribution("silero-vad").locate_file("silero_vad/data/silero_vad.onnx")
    return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def _speech_probabilities(audio: np.ndarray):
    model = _get_model()
    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros((1, 64), dtype=np.float32)
    for offset in range(0, len(audio), 512):
        frame = audio[offset:offset + 512].astype(np.float32, copy=False)
        frame = np.pad(frame, (0, 512 - len(frame)))
        batch = np.concatenate((context, frame[None, :]), axis=1)
        probability, state = model.run(None, {
            "input": batch, "state": state, "sr": np.array(16000, dtype=np.int64),
        })
        context = batch[:, -64:]
        yield float(probability.item())


def has_speech(audio: np.ndarray, sample_rate: int) -> bool:
    if sample_rate != 16000:
        raise ValueError("Speech detection requires 16 kHz audio")
    # Silero's defaults: 0.5/0.35 thresholds, >250 ms speech, 100 ms silence.
    # Only presence is needed; diarized timestamps come from transcription.
    start = None
    silence_start = None
    for index, probability in enumerate(_speech_probabilities(audio)):
        offset = index * 512
        if probability >= 0.5:
            silence_start = None
            if start is None:
                start = offset
        if probability < 0.35 and start is not None:
            if silence_start is None:
                silence_start = offset
            if offset - silence_start >= 1600:
                if silence_start - start > 4000:
                    return True
                start = silence_start = None
    return start is not None and len(audio) - start > 4000
