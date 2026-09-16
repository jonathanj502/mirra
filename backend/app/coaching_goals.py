from app.models.settings import CoachingGoal


GOAL_GUIDANCE: dict[CoachingGoal, str] = {
    "general": "Everyday connection: choose the most useful, well-supported opportunity for this conversation.",
    "make_friends": (
        "Make more friends: prioritize warmth, genuine curiosity, relevant follow-up questions, "
        "balanced self-disclosure, and low-pressure ways to continue a connection."
    ),
    "confidence": (
        "Come across more confidently: prioritize clear statements, a measured pace, expressing a point "
        "without unnecessary apologies, and comfortable pauses when supported by the recording. "
        "Do not equate confidence with loudness, dominance, an accent, or extroversion."
    ),
    "listening": (
        "Listen more closely: prioritize responding to what was actually said, relevant follow-ups, "
        "and leaving room for the other speaker. Do not impose a universal talk/listen ratio."
    ),
    "clarity": (
        "Communicate clearly: prioritize a clear main point, relevant detail, concise explanations, "
        "and checking shared understanding. Do not treat an accent or dialect as a flaw."
    ),
    "assertiveness": (
        "Speak up for myself: prioritize stating preferences, making specific requests, and expressing "
        "respectful boundaries while leaving room for disagreement. Do not encourage dominance or pressure."
    ),
}


def goal_instructions(goal: CoachingGoal) -> str:
    return (
        "Use the selected goal to curate feedback grounded in this conversation, not a generic checklist. "
        "The goal is a preference, not evidence of a deficit. Do not invent a problem to fit it. "
        "Prefer one small, concrete action the user can try naturally; offer example wording when useful. "
        "Do not assign daily exercises or additional app use. Respect an explicit Reflect question. "
        "Never claim to know another person's perception, infer an inner emotional state from a voice, "
        "or guarantee confidence, friendship, or another social outcome. "
        f"Selected coaching goal: {GOAL_GUIDANCE[goal]}"
    )
