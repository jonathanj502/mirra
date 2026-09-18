"""Offline pipeline memory check; see docs/beta-workstreams/memory.md.

Uses real decoding, VAD, encoding, SDK multipart construction and acoustic
metrics. AI replies are synthetic; no server, database or network is exercised.
Run in a fresh Linux container to measure an independent cgroup peak.
"""
import argparse
from contextlib import ExitStack
import json
import math
import os
from pathlib import Path
import platform
import resource
import sys
import time
from unittest.mock import patch


def memory():
    values = {"process_peak_mib": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss /
                                      (1024**2 if sys.platform == "darwin" else 1024), 1)}
    if sys.platform == "linux":
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                values["process_rss_mib"] = round(int(line.split()[1]) / 1024, 1)
        for field in ("current", "peak"):
            path = Path(f"/sys/fs/cgroup/memory.{field}")
            if path.exists():
                values[f"cgroup_{field}_mib"] = round(int(path.read_text()) / 1024**2, 1)
    return values


def report(event, **values):
    print(json.dumps({"event": event, **values, **memory()}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--seconds", type=float, default=1400)
    parser.add_argument("--turn-seconds", type=float, default=1400,
                        help="Synthetic diarization turn length; 1400 stresses merged long turns")
    parser.add_argument("--content-type", default="audio/mp4")
    args = parser.parse_args()
    if min(args.runs, args.seconds, args.turn_seconds) <= 0:
        parser.error("runs, seconds and turn-seconds must be positive")

    # Do not use real credentials, even when the caller has a local .env.
    os.environ.update(SUPABASE_URL="https://test.supabase.co",
                      SUPABASE_SERVICE_ROLE_KEY="offline-benchmark", OPENAI_API_KEY="offline-benchmark")
    report("start", python=platform.python_version(), system=platform.platform(),
           runs=args.runs, seconds=args.seconds, turn_seconds=args.turn_seconds)
    import httpx
    from openai import OpenAI
    import app.main  # Include the service's imports in the measured process.
    from app.pipeline import coordinator, prosody, transcription

    report("imports")
    segments = []
    start = 0.0
    while start < args.seconds:
        segments.append({"start": start, "end": min(args.seconds, start + args.turn_seconds),
                         "speaker": "AB"[len(segments) % 2], "text": "What could we try next?"})
        start += args.turn_seconds
    calls = 0

    def respond(request):
        nonlocal calls
        assert request.url.path == "/v1/audio/transcriptions"
        calls += 1
        report("mock_transcription", multipart_bytes=len(request.content))
        return httpx.Response(200, json={"text": "Synthetic benchmark response.", "segments": segments})

    def client(**kwargs):
        return OpenAI(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(respond)))

    def timed(name, function):
        def run(*args, **kwargs):
            started = time.monotonic()
            result = function(*args, **kwargs)
            extra = {"decoded_seconds": len(result[0]) / result[1]} if name == "_decode_audio" else {}
            report(name, elapsed_seconds=round(time.monotonic() - started, 3), **extra)
            return result
        return run

    pitch = prosody._pitch_for_segments

    def checked_pitch(audio, sample_rate, segments):
        result = pitch(audio, sample_rate, segments)
        if segments:
            assert math.isfinite(result) and result > 0, "Pitch calculation failed silently"
        return result

    with ExitStack() as stack:
        stack.enter_context(patch.object(prosody, "_pitch_for_segments", checked_pitch))
        stack.enter_context(patch.object(transcription, "OpenAI", client))
        stack.enter_context(patch.object(coordinator, "analyze", lambda *_: {
            "observation": "Offline benchmark", "pattern_to_reduce": "Offline benchmark",
            "thing_to_try_next": "Offline benchmark",
        }))
        for name in ("_decode_audio", "has_speech", "transcribe", "audio_segments", "compute_stats"):
            stack.enter_context(patch.object(coordinator, name, timed(name, getattr(coordinator, name))))
        for run in range(1, args.runs + 1):
            started = time.monotonic()
            source = args.audio.read_bytes()
            report("request_start", run=run, input_bytes=len(source))
            result = coordinator.run(source, args.content_type)
            assert result["stats"]["session_duration_minutes"] == round(args.seconds / 60, 3)
            assert result["stats"]["total_word_count"] > 0, "Fixture did not pass the real speech gate"
            assert calls == run, "Expected one transcription per request"
            del source, result
            report("request_complete", run=run, elapsed_seconds=round(time.monotonic() - started, 3))
    assert "torch" not in sys.modules, "Unexpected PyTorch runtime import"
    report("pass", ai="mocked", network=False)


if __name__ == "__main__":
    main()
