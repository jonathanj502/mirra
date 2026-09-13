from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.auth import verify_token
from app.db import get_db
from app.main import app

SAMPLE = {
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
        "interruption_count": 1,
        "session_duration_minutes": 10.0,
        "user_speech_duration_minutes": 6.0,
        "estimated_wpm": 130.0,
    },
    "transcript": None,
}


def _db(rows: list) -> MagicMock:
    db = MagicMock()
    result = MagicMock()
    result.data = rows
    db.table.return_value.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = result
    return db


def _client(rows: list) -> TestClient:
    app.dependency_overrides[get_db] = lambda: _db(rows)
    app.dependency_overrides[verify_token] = lambda: "user-1"
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_debriefs_returns_list():
    r = _client([SAMPLE]).get("/debriefs")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["observation"] == SAMPLE["observation"]


def test_debriefs_empty():
    r = _client([]).get("/debriefs")
    assert r.status_code == 200
    assert r.json() == []


def test_debriefs_pagination_params():
    db = _db([])
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: "user-1"
    TestClient(app).get("/debriefs?limit=10&offset=20")
    db.table.return_value.select.return_value.eq.return_value.order.return_value.range.assert_called_once_with(20, 29)


def test_delete_debrief_is_scoped_idempotent_and_validates_id():
    own_id = SAMPLE["id"]
    other_id = "00000000-0000-0000-0000-000000000002"
    kept_id = "00000000-0000-0000-0000-000000000003"
    rows = [
        {"id": own_id, "user_id": "user-1", "transcript": "private transcript"},
        {"id": other_id, "user_id": "user-2"},
        {"id": kept_id, "user_id": "user-1"},
    ]
    db = MagicMock()
    query = db.table.return_value.delete.return_value
    filters = {}

    def eq(key, value):
        filters[key] = value
        return query

    def execute():
        rows[:] = [row for row in rows if not all(row[key] == value for key, value in filters.items())]

    query.eq.side_effect = eq
    query.execute.side_effect = execute
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: "user-1"
    client = TestClient(app)

    assert client.delete(f"/debriefs/{other_id}").status_code == 204
    assert len(rows) == 3
    response = client.delete(f"/debriefs/{own_id}")
    assert response.status_code == 204 and response.content == b""
    assert rows == [{"id": other_id, "user_id": "user-2"}, {"id": kept_id, "user_id": "user-1"}]
    assert client.delete(f"/debriefs/{own_id}").status_code == 204
    assert client.delete("/debriefs/not-a-uuid").status_code == 422
    assert query.execute.call_count == 3
    # Deletion never touches usage counters or any other account data.
    assert all(call.args == ("debriefs",) for call in db.table.call_args_list)


def test_delete_requires_auth_and_does_not_report_database_failure_as_success():
    db = MagicMock()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    assert client.delete(f'/debriefs/{SAMPLE["id"]}').status_code == 401
    db.table.assert_not_called()

    app.dependency_overrides[verify_token] = lambda: "user-1"
    db.table.return_value.delete.return_value.eq.return_value.eq.return_value.execute.side_effect = RuntimeError("database unavailable")
    response = client.delete(f'/debriefs/{SAMPLE["id"]}')
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
