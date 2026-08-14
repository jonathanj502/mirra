from datetime import datetime, timezone

from fastapi import HTTPException
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


def _adjust_count(db: Client, user_id: str, delta: int, enforce_cap: bool) -> None:
    month = _month_key()
    # ponytail: compare-and-swap retry loop instead of a DB-side atomic increment function;
    # bounded to 5 attempts, fine at this write volume, revisit if usage writes get hot
    for _ in range(5):
        row = (
            db.table("debrief_usage")
            .select("count")
            .eq("user_id", user_id)
            .eq("month_key", month)
            .maybe_single()
            .execute()
        )
        used = row.data["count"] if row and row.data else 0
        if enforce_cap and used >= settings.free_tier_cap:
            raise HTTPException(status_code=402, detail="Monthly debrief limit reached")
        new_count = max(0, used + delta)
        if row and row.data:
            result = (
                db.table("debrief_usage")
                .update({"count": new_count})
                .eq("user_id", user_id)
                .eq("month_key", month)
                .eq("count", used)
                .execute()
            )
            if result.data:
                return
            continue  # lost the race to a concurrent writer; re-read and retry
        if delta <= 0:
            return
        try:
            db.table("debrief_usage").insert({"user_id": user_id, "month_key": month, "count": new_count}).execute()
            return
        except Exception:
            continue  # someone else inserted the row first; retry as an update
    raise HTTPException(status_code=503, detail="Please try again")


def check_and_increment(db: Client, user_id: str) -> None:
    _adjust_count(db, user_id, delta=1, enforce_cap=True)


def release(db: Client, user_id: str) -> None:
    """Undo a reservation from check_and_increment when the debrief attempt fails downstream."""
    _adjust_count(db, user_id, delta=-1, enforce_cap=False)
