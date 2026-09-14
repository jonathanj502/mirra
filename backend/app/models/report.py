from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ContentReportRequest(BaseModel):
    source: Literal['debrief', 'reflect']
    debrief_id: UUID | None = None
    content: str = Field(min_length=1, max_length=8000)
    reason: Literal['harmful', 'inaccurate', 'other']
    comment: str = Field(default='', max_length=1000)


class ContentReport(ContentReportRequest):
    id: UUID
    created_at: datetime
