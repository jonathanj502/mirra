from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from jose import jwt

from app.main import app


SESSION = {
    "access_token": "access-token",
    "refresh_token": "refresh-token",
    "expires_in": 3600,
    "token_type": "bearer",
    "user": {"id": "user-1", "user_metadata": {"username": "maya"}},
}

SERVICE_ROLE_KEY = jwt.encode({"role": "service_role"}, "secret", algorithm="HS256")


def _response(status_code: int, body: dict | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = body or {}
    return response


def test_username_sign_up_creates_confirmed_internal_user_and_returns_session():
    with patch("app.main.httpx.post") as post:
        post.side_effect = [_response(200, {"id": "user-1"}), _response(200, SESSION)]

        r = TestClient(app).post(
            "/auth/username/sign-up",
            json={"username": " Maya_1 ", "password": "secret123"},
        )

    assert r.status_code == 200
    assert r.json()["access_token"] == "access-token"
    create_call = post.call_args_list[0]
    assert create_call.kwargs["json"] == {
        "email": "maya_1@users.mirra.local",
        "password": "secret123",
        "email_confirm": True,
        "user_metadata": {"username": "maya_1"},
    }


def test_username_sign_up_rejects_invalid_username():
    r = TestClient(app).post(
        "/auth/username/sign-up",
        json={"username": "bad-name", "password": "secret123"},
    )
    assert r.status_code == 422


def test_username_sign_up_reports_missing_service_role_key():
    with patch("app.main.httpx.post", return_value=_response(403)):
        r = TestClient(app).post(
            "/auth/username/sign-up",
            json={"username": "maya", "password": "secret123"},
        )
    assert r.status_code == 503
    assert r.json()["detail"] == "Supabase service-role key is required for username sign-up"


def test_username_sign_up_reports_taken_username():
    with patch("app.main.httpx.post", return_value=_response(422)):
        r = TestClient(app).post(
            "/auth/username/sign-up",
            json={"username": "maya", "password": "secret123"},
        )
    assert r.status_code == 409
    assert r.json()["detail"] == "Username is already taken"


def test_username_sign_in_exchanges_internal_email_for_session():
    with patch("app.main.httpx.post", return_value=_response(200, SESSION)) as post:
        r = TestClient(app).post(
            "/auth/username/sign-in",
            json={"username": "Maya", "password": "secret123"},
        )

    assert r.status_code == 200
    assert r.json()["refresh_token"] == "refresh-token"
    assert post.call_args.kwargs["json"] == {
        "email": "maya@users.mirra.local",
        "password": "secret123",
    }


def test_username_sign_in_rejects_bad_credentials():
    with patch("app.main.httpx.post", return_value=_response(400)):
        r = TestClient(app).post(
            "/auth/username/sign-in",
            json={"username": "maya", "password": "wrong123"},
        )
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid username or password"


def test_auth_status_reports_google_and_username_readiness(monkeypatch):
    monkeypatch.setattr("app.main.settings.supabase_service_role_key", SERVICE_ROLE_KEY)
    settings = {
        "external": {"email": True, "google": True},
        "disable_signup": False,
    }
    with patch("app.main.httpx.get", return_value=_response(200, settings)):
        r = TestClient(app).get("/auth/status")

    assert r.status_code == 200
    assert r.json() == {
        "username_password_ready": True,
        "google_enabled": True,
        "email_enabled": True,
        "signup_disabled": False,
    }


def test_auth_status_reports_missing_service_role_key(monkeypatch):
    monkeypatch.setattr("app.main.settings.supabase_service_role_key", "not-a-jwt")
    with patch("app.main.httpx.get", return_value=_response(200, {"external": {"google": False}})):
        r = TestClient(app).get("/auth/status")

    assert r.status_code == 200
    assert r.json()["username_password_ready"] is False
    assert r.json()["google_enabled"] is False


def test_auth_status_accepts_modern_secret_key(monkeypatch):
    monkeypatch.setattr("app.main.settings.supabase_service_role_key", "sb_secret_example")
    with patch("app.main.httpx.get", return_value=_response(200, {"external": {"google": False}})):
        r = TestClient(app).get("/auth/status")

    assert r.status_code == 200
    assert r.json()["username_password_ready"] is True
