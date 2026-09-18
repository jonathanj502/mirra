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


def complete_recording(db: Client, user_id: str, debrief_id: str, payload: dict) -> dict:
    """Save and charge once in one transaction, shared by jobs and legacy uploads."""
    try:
        return db.rpc("complete_recording", {
            "owner_id": user_id, "target_id": debrief_id,
            "payload": payload, "monthly_cap": settings.free_tier_cap,
        }).execute().data
    except APIError as exc:
        if "monthly_debrief_limit" in exc.message:
            raise HTTPException(402, "Monthly debrief limit reached") from exc
        if "recording_deleted" in exc.message:
            raise HTTPException(410, "This conversation was deleted. Discard its saved audio copy.") from exc
        raise
