from dataclasses import dataclass

from fastapi.testclient import TestClient

from app.auth import verify_token
from app.db import get_db
from app.main import app


@dataclass
class _Result:
    data: object


class _SettingsTable:
    def __init__(self, db: "_Db"):
        self.db = db

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        return self

    def upsert(self, row: dict):
        self.db.last_patch = row
        self.db.row = {**(self.db.row or {}), **row}
        self._upserted = self.db.row
        return self

    def execute(self):
        if hasattr(self, "_upserted"):
            return _Result([self._upserted])
        return _Result(self.db.row)


class _Db:
    def __init__(self, row: dict | None = None):
        self.row = row

    def table(self, name: str):
        assert name == "user_settings"
        return _SettingsTable(self)


def _client(db: _Db) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: "user-1"
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_get_settings_returns_defaults_when_missing():
    r = _client(_Db()).get("/settings")
    assert r.status_code == 200
    assert r.json()["notifications_enabled"] is False
    assert r.json()["coaching_tone"] == "warm_reflective"


def test_patch_settings_upserts_user_preferences():
    db = _Db()
    r = _client(db).patch(
        "/settings",
        json={
            "notifications_enabled": False,
            "weekly_summary_day": "wednesday",
            "weekly_summary_time": "night",
            "coaching_tone": "direct_practical",
            "include_transcript_in_reflect": True,
        },
    )
    assert r.status_code == 200
    assert r.json()["notifications_enabled"] is False
    assert r.json()["weekly_summary_day"] == "wednesday"
    assert r.json()["weekly_summary_time"] == "night"
    assert r.json()["coaching_tone"] == "direct_practical"
    assert db.row["user_id"] == "user-1"
    assert db.row["weekly_summary_day"] == "wednesday"
    assert db.row["weekly_summary_time"] == "night"
    assert db.row["include_transcript_in_reflect"] is True


def test_patch_settings_rejects_unknown_option():
    r = _client(_Db()).patch("/settings", json={"coaching_tone": "mean"})
    assert r.status_code == 422


def test_coaching_update_does_not_overwrite_consent_or_transcript_preferences():
    db = _Db({'ai_consent_version': '', 'save_transcripts': False})
    response = _client(db).patch('/settings', json={'coaching_depth': 'deep'})
    assert response.status_code == 200
    assert 'ai_consent_version' not in db.last_patch
    assert 'save_transcripts' not in db.last_patch
    assert response.json()['ai_consent_version'] == ''


def test_consent_has_server_timestamp_and_withdrawal_clears_it():
    db = _Db()
    client = _client(db)
    response = client.patch('/settings', json={'ai_consent_version': '2026-09-14'})
    assert response.status_code == 200
    assert response.json()['ai_consent_at']
    assert client.patch('/settings', json={'ai_consent_version': '', 'ai_consent_at': 'forged'}).status_code == 422
    response = client.patch('/settings', json={'ai_consent_version': ''})
    assert response.json()['ai_consent_at'] is None
