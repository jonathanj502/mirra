import io
import json
from unittest.mock import ANY, MagicMock, patch

import numpy as np
import httpx
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
from app.pipeline.prosody import compute_stats, _pitch_for_segments
from app.pipeline import coaching
from openai import OpenAI

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
    def rpc(name, params):
        if name == "reserve_debrief":
            if not under_cap:
                from postgrest.exceptions import APIError
                raise APIError({"code": "PT402", "message": "Monthly debrief limit reached", "details": "", "hint": ""})
            return MagicMock(execute=MagicMock(return_value=MagicMock(data=True)))
        return MagicMock(execute=MagicMock(return_value=MagicMock(data=[SAMPLE_DEBRIEF])))
    db.rpc.side_effect = rpc
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


@pytest.mark.parametrize("length", [65535, 65536, 65537, 160000])
def test_batched_pitch_preserves_full_turn_median_at_frame_boundaries(length):
    import librosa

    sr = 16000
    time = np.arange(length) / sr
    audio = np.sin(2 * np.pi * (120 * time + 8 * time**2)).astype(np.float32)
    expected = float(np.median(librosa.yin(audio, fmin=50, fmax=500, sr=sr)))
    actual = _pitch_for_segments(audio, sr, [Segment(0, length / sr, 1)])
    assert actual == pytest.approx(expected, abs=1e-5)


@patch("app.pipeline.coordinator.analyze")
@patch("app.pipeline.coordinator.transcribe")
@patch("app.pipeline.coordinator.has_speech")
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

@pytest.mark.parametrize("invalid_attempts", [0, 2, 3])
def test_analyze_validates_openai_output_and_bounds_retries(monkeypatch, invalid_attempts):
    expected = {"observation": "x", "pattern_to_reduce": "y", "thing_to_try_next": "z"}
    requests = []

    def respond(request):
        requests.append(request)
        content = {"observation": ""} if len(requests) <= invalid_attempts else expected
        return httpx.Response(200, json={
            "id": "resp_test", "object": "response", "created_at": 1,
            "model": "gpt-4.1", "status": "completed", "parallel_tool_calls": True,
            "tool_choice": "auto", "tools": [],
            "output": [{"id": "msg_test", "type": "message", "role": "assistant", "status": "completed",
                        "content": [{"type": "output_text", "text": json.dumps(content), "annotations": []}]}],
        })

    def client(**kwargs):
        assert kwargs["api_key"] == coaching.settings.openai_api_key
        assert kwargs["max_retries"] == 2
        return OpenAI(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(respond)))

    monkeypatch.setattr(coaching, "OpenAI", client)
    if invalid_attempts == 3:
        with pytest.raises(RuntimeError, match="valid debrief"):
            coaching.analyze("Speaker A: Hello. Speaker B: Hi.", {"question_count": 1})
    else:
        assert coaching.analyze("Speaker A: Hello. Speaker B: Hi.", {"question_count": 1}) == expected
    assert len(requests) == min(invalid_attempts + 1, 3)
    assert str(requests[0].url) == "https://api.openai.com/v1/responses"
    body = json.loads(requests[0].content)
    assert body["model"] == coaching.settings.openai_debrief_model
    assert body["store"] is False
    assert "Speaker B: Hi." in body["input"] and "question_count" in body["input"]
    assert "not verified voice recognition" in body["instructions"]
    assert body["text"]["format"]["strict"] is True
    assert set(body["text"]["format"]["schema"]["required"]) == set(expected)


@pytest.mark.parametrize("status", ["completed", "incomplete"])
@patch("app.pipeline.coaching.OpenAI")
def test_analyze_does_not_accept_missing_or_incomplete_output(factory, status):
    parse = factory.return_value.__enter__.return_value.responses.parse
    parse.return_value.status = status
    parse.return_value.output_parsed = coaching.CoachingOutput(
        observation="x", pattern_to_reduce="y", thing_to_try_next="z",
    ) if status == "incomplete" else None
    with pytest.raises(RuntimeError, match="valid debrief"):
        coaching.analyze("transcript", {})
    assert parse.call_count == 3


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
    insert_payload = db.rpc.call_args.args[1]["p_debrief"]
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
    insert_payload = db.rpc.call_args.args[1]["p_debrief"]
    assert insert_payload["transcript"] is None


@patch("app.main.coordinator.run")
def test_post_sessions_rejects_unsupported_audio_type(mock_run):
    app.dependency_overrides[get_db] = lambda: _db_for_sessions(under_cap=True)
    app.dependency_overrides[verify_token] = lambda: "user-1"
    r = TestClient(app).post("/sessions", files={"audio": ("test.txt", b"hello", "text/plain")})
    assert r.status_code == 415
    mock_run.assert_not_called()


@patch("app.main.coordinator.run")
def test_post_sessions_rejects_oversized_audio(mock_run, monkeypatch):
    app.dependency_overrides[get_db] = lambda: _db_for_sessions(under_cap=True)
    app.dependency_overrides[verify_token] = lambda: "user-1"
    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 100)
    oversized = b"0" * 101
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
    reserve = MagicMock(return_value=True)
    refund = MagicMock()
    monkeypatch.setattr(main, "check_and_increment", reserve)
    monkeypatch.setattr(main, "release", refund)
    monkeypatch.setattr(main, "_fetch_debrief_row", MagicMock(return_value=None))
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
        db.rpc.side_effect = RuntimeError("insert failed")

    r = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")})

    assert r.status_code == 500
    reserve.assert_called_once()
    refund.assert_called_once_with(db, "user-1", *reserve.call_args.args[2:])


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


def test_session_failure_refunds_reserved_usage(session_io):
    client, _db, reserve, refund = session_io
    main.coordinator.run.side_effect = ValueError("bad audio")
    r = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")})
    assert r.status_code == 422
    reserve.assert_called_once_with(_db, "user-1", ANY, ANY)
    refund.assert_called_once_with(_db, "user-1", ANY, ANY)


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
    payload = db.rpc.call_args.args[1]["p_debrief"]
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
    refund.assert_called_once_with(_db, "user-1", ANY, ANY)


def test_duration_limit_returns_413_and_refunds_usage(session_io):
    client, db, reserve, refund = session_io
    main.coordinator.run.side_effect = main.coordinator.RecordingTooLong("Conversations must be no longer than 23 minutes 20 seconds.")
    response = client.post("/sessions", files={"audio": ("test.m4a", b"audio", "audio/mp4")})
    assert response.status_code == 413
    assert "23 minutes 20 seconds" in response.json()["detail"]
    refund.assert_called_once_with(db, "user-1", *reserve.call_args.args[2:])


def test_offline_recording_replay_is_account_scoped_and_does_not_use_quota_twice(session_io, monkeypatch):
    client, db, reserve, refund = session_io
    saved = {}
    monkeypatch.setattr(main, "_fetch_debrief_row", lambda _db, user, key: saved.get((user, key)))

    def insert(name, params):
        assert name == "complete_debrief"
        row = {**SAMPLE_DEBRIEF, **params["p_debrief"], "user_id": params["p_user_id"], "id": params["p_debrief_id"]}
        saved[(row["user_id"], row["id"])] = row
        return MagicMock(execute=MagicMock(return_value=MagicMock(data=[row])))

    db.rpc.side_effect = insert
    request = {"files": {"audio": ("test.wav", b"audio", "audio/wav")},
               "data": {"recording_id": "saved-offline-1", "started_at": "2026-08-31T23:00:00Z"}}
    first = client.post("/sessions", **request)
    replay = client.post("/sessions", **request)
    assert first.status_code == replay.status_code == 200
    assert first.json()["debrief"]["id"] == replay.json()["debrief"]["id"]
    assert first.json()["debrief"]["stats"]["metadata"]["started_at"] == request["data"]["started_at"]
    reserve.assert_called_once()
    main.coordinator.run.assert_called_once()
    refund.assert_not_called()
    app.dependency_overrides[verify_token] = lambda: "another-user"
    other = client.post("/sessions", **request)
    assert other.status_code == 200
    assert other.json()["debrief"]["id"] != first.json()["debrief"]["id"]
    assert reserve.call_count == 2


def test_concurrent_recovery_waits_for_the_original_upload(session_io, monkeypatch):
    client, _db, reserve, _refund = session_io
    monkeypatch.setattr(main, "_fetch_debrief_row", lambda *_args: None)
    request = {"files": {"audio": ("test.wav", b"audio", "audio/wav")}, "data": {"recording_id": "same-recording"}}

    def processing(*_args, **_kwargs):
        assert client.post("/sessions", **request).status_code == 409
        return dict(SAMPLE_DEBRIEF)

    main.coordinator.run.side_effect = processing
    assert client.post("/sessions", **request).status_code == 200
    reserve.assert_called_once()
    assert not main._processing_sessions


def test_another_recording_retries_without_reserving_usage(session_io, monkeypatch):
    client, _db, reserve, _refund = session_io
    monkeypatch.setattr(main, "_fetch_debrief_row", lambda *_args: None)
    request = {"files": {"audio": ("test.wav", b"audio", "audio/wav")}, "data": {"recording_id": "waiting-recording"}}

    def processing(*_args, **_kwargs):
        response = client.post("/sessions", **request)
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "60"
        reserve.assert_called_once()
        return dict(SAMPLE_DEBRIEF)

    main.coordinator.run.side_effect = processing
    assert client.post("/sessions", files=request["files"]).status_code == 200
    main.coordinator.run.side_effect = None
    main.coordinator.run.return_value = dict(SAMPLE_DEBRIEF)
    assert client.post("/sessions", **request).status_code == 200
    assert reserve.call_count == 2
    assert not main._audio_pipeline_lock.locked()
    assert not main._processing_sessions


@pytest.mark.parametrize("duplicate", [False, True])
def test_committed_upload_recovery_and_duplicate_reservation_refund(session_io, monkeypatch, duplicate):
    from postgrest.exceptions import APIError

    client, db, _reserve, refund = session_io
    monkeypatch.setattr(main, "_fetch_debrief_row", MagicMock(side_effect=[None, dict(SAMPLE_DEBRIEF)]))
    db.rpc.side_effect = (
        APIError({"code": "23505", "message": "duplicate key", "details": "", "hint": ""})
        if duplicate else httpx.ReadError("response lost after commit")
    )
    response = client.post("/sessions", files={"audio": ("test.wav", b"audio", "audio/wav")}, data={"recording_id": "recover-commit"})
    assert response.status_code == 200
    assert response.json()["debrief"]["id"] == SAMPLE_DEBRIEF["id"]
    refund.assert_called_once()  # The receipt RPC makes this a no-op for a committed charge.
    assert not main._processing_sessions
