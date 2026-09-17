"""Compile the audio functions during deployment, before serving recordings.

Use NUMBA_CPU_NAME=generic during both build and runtime so cached code works
across Render's build and service CPUs. No recordings or credentials are used.
"""
import time
import subprocess

import numpy as np

from app.pipeline.prosody import _pitch_for_segments
from app.pipeline.vad import Segment, has_speech


def main():
    start = time.monotonic()
    signal = np.sin(2 * np.pi * 220 * np.arange(16000) / 16000).astype(np.float32)
    assert not has_speech(np.zeros(16000, dtype=np.float32), 16000)
    pitch = _pitch_for_segments(signal, 16000, [Segment(0, 1, 0.5)])
    assert np.isfinite(pitch) and abs(pitch - 220) < 5
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
        "-t", "0.1", "-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3", "pipe:1",
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
    print(f"Audio functions ready in {time.monotonic() - start:.1f}s", flush=True)


if __name__ == "__main__":
    main()
