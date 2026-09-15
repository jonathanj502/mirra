from unittest.mock import MagicMock

import httpx
from fastapi.testclient import TestClient
from supabase import ClientOptions, create_client

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


def test_delete_removes_only_the_owned_conversation_and_is_safe_to_retry():
    rows = [
        {**SAMPLE, "transcript": "Private conversation text"},
        {**SAMPLE, "id": "00000000-0000-0000-0000-000000000002"},
        {**SAMPLE, "id": "00000000-0000-0000-0000-000000000003", "user_id": "user-2"},
    ]
    kept_id, other_id = rows[1]["id"], rows[2]["id"]
    requests = []

    def database(request):
        requests.append(request)
        assert request.url.path == "/rest/v1/debriefs"  # No usage refund or other table mutations.
        filters = {key: value[3:] for key, value in request.url.params.items() if value.startswith("eq.")}
        matches = [row for row in rows if all(row[key] == value for key, value in filters.items())]
        if request.method == "DELETE":
            assert set(filters) == {"user_id", "id"}
            assert "return=minimal" in request.headers["prefer"]
            rows[:] = [row for row in rows if row not in matches]
            return httpx.Response(204)
        assert request.method == "GET"
        return httpx.Response(200, json=matches)

    # Exercise the installed Supabase query builder against an isolated HTTP transport.
    with httpx.Client(transport=httpx.MockTransport(database)) as transport:
        db = create_client("https://test.supabase.co", "test-key", options=ClientOptions(httpx_client=transport))
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[verify_token] = lambda: "user-1"
        client = TestClient(app)

        response = client.delete(f"/debriefs/{SAMPLE['id']}")
        assert response.status_code == 204
        assert response.content == b""
        assert {row["id"] for row in rows} == {kept_id, other_id}
        assert requests[-1].url.params["user_id"] == "eq.user-1"
        assert requests[-1].url.params["id"] == f"eq.{SAMPLE['id']}"
        assert [row["id"] for row in client.get("/debriefs").json()] == [kept_id]

        assert client.delete(f"/debriefs/{SAMPLE['id']}").status_code == 204
        assert client.delete(f"/debriefs/{other_id}").status_code == 204
        assert {row["id"] for row in rows} == {kept_id, other_id}
        app.dependency_overrides[verify_token] = lambda: "user-2"
        assert client.delete(f"/debriefs/{kept_id}").status_code == 204
        assert {row["id"] for row in rows} == {kept_id, other_id}


def test_delete_requires_authentication_and_a_valid_id():
    db = MagicMock()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    assert client.delete(f"/debriefs/{SAMPLE['id']}").status_code == 401
    app.dependency_overrides[verify_token] = lambda: "user-1"
    assert client.delete("/debriefs/not-a-uuid").status_code == 422
    db.table.assert_not_called()


def test_delete_database_failure_is_not_reported_as_success():
    db = MagicMock()
    db.table.return_value.delete.return_value.eq.return_value.eq.return_value.execute.side_effect = RuntimeError("offline")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: "user-1"
    response = TestClient(app).delete(f"/debriefs/{SAMPLE['id']}")
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
