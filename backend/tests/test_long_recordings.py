import base64
from contextlib import contextmanager
import io
from threading import Event
from unittest.mock import MagicMock
import wave

from fastapi import HTTPException
from fastapi.testclient import TestClient
import numpy as np
import pytest
import soundfile as sf

import app.main as main
from app.auth import verify_token
from app.db import get_db
from app.pipeline import coaching, coordinator, transcription
from app.pipeline.transcription import TranscribedTurn
from app.pipeline.vad import Segment
from app.recording_jobs import RecordingJobs, RecordingUpload, UPLOAD_CHUNK_BYTES, RETENTION_SECONDS


def test_large_upload_resumes_after_lost_ack_and_is_account_scoped(tmp_path, monkeypatch):
    jobs = RecordingJobs(tmp_path)
    monkeypatch.setattr(main, 'recording_jobs', jobs)
    monkeypatch.setattr(main, '_recording_result', lambda *_: None)
    monkeypatch.setattr(main, 'get_usage', lambda *_: {'remaining': 5})
    main.app.dependency_overrides[verify_token] = lambda: 'owner'
    db = MagicMock()
    db.auth.admin.get_user_by_id.return_value.user.id = 'owner'
    main.app.dependency_overrides[get_db] = lambda: db
    client = TestClient(main.app)
    body = {'recording_id': 'long', 'total_bytes': 7 * UPLOAD_CHUNK_BYTES + 17,
            'content_type': 'audio/mp4', 'client_duration_seconds': 7200}
    try:
        assert client.post('/recordings', json=body).status_code == 200
        assert client.post('/recordings/long/complete').status_code == 409
        chunk = b'\x19' * UPLOAD_CHUNK_BYTES
        assert client.put('/recordings/long/audio?offset=0', content=chunk).status_code == 200
        # Lost acknowledgement: reconnect at the durable server offset, without duplicating audio.
        state = client.post('/recordings', json=body).json()
        assert state['uploaded_bytes'] == len(chunk)
        assert client.put('/recordings/long/audio?offset=0', content=chunk).status_code == 409
        main.app.dependency_overrides[verify_token] = lambda: 'other'
        assert client.get('/recordings/long').status_code == 404
        assert client.put('/recordings/long/audio?offset=0', content=chunk).status_code == 404
        main.app.dependency_overrides[verify_token] = lambda: 'owner'
        assert client.put('/recordings/long/audio?offset=4194304', content=chunk + b'x').status_code == 413
        for offset in range(len(chunk), body['total_bytes'], len(chunk)):
            response = client.put(f'/recordings/long/audio?offset={offset}',
                                  content=chunk[:min(len(chunk), body['total_bytes'] - offset)])
            assert response.status_code == 200
        state = client.post('/recordings/long/complete').json()
        assert state['status'] == 'queued'
        assert client.post('/recordings/long/complete').json()['status'] == 'queued'
        seen = []
        def process(job, path, progress):
            assert path.stat().st_size == body['total_bytes']
            assert path.open('rb').read(1) == b'\x19'
            seen.append(job['id'])
            progress(80)
        assert jobs.process_one(process)
        assert not jobs.process_one(process)
        assert len(seen) == 1
        assert jobs.status('owner', state['id'])['status'] == 'completed'
        assert not (jobs._path(state['id']) / 'audio').exists()
        db.auth.admin.get_user_by_id.return_value.user = None
        assert client.post('/recordings', json={**body, 'recording_id': 'deleted-account'}).status_code == 401
        assert len(jobs.export('owner')) == 1, 'A deleted account must not create another upload'
    finally:
        main.app.dependency_overrides.clear()


def test_jobs_recover_restart_cancel_safely_and_expire_abandoned_audio(tmp_path):
    jobs = RecordingJobs(tmp_path)
    payload = RecordingUpload(recording_id='long', total_bytes=6, content_type='audio/mp4')
    job = jobs.create('owner', payload)
    jobs.append('owner', job['id'], 0, b'abcdef')
    jobs.enqueue('owner', job['id'])
    job = jobs._read(job['id'])
    job.update(status='processing')  # The process was stopped during analysis.
    jobs._write(job)
    analysis = jobs._path(job['id']) / 'analysis-abandoned'
    analysis.mkdir()
    (analysis / 'decoded.pcm').write_bytes(b'pcm')
    recovered = Event()
    def process(current, path, progress):
        assert not analysis.exists()
        assert path.read_bytes() == b'abcdef'
        jobs.cancel('owner', current['id'])
        assert path.exists(), 'An active decoder must not lose its open source file'
        with pytest.raises(HTTPException) as error:
            progress(50)
        assert error.value.status_code == 410
        recovered.set()
        raise error.value
    restarted = RecordingJobs(tmp_path)
    # Cancellation must target the running store, with its active-job guard.
    jobs = restarted
    restarted.start(process)
    try:
        assert recovered.wait(5)
    finally:
        restarted.stop()
    assert not restarted._path(job['id']).exists()

    abandoned = restarted.create('owner', payload)
    restarted.append('owner', abandoned['id'], 0, b'abc')
    abandoned = restarted._read(abandoned['id'])
    abandoned['updated_at'] -= RETENTION_SECONDS + 1
    restarted._write(abandoned)
    assert not restarted.process_one(lambda *_: pytest.fail('Incomplete audio was processed'))
    assert not restarted._path(abandoned['id']).exists()


def test_worker_retains_audio_after_retries_and_resumes_transient_failures_after_cooldown(tmp_path):
    jobs = RecordingJobs(tmp_path)
    job = jobs.create('owner', RecordingUpload(recording_id='one', total_bytes=3, content_type='audio/mp4'))
    jobs.append('owner', job['id'], 0, b'123')
    jobs.enqueue('owner', job['id'])
    def fail(*_):
        raise ConnectionError('private provider details must not reach the client')
    for attempt in range(1, 4):
        assert jobs.process_one(fail)
        state = jobs._read(job['id'])
        assert state['attempts'] == attempt
        assert state['status'] == ('failed' if attempt == 3 else 'queued')
        assert 'private provider' not in state['error']
        if attempt < 3:
            state['retry_at'] = 0
            jobs._write(state)
    assert not jobs.process_one(fail)
    assert (jobs._path(job['id']) / 'audio').read_bytes() == b'123'
    assert jobs.export('other') == []
    payload = RecordingUpload(recording_id='one', total_bytes=3, content_type='audio/mp4')
    assert jobs.create('owner', payload)['status'] == 'failed'
    state = jobs._read(job['id'])
    state['retry_at'] = 0
    jobs._write(state)
    assert jobs.create('owner', payload)['status'] == 'uploading'
    jobs.enqueue('owner', job['id'])
    assert jobs.process_one(lambda *_: None)
    assert jobs.status('owner', job['id'])['status'] == 'completed'
    assert not (jobs._path(job['id']) / 'audio').exists()
    jobs.remove_user('owner')
    assert jobs.export('owner') == []


def test_two_hour_recording_decodes_and_covers_the_full_timeline(tmp_path, monkeypatch):
    # Real FFmpeg decode of a >25 MB, >60-minute WAV. Silence avoids external AI calls.
    path = tmp_path / 'two-hours.wav'
    with wave.open(str(path), 'wb') as audio:
        audio.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
        for _ in range(120):
            audio.writeframesraw(bytes(8000 * 2 * 60))
    durations = []
    def detect(audio, sr):
        durations.append(len(audio) / sr)
        assert len(audio) <= 600 * sr
        return []
    monkeypatch.setattr(coordinator, 'detect_segments', detect)
    monkeypatch.setattr(coordinator, 'transcribe', lambda *_: pytest.fail('Silence was sent to AI'))
    result = coordinator.run(path, 'audio/wav')
    assert path.stat().st_size > 25 * 1024 * 1024
    assert sum(durations) == 7200
    assert result['stats']['session_duration_minutes'] == 120
    assert result['stats']['metadata']['diarization']['chunk_count'] == 12
    assert not list(tmp_path.glob('analysis-*'))


def test_chunk_speakers_match_by_reference_not_by_reused_anonymous_label(monkeypatch):
    audio = np.full(25 * 16000, 0.1, dtype=np.float32)
    audio[0:3] = [np.nan, np.inf, -np.inf]
    @contextmanager
    def decode(*_):
        yield audio, 16000
    monkeypatch.setattr(coordinator, '_decode_audio', decode)
    monkeypatch.setattr(coordinator, 'CHUNK_SECONDS', 10)
    monkeypatch.setattr(coordinator, 'detect_segments', lambda a, sr: [Segment(0, len(a) / sr, 0.1)])
    requests = []
    def transcribe(a, sr, known_speakers):
        assert np.isfinite(a).all()
        requests.append(known_speakers)
        label = 'part1_A' if len(requests) == 2 else 'A'
        return [TranscribedTurn(0, len(a) / sr, label, f'Part {len(requests)}.')]
    monkeypatch.setattr(coordinator, 'transcribe', transcribe)
    monkeypatch.setattr(coordinator, 'analyze', lambda *_ , **__: {})
    result = coordinator.run(b'unused')
    assert requests[0] == {}
    assert requests[1]['part1_A'].startswith('data:audio/wav;base64,')
    assert result['transcript'] == 'Speaker part1_A: Part 1.\nSpeaker part1_A: Part 2.\nSpeaker part3_A: Part 3.'
    assert result['stats']['metadata']['diarization']['speaker_durations_seconds'] == {'part1_A': 20, 'part3_A': 5}
    assert np.isfinite(result['stats']['energy_series_user']).all()


def test_voice_reference_excludes_overlapping_speech_and_is_bounded():
    audio = np.arange(20 * 16000, dtype=np.float32) / (20 * 16000)
    turns = [TranscribedTurn(0, 20, 'A', ''), TranscribedTurn(0, 11, 'B', '')]
    reference = transcription.speaker_reference(audio, 16000, turns, 'A')
    decoded, sr = sf.read(io.BytesIO(base64.b64decode(reference.split(',')[1])))
    assert 2 <= len(decoded) / sr <= 10
    np.testing.assert_allclose(decoded, audio[11 * sr:19 * sr], atol=1 / 32768)


def test_long_coaching_covers_every_part_with_bounded_context(monkeypatch):
    transcript = '\n'.join(f'PART-{n:02d} ' + 'word ' * 6000 for n in range(5))
    calls = []
    def parse(client, instructions, content, schema, tokens):
        calls.append((schema, content))
        if schema is coaching.ConversationEvidence:
            return schema(notes='Observed evidence in this part.')
        return schema(observation='o', pattern_to_reduce='p', thing_to_try_next='t')
    monkeypatch.setattr(coaching, '_parse', parse)
    monkeypatch.setattr(coaching, 'OpenAI', MagicMock())
    stats = {'metadata': {'diarization': {'user_speaker': 'part1_A'}}}
    coaching.analyze(transcript, stats)
    excerpts = [text.split('\nPart:\n', 1)[1] for schema, text in calls if schema is coaching.ConversationEvidence]
    assert ''.join(excerpts) == transcript
    assert all(len(part) <= coaching.MAX_COACHING_CONTEXT for part in excerpts)
    assert 'Evidence notes covering the recording' in calls[-1][1]
    assert stats['metadata']['coaching_context_summarized'] is True
