import io
import wave

import pytest

import app.main as main
from test_pipeline import session_io


@pytest.mark.parametrize("content_type", sorted(main.SUPPORTED_AUDIO_TYPES))
def test_supported_import_types_reach_decoder(session_io, content_type):
    client, db = session_io
    response = client.post("/sessions", files={"audio": ("original", b"audio", content_type)})
    assert response.status_code == 200
    assert main.coordinator.run.call_args.kwargs["content_type"] == content_type
    assert db.rpc.call_args.args[0] == "complete_recording"


@pytest.mark.parametrize("size,status", [(0, 422), (25 * 1024 * 1024, 200), (25 * 1024 * 1024 + 1, 413)])
def test_legacy_size_boundary_does_not_consume_usage_on_invalid_input(session_io, size, status):
    client, db = session_io
    response = client.post("/sessions", files={"audio": ("clip.wav", b"0" * size, "audio/wav")})
    assert response.status_code == status
    if status != 200:
        db.rpc.assert_not_called()
        main.coordinator.run.assert_not_called()


@pytest.mark.parametrize("claimed_duration", [None, "0", "0.5"])
@pytest.mark.parametrize("invalid", [False, True])
def test_actual_decode_enforces_duration_regardless_of_client_metadata(session_io, monkeypatch, claimed_duration, invalid):
    client, db = session_io
    monkeypatch.setattr(main.coordinator, "MAX_AUDIO_SECONDS", 1)
    body = io.BytesIO()
    with wave.open(body, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * 16001)
    def decode(audio, **kwargs):
        with main.coordinator._decode_audio(audio, kwargs["content_type"]):
            pytest.fail("Invalid audio must not reach model processing")
    main.coordinator.run.side_effect = decode
    data = {} if claimed_duration is None else {"client_duration_seconds": claimed_duration}
    response = client.post("/sessions", data=data, files={"audio": ("clip.wav", b"not audio" if invalid else body.getvalue(), "audio/wav")})
    assert response.status_code == (422 if invalid else 413)
    db.rpc.assert_not_called()
