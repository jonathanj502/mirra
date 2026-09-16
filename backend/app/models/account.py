from datetime import datetime

from pydantic import BaseModel, Field

from app.models.dashboard import ProfileSummary
from app.models.debrief import Debrief
from app.models.settings import UserSettings


class AccountExport(BaseModel):
    exported_at: datetime
    user_id: str
    profile: ProfileSummary
    settings: UserSettings
    debriefs: list[Debrief]
    deleted_conversation_ids: list[str]
    pending_recordings: list[dict] = Field(default_factory=list)
