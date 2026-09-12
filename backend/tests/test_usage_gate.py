from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app import usage
from app.auth import verify_token
from app.db import get_db
from app.main import app
from app.usage import check_and_increment, get_usage, release


def _db(used: int) -> MagicMock:
    db = MagicMock()
    result = MagicMock()
    result.data = {"count": used} if used > 0 else None
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = result
    return db


# --- unit tests ---

def test_get_usage_zero():
    u = get_usage(_db(0), "user-1")
    assert u == {"used_this_month": 0, "remaining": 5, "resets_at": u["resets_at"]}


def test_get_usage_partial():
    u = get_usage(_db(3), "user-1")
    assert u["used_this_month"] == 3
    assert u["remaining"] == 2


def test_get_usage_at_cap():
    u = get_usage(_db(5), "user-1")
    assert u["remaining"] == 0


def test_check_and_increment_under_cap():
    check_and_increment(_db(4), "user-1")  # should not raise


def test_check_and_increment_at_cap():
    with pytest.raises(HTTPException) as exc:
        check_and_increment(_db(5), "user-1")
    assert exc.value.status_code == 402


def test_check_and_increment_retries_on_lost_race():
    db = _db(2)
    lost = MagicMock(data=None)
    won = MagicMock(data=[{"count": 3}])
    db.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.side_effect = [lost, won]

    check_and_increment(db, "user-1")  # should not raise despite the first CAS attempt losing the race

    assert db.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.call_count == 2


def test_release_decrements_count():
    db = _db(3)
    db.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"count": 2}])

    release(db, "user-1", "2026-08")

    db.table.return_value.update.assert_called_with({"count": 2})


def test_release_is_noop_at_zero():
    db = _db(0)
    release(db, "user-1", "2026-08")  # should not raise or attempt an update
    db.table.return_value.update.assert_not_called()


def test_release_uses_reserved_month_after_rollover(monkeypatch):
    monkeypatch.setattr(usage, "_month_key", lambda: "2026-08")
    db = _db(2)
    month = check_and_increment(db, "user-1")
    assert month == "2026-08"
    monkeypatch.setattr(usage, "_month_key", lambda: "2026-09")
    db.reset_mock()

    release(db, "user-1", month)

    db.table.return_value.select.return_value.eq.return_value.eq.assert_called_with("month_key", "2026-08")
    db.table.return_value.update.return_value.eq.return_value.eq.assert_called_with("month_key", "2026-08")


def test_lost_reservation_race_rechecks_cap():
    db = _db(4)
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.side_effect = [
        MagicMock(data={"count": 4}), MagicMock(data={"count": 5}),
    ]
    db.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    with pytest.raises(HTTPException) as exc:
        check_and_increment(db, "user-1")
    assert exc.value.status_code == 402


def test_unrelated_insert_error_is_not_retried():
    db = _db(0)
    error = APIError({"code": "23503", "message": "foreign key violation", "details": None, "hint": None})
    db.table.return_value.insert.return_value.execute.side_effect = error
    with pytest.raises(APIError) as exc:
        check_and_increment(db, "user-1")
    assert exc.value is error
    assert db.table.return_value.insert.return_value.execute.call_count == 1


def test_concurrent_first_reservation_rechecks_cap():
    db = _db(0)
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.side_effect = [
        MagicMock(data=None), MagicMock(data={"count": 5}),
    ]
    db.table.return_value.insert.return_value.execute.side_effect = APIError({
        "code": "23505", "message": "duplicate key", "details": None, "hint": None,
    })
    with pytest.raises(HTTPException) as exc:
        check_and_increment(db, "user-1")
    assert exc.value.status_code == 402


# --- HTTP endpoint test ---

def test_usage_endpoint():
    app.dependency_overrides[get_db] = lambda: _db(3)
    app.dependency_overrides[verify_token] = lambda: "user-1"
    try:
        r = TestClient(app).get("/usage")
        assert r.status_code == 200
        data = r.json()
        assert data["used_this_month"] == 3
        assert data["remaining"] == 2
    finally:
        app.dependency_overrides.clear()
