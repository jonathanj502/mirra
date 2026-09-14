from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import verify_token
from app.db import get_db
from app.main import app


def teardown_function():
    app.dependency_overrides.clear()


def test_reports_require_auth_validate_content_and_scope_conversation_ownership():
    db = MagicMock()
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    report = {'source': 'reflect', 'content': 'A response to review', 'reason': 'harmful'}
    assert client.post('/content-reports', json=report).status_code == 401
    app.dependency_overrides[verify_token] = lambda: 'owner'
    for patch_value in ({'content': 'x' * 8001}, {'reason': 'invalid'}, {'comment': 'x' * 1001}, {'source': 'debrief'}):
        assert client.post('/content-reports', json={**report, **patch_value}).status_code == 422
    with patch('app.main.check_request_limit') as limit:
        assert client.post('/content-reports', json={**report, 'user_id': 'attacker-selected-owner'}).status_code == 204
        limit.assert_called_with('owner', 'Content reports', 20)
        written = db.table.return_value.insert.call_args.args[0]
        assert written == {**report, 'comment': '', 'debrief_id': None, 'user_id': 'owner'}
        db.table.return_value.insert.reset_mock()
        target = '00000000-0000-0000-0000-000000000201'
        with patch('app.main._fetch_debrief_row', return_value=None) as find:
            assert client.post('/content-reports', json={**report, 'debrief_id': target}).status_code == 404
            find.assert_called_once_with(db, 'owner', target)
            db.table.return_value.insert.assert_not_called()
        db.table.return_value.insert.return_value.execute.side_effect = RuntimeError('private-report-text')
        assert client.post('/content-reports', json=report).status_code == 500


def test_report_budget_is_separate_from_reflect_and_resets(monkeypatch):
    import app.rate_limit as limits
    monkeypatch.setattr(limits, '_requests', {})
    monkeypatch.setattr(limits, 'monotonic', lambda: 1)
    for _ in range(20):
        limits.check_request_limit('owner', 'Content reports', 20)
    with pytest.raises(HTTPException) as failure:
        limits.check_request_limit('owner', 'Content reports', 20)
    assert failure.value.status_code == 429
    limits.check_reflect_limit('owner')
    monkeypatch.setattr(limits, 'monotonic', lambda: 3602)
    limits.check_request_limit('owner', 'Content reports', 20)
