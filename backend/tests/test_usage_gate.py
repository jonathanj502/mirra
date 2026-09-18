from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app import usage
from app.auth import verify_token
from app.db import get_db
from app.main import app
from app.usage import complete_recording, get_usage


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


def test_completion_passes_owner_cap_and_payload_to_single_transaction():
    db = MagicMock()
    db.rpc.return_value.execute.return_value.data = {"id": "clip"}
    assert complete_recording(db, "owner", "clip", {"stats": {}}) == {"id": "clip"}
    db.rpc.assert_called_once_with("complete_recording", {
        "owner_id": "owner", "target_id": "clip", "payload": {"stats": {}}, "monthly_cap": 5,
    })


@pytest.mark.parametrize("message,status", [("monthly_debrief_limit", 402), ("recording_deleted", 410)])
def test_atomic_completion_errors_preserve_http_status(message, status):
    db = MagicMock()
    db.rpc.return_value.execute.side_effect = APIError({"code": "P0001", "message": message, "details": "", "hint": ""})
    with pytest.raises(HTTPException) as error:
        complete_recording(db, "owner", "clip", {})
    assert error.value.status_code == status


def test_database_failure_never_falls_back_to_nonatomic_accounting():
    db = MagicMock()
    db.rpc.return_value.execute.side_effect = APIError({"code": "PGRST202", "message": "RPC missing", "details": "", "hint": ""})
    with pytest.raises(APIError):
        complete_recording(db, "owner", "clip", {})
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
