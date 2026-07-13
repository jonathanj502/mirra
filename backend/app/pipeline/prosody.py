from __future__ import annotations

from collections import Counter
import math
import re
from typing import Any

import librosa
import numpy as np

from app.pipeline.vad import Segment

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
BASELINE_FUNCTION_PROFILE = {
    "pronouns": 0.78,
    "articles": 0.48,
    "prepositions": 0.68,
    "conjunctions": 0.70,
    "quantifiers": 0.36,
    "aux_verbs": 0.62,
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _round_float(value: float, places: int = 3) -> float:
    if not math.isfinite(value):
        return 0.0
    return round(float(value), places)


def _words(transcript: str) -> list[str]:
    return re.findall(r"[a-z']+", transcript.lower())


def _question_counts(transcript: str) -> tuple[int, int, int]:
    questions = [part.strip().lower() for part in re.findall(r"([^?]+)\?", transcript)]
    open_count = 0
    for question in questions:
        lead_words = _words(question)[:4]
        if any(word in OPEN_QUESTION_STARTS for word in lead_words if word not in QUESTION_LEAD_INS):
            open_count += 1
    total = len(questions)
    return total, open_count, max(0, total - open_count)


def _filler_counts(transcript: str) -> list[dict[str, int]]:
    lower = transcript.lower()
    counts = Counter({
        phrase: len(re.findall(rf"\b{re.escape(phrase)}\b", lower))
        for phrase in FILLER_PHRASES
    })
    return [{"phrase": phrase, "count": count} for phrase, count in counts.most_common() if count > 0]


def _segment_slice(audio: np.ndarray, sample_rate: int, segment: Segment) -> np.ndarray:
    start = max(0, int(segment.start * sample_rate))
    end = min(len(audio), int(segment.end * sample_rate))
    if end <= start:
        return np.array([], dtype=np.float32)
    return audio[start:end]


def _rms(values: np.ndarray) -> float:
    if len(values) == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(values.astype(np.float32)))))


def _mean_energy(segments: list[Segment]) -> float:
    if not segments:
        return 0.0
    return float(np.mean([max(0.0, segment.energy) for segment in segments]))


def _match_ratio(left: float, right: float) -> float:
    if left <= 0 or right <= 0:
        return 0.0
    return _clamp(1.0 - abs(math.log(left / right)) / math.log(4.0))


def _pitch_for_segments(audio: np.ndarray, sample_rate: int, segments: list[Segment]) -> float:
    pitches: list[float] = []
    for segment in segments:
        chunk = _segment_slice(audio, sample_rate, segment)
        if len(chunk) < max(400, sample_rate // 12):
            continue
        try:
            f0 = librosa.yin(chunk.astype(np.float32), fmin=50, fmax=500, sr=sample_rate)
        except Exception:
            continue
        voiced = f0[np.isfinite(f0)]
        if len(voiced):
            pitches.append(float(np.median(voiced)))
    return float(np.median(pitches)) if pitches else 0.0


def _normalize_series(values: list[float]) -> list[float]:
    if not values:
        return []
    high, low = max(values), min(values)
    if high <= 0:
        return [0.0 for _ in values]
    if high == low:
        return [5.0 if value > 0 else 0.0 for value in values]
    scaled = np.interp(values, [low, high], [1.0, 10.0])
    return [_round_float(s, 2) if value > 0 else 0.0 for value, s in zip(values, scaled)]


def _energy_series(audio: np.ndarray, sample_rate: int, segments: list[Segment], total_seconds: float, buckets: int = 16) -> list[float]:
    if total_seconds <= 0 or len(audio) == 0:
        return [0.0] * buckets
    values: list[float] = []
    for index in range(buckets):
        bucket_start = total_seconds * index / buckets
        bucket_end = total_seconds * (index + 1) / buckets
        chunks: list[np.ndarray] = []
        for segment in segments:
            overlap_start = max(segment.start, bucket_start)
            overlap_end = min(segment.end, bucket_end)
            if overlap_end <= overlap_start:
                continue
            chunks.append(_segment_slice(audio, sample_rate, Segment(overlap_start, overlap_end, segment.energy)))
        values.append(_rms(np.concatenate(chunks)) if chunks else 0.0)
    return _normalize_series(values)


def _turn_offsets(segments: list[Segment], user_segments: list[Segment]) -> tuple[int, int, list[dict[str, float | str]]]:
    if len(segments) < 2:
        return 0, 0, []
    user_keys = {(round(segment.start, 3), round(segment.end, 3)) for segment in user_segments}
    labeled = []
    for segment in sorted(segments, key=lambda item: item.start):
        key = (round(segment.start, 3), round(segment.end, 3))
        labeled.append((segment, "user" if key in user_keys else "other"))

    offsets: list[float] = []
    series: list[dict[str, float | str]] = []
    interruptions = 0
    for previous, current in zip(labeled, labeled[1:]):
        prev_segment, prev_speaker = previous
        curr_segment, curr_speaker = current
        if prev_speaker == curr_speaker:
            continue
        gap_ms = (curr_segment.start - prev_segment.end) * 1000.0
        offsets.append(gap_ms)
        if gap_ms <= 150:
            interruptions += 1
        label_seconds = max(0, curr_segment.start)
        minutes = int(label_seconds // 60)
        seconds = int(label_seconds % 60)
        series.append({"t": f"{minutes}:{seconds:02d}", "ms": round(gap_ms)})

    if not offsets:
        return 0, 0, []
    return interruptions, round(float(np.mean(offsets))), series[:12]


def _function_profile(words: list[str]) -> dict[str, float]:
    total = max(1, len(words))
    values: dict[str, float] = {}
    for key, word_set in FUNCTION_WORD_GROUPS.items():
        rate = sum(1 for word in words if word in word_set) / total
        values[key] = _clamp(rate / 0.18)
    return values


def _language_style_score(profile: dict[str, float]) -> float:
    if not profile:
        return 0.0
    matches = []
    for key, baseline in BASELINE_FUNCTION_PROFILE.items():
        matches.append(1.0 - min(1.0, abs(profile.get(key, 0.0) - baseline)))
    return _clamp(float(np.mean(matches)))


def compute_stats(
    all_segments: list[Segment],
    user_segments: list[Segment],
    transcript: str,
    total_seconds: float,
    audio: np.ndarray | None = None,
    sample_rate: int | None = None,
) -> dict[str, Any]:
    user_speech = sum(s.end - s.start for s in user_segments)
    other_speech = max(0.0, sum(s.end - s.start for s in all_segments) - user_speech)
    talk_listen_ratio = round(user_speech / other_speech, 3) if other_speech > 0 else 99.0
    tokenized = _words(transcript)
    question_count, open_question_count, closed_question_count = _question_counts(transcript)
    interruptions, average_turn_offset_ms, turn_offset_series = _turn_offsets(all_segments, user_segments)

    user_energy = _mean_energy(user_segments)
    other_segments = [
        segment for segment in all_segments
        if (round(segment.start, 3), round(segment.end, 3))
        not in {(round(user.start, 3), round(user.end, 3)) for user in user_segments}
    ]
    other_energy = _mean_energy(other_segments)
    volume_match = _match_ratio(user_energy, other_energy)
    pitch_match = 0.0
    energy_series_user = [0.0] * 16
    energy_series_other = [0.0] * 16
    if audio is not None and sample_rate:
        user_pitch = _pitch_for_segments(audio, sample_rate, user_segments)
        other_pitch = _pitch_for_segments(audio, sample_rate, other_segments)
        pitch_match = _match_ratio(user_pitch, other_pitch)
        energy_series_user = _energy_series(audio, sample_rate, user_segments, total_seconds)
        energy_series_other = _energy_series(audio, sample_rate, other_segments, total_seconds)

    estimated_wpm = round(len(tokenized) / (user_speech / 60), 1) if user_speech > 0 else 0.0
    speech_rate_score = _clamp(1.0 - abs(estimated_wpm - 145.0) / 110.0) if estimated_wpm else 0.0
    talk_share = talk_listen_ratio if talk_listen_ratio <= 1 else talk_listen_ratio / (1 + talk_listen_ratio)
    balance_score = _clamp(1.0 - abs(talk_share - 0.5) / 0.5) if user_speech > 0 and other_speech > 0 else 0.0
    energy_axes = [
        _round_float(volume_match),
        _round_float(pitch_match),
        _round_float(speech_rate_score),
    ]
    energy_score = round(100 * _clamp(float(np.mean([*energy_axes, balance_score])) - min(0.25, interruptions * 0.025)))

    function_profile = _function_profile(tokenized)
    language_score = _language_style_score(function_profile)
    acoustic_score = float(np.mean(energy_axes))
    lsm_score = _clamp((language_score * 0.55) + (acoustic_score * 0.45))
    unique_word_count = len(set(tokenized))
    total_word_count = len(tokenized)

    return {
        "talk_listen_ratio": talk_listen_ratio,
        "question_count": question_count,
        "open_question_count": open_question_count,
        "closed_question_count": closed_question_count,
        "interruption_count": interruptions,
        "average_turn_offset_ms": average_turn_offset_ms,
        "turn_offset_series": turn_offset_series,
        "session_duration_minutes": round(total_seconds / 60, 3),
        "user_speech_duration_minutes": round(user_speech / 60, 3),
        "other_speech_duration_minutes": round(other_speech / 60, 3),
        "estimated_wpm": estimated_wpm,
        "energy_score": int(max(0, min(100, energy_score))),
        "energy_axes": energy_axes,
        "energy_series_user": energy_series_user,
        "energy_series_other": energy_series_other,
        "lsm_score": _round_float(lsm_score),
        "lsm_dimensions_user": {key: _round_float(value) for key, value in function_profile.items()},
        "lsm_dimensions_reference": BASELINE_FUNCTION_PROFILE,
        "total_word_count": total_word_count,
        "unique_word_count": unique_word_count,
        "vocabulary_richness": _round_float(unique_word_count / total_word_count) if total_word_count else 0.0,
        "filler_counts": _filler_counts(transcript),
    }
