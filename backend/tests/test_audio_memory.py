"""Metric equivalence and bounded temporary arrays for long speaker turns."""
import numpy as np
import pytest

from app.pipeline import prosody
from app.pipeline.speaker import audio_segments
from app.pipeline.transcription import TranscribedTurn
from app.pipeline.vad import Segment


def test_long_turn_rms_retains_float64_accuracy():
    audio = np.random.default_rng(0).uniform(-1, 1, 16000 * 30).astype(np.float32)
    expected = np.sqrt(np.mean(audio.astype(np.float64) ** 2))
    segment, = audio_segments([TranscribedTurn(0, 30, "A", "speech")], audio, 16000)
    assert segment.energy == pytest.approx(expected, rel=1e-12)


@pytest.mark.parametrize("length", [1333, 65535, 65536, 65537, 160000])
def test_pitch_frames_match_whole_turn_without_padding_whole_turn(monkeypatch, length):
    audio = np.random.default_rng(0).uniform(-1, 1, length).astype(np.float32)
    expected = np.pad(audio, (1024, 1024))
    frames = []

    def yin(batch, **kwargs):
        assert len(batch) <= 2048 + 127 * 512
        assert kwargs["center"] is False
        frames.extend(batch[start:start + 2048].copy() for start in range(0, len(batch) - 2047, 512))
        return np.full((len(batch) - 2048) // 512 + 1, 220.0)

    monkeypatch.setattr(prosody.librosa, "yin", yin)
    assert prosody._pitch_for_segments(audio, 16000, [Segment(0, length / 16000, 1)]) == 220
    np.testing.assert_array_equal(frames, [expected[start:start + 2048] for start in range(0, length + 1, 512)])
