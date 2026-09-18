import io
import wave
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

import app.main as main
from test_pipeline import session_io


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    main.app.dependency_overrides.clear()


@pytest.mark.parametrize("content_type", sorted(main.SUPPORTED_AUDIO_TYPES))
def test_supported_import_types_reach_decoder(session_io, content_type):
    client, _db, reserve, _refund = session_io
    response = client.post("/sessions", files={"audio": ("original", b"audio", content_type)})
    assert response.status_code == 200
    assert main.coordinator.run.call_args.kwargs["content_type"] == content_type
    reserve.assert_called_once()


@pytest.mark.parametrize("size,status", [(99, 200), (100, 200), (101, 413), (0, 422)])
def test_size_boundary_is_inclusive_and_invalid_files_do_not_reserve_usage(session_io, monkeypatch, size, status):
    client, _db, reserve, refund = session_io
    assert main.MAX_AUDIO_BYTES == 100 * 1024 * 1024
    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 100)
    response = client.post("/sessions", files={"audio": ("clip.wav", b"0" * size, "audio/wav")})
    assert response.status_code == status
    if status != 200:
        reserve.assert_not_called()
        main.coordinator.run.assert_not_called()
        assert "100 MiB" in response.json()["detail"] if size else "empty" in response.json()["detail"]
    refund.assert_not_called()


@pytest.mark.parametrize("content_type", ["application/octet-stream", "text/plain", "audio/not-supported"])
def test_unsupported_import_type_is_actionable_without_usage(session_io, content_type):
    client, _db, reserve, _refund = session_io
    response = client.post("/sessions", files={"audio": ("clip.m4a", b"audio", content_type)})
    assert response.status_code == 415
    assert "M4A, MP3, WAV, WebM" in response.json()["detail"]
    reserve.assert_not_called()
    main.coordinator.run.assert_not_called()


def test_incoming_read_is_bounded_to_limit_plus_one(session_io, monkeypatch):
    _client, db, reserve, _refund = session_io
    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 100)
    original = io.BytesIO(b"x" * 1000)
    read = MagicMock(wraps=original.read)
    audio = UploadFile(file=MagicMock(read=read), filename="clip.wav", headers=Headers({"content-type": "audio/wav"}))
    with pytest.raises(HTTPException) as error:
        main._process_session(audio, None, None, None, "user-1", db, None)
    assert error.value.status_code == 413
    read.assert_called_once_with(101)
    assert original.tell() == 101
    assert len(original.getvalue()) == 1000
    reserve.assert_not_called()


@pytest.mark.parametrize("claimed_duration", [None, "0", "0.5"])
@pytest.mark.parametrize("invalid", [False, True])
def test_actual_decode_rejects_overlong_or_corrupt_imports_regardless_of_client_metadata(
    session_io, monkeypatch, claimed_duration, invalid,
):
    client, db, reserve, refund = session_io
    # Exercise the actual decoder at a small boundary, including one extra PCM sample.
    # The configured production limit is asserted in test_diarization.py.
    monkeypatch.setattr(main.coordinator, "MAX_RECORDING_SECONDS", 1)
    body = io.BytesIO()
    with wave.open(body, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * 16001)
    def decode(audio_bytes, content_type):
        main.coordinator._decode_audio(audio_bytes, content_type)
        pytest.fail("Invalid audio must not reach model processing")
    main.coordinator.run.side_effect = decode
    data = {} if claimed_duration is None else {"client_duration_seconds": claimed_duration}
    response = client.post("/sessions", data=data, files={
        "audio": ("clip.wav", b"not audio" if invalid else body.getvalue(), "audio/wav"),
    })
    assert response.status_code == (422 if invalid else 413)
    assert "Could not decode audio" in response.json()["detail"] if invalid else "23 minutes 20 seconds" in response.json()["detail"]
    reserve.assert_called_once_with(db, "user-1")
    refund.assert_called_once_with(db, "user-1", "2026-08")
    db.table.return_value.insert.assert_not_called()
