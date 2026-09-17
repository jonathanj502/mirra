import numpy as np
import pytest

from app.pipeline import vad


@pytest.mark.parametrize("probabilities, expected", [
    ([0.0] * 40, False),
    ([0.8] * 7 + [0.0] * 10, False),
    ([0.8] * 8 + [0.0] * 10, True),
    ([0.8] * 7, False),
    ([0.8] * 8, True),
    ([0.8] * 4 + [0.0] * 2 + [0.8] * 4 + [0.0] * 10, True),
    ([0.8] * 4 + [0.0] * 10 + [0.8] * 4 + [0.0] * 10, False),
])
def test_speech_gate_preserves_silero_thresholds(monkeypatch, probabilities, expected):
    monkeypatch.setattr(vad, "_speech_probabilities", lambda _: iter(probabilities))
    assert vad.has_speech(np.zeros(len(probabilities) * 512, dtype=np.float32), 16000) is expected


def test_onnx_model_state_is_reset_for_each_recording():
    silence = np.zeros(16000, dtype=np.float32)
    first = list(vad._speech_probabilities(silence))
    second = list(vad._speech_probabilities(silence))
    np.testing.assert_array_equal(first, second)
    assert not vad.has_speech(silence, 16000)
