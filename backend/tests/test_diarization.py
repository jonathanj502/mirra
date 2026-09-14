import io
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
import soundfile as sf

from app.pipeline import coordinator, transcription
from app.pipeline.prosody import compute_stats
from app.pipeline.speaker import audio_segments
from app.pipeline.transcription import TranscribedTurn, TranscriptionInputTooLarge
from app.pipeline.vad import Segment


@pytest.fixture
def transcription_client(monkeypatch):
    factory = MagicMock()
    client = factory.return_value.__enter__.return_value
    client.audio.transcriptions.create.return_value.model_dump.return_value = {
        "text": "Hello. Hi.",
        "segments": [
            {"start": 0.1, "end": 0.4, "speaker": "A", "text": "Hello."},
            {"start": 0.6, "end": 0.9, "speaker": "B", "text": "Hi."},
        ],
    }
    monkeypatch.setattr(transcription, "OpenAI", factory)
    return client.audio.transcriptions.create


def test_transcribes_the_complete_timeline_with_speakers(transcription_client):
    audio = np.linspace(-0.5, 0.5, 16000, dtype=np.float32)
    turns = transcription.transcribe(audio, 16000)
    request = transcription_client.call_args.kwargs
    assert request["model"] == "gpt-4o-transcribe-diarize"
    assert request["response_format"] == "diarized_json"
    assert request["chunking_strategy"] == "auto"
    assert "prompt" not in request and "timestamp_granularities" not in request
    encoded, sr = sf.read(request["file"])
    assert sr == 16000
    np.testing.assert_allclose(encoded, audio, atol=1 / 32768)
    assert turns == [TranscribedTurn(0.1, 0.4, "A", "Hello."), TranscribedTurn(0.6, 0.9, "B", "Hi.")]


def test_empty_audio_does_not_call_openai(transcription_client):
    assert transcription.transcribe(np.array([], dtype=np.float32), 16000) == []
    transcription_client.assert_not_called()


def test_compressed_source_is_used_when_decoded_wav_exceeds_limit(monkeypatch, transcription_client):
    monkeypatch.setattr(transcription, "MAX_TRANSCRIPTION_BYTES", 100)
    transcription.transcribe(np.zeros(16000), 16000, source_audio=b"compressed", content_type="Audio/WebM; codecs=opus")
    request = transcription_client.call_args.kwargs
    assert request["file"].read() == b"compressed"
    assert request["file"].name.endswith(".webm")
    transcription_client.assert_called_once()


@pytest.mark.parametrize("source,content_type", [(None, None), (b"x" * 101, "audio/mp4"), (b"small", "audio/aac")])
def test_oversized_audio_is_not_split_or_silently_truncated(monkeypatch, transcription_client, source, content_type):
    monkeypatch.setattr(transcription, "MAX_TRANSCRIPTION_BYTES", 100)
    with pytest.raises(TranscriptionInputTooLarge):
        transcription.transcribe(np.zeros(16000), 16000, source_audio=source, content_type=content_type)
    transcription_client.assert_not_called()


@pytest.mark.parametrize("segment", [
    {"start": 0, "end": 1, "text": "No speaker"},
    {"start": 0, "end": 1, "text": "Unknown", "speaker": ""},
    {"start": float("nan"), "end": 1, "text": "Bad timing", "speaker": "A"},
    {"start": 1, "end": 0, "text": "Reversed", "speaker": "A"},
    {"start": 2, "end": 3, "text": "Outside", "speaker": "A"},
])
def test_malformed_diarization_fails_instead_of_misattributing_speech(segment):
    with pytest.raises(RuntimeError, match="invalid speaker segment"):
        transcription._parse_turns({"segments": [segment]}, 1)


@pytest.mark.parametrize("payload", [{"text": "Missing segments"}, {"text": "Unlabelled speech", "segments": []}])
def test_plain_text_is_not_treated_as_a_single_speaker(payload):
    with pytest.raises(RuntimeError):
        transcription._parse_turns(payload, 1)


def test_timestamps_are_clamped_sorted_and_anonymous_labels_are_preserved():
    turns = transcription._parse_turns({"segments": [
        {"start": 0.6, "end": 1.05, "speaker": "@", "text": " second "},
        {"start": -0.01, "end": 0.4, "speaker": "A", "text": "first"},
    ]}, 1)
    assert turns == [TranscribedTurn(0, 0.4, "A", "first"), TranscribedTurn(0.6, 1, "@", "second")]


def test_same_speaker_overlap_is_unioned_but_other_speakers_remain_separate():
    turns = [TranscribedTurn(0, 2, "A", "one"), TranscribedTurn(1, 3, "A", "two"), TranscribedTurn(1, 2, "B", "three")]
    segments = audio_segments(turns, np.ones(300), 100)
    assert segments == [Segment(0, 3, 1, "A"), Segment(1, 2, 1, "B")]
    stats = compute_stats(segments, segments[:1], "one two", 3)
    assert stats["user_speech_duration_minutes"] == 0.05
    assert stats["other_speech_duration_minutes"] == 0.017


def test_identical_bounds_do_not_make_other_speakers_count_as_the_user():
    segments = [Segment(0, 1, 0.5, "A"), Segment(0, 1, 0.5, "B")]
    stats = compute_stats(segments, segments[:1], "hello", 1)
    assert stats["energy_axes"][0] == 1.0  # Both speakers' energy is present.
    assert stats["talk_listen_ratio"] == 1.0
    assert stats["interruption_count"] == 0


def test_interruptions_only_count_user_initiated_overlap():
    segments = [Segment(0, 2, 0.2, "B"), Segment(1.5, 3, 0.5, "A"),
                Segment(2.8, 4, 0.2, "B"), Segment(4.05, 5, 0.5, "A")]
    stats = compute_stats(segments, [s for s in segments if s.speaker == "A"], "um uh", 5)
    assert stats["interruption_count"] == 1
    assert stats["filler_counts"] == [{"phrase": "um", "count": 1}, {"phrase": "uh", "count": 1}]


def test_coordinator_keeps_quiet_user_turns_and_supplies_full_context(monkeypatch):
    sr = 16000
    audio = np.concatenate([np.full(sr, level, dtype=np.float32) for level in (0.8, 0.4, 0.05, 0)])
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    monkeypatch.setattr(coordinator, "detect_segments", lambda *_: [Segment(0, 3, 0.5)])
    transcribe = MagicMock(return_value=[TranscribedTurn(0, 1, "A", "Um, hello."),
        TranscribedTurn(1, 2, "B", "Why now? Uh, okay."), TranscribedTurn(2, 3, "A", "What changed?")])
    monkeypatch.setattr(coordinator, "transcribe", transcribe)
    analyze = MagicMock(return_value={"observation": "x", "pattern_to_reduce": "y", "thing_to_try_next": "z"})
    monkeypatch.setattr(coordinator, "analyze", analyze)
    result = coordinator.run(buf.getvalue(), "audio/wav")
    assert len(transcribe.call_args.args[0]) == sr * 4
    assert result["stats"]["metadata"]["diarization"]["user_speaker"] == "A"
    assert result["stats"]["metadata"]["diarization"]["user_speaker_confirmed"] is False
    assert result["stats"]["total_word_count"] == 4
    assert result["stats"]["question_count"] == 1
    assert result["stats"]["filler_counts"] == [{"phrase": "um", "count": 1}]
    assert "Speaker B: Why now?" in result["transcript"]
    assert "Speaker A: What changed?" in result["transcript"]
    assert analyze.call_args.args == (result["transcript"], result["stats"])


@pytest.mark.parametrize("local_speech", [False, True])
def test_no_speech_skips_coaching_and_returns_empty_transcript(monkeypatch, local_speech):
    buf = io.BytesIO()
    sf.write(buf, np.zeros(16000), 16000, format="WAV")
    monkeypatch.setattr(coordinator, "detect_segments", lambda *_: [Segment(0, 1, 0)] if local_speech else [])
    transcribe, analyze = MagicMock(return_value=[]), MagicMock()
    monkeypatch.setattr(coordinator, "transcribe", transcribe)
    monkeypatch.setattr(coordinator, "analyze", analyze)
    result = coordinator.run(buf.getvalue())
    assert result["transcript"] == ""
    assert result["stats"]["metadata"]["diarization"]["speaker_count"] == 0
    assert result["stats"]["total_word_count"] == 0
    assert transcribe.call_count == int(local_speech)
    analyze.assert_not_called()


def test_decode_uses_bounded_ffmpeg_and_cleans_up_temporary_audio(monkeypatch):
    paths = []

    def decode(command, **kwargs):
        path = Path(command[command.index('-i') + 1])
        paths.append(path)
        assert path.read_bytes() == b"encoded m4a"
        assert command[command.index('-protocol_whitelist') + 1] == 'file,pipe'
        assert 'concat' not in command[command.index('-format_whitelist') + 1]
        assert kwargs['timeout'] == 120
        return type('Decoded', (), {'stdout': np.array([0.3, 0.5, 0.7], dtype='<f4').tobytes()})()

    monkeypatch.setattr(coordinator.subprocess, 'run', decode)
    audio, sr = coordinator._decode_audio(b"encoded m4a", "audio/mp4")
    np.testing.assert_allclose(audio, [0.3, 0.5, 0.7])
    assert sr == 16000
    assert paths[0].suffix == ".m4a"
    assert not paths[0].exists()


def test_decode_rejects_audio_beyond_duration_limit(monkeypatch):
    monkeypatch.setattr(coordinator, 'MAX_AUDIO_SECONDS', 1)
    monkeypatch.setattr(coordinator.subprocess, 'run', lambda *args, **kwargs: type('Decoded', (), {'stdout': np.zeros(16001, dtype='<f4').tobytes()})())
    with pytest.raises(coordinator.AudioDurationTooLong):
        coordinator._decode_audio(b'audio', 'audio/wav')
