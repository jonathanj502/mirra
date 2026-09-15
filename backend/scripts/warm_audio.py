"""Compile the audio functions during deployment, before serving recordings.

Use NUMBA_CPU_NAME=generic during both build and runtime so cached code works
across Render's build and service CPUs. No recordings or credentials are used.
"""
import time

import librosa
import numpy as np


def main():
    start = time.monotonic()
    signal = np.sin(2 * np.pi * 220 * np.arange(22050) / 22050).astype(np.float32)
    assert callable(librosa.load)  # Resolve the lazy audio module and its compiled helpers.
    librosa.util.buf_to_float(bytes(4096), dtype=np.float32)  # M4A/audioread conversion.
    resampled = librosa.resample(signal, orig_sr=22050, target_sr=16000)
    pitch = librosa.yin(resampled, fmin=50, fmax=500, sr=16000)
    assert np.isfinite(pitch).all() and abs(float(np.median(pitch)) - 220) < 5
    print(f"Audio functions ready in {time.monotonic() - start:.1f}s", flush=True)


if __name__ == "__main__":
    main()
