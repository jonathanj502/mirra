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


@pytest.mark.parametrize("reserved", [True, False])
def test_reservation_passes_identity_and_cap_to_transaction(monkeypatch, reserved):
    monkeypatch.setattr(usage, "_month_key", lambda: "2026-09")
    db = MagicMock()
    db.rpc.return_value.execute.return_value.data = reserved
    assert check_and_increment(db, "owner", "clip", "attempt") is reserved
    db.rpc.assert_called_once_with("reserve_debrief", {
        "p_user_id": "owner", "p_debrief_id": "clip", "p_attempt_id": "attempt",
        "p_month_key": "2026-09", "p_cap": 5,
    })


def test_release_uses_receipt_identity_not_current_month():
    db = MagicMock()
    release(db, "owner", "clip", "attempt")
    db.rpc.assert_called_once_with("release_debrief", {
        "p_user_id": "owner", "p_debrief_id": "clip", "p_attempt_id": "attempt",
    })


@pytest.mark.parametrize("status", [402, 409, 410])
def test_receipt_errors_preserve_http_status(status):
    db = MagicMock()
    db.rpc.return_value.execute.side_effect = APIError({
        "code": f"PT{status}", "message": "Recording unavailable", "details": "", "hint": "",
    })
    with pytest.raises(HTTPException) as exc:
        check_and_increment(db, "owner", "clip", "attempt")
    assert exc.value.status_code == status


def test_database_failure_never_falls_back_to_a_nonatomic_reservation():
    db = MagicMock()
    db.rpc.return_value.execute.side_effect = APIError({
        "code": "PGRST202", "message": "RPC missing", "details": "", "hint": "",
    })
    with pytest.raises(APIError):
        check_and_increment(db, "owner", "clip", "attempt")
    db.table.assert_not_called()


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
