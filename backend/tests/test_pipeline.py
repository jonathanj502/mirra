import io
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.auth import verify_token
from app.db import get_db
from app.main import app
from app.models.settings import UserSettings
import app.main as main
from app.pipeline.vad import Segment
from app.pipeline.speaker import select_user_speaker
from app.pipeline.transcription import TranscribedTurn, TranscriptionInputTooLarge
from app.pipeline.prosody import compute_stats

SAMPLE_DEBRIEF = {
    "id": "00000000-0000-0000-0000-000000000001",
    "session_id": "session-1",
    "user_id": "user-1",
    "created_at": "2026-06-27T00:00:00+00:00",
    "observation": "You asked great questions.",
    "pattern_to_reduce": "Interrupting before the other person finishes.",
    "thing_to_try_next": "Wait 2 seconds before responding.",
    "stats": {
        "talk_listen_ratio": 0.6,
        "question_count": 3,
        "interruption_count": 0,
        "session_duration_minutes": 10.0,
        "user_speech_duration_minutes": 6.0,
        "estimated_wpm": 130.0,
    },
    "transcript": "Hello world?",
}


def _fake_wav(sample_rate: int = 16000, stereo: bool = False) -> bytes:
    buf = io.BytesIO()
    audio = np.zeros(sample_rate, dtype=np.float32)
    if stereo:
        audio = np.stack([audio, audio], axis=1)
    sf.write(buf, audio, sample_rate, format="WAV")
    buf.seek(0)
    return buf.read()


def _db_for_sessions(under_cap: bool = True) -> MagicMock:
    db = MagicMock()
    usage_result = MagicMock()
    usage_result.data = None if under_cap else {"count": 5}
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = usage_result
    db.table.return_value.insert.return_value.execute.return_value.data = [SAMPLE_DEBRIEF]
    return db


def teardown_function():
    app.dependency_overrides.clear()


# --- pure function tests ---

def test_select_user_speaker_weights_energy_by_duration():
    # A brief loud turn should not outweigh the rest of that speaker's quiet speech.
    segs = [Segment(0, 9, 0.1, "A"), Segment(9, 10, 0.9, "A"), Segment(10, 20, 0.4, "B")]
    assert select_user_speaker(segs) == "B"


def test_select_user_speaker_handles_one_voice():
    assert select_user_speaker([Segment(0, 1, 0.45, "A")]) == "A"


def test_select_user_speaker_empty():
    assert select_user_speaker([]) is None


def test_compute_stats_basic():
    all_segs = [Segment(0, 10, 0.5), Segment(20, 30, 0.5)]
    user_segs = [Segment(0, 10, 0.5)]
    stats = compute_stats(all_segs, user_segs, "Hello world? Yes.", 60.0)
    assert stats["talk_listen_ratio"] == 1.0
    assert stats["question_count"] == 1
    assert stats["open_question_count"] == 0
    assert stats["closed_question_count"] == 1
    assert stats["session_duration_minutes"] == 1.0
    assert stats["interruption_count"] == 0
    assert stats["average_turn_offset_ms"] == 10000
    assert stats["total_word_count"] == 3
    assert stats["unique_word_count"] == 3


def test_compute_stats_no_other_speech():
    segs = [Segment(0, 10, 0.5)]
    stats = compute_stats(segs, segs, "words", 60.0)
    assert stats["talk_listen_ratio"] == 99.0


def test_balanced_speaking_time_improves_energy_score():
    user = Segment(0, 10, 0.5)
    balanced = compute_stats([user, Segment(10, 20, 0.5)], [user], "same words", 30.0)
    unbalanced = compute_stats([user, Segment(10, 30, 0.5)], [user], "same words", 30.0)
    assert balanced["energy_axes"] == unbalanced["energy_axes"]
    assert balanced["energy_score"] > unbalanced["energy_score"]


def test_no_speech_does_not_report_a_high_talk_ratio():
    stats = compute_stats([], [], "", 60.0)
    assert stats["talk_listen_ratio"] == 0


def test_compute_stats_adds_voice_analysis_from_audio():
    sr = 16000
    timeline = np.linspace(0, 3, sr * 3, endpoint=False)
    audio = (0.08 * np.sin(2 * np.pi * 180 * timeline)).astype(np.float32)
    all_segs = [Segment(0, 1, 0.08), Segment(1.05, 2, 0.04), Segment(2.5, 3, 0.09)]
    user_segs = [all_segs[0], all_segs[2]]
    stats = compute_stats(all_segs, user_segs, "What changed? Did that help? like actually", 3.0, audio=audio, sample_rate=sr)
    assert stats["question_count"] == 2
    assert stats["open_question_count"] == 1
    assert stats["closed_question_count"] == 1
    assert stats["interruption_count"] == 0
    assert stats["average_turn_offset_ms"] == 275
    assert len(stats["energy_axes"]) == 3
    assert len(stats["energy_series_user"]) == 16
    assert stats["energy_score"] > 0
    assert stats["lsm_score"] > 0
    assert stats["filler_counts"][0] == {"phrase": "like", "count": 1}


@patch("app.pipeline.coordinator.analyze")
@patch("app.pipeline.coordinator.transcribe")
@patch("app.pipeline.coordinator.detect_segments")
def test_coordinator_resamples_stereo_audio_for_voice_analysis(mock_detect, mock_transcribe, mock_analyze):
    from app.pipeline import coordinator

    mock_detect.return_value = [Segment(0, 0.5, 0.1)]
    mock_transcribe.return_value = [TranscribedTurn(0, 0.5, "A", "What changed?")]
    mock_analyze.return_value = {"observation": "x", "pattern_to_reduce": "y", "thing_to_try_next": "z"}

    result = coordinator.run(_fake_wav(sample_rate=44100, stereo=True))

    detected_audio, detected_sr = mock_detect.call_args.args
    transcribed_audio, transcribed_sr = mock_transcribe.call_args.args
    assert detected_sr == 16000
    assert transcribed_sr == 16000
    assert detected_audio.ndim == 1
    assert transcribed_audio.ndim == 1
    assert result["stats"]["session_duration_minutes"] > 0


# --- mocked I/O tests ---

@patch("app.pipeline.claude.anthropic.Anthropic")
def test_analyze(mock_anthropic):
    block = MagicMock()
    block.type = "tool_use"
    block.name = "debrief_card"
    block.input = {"observation": "x", "pattern_to_reduce": "y", "thing_to_try_next": "z"}
    mock_anthropic.return_value.messages.create.return_value.content = [block]
    from app.pipeline.claude import analyze
    result = analyze("transcript", {})
    assert result == {"observation": "x", "pattern_to_reduce": "y", "thing_to_try_next": "z"}


# --- endpoint tests ---

@patch("app.main.coordinator.run")
def test_post_sessions_success(mock_run):
    mock_run.return_value = {
        "observation": SAMPLE_DEBRIEF["observation"],
        "pattern_to_reduce": SAMPLE_DEBRIEF["pattern_to_reduce"],
        "thing_to_try_next": SAMPLE_DEBRIEF["thing_to_try_next"],
        "stats": SAMPLE_DEBRIEF["stats"],
        "transcript": SAMPLE_DEBRIEF["transcript"],
    }
    db = _db_for_sessions(under_cap=True)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: "user-1"
    r = TestClient(app).post("/sessions", files={"audio": ("test.wav", _fake_wav(), "audio/wav")})
    assert r.status_code == 200
    data = r.json()
    assert "debrief" in data
    assert "used_this_month" in data
    assert "remaining" in data
    assert data["debrief"]["observation"] == SAMPLE_DEBRIEF["observation"]
    insert_payload = db.table.return_value.insert.call_args.args[0]
    assert "session_id" in insert_payload
    assert mock_run.call_args.kwargs["content_type"] == "audio/wav"


@patch("app.main.fetch_user_settings")
@patch("app.main.coordinator.run")
def test_post_sessions_respects_transcript_setting(mock_run, mock_settings):
    mock_settings.return_value = UserSettings(save_transcripts=False)
    mock_run.return_value = {
        "observation": SAMPLE_DEBRIEF["observation"],
        "pattern_to_reduce": SAMPLE_DEBRIEF["pattern_to_reduce"],
        "thing_to_try_next": SAMPLE_DEBRIEF["thing_to_try_next"],
        "stats": SAMPLE_DEBRIEF["stats"],
        "transcript": SAMPLE_DEBRIEF["transcript"],
    }
    db = _db_for_sessions(under_cap=True)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: "user-1"
    r = TestClient(app).post("/sessions", files={"audio": ("test.wav", _fake_wav(), "audio/wav")})
    assert r.status_code == 200
    insert_payload = db.table.return_value.insert.call_args.args[0]
    assert insert_payload["transcript"] is None


@patch("app.main.coordinator.run")
def test_post_sessions_rejects_unsupported_audio_type(mock_run):
    app.dependency_overrides[get_db] = lambda: _db_for_sessions(under_cap=True)
    app.dependency_overrides[verify_token] = lambda: "user-1"
    r = TestClient(app).post("/sessions", files={"audio": ("test.txt", b"hello", "text/plain")})
    assert r.status_code == 415
    mock_run.assert_not_called()


@patch("app.main.coordinator.run")
def test_post_sessions_rejects_oversized_audio(mock_run):
    app.dependency_overrides[get_db] = lambda: _db_for_sessions(under_cap=True)
    app.dependency_overrides[verify_token] = lambda: "user-1"
    oversized = b"0" * (25 * 1024 * 1024 + 1)
    r = TestClient(app).post("/sessions", files={"audio": ("test.wav", oversized, "audio/wav")})
    assert r.status_code == 413
    mock_run.assert_not_called()


@patch("app.main.coordinator.run", side_effect=ValueError("bad audio"))
def test_post_sessions_returns_422_when_audio_cannot_be_decoded(mock_run):
    app.dependency_overrides[get_db] = lambda: _db_for_sessions(under_cap=True)
    app.dependency_overrides[verify_token] = lambda: "user-1"
    r = TestClient(app).post("/sessions", files={"audio": ("test.wav", b"not really audio", "audio/wav")})
    assert r.status_code == 422
    assert r.json()["detail"] == "Could not decode audio"
    mock_run.assert_called_once()


@patch("app.main.coordinator.run")
def test_post_sessions_at_cap_returns_402(mock_run):
    app.dependency_overrides[get_db] = lambda: _db_for_sessions(under_cap=False)
    app.dependency_overrides[verify_token] = lambda: "user-1"
    r = TestClient(app).post("/sessions", files={"audio": ("test.wav", _fake_wav(), "audio/wav")})
    assert r.status_code == 402
    mock_run.assert_not_called()


@pytest.fixture
def session_io(monkeypatch):
    db = _db_for_sessions()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: "user-1"
    reserve = MagicMock(return_value="2026-08")
    refund = MagicMock()
    monkeypatch.setattr(main, "user_has_pro_access", lambda *_args: False)
    monkeypatch.setattr(main, "check_and_increment", reserve)
    monkeypatch.setattr(main, "release", refund)
    monkeypatch.setattr(main, "fetch_user_settings", MagicMock(return_value=UserSettings()))
    monkeypatch.setattr(main.coordinator, "run", MagicMock(return_value=dict(SAMPLE_DEBRIEF)))
    monkeypatch.setattr(main, "get_usage", MagicMock(return_value={"used_this_month": 1, "remaining": 4}))
    return TestClient(app), db, reserve, refund


@pytest.mark.parametrize("failure", ["settings", "pipeline", "result", "insert"])
def test_session_failure_refunds_reservation(session_io, failure):
    client, db, reserve, refund = session_io
    if failure == "settings":
        main.fetch_user_settings.side_effect = RuntimeError("settings unavailable")
    elif failure == "pipeline":
        main.coordinator.run.side_effect = RuntimeError("processing failed")
    elif failure == "result":
        main.coordinator.run.return_value = {"stats": None}
    else:
        db.table.return_value.insert.return_value.execute.side_effect = RuntimeError("insert failed")

    r = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")})

    assert r.status_code == 500
    reserve.assert_called_once()
    refund.assert_called_once_with(db, "user-1", "2026-08")


def test_refund_failure_preserves_original_audio_error(session_io):
    client, _db, _reserve, refund = session_io
    main.coordinator.run.side_effect = ValueError("bad audio")
    refund.side_effect = RuntimeError("database unavailable")
    r = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")})
    assert r.status_code == 422
    assert r.json()["detail"] == "Could not decode audio"


def test_saved_debrief_is_not_refunded_when_usage_read_fails(session_io):
    client, _db, _reserve, refund = session_io
    main.get_usage.side_effect = RuntimeError("usage unavailable")
    r = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")})
    assert r.status_code == 500
    refund.assert_not_called()


def test_pro_session_failure_does_not_refund_free_usage(session_io, monkeypatch):
    client, _db, reserve, refund = session_io
    monkeypatch.setattr(main, "user_has_pro_access", lambda *_args: True)
    main.coordinator.run.side_effect = ValueError("bad audio")
    r = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")})
    assert r.status_code == 422
    reserve.assert_not_called()
    refund.assert_not_called()


def test_audio_content_type_accepts_parameters_and_case(session_io):
    client, _db, _reserve, refund = session_io
    r = client.post("/sessions", files={"audio": ("test.webm", b"audio", "Audio/WebM; codecs=opus")})
    assert r.status_code == 200
    assert main.coordinator.run.call_args.kwargs["content_type"] == "audio/webm"
    refund.assert_not_called()


def test_missing_audio_content_type_is_rejected(session_io):
    client, _db, reserve, _refund = session_io
    body = b'--test\r\nContent-Disposition: form-data; name="audio"; filename="test.wav"\r\n\r\naudio\r\n--test--\r\n'
    r = client.post("/sessions", content=body, headers={"Content-Type": "multipart/form-data; boundary=test"})
    assert r.status_code == 415
    reserve.assert_not_called()


def test_session_preserves_diarization_metadata_with_transcript_saving_disabled(session_io):
    client, db, _reserve, _refund = session_io
    main.fetch_user_settings.return_value = UserSettings(save_transcripts=False)
    diarization = {"model": "gpt-4o-transcribe-diarize", "user_speaker": "A", "speaker_count": 2}
    main.coordinator.run.return_value = {**SAMPLE_DEBRIEF,
        "stats": {**SAMPLE_DEBRIEF["stats"], "metadata": {"diarization": diarization}},
        "transcript": "Speaker A: Hello.\nSpeaker B: Hi.",
    }
    r = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")}, data={"title": "Meeting"})
    assert r.status_code == 200
    payload = db.table.return_value.insert.call_args.args[0]
    assert payload["stats"]["metadata"]["diarization"] == diarization
    assert payload["stats"]["metadata"]["title"] == "Meeting"
    assert payload["transcript"] is None
    assert "Speaker A: Hello" not in str(payload)


def test_transcription_upload_limit_returns_413_and_refunds_usage(session_io):
    client, _db, _reserve, refund = session_io
    main.coordinator.run.side_effect = TranscriptionInputTooLarge()
    r = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")})
    assert r.status_code == 413
    assert "too large to transcribe" in r.json()["detail"]
    refund.assert_called_once_with(_db, "user-1", "2026-08")
