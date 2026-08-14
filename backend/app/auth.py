import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt

from app.config import settings

_bearer = HTTPBearer()
_jwks: dict | None = None


def _get_jwks() -> dict:
    # ponytail: JWKS cached until process restart; add refetch-on-unknown-kid
    # if Supabase signing-key rotation ever bites
    global _jwks
    if _jwks is None:
        response = httpx.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json",
            timeout=10,
        )
        response.raise_for_status()
        _jwks = response.json()
    return _jwks


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        jwks = _get_jwks()
    except httpx.HTTPError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Auth service unavailable")

    try:
        payload = jwt.decode(
            credentials.credentials,
            jwks,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
        )
    except ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing sub claim")

    return user_id
