from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ConversationListItem(BaseModel):
    id: UUID
    title: str
    created_at: datetime
    duration_minutes: float
    talk_listen_percent: int
    question_count: int
    interruption_count: int
    energy_score: int = 0
    lsm_score: float = 0.0
    vocabulary_richness: float = 0.0
    tone: str
    note: str


class FillerCount(BaseModel):
    phrase: str
    count: int


class ProgressWeek(BaseModel):
    week_key: str
    label: str
    starts_at: datetime
    ends_at: datetime
    conversation_count: int
    total_minutes: float
    daily_minutes: list[float] = Field(min_length=7, max_length=7)
    daily_questions: list[int] = Field(min_length=7, max_length=7)
    daily_open_questions: list[int] = Field(min_length=7, max_length=7)
    daily_closed_questions: list[int] = Field(min_length=7, max_length=7)
    daily_interruptions: list[int] = Field(min_length=7, max_length=7)
    average_session_minutes: float
    talk_listen_percent: int
    average_questions: float
    total_questions: int
    total_open_questions: int
    total_closed_questions: int
    interruption_count: int
    average_turn_offset_ms: int
    daily_turn_offsets: list[int | None] = Field(min_length=7, max_length=7)
    average_wpm: float
    energy_score: int
    energy_axes: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    lsm_average: float
    vocabulary_unique_words: int
    vocabulary_total_words: int
    vocabulary_richness: float
    top_fillers: list[FillerCount]
    wins: list[str]
    nudges: list[str]
    conversations: list[ConversationListItem]


class ProgressResponse(BaseModel):
    generated_at: datetime
    current_week_index: int
    weeks: list[ProgressWeek]


class ProfileSummary(BaseModel):
    total_conversations: int
    total_minutes: float
    average_questions: float
    talk_listen_percent: int
    used_this_month: int
    remaining: int
    resets_at: datetime


class ChatMessage(BaseModel):
    role: Literal["assistant", "user"]
    content: str = Field(min_length=1, max_length=4000)


class ReflectRequest(BaseModel):
    conversation_id: UUID | None = None
    messages: list[ChatMessage] = Field(default_factory=list, max_length=30)
    prompt: str = Field(min_length=1, max_length=1000)


class ReflectResponse(BaseModel):
    reply: str
    used_model: bool
