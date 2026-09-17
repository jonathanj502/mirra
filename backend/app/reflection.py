from __future__ import annotations

from typing import Any

from openai import OpenAI, OpenAIError

from app.config import settings
from app.coaching_goals import goal_instructions
from app.models.settings import CoachingGoal
from app.dashboard import talk_listen_percent, title_for
from app.models.dashboard import ReflectRequest

_BASE_SYSTEM_PROMPT = (
    "You are Mirra, a concise conversation coach. Help the user reflect on a real "
    "conversation with kindness and specificity. Use the supplied debrief context when it is "
    "available, and say when there is not enough context. Do not diagnose, moralize, or invent "
    "details. Ask one gentle follow-up question when it would help the user continue."
)

_TONE_PROMPTS = {
    "warm_reflective": "Use a warm, reflective tone.",
    "direct_practical": "Use a direct, practical tone with concrete next steps.",
    "curious_gentle": "Use a curious, gentle tone and lead with questions.",
}

_DEPTH_PROMPTS = {
    "quick": "Keep the reply to one short sentence.",
    "balanced": "Keep the reply to 1-3 short sentences.",
    "deep": "Use up to 4 sentences and include a little more nuance.",
}


def _stats(row: dict) -> dict:
    value = row.get("stats")
    return value if isinstance(value, dict) else {}


def _truncate(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def _debrief_context(row: dict, include_transcript: bool = False) -> str:
    stats = _stats(row)
    pieces = [
        f"Title: {title_for(row)}",
        f"Observation: {_truncate(row.get('observation'), 500)}",
        f"Pattern to reduce: {_truncate(row.get('pattern_to_reduce'), 350)}",
        f"Thing to try next: {_truncate(row.get('thing_to_try_next'), 350)}",
        f"Talk share: {talk_listen_percent(row)}%",
        f"Questions: {int(stats.get('question_count') or 0)}",
        f"Interruptions: {int(stats.get('interruption_count') or 0)}",
    ]
    transcript = _truncate(row.get("transcript"), 1200) if include_transcript else ""
    if include_transcript and transcript:
        pieces.append(f"Transcript excerpt: {transcript}")
    return "\n".join(pieces)


def build_reflection_messages(
    rows: list[dict],
    payload: ReflectRequest,
    include_transcript: bool = False,
    coaching_tone: str = "warm_reflective",
    coaching_depth: str = "balanced",
    coaching_goal: CoachingGoal = "general",
) -> list[dict[str, str]]:
    system = " ".join(
        [
            _BASE_SYSTEM_PROMPT,
            _TONE_PROMPTS.get(coaching_tone, _TONE_PROMPTS["warm_reflective"]),
            _DEPTH_PROMPTS.get(coaching_depth, _DEPTH_PROMPTS["balanced"]),
            goal_instructions(coaching_goal),
        ]
    )
    messages = [{"role": "system", "content": system}]
    for message in payload.messages[-12:]:
        if message.role not in {"assistant", "user"}:
            continue
        content = message.content.strip()
        if content:
            messages.append({"role": message.role, "content": content})

    if rows:
        context = "\n\n".join(_debrief_context(row, include_transcript) for row in rows[:3])
    else:
        context = "No saved debrief is available yet."

    messages.append(
        {
            "role": "user",
            "content": f"Debrief context:\n{context}\n\nUser prompt:\n{payload.prompt.strip()}",
        }
    )
    return messages


def generate_reflection(
    rows: list[dict],
    payload: ReflectRequest,
    coaching_tone: str = "warm_reflective",
    coaching_depth: str = "balanced",
    include_transcript: bool = False,
    coaching_goal: CoachingGoal = "general",
) -> str | None:
    if not settings.openai_api_key:
        return None

    messages = build_reflection_messages(
        rows,
        payload,
        include_transcript=include_transcript,
        coaching_tone=coaching_tone,
        coaching_depth=coaching_depth,
        coaching_goal=coaching_goal,
    )
    try:
        with OpenAI(api_key=settings.openai_api_key, timeout=30.0, max_retries=2) as client:
            response = client.responses.create(
                model=settings.openai_reflect_model,
                input=messages,
                max_output_tokens=350,
                store=False,
            )
        return (response.output_text.strip() or None) if response.status == "completed" else None
    except OpenAIError:
        return None
