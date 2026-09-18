from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class ConversationStats(BaseModel):
    talk_listen_ratio: float
    question_count: int
    open_question_count: int = 0
    closed_question_count: int = 0
    interruption_count: int
    average_turn_offset_ms: int = 0
    turn_offset_series: list[dict[str, Any]] = Field(default_factory=list)
    session_duration_minutes: float
    user_speech_duration_minutes: float
    other_speech_duration_minutes: float | None = None
    estimated_wpm: float
    other_estimated_wpm: float | None = None
    user_volume_dbfs: float | None = None
    other_volume_dbfs: float | None = None
    user_pitch_hz: float | None = None
    other_pitch_hz: float | None = None
    energy_score: int = 0
    energy_axes: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    energy_series_user: list[float] = Field(default_factory=list)
    energy_series_other: list[float] = Field(default_factory=list)
    lsm_score: float = 0.0
    lsm_dimensions_user: dict[str, float] = Field(default_factory=dict)
    lsm_dimensions_reference: dict[str, float] = Field(default_factory=dict)
    total_word_count: int = 0
    unique_word_count: int = 0
    repeated_words: list[dict[str, Any]] | None = None
    vocabulary_richness: float = 0.0
    filler_counts: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class Debrief(BaseModel):
    id: UUID
    session_id: str
    user_id: str
    created_at: datetime
    observation: str
    pattern_to_reduce: str
    thing_to_try_next: str
    stats: ConversationStats
    transcript: str | None = None


class SessionResponse(BaseModel):
    debrief: Debrief
    used_this_month: int
    remaining: int
