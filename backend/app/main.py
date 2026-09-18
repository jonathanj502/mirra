import logging
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Lock, BoundedSemaphore
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import httpx
from jose import JWTError, jwt
from supabase import Client

from app.auth import verify_token
from app.config import settings
from app.dashboard import build_profile_summary, build_progress, enrich_debrief_row, fallback_reflection
from app.db import get_db
from app.models.account import AccountExport
from app.models.auth import UsernameAuthRequest, UsernameAuthResponse
from app.models.dashboard import ProfileSummary, ProgressResponse, ReflectRequest, ReflectResponse
from app.models.debrief import Debrief, SessionResponse
from app.models.settings import UserSettings, UserSettingsUpdate
from app.reflection import generate_reflection
from app.rate_limit import check_reflect_limit
from app.pipeline import coordinator
from app.pipeline.transcription import TranscriptionInputTooLarge
from app.recording_jobs import RecordingJobs, RecordingUpload, recording_key, UPLOAD_CHUNK_BYTES, SUPPORTED_AUDIO_TYPES
from app.usage import complete_recording, get_usage
from app.user_settings import fetch_user_settings, save_user_settings

recording_jobs = RecordingJobs(settings.recording_storage_dir)


@asynccontextmanager
async def lifespan(_app):
    recording_jobs.start(_run_recording_job)
    yield
    recording_jobs.stop()


app = FastAPI(title="Mirra Backend", lifespan=lifespan)

USERNAME_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_")

logger = logging.getLogger(__name__)

_session_lock = Lock()
_processing_sessions: set[str] = set()
# Silero's shared model has mutable inference state. Serialize processing to keep it correct
# and bound decoded-audio memory; the durable app queue retries a busy server automatically.
_pipeline_slot = BoundedSemaphore(1)


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
    except Exception as exc:
        # Provider/validation exception messages can contain conversation content. Keep stack
        # locations and the exception type, never its message, body or request credentials.
        logger.error("Unhandled %s on %s %s\n%s", type(exc).__name__, request.method, request.url.path,
                     ''.join(traceback.format_tb(exc.__traceback__)))
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    # Auth is Bearer-token only, never cookies, so there's nothing that needs a credentialed
    # CORS request; keeping this False means a wildcard origin can't be paired with reflected
    # credentials (Starlette would otherwise echo the caller's Origin back).
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get('/ready')
def ready(db: Client = Depends(get_db)):
    try:
        if not settings.openai_api_key:
            raise ValueError('Missing AI credential')
        db.table('debrief_deletions').select('debrief_id').limit(0).execute()
        db.table('user_settings').select('coaching_goal').limit(0).execute()
        if not db.rpc('recording_uploads_ready').execute().data:
            raise ValueError('Missing long-recording migration')
    except Exception:
        return JSONResponse(status_code=503, content={'status': 'not_ready'})
    return {'status': 'ready'}


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
    rows = []
    while True:
        page = _fetch_debrief_rows(db, user_id, limit=500, offset=len(rows))
        rows.extend(page)
        if len(page) < 500:
            break
    deleted_ids = []
    while True:
        markers = db.table('debrief_deletions').select('debrief_id').eq('user_id', user_id).order('debrief_id').range(len(deleted_ids), len(deleted_ids) + 499).execute().data or []
        deleted_ids.extend(row['debrief_id'] for row in markers)
        if len(markers) < 500:
            break
    return AccountExport(
        exported_at=datetime.now(timezone.utc),
        user_id=user_id,
        profile=build_profile_summary(rows, get_usage(db, user_id)),
        settings=fetch_user_settings(db, user_id),
        debriefs=rows,
        deleted_conversation_ids=deleted_ids,
        pending_recordings=recording_jobs.export(user_id),
    )


@app.delete("/account", status_code=204)
def delete_account(user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    # Auth deletion cascades to debriefs, usage, and settings via their foreign keys.
    with recording_jobs.lock:
        try:
            db.auth.admin.delete_user(user_id)
        except Exception as exc:
            if str(getattr(exc, "status", "")) != "404":
                raise
        recording_jobs.remove_user(user_id)
    return Response(status_code=204)


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
    started_at: str | None = Form(None, max_length=100),
    client_duration_seconds: float | None = Form(None, ge=0, le=86400),
    title: str | None = Form(None, max_length=200),
    recording_id: str | None = Form(None, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$"),
    user_id: str = Depends(verify_token),
    db: Client = Depends(get_db),
):
    # Account-scoped deterministic IDs use the existing primary key for durable duplicate protection.
    debrief_id = str(uuid5(NAMESPACE_URL, f"mirra:{user_id}:{recording_id}")) if recording_id else str(uuid4())
    if debrief_id:
        # ponytail: this suppresses duplicate model work within one process. Across workers the DB
        # primary key still prevents duplicate debriefs; add a DB job lease if scaling workers.
        with _session_lock:
            if debrief_id in _processing_sessions:
                raise HTTPException(status_code=409, detail="This recording is already being processed.")
            _processing_sessions.add(debrief_id)
    try:
        existing = _recording_result(db, user_id, debrief_id)
        if existing:
            return existing
        if not _pipeline_slot.acquire(blocking=False):
            raise HTTPException(status_code=503, detail='Mirra is processing another recording. Your saved recording will upload automatically.', headers={'Retry-After': '60'})
        try:
            return _process_session(audio, started_at, client_duration_seconds, title, user_id, db, debrief_id)
        finally:
            _pipeline_slot.release()
    finally:
        if debrief_id:
            with _session_lock:
                _processing_sessions.discard(debrief_id)


def _session_response(db: Client, user_id: str, row: dict):
    usage = get_usage(db, user_id)
    return {"debrief": row, "used_this_month": usage["used_this_month"], "remaining": usage["remaining"]}


def _process_session(audio, started_at, client_duration_seconds, title, user_id, db, debrief_id):
    if debrief_id:
        deleted = db.table('debrief_deletions').select('debrief_id').eq('user_id', user_id).eq('debrief_id', debrief_id).maybe_single().execute()
        if deleted and isinstance(deleted.data, dict) and deleted.data.get('debrief_id') == debrief_id:
            raise HTTPException(410, 'This conversation was deleted. Discard its saved audio copy.')
        existing = _fetch_debrief_row(db, user_id, debrief_id)
        if existing:
            return _session_response(db, user_id, existing)
    content_type = (audio.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in SUPPORTED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio type")

    audio.file.seek(0, 2)
    if audio.file.tell() > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file is too large")
    if audio.file.tell() == 0:
        raise HTTPException(422, "The audio file is empty. Choose a nonempty audio file.")
    audio.file.seek(0)

    if get_usage(db, user_id)['remaining'] <= 0:
        raise HTTPException(402, 'Monthly debrief limit reached')
    user_settings = fetch_user_settings(db, user_id)
    try:
        result = coordinator.run(audio.file, content_type=content_type, coaching_goal=user_settings.coaching_goal)
    except (TranscriptionInputTooLarge, coordinator.AudioDurationTooLong) as exc:
        raise HTTPException(413, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, 'Could not decode audio') from exc
    metadata = {
        "started_at": started_at, "client_duration_seconds": client_duration_seconds,
        "original_filename": audio.filename, "content_type": content_type, "title": title,
        "coaching_goal": user_settings.coaching_goal,
    }
    payload = {**result, "session_id": str(uuid4()),
               "transcript": result["transcript"] if fetch_user_settings(db, user_id).save_transcripts else None,
               "stats": {**result["stats"], "metadata": {
                   **result["stats"].get("metadata", {}),
                   **{k: v for k, v in metadata.items() if v is not None},
               }}}
    row = complete_recording(db, user_id, debrief_id, payload)
    return _session_response(db, user_id, row)


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


@app.delete("/debriefs/{debrief_id}", status_code=204)
def delete_debrief(
    debrief_id: UUID,
    user_id: str = Depends(verify_token),
    db: Client = Depends(get_db),
):
    # Scope the mutation itself: service-role access bypasses database RLS.
    db.rpc('delete_debrief_permanently', {'owner_id': user_id, 'target_id': str(debrief_id)}).execute()
    recording_jobs.cancel(user_id, str(debrief_id))
    return Response(status_code=204)


def _recording_result(db, user_id, key):
    deleted = db.table('debrief_deletions').select('debrief_id').eq('user_id', user_id).eq('debrief_id', key).maybe_single().execute()
    if deleted and isinstance(deleted.data, dict) and deleted.data.get('debrief_id') == key:
        raise HTTPException(410, 'This conversation was deleted. Discard its saved audio copy.')
    row = _fetch_debrief_row(db, user_id, key)
    return {"status": "completed", **_session_response(db, user_id, row)} if row else None


@app.post('/recordings')
def start_recording_upload(payload: RecordingUpload, user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    completed = _recording_result(db, user_id, recording_key(user_id, payload.recording_id))
    if completed:
        return completed
    if get_usage(db, user_id)['remaining'] <= 0:
        raise HTTPException(402, 'Monthly debrief limit reached')
    with recording_jobs.lock:
        # A signed JWT can outlive account deletion. Do not recreate server audio for it.
        try:
            account = db.auth.admin.get_user_by_id(user_id)
        except Exception as exc:
            if str(getattr(exc, 'status', '')) == '404':
                raise HTTPException(401, 'This account is no longer available.') from exc
            raise
        if not account.user or account.user.id != user_id:
            raise HTTPException(401, 'This account is no longer available.')
        return recording_jobs.create(user_id, payload)


@app.get('/recordings/{recording_id}')
def recording_status(recording_id: str, user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    key = recording_key(user_id, recording_id)
    return _recording_result(db, user_id, key) or recording_jobs.status(user_id, key)


@app.put('/recordings/{recording_id}/audio')
async def upload_recording_chunk(recording_id: str, request: Request, offset: int = Query(ge=0), user_id: str = Depends(verify_token)):
    # Authenticate before reading a bounded body. Byte offsets make lost acknowledgements resumable.
    key = recording_key(user_id, recording_id)
    await run_in_threadpool(recording_jobs.status, user_id, key)
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > UPLOAD_CHUNK_BYTES:
            raise HTTPException(413, 'Audio upload chunk is too large')
        data.extend(chunk)
    return await run_in_threadpool(recording_jobs.append, user_id, key, offset, data)


@app.post('/recordings/{recording_id}/complete')
def finish_recording_upload(recording_id: str, user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    key = recording_key(user_id, recording_id)
    return _recording_result(db, user_id, key) or recording_jobs.enqueue(user_id, key)


@app.delete('/recordings/{recording_id}', status_code=204)
def discard_recording(recording_id: str, user_id: str = Depends(verify_token), db: Client = Depends(get_db)):
    key = recording_key(user_id, recording_id)
    db.rpc('delete_debrief_permanently', {'owner_id': user_id, 'target_id': key}).execute()
    recording_jobs.cancel(user_id, key)
    return Response(status_code=204)


def _run_recording_job(job, path, progress):
    db = get_db()
    user_id, key = job['user_id'], job['id']
    with _pipeline_slot:
        if _recording_result(db, user_id, key):
            return
        if get_usage(db, user_id)['remaining'] <= 0:
            raise HTTPException(402, 'Monthly debrief limit reached')
        # Auth tokens can expire while a job runs. Work is bound to its authenticated upload owner.
        user_settings = fetch_user_settings(db, user_id)
        try:
            result = coordinator.run(path, content_type=job['content_type'], coaching_goal=user_settings.coaching_goal, progress=progress)
        except coordinator.AudioDurationTooLong as exc:
            raise HTTPException(413, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, 'Could not decode audio') from exc
        progress(100)  # Recheck cancellation before committing.
        metadata = {k: job[k] for k in ('started_at', 'client_duration_seconds', 'title', 'content_type') if job.get(k) is not None}
        metadata.update(original_filename=job['filename'], coaching_goal=user_settings.coaching_goal)
        save_transcripts = fetch_user_settings(db, user_id).save_transcripts
        payload = {**result, 'session_id': str(uuid4()),
                   'transcript': result['transcript'] if save_transcripts else None,
                   'stats': {**result['stats'], 'metadata': {**result['stats'].get('metadata', {}), **metadata}}}
        complete_recording(db, user_id, key, payload)


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
    check_reflect_limit(user_id)
    text = generate_reflection(
        rows,
        payload,
        coaching_tone=user_settings.coaching_tone,
        coaching_depth=user_settings.coaching_depth,
        include_transcript=user_settings.include_transcript_in_reflect,
        coaching_goal=user_settings.coaching_goal,
    )
    if text:
        return {"reply": text, "used_model": True}

    return {"reply": fallback_reflection(rows, payload.prompt), "used_model": False}
