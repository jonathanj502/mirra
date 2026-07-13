from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, time, timezone, timedelta
import re
from typing import Any
from uuid import UUID

from app.models.dashboard import ConversationListItem, FillerCount, ProfileSummary, ProgressResponse, ProgressWeek

FILLER_PHRASES = ("you know", "i mean", "kind of", "sort of", "like", "honestly", "actually", "right")
OPEN_QUESTION_STARTS = ("what", "how", "why", "when", "where", "who", "which", "tell", "describe", "walk")
QUESTION_LEAD_INS = {"honestly", "actually", "like", "so", "okay", "well", "um", "uh"}
FUNCTION_WORD_GROUPS = {
    "pronouns": {"i", "me", "my", "mine", "you", "your", "yours", "we", "us", "our", "they", "them", "their"},
    "articles": {"a", "an", "the"},
    "prepositions": {"to", "of", "in", "for", "on", "with", "at", "from", "by", "about", "as", "into", "through"},
    "conjunctions": {"and", "but", "or", "so", "because", "while", "though", "if", "when"},
    "quantifiers": {"all", "some", "many", "few", "most", "more", "less", "each", "every", "any"},
    "aux_verbs": {"is", "am", "are", "was", "were", "be", "been", "being", "do", "did", "does", "have", "has", "had", "can", "could", "will", "would", "should"},
}


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _stats(row: dict) -> dict:
    value = row.get("stats")
    return value if isinstance(value, dict) else {}


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z']+", text.lower())


def _question_breakdown_from_transcript(transcript: str) -> tuple[int, int, int]:
    questions = [part.strip().lower() for part in re.findall(r"([^?]+)\?", transcript)]
    open_count = 0
    for question in questions:
        words = _words(question)[:4]
        if any(word in OPEN_QUESTION_STARTS for word in words if word not in QUESTION_LEAD_INS):
            open_count += 1
    total = len(questions)
    return total, open_count, max(0, total - open_count)


def _function_profile(words: list[str]) -> dict[str, float]:
    total = max(1, len(words))
    return {
        key: round(min(1.0, sum(1 for word in words if word in word_set) / total / 0.18), 3)
        for key, word_set in FUNCTION_WORD_GROUPS.items()
    }


def _filler_dicts_from_transcript(transcript: str) -> list[dict[str, int]]:
    lower = transcript.lower()
    counts = Counter({
        phrase: len(re.findall(rf"\b{re.escape(phrase)}\b", lower))
        for phrase in FILLER_PHRASES
    })
    return [{"phrase": phrase, "count": count} for phrase, count in counts.most_common() if count > 0]


def enrich_debrief_row(row: dict) -> dict:
    stats = dict(_stats(row))
    transcript = str(row.get("transcript") or "")
    words = _words(transcript)
    question_total, open_questions, closed_questions = _question_breakdown_from_transcript(transcript)

    if "open_question_count" not in stats:
        stats["open_question_count"] = open_questions
    if "closed_question_count" not in stats:
        if question_total:
            stats["closed_question_count"] = closed_questions
        else:
            stats["closed_question_count"] = max(0, int(stats.get("question_count") or 0) - int(stats.get("open_question_count") or 0))
    if "other_speech_duration_minutes" not in stats:
        duration = float(stats.get("session_duration_minutes") or 0)
        user_duration = float(stats.get("user_speech_duration_minutes") or 0)
        stats["other_speech_duration_minutes"] = round(max(0.0, duration - user_duration), 3)
    if "total_word_count" not in stats:
        stats["total_word_count"] = len(words)
    if "unique_word_count" not in stats:
        stats["unique_word_count"] = len(set(words))
    if "vocabulary_richness" not in stats:
        total = int(stats.get("total_word_count") or 0)
        stats["vocabulary_richness"] = round(int(stats.get("unique_word_count") or 0) / total, 3) if total else 0.0
    if "filler_counts" not in stats:
        stats["filler_counts"] = _filler_dicts_from_transcript(transcript)
    if "lsm_dimensions_user" not in stats and words:
        stats["lsm_dimensions_user"] = _function_profile(words)

    return {**row, "stats": stats}


def _metadata(row: dict) -> dict:
    value = _stats(row).get("metadata")
    return value if isinstance(value, dict) else {}


def title_for(row: dict) -> str:
    title = _metadata(row).get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    observation = str(row.get("observation") or "").strip()
    return re.split(r"[.!?]", observation)[0].strip() or "Conversation debrief"


def _note_for(row: dict) -> str:
    return str(row.get("thing_to_try_next") or row.get("pattern_to_reduce") or "").strip()


def _duration(row: dict) -> float:
    return round(float(_stats(row).get("session_duration_minutes") or 0), 3)


def _question_count(row: dict) -> int:
    return int(_stats(row).get("question_count") or 0)


def _open_question_count(row: dict) -> int:
    return int(_stats(enrich_debrief_row(row)).get("open_question_count") or 0)


def _closed_question_count(row: dict) -> int:
    return int(_stats(enrich_debrief_row(row)).get("closed_question_count") or 0)


def _interruption_count(row: dict) -> int:
    return int(_stats(row).get("interruption_count") or 0)


def _average_turn_offset(row: dict) -> int:
    return int(_stats(row).get("average_turn_offset_ms") or 0)


def _wpm(row: dict) -> float:
    return float(_stats(row).get("estimated_wpm") or 0)


def _energy_score(row: dict) -> int:
    return max(0, min(100, int(_stats(row).get("energy_score") or 0)))


def _energy_axes(row: dict) -> list[float]:
    raw = _stats(row).get("energy_axes")
    values = raw if isinstance(raw, list) else []
    padded = [float(value or 0) for value in values[:3]]
    return [*padded, *([0.0] * (3 - len(padded)))]


def _lsm_score(row: dict) -> float:
    return max(0.0, min(1.0, float(_stats(row).get("lsm_score") or 0)))


def _unique_words(row: dict) -> int:
    return int(_stats(row).get("unique_word_count") or 0)


def _total_words(row: dict) -> int:
    return int(_stats(row).get("total_word_count") or 0)


def _vocabulary_richness(row: dict) -> float:
    total = _total_words(row)
    return round(_unique_words(row) / total, 3) if total else 0.0


def talk_listen_percent(row: dict) -> int:
    raw = float(_stats(row).get("talk_listen_ratio") or 0)
    if raw <= 0:
        return 0
    share = raw if raw <= 1 else raw / (1 + raw)
    return max(0, min(100, round(share * 100)))


def tone_for(row: dict) -> str:
    talk_percent = talk_listen_percent(row)
    if talk_percent > 65:
        return "coral"
    if _question_count(row) >= 8:
        return "sage"
    if _interruption_count(row) > 2:
        return "terracotta"
    return "lavender"


def conversation_item(row: dict) -> ConversationListItem:
    return ConversationListItem(
        id=UUID(str(row["id"])),
        title=title_for(row),
        created_at=_parse_datetime(row["created_at"]),
        duration_minutes=_duration(row),
        talk_listen_percent=talk_listen_percent(row),
        question_count=_question_count(row),
        interruption_count=_interruption_count(row),
        energy_score=_energy_score(row),
        lsm_score=_lsm_score(row),
        vocabulary_richness=_vocabulary_richness(row),
        tone=tone_for(row),
        note=_note_for(row),
    )


def _week_start(dt: datetime) -> datetime:
    day = dt.astimezone(timezone.utc).date()
    start_date = day - timedelta(days=day.weekday())
    return datetime.combine(start_date, time.min, tzinfo=timezone.utc)


def _date_label(dt: datetime) -> str:
    return f"{dt.strftime('%b')} {dt.day}"


def _week_label(start: datetime) -> str:
    end = start + timedelta(days=6)
    return f"{_date_label(start)} - {_date_label(end)}"


def _top_fillers(rows: list[dict]) -> list[FillerCount]:
    counts: Counter[str] = Counter()
    fallback_rows: list[dict] = []
    for row in rows:
        raw_counts = _stats(row).get("filler_counts")
        if isinstance(raw_counts, list):
            for item in raw_counts:
                if isinstance(item, dict):
                    phrase = str(item.get("phrase") or "").strip().lower()
                    count = int(item.get("count") or 0)
                    if phrase and count > 0:
                        counts[phrase] += count
            continue
        fallback_rows.append(row)
    transcript = "\n".join(str(row.get("transcript") or "").lower() for row in fallback_rows)
    for phrase in FILLER_PHRASES:
        counts[phrase] += len(re.findall(rf"\b{re.escape(phrase)}\b", transcript))
    return [FillerCount(phrase=phrase, count=count) for phrase, count in counts.most_common(5) if count > 0]


def _wins(rows: list[dict], talk_percent: int, average_questions: float, interruptions: int, energy_score: int, lsm_average: float) -> list[str]:
    wins: list[str] = []
    if 40 <= talk_percent <= 60:
        wins.append(f"Talk share landed near balance at {talk_percent}%.")
    if average_questions >= 8:
        wins.append(f"You averaged {average_questions:.1f} questions per conversation.")
    if rows and interruptions <= max(1, len(rows)):
        wins.append("Interruptions stayed comparatively low.")
    if energy_score >= 70:
        wins.append(f"Energy mirroring averaged {energy_score}%, a strong in-tune signal.")
    if lsm_average >= 0.7:
        wins.append(f"Language style match averaged {lsm_average:.2f}, which is in the high range.")
    return wins[:3]


def _nudges(
    rows: list[dict],
    talk_percent: int,
    average_questions: float,
    interruptions: int,
    fillers: list[FillerCount],
    energy_score: int,
    vocabulary_richness: float,
) -> list[str]:
    nudges: list[str] = []
    if talk_percent > 65:
        nudges.append(f"You spoke {talk_percent}% of the time; try leaving a little more room.")
    if average_questions < 3 and rows:
        nudges.append("Question count was low; one more open question could invite more detail.")
    if interruptions >= max(3, len(rows) * 2):
        nudges.append("Interruptions are clustering enough to watch for the urge to jump in.")
    if fillers and sum(item.count for item in fillers) >= 10:
        nudges.append("Filler words showed up often enough to notice without judging.")
    if rows and energy_score < 45:
        nudges.append("Energy mirroring looked low this week; matching pace or volume for a beat may help.")
    if rows and vocabulary_richness < 0.45:
        nudges.append("Vocabulary variety was low; reaching for a fresher word can open new ground.")
    return nudges[:3]


def build_progress(rows: list[dict], max_weeks: int = 8) -> ProgressResponse:
    now = datetime.now(timezone.utc)
    grouped: dict[datetime, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[_week_start(_parse_datetime(row["created_at"]))].append(row)

    current_start = _week_start(now)
    starts = sorted(set(grouped.keys()) | {current_start}, reverse=True)[:max_weeks]
    weeks: list[ProgressWeek] = []
    for start in starts:
        week_rows = sorted(grouped.get(start, []), key=lambda row: _parse_datetime(row["created_at"]), reverse=True)
        daily = [0.0] * 7
        daily_questions = [0] * 7
        daily_open_questions = [0] * 7
        daily_closed_questions = [0] * 7
        daily_interruptions = [0] * 7
        daily_offsets: list[list[int]] = [[] for _ in range(7)]
        for row in week_rows:
            dt = _parse_datetime(row["created_at"])
            daily[dt.weekday()] += _duration(row)
            daily_questions[dt.weekday()] += _question_count(row)
            daily_open_questions[dt.weekday()] += _open_question_count(row)
            daily_closed_questions[dt.weekday()] += _closed_question_count(row)
            daily_interruptions[dt.weekday()] += _interruption_count(row)
            offset = _average_turn_offset(row)
            if offset:
                daily_offsets[dt.weekday()].append(offset)

        total_minutes = round(sum(daily), 3)
        conv_count = len(week_rows)
        total_questions = sum(_question_count(row) for row in week_rows)
        total_open_questions = sum(_open_question_count(row) for row in week_rows)
        total_closed_questions = sum(_closed_question_count(row) for row in week_rows)
        interruptions = sum(_interruption_count(row) for row in week_rows)
        talk_percent = round(sum(talk_listen_percent(row) for row in week_rows) / conv_count) if conv_count else 0
        average_questions = round(total_questions / conv_count, 1) if conv_count else 0.0
        average_wpm = round(sum(_wpm(row) for row in week_rows) / conv_count, 1) if conv_count else 0.0
        average_turn_offset = round(sum(_average_turn_offset(row) for row in week_rows) / conv_count) if conv_count else 0
        daily_turn_offsets = [round(sum(values) / len(values)) if values else None for values in daily_offsets]
        energy_score = round(sum(_energy_score(row) for row in week_rows) / conv_count) if conv_count else 0
        energy_axes = [
            round(sum(_energy_axes(row)[index] for row in week_rows) / conv_count, 3) if conv_count else 0.0
            for index in range(3)
        ]
        lsm_average = round(sum(_lsm_score(row) for row in week_rows) / conv_count, 3) if conv_count else 0.0
        unique_words = sum(_unique_words(row) for row in week_rows)
        total_words = sum(_total_words(row) for row in week_rows)
        if total_words == 0:
            transcript_words = re.findall(r"[a-z']+", "\n".join(str(row.get("transcript") or "").lower() for row in week_rows))
            unique_words = len(set(transcript_words))
            total_words = len(transcript_words)
        vocabulary_richness = round(unique_words / total_words, 3) if total_words else 0.0
        fillers = _top_fillers(week_rows)
        weeks.append(
            ProgressWeek(
                week_key=start.date().isoformat(),
                label="This week" if start == current_start else _week_label(start),
                starts_at=start,
                ends_at=start + timedelta(days=6, hours=23, minutes=59, seconds=59),
                conversation_count=conv_count,
                total_minutes=total_minutes,
                daily_minutes=[round(value, 3) for value in daily],
                daily_questions=daily_questions,
                daily_open_questions=daily_open_questions,
                daily_closed_questions=daily_closed_questions,
                daily_interruptions=daily_interruptions,
                average_session_minutes=round(total_minutes / conv_count, 1) if conv_count else 0.0,
                talk_listen_percent=talk_percent,
                average_questions=average_questions,
                total_questions=total_questions,
                total_open_questions=total_open_questions,
                total_closed_questions=total_closed_questions,
                interruption_count=interruptions,
                average_turn_offset_ms=average_turn_offset,
                daily_turn_offsets=daily_turn_offsets,
                average_wpm=average_wpm,
                energy_score=energy_score,
                energy_axes=energy_axes,
                lsm_average=lsm_average,
                vocabulary_unique_words=unique_words,
                vocabulary_total_words=total_words,
                vocabulary_richness=vocabulary_richness,
                top_fillers=fillers,
                wins=_wins(week_rows, talk_percent, average_questions, interruptions, energy_score, lsm_average),
                nudges=_nudges(week_rows, talk_percent, average_questions, interruptions, fillers, energy_score, vocabulary_richness),
                conversations=[conversation_item(row) for row in week_rows],
            )
        )

    current_index = next((idx for idx, week in enumerate(weeks) if week.week_key == current_start.date().isoformat()), 0)
    return ProgressResponse(generated_at=now, current_week_index=current_index, weeks=weeks)


def build_profile_summary(rows: list[dict], usage: dict) -> ProfileSummary:
    total_conversations = len(rows)
    total_minutes = round(sum(_duration(row) for row in rows), 3)
    total_questions = sum(_question_count(row) for row in rows)
    talk_percent = round(sum(talk_listen_percent(row) for row in rows) / total_conversations) if rows else 0
    return ProfileSummary(
        total_conversations=total_conversations,
        total_minutes=total_minutes,
        average_questions=round(total_questions / total_conversations, 1) if total_conversations else 0.0,
        talk_listen_percent=talk_percent,
        used_this_month=int(usage["used_this_month"]),
        remaining=int(usage["remaining"]),
        resets_at=_parse_datetime(usage["resets_at"]),
    )


def fallback_reflection(rows: list[dict], prompt: str) -> str:
    if not rows:
        return "I do not have a conversation to reference yet, but I can still help you reflect. What moment from the conversation are you most curious about?"

    row = rows[0]
    title = title_for(row)
    talk_percent = talk_listen_percent(row)
    questions = _question_count(row)
    interruptions = _interruption_count(row)
    if "question" in prompt.lower():
        return f"In {title}, you asked {questions} questions. A useful next step is to make the first one open-ended, then leave a beat for the other person to find their words."
    if "interrupt" in prompt.lower():
        return f"In {title}, I see {interruptions} interruptions estimated. Notice whether they happen when you are excited, anxious, or trying to help."
    return f"In {title}, your talk share was about {talk_percent}%. The pattern to watch is not good or bad by itself; it is whether the other person had enough room to unfold."
