from __future__ import annotations

from datetime import datetime, timezone

from supabase import Client

from app.models.settings import UserSettings, UserSettingsUpdate


def _settings_from_row(row: dict | None) -> UserSettings:
    return UserSettings(**(row or {}))


def fetch_user_settings(db: Client, user_id: str) -> UserSettings:
    result = (
        db.table("user_settings")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    data = result.data if result and isinstance(result.data, dict) else None
    return _settings_from_row(data)


def save_user_settings(db: Client, user_id: str, payload: UserSettingsUpdate) -> UserSettings:
    current = fetch_user_settings(db, user_id)
    values = payload.model_dump(exclude_none=True, exclude_unset=True)
    next_settings = current.model_copy(update=values)
    row = {
        "user_id": user_id,
        **next_settings.model_dump(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = db.table("user_settings").upsert(row).execute()
    if result and result.data:
        return _settings_from_row(result.data[0])
    return next_settings
