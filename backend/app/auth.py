import httpx
from threading import Lock
from time import monotonic
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt

from app.config import settings

_bearer = HTTPBearer()
_jwks: dict | None = None
_jwks_fetched_at = monotonic()
_jwks_lock = Lock()


def _get_jwks(kid: str | None = None) -> dict:
    global _jwks, _jwks_fetched_at
    with _jwks_lock:
        age = monotonic() - _jwks_fetched_at
        unknown_key = kid and _jwks and not any(key.get('kid') == kid for key in _jwks['keys'])
        # Refresh on rotation, rate-limited so arbitrary kids cannot hammer Supabase.
        if _jwks is not None and age < 600 and not (unknown_key and age >= 30):
            return _jwks
        response = httpx.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json",
            timeout=10,
        )
        response.raise_for_status()
        jwks = response.json()
        if (
            not isinstance(jwks, dict)
            or not isinstance(jwks.get("keys"), list)
            or not jwks["keys"]
            or not all(isinstance(key, dict) for key in jwks["keys"])
        ):
            raise ValueError("Invalid JWKS response")
        _jwks = jwks
        _jwks_fetched_at = monotonic()
    return _jwks


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        header = jwt.get_unverified_header(credentials.credentials)
        if header.get('alg') != 'ES256':
            raise JWTError('Unsupported signing algorithm')
    except JWTError as exc:
        raise HTTPException(status_code=401, detail='Invalid token') from exc
    try:
        jwks = _get_jwks(header.get('kid'))
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Auth service unavailable") from exc

    try:
        payload = jwt.decode(
            credentials.credentials,
            jwks,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
            options={"require_exp": True, "require_aud": True, "require_iss": True},
        )
    except ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing sub claim")

    return user_id
