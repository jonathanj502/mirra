import time

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwk, jwt

import app.auth
from app.auth import verify_token
from app.config import settings

_app = FastAPI()

@_app.get("/me")
def _me(user_id: str = Depends(verify_token)):
    return {"user_id": user_id}

client = TestClient(_app)


def _keypair() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_pem, public_pem


PRIVATE_PEM, PUBLIC_PEM = _keypair()
WRONG_PRIVATE_PEM, _ = _keypair()

# Pre-fill the module-level JWKS cache so no network fetch happens in tests.
app.auth._jwks = {"keys": [jwk.construct(PUBLIC_PEM, "ES256").to_dict()]}


ISSUER = f"{settings.supabase_url.rstrip('/')}/auth/v1"


def _token(payload: dict, key: str = PRIVATE_PEM) -> str:
    return jwt.encode({"aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 300, **payload}, key, algorithm="ES256")


def test_valid_token():
    r = client.get("/me", headers={"Authorization": f"Bearer {_token({'sub': 'user-123'})}"})
    assert r.status_code == 200
    assert r.json() == {"user_id": "user-123"}


def test_missing_header():
    assert client.get("/me").status_code == 401


def test_malformed_token():
    r = client.get("/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401


def test_expired_token():
    token = _token({"sub": "user-123", "exp": int(time.time()) - 10})
    r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_wrong_key():
    token = _token({"sub": "user-123"}, key=WRONG_PRIVATE_PEM)
    r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_wrong_audience():
    token = _token({"sub": "user-123", "aud": "anon"})
    r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_missing_sub():
    token = _token({"uid": "user-123"})
    r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_wrong_issuer():
    token = _token({"sub": "user-123", "iss": "https://evil.example/auth/v1"})
    r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


@pytest.mark.parametrize("claim", ["aud", "iss", "exp"])
def test_required_claim_cannot_be_omitted(claim):
    payload = {"sub": "user-123", "aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 300}
    del payload[claim]
    token = jwt.encode(payload, PRIVATE_PEM, algorithm="ES256")
    r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


@pytest.mark.parametrize("body", [b"not json", b"null", b'{"keys": []}', b'{"keys": "invalid"}'])
def test_unusable_jwks_returns_503_without_caching(monkeypatch, body):
    monkeypatch.setattr(app.auth, "_jwks", None)
    monkeypatch.setattr(httpx, "get", lambda *_args, **_kwargs: httpx.Response(
        200, content=body, request=httpx.Request("GET", "https://test.supabase.co/jwks"),
    ))
    r = client.get("/me", headers={"Authorization": f"Bearer {_token({'sub': 'user-123'})}"})
    assert r.status_code == 503
    assert app.auth._jwks is None


def test_jwks_network_failure_returns_503(monkeypatch):
    monkeypatch.setattr(app.auth, "_jwks", None)

    def unavailable(*_args, **_kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx, "get", unavailable)
    r = client.get("/me", headers={"Authorization": f"Bearer {_token({'sub': 'user-123'})}"})
    assert r.status_code == 503


def test_jwks_rotation_refresh_is_bounded(monkeypatch):
    monkeypatch.setattr(app.auth, '_jwks', {'keys': [{'kid': 'old'}]})
    monkeypatch.setattr(app.auth, '_jwks_fetched_at', 100)
    monkeypatch.setattr(app.auth, 'monotonic', lambda: 131)
    calls = []
    def rotated(*args, **kwargs):
        calls.append(1)
        return httpx.Response(200, json={'keys': [{'kid': 'new'}]}, request=httpx.Request('GET', 'https://test.invalid'))
    monkeypatch.setattr(httpx, 'get', rotated)
    assert app.auth._get_jwks('new')['keys'][0]['kid'] == 'new'
    app.auth._get_jwks('random-attacker-kid')
    assert len(calls) == 1
