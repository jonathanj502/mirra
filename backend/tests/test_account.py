from dataclasses import dataclass

from fastapi.testclient import TestClient

from app.auth import verify_token
from app.db import get_db
from app.main import app


ROW = {
    "id": "00000000-0000-0000-0000-000000000201",
    "session_id": "session-201",
    "user_id": "user-1",
    "created_at": "2026-07-07T18:30:00+00:00",
    "observation": "You asked a thoughtful question.",
    "pattern_to_reduce": "Rushing through silence.",
    "thing_to_try_next": "Pause once before answering.",
    "stats": {
        "talk_listen_ratio": 0.5,
        "question_count": 6,
        "interruption_count": 1,
        "session_duration_minutes": 12.0,
        "user_speech_duration_minutes": 5.0,
        "estimated_wpm": 128.0,
    },
    "transcript": "What changed for you?",
}


@dataclass
class _Result:
    data: object


class _Table:
    def __init__(self, db: "_Db", name: str):
        self.db = db
        self.name = name
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
        if self.name == 'debrief_deletions':
            return _Result([{'debrief_id': 'deleted-conversation'}])
        if self.name == "debrief_usage":
            return _Result({"count": self.db.used})
        if self.name == "user_settings":
            return _Result(self.db.settings_row)

        rows = self.db.rows
        for key, value in self.filters:
            rows = [row for row in rows if str(row.get(key)) == str(value)]
        rows = sorted(rows, key=lambda row: row["created_at"], reverse=self.desc)
        if self.single:
            return _Result(rows[0] if rows else None)
        end = self.end if self.end is not None else len(rows) - 1
        return _Result(rows[self.start : end + 1])


class _Db:
    def __init__(self):
        self.rows = [ROW]
        self.used = 1
        self.settings_row = {"coaching_tone": "curious_gentle", "save_transcripts": False, "coaching_goal": "listening"}

    def table(self, name: str):
        return _Table(self, name)


def _client() -> TestClient:
    app.dependency_overrides[get_db] = lambda: _Db()
    app.dependency_overrides[verify_token] = lambda: "user-1"
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_account_export_returns_user_data_bundle():
    r = _client().get("/account/export")

    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == "user-1"
    assert body["profile"]["total_conversations"] == 1
    assert body["settings"]["coaching_tone"] == "curious_gentle"
    assert body["settings"]["coaching_goal"] == "listening"
    assert set(body) == {"exported_at", "user_id", "profile", "settings", "debriefs", "deleted_conversation_ids"}
    assert body['deleted_conversation_ids'] == ['deleted-conversation']
    assert body["debriefs"][0]["id"] == ROW["id"]
    assert body["debriefs"][0]["transcript"] == ROW["transcript"]
