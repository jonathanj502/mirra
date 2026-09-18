from datetime import datetime, timezone

from fastapi import HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from app.config import settings


def _month_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _resets_at() -> str:
    now = datetime.now(timezone.utc)
    year, month = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(year, month, 1, tzinfo=timezone.utc).isoformat()


def get_usage(db: Client, user_id: str) -> dict:
    month = _month_key()
    row = (
        db.table("debrief_usage")
        .select("count")
        .eq("user_id", user_id)
        .eq("month_key", month)
        .maybe_single()
        .execute()
    )
    used = row.data["count"] if row and row.data else 0
    return {
        "used_this_month": used,
        "remaining": max(0, settings.free_tier_cap - used),
        "resets_at": _resets_at(),
    }


def _receipt_rpc(db: Client, name: str, user_id: str, debrief_id: str, attempt_id: str, **params):
    try:
        return db.rpc(name, {
            "p_user_id": user_id, "p_debrief_id": debrief_id, "p_attempt_id": attempt_id, **params,
        }).execute().data
    except APIError as exc:
        if exc.code in {"PT402", "PT409", "PT410"}:
            raise HTTPException(status_code=int(exc.code[2:]), detail=exc.message) from exc
        raise


def check_and_increment(db: Client, user_id: str, debrief_id: str, attempt_id: str) -> bool:
    """Reuse a durable reservation on retry; False means this ID already completed."""
    return _receipt_rpc(db, "reserve_debrief", user_id, debrief_id, attempt_id,
                        p_month_key=_month_key(), p_cap=settings.free_tier_cap)


def release(db: Client, user_id: str, debrief_id: str, attempt_id: str) -> None:
    """Refund only this uncommitted attempt, in its original reservation month."""
    _receipt_rpc(db, "release_debrief", user_id, debrief_id, attempt_id)


def complete_debrief(db: Client, user_id: str, debrief_id: str, attempt_id: str, payload: dict) -> dict:
    """Save the debrief and mark its charge committed in one database transaction."""
    return _receipt_rpc(db, "complete_debrief", user_id, debrief_id, attempt_id, p_debrief=payload)[0]
