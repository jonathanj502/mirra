"""Offline probe for the disk-backed recording pipeline; see rollout.md.

Run under a Linux container memory limit with networking disabled. Speech mode
uses real VAD; day mode stubs VAD to bound runtime. Both mock external AI replies
while exercising real SDK multipart construction, decoding and acoustic metrics.
This is not a production load test or a live AI quality check.
"""
import argparse
from contextlib import contextmanager, ExitStack
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import tempfile
import time
from unittest.mock import patch
import wave


def report(event, **values):
    memory = {"process_peak_mib": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)}
    for name in ("current", "peak"):
        path = Path(f"/sys/fs/cgroup/memory.{name}")
        if path.exists():
            memory[f"cgroup_{name}_mib"] = round(int(path.read_text()) / 1024**2, 1)
    path = Path("/sys/fs/cgroup/memory.stat")
    if path.exists():
        fields = dict(line.split() for line in path.read_text().splitlines())
        for name in ("anon", "file"):
            memory[f"cgroup_{name}_mib"] = round(int(fields[name]) / 1024**2, 1)
    print(json.dumps({"event": event, **values, **memory}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("speech", "day", "upload"))
    parser.add_argument("--audio", type=Path, help="Synthetic speech fixture of exactly 600 seconds")
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    if platform.system() != "Linux" or args.runs < 1 or (args.mode == "speech" and not args.audio):
        parser.error("Requires Linux, positive runs and --audio in speech mode")
    os.environ.update(SUPABASE_URL="https://test.supabase.co", ENVIRONMENT="development",
                      SUPABASE_SERVICE_ROLE_KEY="offline-probe", OPENAI_API_KEY="offline-probe",
                      CORS_ORIGINS="*")
    report("start", python=platform.python_version(), mode=args.mode, runs=args.runs)
    import httpx
    from openai import OpenAI
    import app.main  # Include service imports without starting any worker or DB connection.
    from app.pipeline import coordinator, transcription
    from app.pipeline.vad import Segment

    report("imports", packages={name: importlib.metadata.version(name) for name in
           ("torch", "torchaudio", "silero-vad", "librosa", "numpy", "openai")})
    if args.mode == "upload":
        from fastapi import HTTPException
        from app.recording_jobs import RecordingJobs, RecordingUpload, MAX_AUDIO_BYTES, UPLOAD_CHUNK_BYTES
        with tempfile.TemporaryDirectory(prefix="mirra-upload-") as directory:
            jobs = RecordingJobs(directory)
            job = jobs.create("offline-owner", RecordingUpload(recording_id="max-input",
                              total_bytes=MAX_AUDIO_BYTES, content_type="audio/wav"))
            chunk = bytes(UPLOAD_CHUNK_BYTES)
            for offset in range(0, MAX_AUDIO_BYTES, len(chunk)):
                jobs.append("offline-owner", job["id"], offset, chunk)
            try:
                jobs.append("offline-owner", job["id"], MAX_AUDIO_BYTES, b"x")
            except HTTPException as exc:
                assert exc.status_code == 413
            else:
                raise AssertionError("Accepted more than declared 2 GiB")
            jobs.enqueue("offline-owner", job["id"])
            recovered = RecordingJobs(directory).status("offline-owner", job["id"])
            assert recovered["status"] == "queued" and recovered["uploaded_bytes"] == MAX_AUDIO_BYTES
            report("upload_pass", uploaded_bytes=MAX_AUDIO_BYTES, chunks=MAX_AUDIO_BYTES // len(chunk))
        report("pass", ai="not called", decoder="not called")
        return
    calls = 0
    multipart_peak = 0
    # Thirty alternating turns per chunk, about 135 words/minute. Retain a full
    # day's synthetic transcript/turns through the real final metrics calculation.
    text = "We talked about plans for the weekend and listened to each other. " * 3

    def respond(request):
        nonlocal calls, multipart_peak
        assert request.url.path == "/v1/audio/transcriptions"
        body = request.content
        multipart_peak = max(multipart_peak, len(body))
        assert len(body) < 25_000_000
        names = ("part1_A", "part1_B") if b"known_speaker_names" in body else ("A", "B")
        calls += 1
        return httpx.Response(200, json={"text": text, "segments": [
            {"start": i * 20, "end": (i + 1) * 20, "speaker": names[i % 2], "text": text}
            for i in range(30)]})

    def client(**kwargs):
        return OpenAI(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(respond)))

    decode = coordinator._decode_audio

    @contextmanager
    def checked_decode(source, content_type=None):
        with decode(source, content_type) as (audio, sr):
            seconds = 86400 if args.mode == "day" else 600
            assert len(audio) == seconds * sr
            report("decoded", seconds=seconds, pcm_bytes=Path(audio.filename).stat().st_size)
            yield audio, sr

    with tempfile.TemporaryDirectory(prefix="mirra-rollout-") as directory, ExitStack() as stack:
        source = args.audio
        if args.mode == "day":
            source = Path(directory) / "day.wav"
            with wave.open(str(source), "wb") as target:
                target.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
                for _ in range(1440):
                    target.writeframesraw(bytes(8000 * 2 * 60))
            stack.enter_context(patch.object(coordinator, "detect_segments",
                                            lambda *_: [Segment(0, 600, 0.1)]))
        else:
            # The source must live on a writable scratch mount: decoded PCM is
            # deliberately placed beside it by the production decoder.
            assert source.is_file()
        stack.enter_context(patch.object(coordinator, "_decode_audio", checked_decode))
        stack.enter_context(patch.object(transcription, "OpenAI", client))
        stack.enter_context(patch.object(coordinator, "analyze", lambda *_, **__: {
            "observation": "Offline probe", "pattern_to_reduce": "Offline probe",
            "thing_to_try_next": "Offline probe"}))
        for run in range(args.runs):
            started = time.monotonic()
            before = calls
            reported = set()

            def progress(value):
                bucket = value // 10
                if bucket not in reported:
                    reported.add(bucket)
                    report("progress", run=run + 1, percent=value, transcriptions=calls - before)

            result = coordinator.run(source, "audio/wav" if source.suffix == ".wav" else "audio/mp4",
                                     progress=progress)
            expected_chunks = 144 if args.mode == "day" else 1
            assert calls - before == expected_chunks, "Speech fixture failed VAD or chunk coverage changed"
            assert result["stats"]["metadata"]["diarization"]["chunk_count"] == expected_chunks
            assert result["stats"]["session_duration_minutes"] == expected_chunks * 10
            assert len(result["transcript"].splitlines()) == expected_chunks * 30
            assert not list(source.parent.glob("analysis-*")), "Temporary PCM was retained"
            report("run_complete", run=run + 1, seconds=round(time.monotonic() - started, 3),
                   chunks=expected_chunks, turns=expected_chunks * 30,
                   transcript_bytes=len(result["transcript"].encode()), multipart_peak=multipart_peak)
            del result
    report("pass", ai="mocked", real_vad=args.mode == "speech")


if __name__ == "__main__":
    main()
