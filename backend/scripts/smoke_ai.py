"""Optional paid API smoke check using synthetic voices, never a user's recording.

Run from backend: python scripts/smoke_ai.py --live
Creates no accounts or saved debriefs. Audio stays in memory/temporary decoder files.
"""
import argparse
import io
import json
from pathlib import Path
import sys
from time import monotonic

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
import soundfile as sf
from openai import OpenAI

from app.config import settings
from app.pipeline.coordinator import _decode_audio, run
from app.models.dashboard import ReflectRequest
from app.reflection import generate_reflection


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Allow paid OpenAI requests with the configured backend key')
    if not parser.parse_args().live:
        parser.error('--live is required; this test uses paid API calls')
    started = monotonic()
    client = OpenAI(api_key=settings.openai_api_key)
    clips = []
    for voice, sentence in [
        ('alloy', 'What was the best part of your weekend? I went for a walk and enjoyed the quiet. I am trying to leave more space for others to speak.'),
        ('echo', 'I enjoyed cooking dinner with friends. Thank you for asking. The quiet moments helped everyone share a story. What would you like to try next weekend?'),
    ]:
        data = client.audio.speech.create(model='tts-1', voice=voice, input=sentence, response_format='wav').read()
        clip, sr = _decode_audio(data, 'audio/wav')
        clips.extend([clip, np.zeros(sr, dtype=np.float32)])
    wav = io.BytesIO()
    sf.write(wav, np.concatenate(clips), sr, format='WAV', subtype='PCM_16')
    result = run(wav.getvalue(), 'audio/wav')
    assert all(result[key].strip() for key in ('observation', 'pattern_to_reduce', 'thing_to_try_next'))
    assert result['stats']['metadata']['diarization']['speaker_count'] >= 1
    reply = generate_reflection([result], ReflectRequest(prompt='What is one small listening habit to practice?'))
    assert reply, 'Reflect returned no model reply'
    print(json.dumps({'status': 'passed', 'duration_seconds': round(monotonic() - started, 1),
                      'detected_speakers': result['stats']['metadata']['diarization']['speaker_count'],
                      'audio_minutes': result['stats']['session_duration_minutes'],
                      'transcription': 'passed', 'structured_coaching': 'passed', 'reflect': 'passed'}))


if __name__ == '__main__':
    main()
