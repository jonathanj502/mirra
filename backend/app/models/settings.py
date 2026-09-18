from typing import Literal

from pydantic import BaseModel, ConfigDict


WeeklySummaryDay = Literal["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
WeeklySummaryTime = Literal["early_morning", "morning", "midday", "afternoon", "evening", "night"]
CoachingTone = Literal["warm_reflective", "direct_practical", "curious_gentle"]
CoachingDepth = Literal["quick", "balanced", "deep"]
CoachingGoal = Literal["general", "make_friends", "confidence", "listening", "clarity", "assertiveness"]


class UserSettings(BaseModel):
    notifications_enabled: bool = False
    weekly_summary_day: WeeklySummaryDay = "sunday"
    weekly_summary_time: WeeklySummaryTime = "evening"
    reflection_reminders: bool = False
    product_updates: bool = False
    save_transcripts: bool = True
    include_transcript_in_reflect: bool = False
    coaching_tone: CoachingTone = "warm_reflective"
    coaching_depth: CoachingDepth = "balanced"
    coaching_goal: CoachingGoal = "general"

    model_config = ConfigDict(extra="ignore")


class UserSettingsUpdate(BaseModel):
    notifications_enabled: bool | None = None
    weekly_summary_day: WeeklySummaryDay | None = None
    weekly_summary_time: WeeklySummaryTime | None = None
    reflection_reminders: bool | None = None
    product_updates: bool | None = None
    save_transcripts: bool | None = None
    include_transcript_in_reflect: bool | None = None
    coaching_tone: CoachingTone | None = None
    coaching_depth: CoachingDepth | None = None
    coaching_goal: CoachingGoal | None = None

    model_config = ConfigDict(extra="forbid")
