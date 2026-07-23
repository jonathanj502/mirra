import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
from jose import JWTError, jwt
from supabase import Client

from app.auth import verify_token
from app.billing import (
    create_checkout_session,
    create_portal_session,
    fetch_billing_status,
    handle_stripe_webhook,
    user_has_pro_access,
)
from app.config import settings
from app.dashboard import build_profile_summary, build_progress, enrich_debrief_row, fallback_reflection
from app.db import get_db
from app.models.account import AccountExport
from app.models.auth import UsernameAuthRequest, UsernameAuthResponse
from app.models.billing import BillingSessionResponse, BillingStatus, StripeWebhookResponse
from app.models.dashboard import ProfileSummary, ProgressResponse, ReflectRequest, ReflectResponse
from app.models.debrief import Debrief, SessionResponse
from app.models.settings import UserSettings, UserSettingsUpdate
from app.open_model import generate_open_model_reflection
from app.pipeline import coordinator
from app.usage import check_and_increment, get_usage
from app.user_settings import fetch_user_settings, save_user_settings

app = FastAPI(title="Mirra Backend")

MAX_AUDIO_BYTES = 25 * 1024 * 1024
SUPPORTED_AUDIO_TYPES = {
    "audio/aac",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/x-m4a",
    "audio/x-wav",
    "audio/webm",
}

USERNAME_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_")

logger = logging.getLogger(__name__)


# Starlette's default 500 handler returns a plain-text body, which breaks clients that assume
# every response is JSON (e.g. the app's parseResponse). Route unhandled exceptions through JSON too.
#
# This has to be HTTP middleware, not @app.exception_handler(Exception): Starlette routes the
# Exception/500 handler key to ServerErrorMiddleware, which always sits outermost, outside
# CORSMiddleware, so a JSONResponse returned from there would skip CORS header injection and get
# blocked by browsers. Starlette's add_middleware() prepends (each new call becomes the new
# outermost layer), so registering this middleware *before* CORSMiddleware puts CORS on the
# outside, letting its response pass back through CORSMiddleware's header injection normally.
@app.middleware("http")
async def catch_unhandled_exceptions(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


def _service_role_key_configured() -> bool:
    if settings.supabase_service_role_key.startswith("sb_secret_"):
        return True
    try:
        claims = jwt.get_unverified_claims(settings.supabase_service_role_key)
    except JWTError:
        return False
    return claims.get("role") == "service_role"


def _auth_provider_settings() -> dict:
    try:
        response = httpx.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/settings",
            headers={"apikey": settings.supabase_service_role_key},
            timeout=10,
        )
    except httpx.HTTPError:
        return {}
    if response.status_code >= 400:
        return {}
    return response.json()


@app.get("/auth/status")
def auth_status():
    provider_settings = _auth_provider_settings()
    external = provider_settings.get("external", {})
    return {
        "username_password_ready": _service_role_key_configured(),
        "google_enabled": bool(external.get("google")),
        "email_enabled": bool(external.get("email")),
        "signup_disabled": bool(provider_settings.get("disable_signup", False)),
    }


def _normalize_username(username: str) -> str:
    value = username.strip().lower()
    if len(value) < 3 or len(value) > 24 or any(ch not in USERNAME_CHARS for ch in value):
        raise HTTPException(
            status_code=422,
            detail="Username must be 3-24 characters and use only letters, numbers, or underscores",
        )
    return value


def _username_email(username: str) -> str:
    return f"{username}@users.mirra.local"


async def _password_token(email: str, password: str) -> dict:
    response = httpx.post(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/token?grant_type=password",
        headers={
            "apikey": settings.supabase_service_role_key,
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
        timeout=15,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return response.json()


def _fetch_debrief_rows(db: Client, user_id: str, limit: int = 100, offset: int = 0) -> list[dict]:
    result = (
        db.table("debriefs")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return [enrich_debrief_row(row) for row in (result.data or [])]


def _fetch_debrief_row(db: Client, user_id: str, debrief_id: str) -> dict | None:
    result = (
        db.table("debriefs")
        .select("*")
        .eq("user_id", user_id)
        .eq("id", debrief_id)
        .maybe_single()
        .execute()
    )
    return enrich_debrief_row(result.data) if result and result.data else None


# TODO: sign-up has no real email today (fabricates <username>@users.mirra.local, no
# verification). Tighten before wider launch: add a required, verified email field so
# accounts are recoverable and can't be thrown away in one curl call. Decide whether
# username stays as the login handle or is replaced by email+password outright.
@app.post("/auth/username/sign-up", response_model=UsernameAuthResponse)
async def username_sign_up(payload: UsernameAuthRequest):
    username = _normalize_username(payload.username)
    email = _username_email(username)
    response = httpx.post(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
        headers={
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "Content-Type": "application/json",
        },
        json={
            "email": email,
            "password": payload.password,
            "email_confirm": True,
            "user_metadata": {"username": username},
        },
        timeout=15,
    )
    if response.status_code in {401, 403}:
        raise HTTPException(status_code=503, detail="Supabase service-role key is required for username sign-up")
    if response.status_code == 422:
        raise HTTPException(status_code=409, detail="Username is already taken")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Could not create account")
    return await _password_token(email, payload.password)


@app.post("/auth/username/sign-in", response_model=UsernameAuthResponse)
async def username_sign_in(payload: UsernameAuthRequest):
    username = _normalize_username(payload.username)
    return await _password_token(_username_email(username), payload.password)


@app.get("/usage")
def usage(user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    return get_usage(db, user_id)


@app.get("/profile/summary", response_model=ProfileSummary)
def profile_summary(user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    rows = _fetch_debrief_rows(db, user_id, limit=500)
    return build_profile_summary(rows, get_usage(db, user_id))


@app.get("/account/export", response_model=AccountExport)
def account_export(user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    rows = _fetch_debrief_rows(db, user_id, limit=500)
    return AccountExport(
        exported_at=datetime.now(timezone.utc),
        user_id=user_id,
        profile=build_profile_summary(rows, get_usage(db, user_id)),
        settings=fetch_user_settings(db, user_id),
        billing=fetch_billing_status(db, user_id),
        debriefs=rows,
    )


@app.get("/settings", response_model=UserSettings)
def get_settings(user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    return fetch_user_settings(db, user_id)


@app.patch("/settings", response_model=UserSettings)
def update_settings(
    payload: UserSettingsUpdate,
    user_id: str = Depends(verify_token),
    db: Client = Depends(get_db),
):
    return save_user_settings(db, user_id, payload)


@app.get("/billing/status", response_model=BillingStatus)
def billing_status(user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    return fetch_billing_status(db, user_id)


@app.post("/billing/checkout", response_model=BillingSessionResponse)
def billing_checkout(user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    return create_checkout_session(db, user_id)


@app.post("/billing/portal", response_model=BillingSessionResponse)
def billing_portal(user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    return create_portal_session(db, user_id)


@app.post("/billing/webhook", response_model=StripeWebhookResponse)
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(None),
    db: Client = Depends(get_db),
):
    payload = await request.body()
    return handle_stripe_webhook(db, payload, stripe_signature)


@app.get("/analytics/progress", response_model=ProgressResponse)
def progress_summary(
    weeks: int = Query(8, ge=1, le=26),
    user_id: str = Depends(verify_token),
    db: Client = Depends(get_db),
):
    rows = _fetch_debrief_rows(db, user_id, limit=500)
    return build_progress(rows, max_weeks=weeks)


@app.post("/sessions", response_model=SessionResponse)
def create_session(
    audio: UploadFile = File(...),
    started_at: str | None = Form(None),
    client_duration_seconds: float | None = Form(None),
    title: str | None = Form(None),
    user_id: str = Depends(verify_token),
    db: Client = Depends(get_db),
):
    if audio.content_type and audio.content_type not in SUPPORTED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio type")

    audio_bytes = audio.file.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file is too large")

    if not user_has_pro_access(db, user_id):
        # ponytail: charged on attempt not success; race window OK at 5/month cap
        check_and_increment(db, user_id)
    user_settings = fetch_user_settings(db, user_id)
    try:
        result = coordinator.run(audio_bytes, content_type=audio.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Could not decode audio") from exc
    session_id = str(uuid4())
    metadata = {
        "started_at": started_at,
        "client_duration_seconds": client_duration_seconds,
        "title": title,
        "original_filename": audio.filename,
        "content_type": audio.content_type,
    }
    stats = {**result["stats"], "metadata": {k: v for k, v in metadata.items() if v is not None}}
    row = (
        db.table("debriefs")
        .insert(
            {
                "user_id": user_id,
                "session_id": session_id,
                "observation": result["observation"],
                "pattern_to_reduce": result["pattern_to_reduce"],
                "thing_to_try_next": result["thing_to_try_next"],
                "stats": stats,
                "transcript": result["transcript"] if user_settings.save_transcripts else None,
            }
        )
        .execute()
    )
    usage = get_usage(db, user_id)
    return {"debrief": row.data[0], "used_this_month": usage["used_this_month"], "remaining": usage["remaining"]}


@app.get("/debriefs", response_model=list[Debrief])
def debriefs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: str = Depends(verify_token),
    db: Client = Depends(get_db),
):
    return _fetch_debrief_rows(db, user_id, limit=limit, offset=offset)


@app.get("/debriefs/{debrief_id}", response_model=Debrief)
def debrief_detail(
    debrief_id: str,
    user_id: str = Depends(verify_token),
    db: Client = Depends(get_db),
):
    row = _fetch_debrief_row(db, user_id, debrief_id)
    if not row:
        raise HTTPException(status_code=404, detail="Debrief not found")
    return row


@app.post("/reflect", response_model=ReflectResponse)
def reflect(
    payload: ReflectRequest,
    user_id: str = Depends(verify_token),
    db: Client = Depends(get_db),
):
    if payload.conversation_id:
        row = _fetch_debrief_row(db, user_id, str(payload.conversation_id))
        if not row:
            raise HTTPException(status_code=404, detail="Debrief not found")
        rows = [row]
    else:
        rows = _fetch_debrief_rows(db, user_id, limit=1)

    user_settings = fetch_user_settings(db, user_id)
    text = generate_open_model_reflection(
        rows,
        payload,
        coaching_tone=user_settings.coaching_tone,
        coaching_depth=user_settings.coaching_depth,
        include_transcript=user_settings.include_transcript_in_reflect,
    )
    if text:
        return {"reply": text, "used_model": True}

    return {"reply": fallback_reflection(rows, payload.prompt), "used_model": False}
