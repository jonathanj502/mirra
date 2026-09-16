from contextlib import contextmanager
import io
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np

from app.pipeline.coaching import analyze
from app.models.settings import CoachingGoal
from app.pipeline.prosody import compute_stats
from app.pipeline.speaker import audio_segments, select_user_speaker
from app.pipeline.transcription import TRANSCRIPTION_MODEL, TranscribedTurn, transcribe, speaker_reference
from app.pipeline.vad import detect_segments

ANALYSIS_SAMPLE_RATE = 16000
MAX_AUDIO_SECONDS = 24 * 60 * 60
CHUNK_SECONDS = 10 * 60
CONTENT_TYPE_SUFFIXES = {
    "audio/aac": ".aac", "audio/mp4": ".m4a", "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-m4a": ".m4a",
    "audio/x-wav": ".wav", "audio/webm": ".webm",
}


class AudioDurationTooLong(ValueError):
    pass


@contextmanager
def _decode_audio(source, content_type: str | None = None):
    """Keep decoded audio on disk, mapping only the portions being analyzed into memory."""
    with tempfile.TemporaryDirectory(prefix="analysis-", dir=source.parent if isinstance(source, Path) else None) as directory:
        if isinstance(source, Path):
            path = source
        else:
            path = Path(directory) / ("recording" + CONTENT_TYPE_SUFFIXES.get(content_type, ".audio"))
            reader = io.BytesIO(source) if isinstance(source, bytes) else source
            reader.seek(0)
            with path.open("wb") as target:
                shutil.copyfileobj(reader, target, 1024 * 1024)
        pcm = Path(directory) / "decoded.pcm"
        try:
            # No playlist/network demuxers. Decode a bounded duration to disk, not a giant pipe buffer.
            subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-protocol_whitelist", "file,pipe", "-format_whitelist", "aac,wav,mp3,mov,ogg,matroska,webm",
                "-i", str(path), "-t", str(MAX_AUDIO_SECONDS + 1), "-vn", "-threads", "1",
                "-ac", "1", "-ar", str(ANALYSIS_SAMPLE_RATE), "-f", "f32le", str(pcm),
            ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=900)
        except subprocess.CalledProcessError as exc:
            if b"No space left on device" in (exc.stderr or b""):
                raise OSError("Temporary recording storage is full") from exc
            raise ValueError("Could not decode audio") from exc
        except subprocess.SubprocessError as exc:
            raise ValueError("Could not decode audio") from exc
        samples = pcm.stat().st_size // 4
        if samples > MAX_AUDIO_SECONDS * ANALYSIS_SAMPLE_RATE:
            raise AudioDurationTooLong("This recording exceeds the supported 24-hour duration.")
        if not samples:
            raise ValueError("Could not decode audio")
        audio = np.memmap(pcm, dtype="<f4", mode="r")
        try:
            yield audio, ANALYSIS_SAMPLE_RATE
        finally:
            audio._mmap.close()


def run(source, content_type: str | None = None, coaching_goal: CoachingGoal = "general", progress=None) -> dict:
    def report(value):
        if progress:
            progress(value)

    report(0)
    with _decode_audio(source, content_type) as (audio, sr):
        report(0)
        total_seconds = len(audio) / sr
        turns = []
        references = {}
        start = 0
        chunk_count = 0
        while start < len(audio):
            end = min(len(audio), start + CHUNK_SECONDS * sr)
            chunk = np.nan_to_num(np.array(audio[start:end]), copy=False, nan=0.0, posinf=0.0, neginf=0.0)
            speech = detect_segments(chunk, sr)
            # Prefer a pause near the boundary. Every sample belongs to exactly one request.
            if end < len(audio):
                pauses = [(left.end + right.start) / 2 for left, right in zip(speech, speech[1:])
                          if right.start - left.end >= 0.2 and CHUNK_SECONDS - 30 <= left.end < CHUNK_SECONDS]
                if pauses:
                    end = start + int(pauses[-1] * sr)
                    chunk = chunk[:end - start]
            report(round(90 * start / len(audio)))
            local_turns = transcribe(chunk, sr, known_speakers=dict(references)) if speech else []
            # Only reference-matched labels are shared across requests. Anonymous "A" in a later
            # request is not evidence that this is the same person as an earlier "A".
            mapping = {turn.speaker: turn.speaker if turn.speaker in references else
                       f"part{chunk_count + 1}_{turn.speaker}" for turn in local_turns}
            if len(references) < 4:
                candidates = audio_segments(local_turns, chunk, sr)
                ranked = sorted(mapping, key=lambda label: sum(
                    s.energy ** 2 * (s.end - s.start) for s in candidates if s.speaker == label), reverse=True)
                for label in ranked:
                    stable = mapping[label]
                    if stable in references or len(references) >= 4:
                        continue
                    reference = speaker_reference(chunk, sr, local_turns, label)
                    if reference:
                        references[stable] = reference
            turns.extend(TranscribedTurn(t.start + start / sr, t.end + start / sr, mapping[t.speaker], t.text)
                         for t in local_turns)
            chunk_count += 1
            start = end
            report(round(90 * start / len(audio)))

        all_segs = audio_segments(turns, audio, sr)
        user_speaker = select_user_speaker(all_segs)
        user_segs = [segment for segment in all_segs if segment.speaker == user_speaker]
        user_transcript = " ".join(turn.text for turn in turns if turn.speaker == user_speaker)
        transcript = "\n".join(f"Speaker {turn.speaker}: {turn.text}" for turn in turns)
        stats = compute_stats(all_segs, user_segs, user_transcript, total_seconds, audio=audio, sample_rate=sr)
        speakers = list(dict.fromkeys(segment.speaker for segment in all_segs))
        stats["metadata"] = {"diarization": {
            "model": TRANSCRIPTION_MODEL, "speaker_count": len(speakers), "user_speaker": user_speaker,
            "user_speaker_selection": "none" if not speakers else "only_speaker" if len(speakers) == 1 else "loudest_speaker",
            "user_speaker_confirmed": False, "timing_precision": "segment", "chunk_count": chunk_count,
            "speaker_matching": "audio_references" if chunk_count > 1 else "single_request",
            "unlinked_speaker_labels": [label for label in speakers if label not in references] if chunk_count > 1 else [],
            "speaker_durations_seconds": {
                speaker: round(sum(s.end - s.start for s in all_segs if s.speaker == speaker), 3)
                for speaker in speakers
            },
        }, "acoustic_pitch_sampling": "up to 64 five-second excerpts per speaker group"}
        report(95)
        coaching = analyze(transcript, stats, coaching_goal=coaching_goal) if turns else {
            "observation": "No speech was detected in this recording.",
            "pattern_to_reduce": "There is not enough speech to identify a conversational pattern.",
            "thing_to_try_next": "Try another recording with the microphone closer to the conversation.",
        }
        report(100)
        return {**coaching, "stats": stats, "transcript": transcript}
