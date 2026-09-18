import io
import json
from unittest.mock import MagicMock, patch

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
from app.pipeline.prosody import compute_stats
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
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
    usage_query = MagicMock()
    usage_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = usage_result
    tables = db.table.return_value
    db.table.side_effect = lambda name: usage_query if name == "debrief_usage" else tables
    db.rpc.return_value.execute.return_value.data = SAMPLE_DEBRIEF
    db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {}
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


def test_speaking_share_is_not_scored_as_better_when_balanced():
    user = Segment(0, 10, 0.5)
    balanced = compute_stats([user, Segment(10, 20, 0.5)], [user], "same words", 30.0)
    unbalanced = compute_stats([user, Segment(10, 30, 0.5)], [user], "same words", 30.0)
    assert balanced["energy_axes"] == unbalanced["energy_axes"]
    assert balanced["energy_score"] == unbalanced["energy_score"]


def test_no_speech_does_not_report_a_high_talk_ratio():
    stats = compute_stats([], [], "", 60.0)
    assert stats["talk_listen_ratio"] == 0
    assert stats["user_volume_dbfs"] is None
    assert stats["user_pitch_hz"] is None
    assert stats["other_estimated_wpm"] is None
    assert stats["repeated_words"] == []


def test_compute_stats_adds_voice_analysis_from_audio():
    sr = 16000
    timeline = np.linspace(0, 3, sr * 3, endpoint=False)
    audio = (0.08 * np.sin(2 * np.pi * 180 * timeline)).astype(np.float32)
    all_segs = [Segment(0, 1, 0.08), Segment(1.05, 2, 0.04), Segment(2.5, 3, 0.09)]
    user_segs = [all_segs[0], all_segs[2]]
    stats = compute_stats(all_segs, user_segs, "That changed. What changed? Did that help? like actually like", 3.0,
                          audio=audio, sample_rate=sr, other_transcript="It helped a lot.")
    assert stats["question_count"] == 2
    assert stats["open_question_count"] == 1
    assert stats["closed_question_count"] == 1
    assert stats["interruption_count"] == 0
    assert stats["average_turn_offset_ms"] == 275
    assert len(stats["energy_axes"]) == 3
    assert len(stats["energy_series_user"]) == 16
    assert stats["energy_score"] > 0
    assert stats["lsm_score"] > 0
    assert stats["filler_counts"][0] == {"phrase": "like", "count": 2}
    assert stats["other_estimated_wpm"] == pytest.approx(252.6)
    assert stats["user_volume_dbfs"] == pytest.approx(-21.6, abs=0.1)
    assert stats["other_volume_dbfs"] == pytest.approx(-28, abs=0.1)
    assert stats["user_pitch_hz"] == pytest.approx(180, abs=3)
    assert stats["other_pitch_hz"] == pytest.approx(180, abs=3)
    assert stats["repeated_words"] == [{"phrase": "that", "count": 2}, {"phrase": "changed", "count": 2}, {"phrase": "like", "count": 2}]
    from app.models.debrief import ConversationStats
    assert ConversationStats(**stats).model_dump()["repeated_words"] == stats["repeated_words"]
    assert ConversationStats(**stats).model_dump()["user_pitch_hz"] == stats["user_pitch_hz"]


@patch("app.pipeline.coordinator.analyze")
@patch("app.pipeline.coordinator.transcribe")
@patch("app.pipeline.coordinator.detect_segments")
def test_coordinator_resamples_stereo_audio_for_voice_analysis(mock_detect, mock_transcribe, mock_analyze):
    from app.pipeline import coordinator

    mock_detect.return_value = [Segment(0, 0.5, 0.1)]
    mock_transcribe.return_value = [TranscribedTurn(0, 0.5, "A", "What changed?")]
    mock_analyze.return_value = {"observation": "x", "pattern_to_reduce": "y", "thing_to_try_next": "z"}

    result = coordinator.run(_fake_wav(sample_rate=44100, stereo=True), coaching_goal="make_friends")
    assert mock_analyze.call_args.kwargs == {"coaching_goal": "make_friends"}

    detected_audio, detected_sr = mock_detect.call_args.args
    transcribed_audio, transcribed_sr = mock_transcribe.call_args.args
    assert detected_sr == 16000
    assert transcribed_sr == 16000
    assert detected_audio.ndim == 1
    assert transcribed_audio.ndim == 1
    assert result["stats"]["session_duration_minutes"] > 0


# --- mocked I/O tests ---

@pytest.mark.parametrize("invalid_attempts", [0, 2, 3])
@pytest.mark.parametrize("goal, guidance", [("make_friends", "mutual self-disclosure"), ("confidence", "Preserve honest uncertainty")])
def test_analyze_validates_openai_output_and_bounds_retries(monkeypatch, invalid_attempts, goal, guidance):
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
            coaching.analyze("Speaker A: Hello. Speaker B: Hi.", {"question_count": 1}, coaching_goal=goal)
    else:
        assert coaching.analyze("Speaker A: Hello. Speaker B: Hi.", {"question_count": 1}, coaching_goal=goal) == expected
    assert len(requests) == min(invalid_attempts + 1, 3)
    assert str(requests[0].url) == "https://api.openai.com/v1/responses"
    body = json.loads(requests[0].content)
    assert body["model"] == coaching.settings.openai_debrief_model
    assert body["store"] is False
    assert "Speaker B: Hi." in body["input"] and "question_count" in body["input"]
    assert "not verified voice recognition" in body["instructions"]
    assert guidance in body["instructions"]
    assert "Do not invent a problem" in body["instructions"]
    assert "Do not assign daily exercises" in body["instructions"]
    assert "no universal ideal talk/listen ratio" in body["instructions"]
    assert "Speaking-time share does not measure listening quality" in body["instructions"]
    assert "Speaker identity and timing are estimates" in body["instructions"]
    assert "Do not use em dashes" in body["instructions"]
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
    insert_payload = db.rpc.call_args.args[1]["payload"]
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
    insert_payload = db.rpc.call_args.args[1]["payload"]
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
    monkeypatch.setattr(main, "fetch_user_settings", MagicMock(return_value=UserSettings()))
    monkeypatch.setattr(main.coordinator, "run", MagicMock(return_value=dict(SAMPLE_DEBRIEF)))
    monkeypatch.setattr(main, "get_usage", MagicMock(return_value={"used_this_month": 1, "remaining": 4}))
    return TestClient(app), db


@pytest.mark.parametrize("failure", ["settings", "pipeline", "result", "commit"])
def test_failures_never_charge_before_atomic_completion(session_io, failure):
    client, db = session_io
    if failure == "settings":
        main.fetch_user_settings.side_effect = RuntimeError("settings unavailable")
    elif failure == "pipeline":
        main.coordinator.run.side_effect = RuntimeError("processing failed")
    elif failure == "result":
        main.coordinator.run.return_value = {"stats": None}
    else:
        db.rpc.return_value.execute.side_effect = RuntimeError("commit unavailable")
    assert client.post("/sessions", files={"audio": ("clip.wav", b"audio", "audio/wav")}).status_code == 500
    if failure != "commit":
        db.rpc.assert_not_called()
    db.table.return_value.insert.assert_not_called()


def test_commit_rechecks_transcript_choice_and_preserves_processing_goal(session_io):
    client, db = session_io
    main.fetch_user_settings.side_effect = [UserSettings(save_transcripts=True, coaching_goal="confidence"),
                                           UserSettings(save_transcripts=False, coaching_goal="listening")]
    response = client.post("/sessions", files={"audio": ("clip.webm", b"audio", "Audio/WebM; codecs=opus")},
                           data={"title": "Meeting"})
    assert response.status_code == 200
    assert main.coordinator.run.call_args.kwargs["coaching_goal"] == "confidence"
    payload = db.rpc.call_args.args[1]["payload"]
    assert payload["transcript"] is None
    assert payload["stats"]["metadata"]["coaching_goal"] == "confidence"
    assert payload["stats"]["metadata"]["title"] == "Meeting"
    assert payload["stats"]["metadata"]["content_type"] == "audio/webm"


def test_lost_completion_response_replays_same_account_id_without_processing_again(session_io, monkeypatch):
    client, db = session_io
    saved = {}
    monkeypatch.setattr(main, "_fetch_debrief_row", lambda _db, owner, key: saved.get((owner, key)))
    def commit():
        args = db.rpc.call_args.args[1]
        saved[(args["owner_id"], args["target_id"])] = {
            **SAMPLE_DEBRIEF, **args["payload"], "id": args["target_id"], "user_id": args["owner_id"],
        }
        raise httpx.ReadError("response lost after commit")
    db.rpc.return_value.execute.side_effect = commit
    request = {"files": {"audio": ("clip.wav", b"audio", "audio/wav")}, "data": {"recording_id": "stable"}}
    assert client.post("/sessions", **request).status_code == 500
    main._pipeline_slot.acquire()
    try:
        replay = client.post("/sessions", **request)
        assert replay.status_code == 200, "Saved replay must bypass a busy pipeline"
    finally:
        main._pipeline_slot.release()
    main.coordinator.run.assert_called_once()
    db.rpc.assert_called_once()
    app.dependency_overrides[verify_token] = lambda: "other-user"
    assert client.post("/sessions", **request).status_code == 500
    assert len(saved) == 2
    assert len({key for _, key in saved}) == 2


def test_busy_and_duplicate_admission_happens_before_processing(session_io):
    client, db = session_io
    request = {"files": {"audio": ("clip.wav", b"audio", "audio/wav")}, "data": {"recording_id": "stable"}}
    def process(*args, **kwargs):
        assert client.post("/sessions", **request).status_code == 409
        other = {**request, "data": {"recording_id": "different"}}
        busy = client.post("/sessions", **other)
        assert busy.status_code == 503 and busy.headers["Retry-After"] == "60"
        db.rpc.assert_not_called()
        return dict(SAMPLE_DEBRIEF)
    main.coordinator.run.side_effect = process
    assert client.post("/sessions", **request).status_code == 200
    assert not main._processing_sessions
