import json
from dataclasses import dataclass
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import OpenAI

from app.auth import verify_token
from app.dashboard import build_profile_summary, build_progress, conversation_item, fallback_reflection, talk_listen_percent
from app.db import get_db
from app.main import app


class _FrozenDatetime(datetime):
    """datetime.now() pinned to the same week as ROW_1/ROW_2, real otherwise."""

    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 7, 9, 12, 0, tzinfo=tz or timezone.utc)


ROW_1 = {
    "id": "00000000-0000-0000-0000-000000000101",
    "session_id": "session-101",
    "user_id": "user-1",
    "created_at": "2026-07-07T18:30:00+00:00",
    "observation": "You asked great questions.",
    "pattern_to_reduce": "Jumping in early.",
    "thing_to_try_next": "Try one breath before answering.",
    "stats": {
        "talk_listen_ratio": 0.55,
        "question_count": 9,
        "interruption_count": 1,
        "average_turn_offset_ms": 220,
        "session_duration_minutes": 20.0,
        "user_speech_duration_minutes": 11.0,
        "estimated_wpm": 132.0,
        "energy_score": 76,
        "energy_axes": [0.8, 0.7, 0.6],
        "lsm_score": 0.74,
        "unique_word_count": 30,
        "total_word_count": 50,
        "filler_counts": [{"phrase": "you know", "count": 1}, {"phrase": "i mean", "count": 1}],
        "metadata": {"title": "Coffee with Maya"},
    },
    "transcript": "Honestly, what was that like? I mean, you know, what changed?",
}

ROW_2 = {
    "id": "00000000-0000-0000-0000-000000000102",
    "session_id": "session-102",
    "user_id": "user-1",
    "created_at": "2026-07-08T18:30:00+00:00",
    "observation": "You spoke for most of the conversation.",
    "pattern_to_reduce": "Long monologues.",
    "thing_to_try_next": "Ask one follow-up question.",
    "stats": {
        "talk_listen_ratio": 2.0,
        "question_count": 2,
        "interruption_count": 3,
        "average_turn_offset_ms": 160,
        "session_duration_minutes": 40.0,
        "user_speech_duration_minutes": 28.0,
        "estimated_wpm": 145.0,
        "energy_score": 44,
        "energy_axes": [0.4, 0.5, 0.6],
        "lsm_score": 0.61,
        "unique_word_count": 40,
        "total_word_count": 100,
    },
    "transcript": "Like actually this was kind of a long update.",
}


@dataclass
class _Result:
    data: object


@pytest.fixture
def reflection_api(monkeypatch):
    monkeypatch.setattr("app.reflection.settings.openai_api_key", "test-openai-key")
    response = httpx.Response(200, json={
        "id": "resp_test", "object": "response", "created_at": 1,
        "model": "gpt-4.1-mini", "status": "completed", "parallel_tool_calls": True,
        "tool_choice": "auto", "tools": [],
        "output": [{"id": "msg_test", "type": "message", "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": "A focused reply.", "annotations": []}]}],
    })
    handler = MagicMock(return_value=response)

    def client(**kwargs):
        assert kwargs["api_key"] == "test-openai-key"
        assert kwargs["max_retries"] == 2
        return OpenAI(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    monkeypatch.setattr("app.reflection.OpenAI", client)
    return handler


class _Table:
    def __init__(self, name: str, rows: list[dict], used: int, settings_row: dict | None = None):
        self.name = name
        self.rows = rows
        self.used = used
        self.settings_row = settings_row
        self.filters: list[tuple[str, object]] = []
        self.single = False
        self.start = 0
        self.end: int | None = None
        self.desc = False

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def order(self, _key, desc=False):
        self.desc = desc
        return self

    def range(self, start, end):
        self.start = start
        self.end = end
        return self

    def maybe_single(self):
        self.single = True
        return self

    def execute(self):
        if self.name == "debrief_usage":
            return _Result({"count": self.used} if self.used else None)
        if self.name == "user_settings":
            return _Result(self.settings_row)

        rows = self.rows
        for key, value in self.filters:
            rows = [row for row in rows if str(row.get(key)) == str(value)]
        rows = sorted(rows, key=lambda row: row["created_at"], reverse=self.desc)
        if self.single:
            return _Result(rows[0] if rows else None)
        end = self.end if self.end is not None else len(rows) - 1
        return _Result(rows[self.start : end + 1])


class _Db:
    def __init__(self, rows: list[dict], used: int = 2, settings_row: dict | None = None):
        self.rows = rows
        self.used = used
        self.settings_row = settings_row

    def table(self, name: str):
        return _Table(name, self.rows, self.used, self.settings_row)


def _client(rows: list[dict], used: int = 2, settings_row: dict | None = None) -> TestClient:
    app.dependency_overrides[get_db] = lambda: _Db(rows, used, {"ai_consent_version": "2026-09-14", **(settings_row or {})})
    app.dependency_overrides[verify_token] = lambda: "user-1"
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_conversation_item_uses_metadata_title_and_ratio_conversion():
    item = conversation_item(ROW_2)
    assert item.title == "You spoke for most of the conversation"
    assert item.talk_listen_percent == 67
    assert item.tone == "coral"


@pytest.mark.parametrize("ratio, percent", [(0, 0), (0.5, 33), (1, 50), (2, 67), (99, 99)])
def test_talk_listen_ratio_converts_to_share(ratio, percent):
    assert talk_listen_percent({"stats": {"talk_listen_ratio": ratio}}) == percent


def test_balanced_conversation_is_not_marked_as_talking_too_much():
    row = {**ROW_1, "stats": {**ROW_1["stats"], "talk_listen_ratio": 1}}
    item = conversation_item(row)
    assert item.talk_listen_percent == 50
    assert item.tone == "sage"


def test_build_progress_groups_daily_minutes_and_fillers():
    with patch("app.dashboard.datetime", _FrozenDatetime):
        progress = build_progress([ROW_1, ROW_2], max_weeks=1)
    week = progress.weeks[0]
    assert week.conversation_count == 2
    assert week.daily_minutes[1] == 20.0
    assert week.daily_minutes[2] == 40.0
    assert week.daily_questions[1] == 9
    assert week.daily_open_questions[1] == 1
    assert week.daily_closed_questions[1] == 1
    assert week.daily_open_questions[2] == 0
    assert week.daily_closed_questions[2] == 2
    assert week.daily_interruptions[2] == 3
    assert week.daily_turn_offsets[1] == 220
    assert week.daily_turn_offsets[2] == 160
    assert week.total_questions == 11
    assert week.total_open_questions == 1
    assert week.total_closed_questions == 3
    assert week.average_questions == 5.5
    assert week.average_turn_offset_ms == 190
    assert week.energy_score == 60
    assert week.energy_axes == [0.6, 0.6, 0.6]
    assert week.lsm_average == 0.675
    assert week.vocabulary_unique_words == 70
    assert week.vocabulary_total_words == 150
    assert week.vocabulary_richness == 0.467
    assert week.conversations[0].title == "You spoke for most of the conversation"
    assert week.conversations[0].energy_score == 44
    assert week.conversations[0].lsm_score == 0.61
    assert any(item.phrase == "you know" for item in week.top_fillers)


def test_build_profile_summary_rolls_up_usage():
    summary = build_profile_summary([ROW_1, ROW_2], {"used_this_month": 2, "remaining": 3, "resets_at": "2026-08-01T00:00:00+00:00"})
    assert summary.total_conversations == 2
    assert summary.total_minutes == 60.0
    assert summary.average_questions == 5.5
    assert summary.used_this_month == 2


def test_debrief_detail_returns_owned_row():
    r = _client([ROW_1]).get("/debriefs/00000000-0000-0000-0000-000000000101")
    assert r.status_code == 200
    assert r.json()["id"] == ROW_1["id"]
    assert r.json()["stats"]["open_question_count"] == 1
    assert r.json()["stats"]["closed_question_count"] == 1
    assert r.json()["stats"]["filler_counts"][0] == {"phrase": "you know", "count": 1}


def test_debrief_detail_404s_missing_row():
    r = _client([]).get("/debriefs/00000000-0000-0000-0000-000000000101")
    assert r.status_code == 404


def test_profile_summary_endpoint():
    r = _client([ROW_1, ROW_2], used=4).get("/profile/summary")
    assert r.status_code == 200
    assert r.json()["total_conversations"] == 2
    assert r.json()["remaining"] == 1


def test_progress_endpoint():
    with patch("app.dashboard.datetime", _FrozenDatetime):
        r = _client([ROW_1, ROW_2]).get("/analytics/progress?weeks=1")
    assert r.status_code == 200
    body = r.json()
    assert body["weeks"][0]["conversation_count"] == 2
    assert body["weeks"][0]["conversations"][0]["id"] == ROW_2["id"]


def test_reflect_fallback_without_model(monkeypatch, reflection_api):
    monkeypatch.setattr("app.reflection.settings.openai_api_key", "")
    r = _client([ROW_1]).post("/reflect", json={"conversation_id": ROW_1["id"], "prompt": "How were my questions?"})
    assert r.status_code == 200
    assert r.json()["used_model"] is False
    assert "9 questions" in r.json()["reply"]
    reflection_api.assert_not_called()


def test_reflect_uses_openai_when_configured(reflection_api):
    r = _client([ROW_1]).post(
        "/reflect",
        json={
            "conversation_id": ROW_1["id"],
            "prompt": "What worked?",
            "messages": [{"role": "user", "content": "Can you help me reflect?"}],
        },
    )

    assert r.status_code == 200
    assert r.json() == {"reply": "A focused reply.", "used_model": True}
    reflection_api.assert_called_once()
    request = reflection_api.call_args.args[0]
    assert str(request.url) == "https://api.openai.com/v1/responses"
    assert request.headers["Authorization"] == "Bearer test-openai-key"
    body = json.loads(request.content)
    assert body["model"] == "gpt-4.1-mini"
    assert body["store"] is False
    assert body["input"][0]["role"] == "system"
    assert body["input"][1]["content"] == "Can you help me reflect?"
    assert "Coffee with Maya" in body["input"][-1]["content"]
    assert "Honestly, what was that like?" not in body["input"][-1]["content"]


def test_reflect_uses_saved_coaching_and_privacy_settings(reflection_api):
    settings_row = {
        "coaching_tone": "direct_practical",
        "coaching_depth": "quick",
        "include_transcript_in_reflect": True,
    }
    r = _client([ROW_1], settings_row=settings_row).post(
        "/reflect",
        json={"conversation_id": ROW_1["id"], "prompt": "What should I do next?"},
    )

    assert r.status_code == 200
    body = json.loads(reflection_api.call_args.args[0].content)
    assert "direct, practical" in body["input"][0]["content"]
    assert "one short sentence" in body["input"][0]["content"]
    assert "Honestly, what was that like?" in body["input"][-1]["content"]


@pytest.mark.parametrize("failure", ["server_error", "empty", "incomplete"])
def test_reflect_falls_back_when_openai_cannot_reply(reflection_api, failure):
    if failure == "server_error":
        reflection_api.return_value = httpx.Response(500, json={"error": {"message": "Unavailable"}})
    else:
        body = reflection_api.return_value.json()
        if failure == "empty":
            body["output"] = []
        else:
            body["status"] = "incomplete"
        reflection_api.return_value = httpx.Response(200, json=body)
    r = _client([ROW_1]).post("/reflect", json={"conversation_id": ROW_1["id"], "prompt": "How were my questions?"})

    assert r.status_code == 200
    assert r.json()["used_model"] is False
    assert "9 questions" in r.json()["reply"]
    assert reflection_api.call_count == (3 if failure == "server_error" else 1)


def test_fallback_reflection_handles_empty_context():
    reply = fallback_reflection([], "What worked?")
    assert "do not have a conversation" in reply
