from fastapi import HTTPException

from app.models.settings import UserSettings

CONSENT_VERSION = "2026-09-14"


def require_ai_consent(settings: UserSettings) -> None:
    if settings.ai_consent_version != CONSENT_VERSION:
        raise HTTPException(status_code=403, detail="Review and accept AI processing in Voice & privacy before continuing.")
