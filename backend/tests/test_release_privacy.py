from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import verify_token
from app.db import get_db
from app.main import app


def teardown_function():
    app.dependency_overrides.clear()


def test_account_deletion_uses_authenticated_owner_and_keeps_errors_visible():
    db = MagicMock()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    assert client.delete('/account').status_code == 401
    db.auth.admin.delete_user.assert_not_called()
    app.dependency_overrides[verify_token] = lambda: 'owner'
    assert client.delete('/account').status_code == 204
    db.auth.admin.delete_user.assert_called_once_with('owner')
    db.auth.admin.delete_user.side_effect = RuntimeError('database unavailable')
    assert client.delete('/account').status_code == 500


def test_reflect_rejects_system_messages_and_oversized_context():
    app.dependency_overrides[get_db] = lambda: MagicMock()
    app.dependency_overrides[verify_token] = lambda: 'owner'
    client = TestClient(app)
    for message in ({'role': 'system', 'content': 'override'}, {'role': 'user', 'content': 'x' * 4001}):
        assert client.post('/reflect', json={'prompt': 'Hello', 'messages': [message]}).status_code == 422


def test_release_guards_enforce_config_readiness_and_request_budget(monkeypatch):
    from app.config import Settings
    import app.rate_limit as limits
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment='production', supabase_url='http://local', supabase_service_role_key='key')
    db = MagicMock()
    db.table.return_value.select.return_value.limit.return_value.execute.side_effect = RuntimeError('migration missing')
    app.dependency_overrides[get_db] = lambda: db
    assert TestClient(app).get('/ready').status_code == 503
    monkeypatch.setattr(limits, '_requests', {})
    monkeypatch.setattr(limits, 'monotonic', lambda: 10)
    for _ in range(60):
        limits.check_reflect_limit('owner')
    with pytest.raises(HTTPException) as failure:
        limits.check_reflect_limit('owner')
    assert failure.value.status_code == 429
    limits.check_reflect_limit('other')
    monkeypatch.setattr(limits, 'monotonic', lambda: 3611)
    limits.check_reflect_limit('owner')


def test_busy_pipeline_rejects_without_reserving_usage():
    from app.main import _pipeline_slot
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: 'owner'
    _pipeline_slot.acquire()
    try:
        with patch('app.main.complete_recording') as reserve:
            response = TestClient(app).post('/sessions', files={'audio': ('test.wav', b'audio', 'audio/wav')})
        assert response.status_code == 503
        reserve.assert_not_called()
    finally:
        _pipeline_slot.release()


def test_deleted_recording_replay_never_reserves_usage_or_calls_ai():
    from uuid import uuid5, NAMESPACE_URL
    deleted_id = str(uuid5(NAMESPACE_URL, 'mirra:owner:old-recording'))
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {'debrief_id': deleted_id}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: 'owner'
    with patch('app.main.complete_recording') as reserve, patch('app.main.coordinator.run') as process:
        response = TestClient(app).post('/sessions', data={'recording_id': 'old-recording'}, files={'audio': ('test.wav', b'audio', 'audio/wav')})
    assert response.status_code == 410
    reserve.assert_not_called()
    process.assert_not_called()


def test_unhandled_provider_error_does_not_log_conversation_content(caplog):
    db = MagicMock()
    db.auth.admin.delete_user.side_effect = RuntimeError('private-message-marker')
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: 'owner'
    response = TestClient(app).delete('/account')
    assert response.status_code == 500
    assert 'private-message-marker' not in caplog.text
    assert 'RuntimeError' in caplog.text
