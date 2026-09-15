from unittest.mock import MagicMock
from uuid import uuid4

import httpx
import pytest

from scripts import smoke_beta


@pytest.mark.parametrize("own_account,valid_id,lookup_status", [
    (False, True, 200), (True, True, 200), (True, False, 200), (True, True, 503),
])
def test_smoke_cleanup_requires_authoritative_matching_test_account(monkeypatch, tmp_path, own_account, valid_id, lookup_status):
    audio = tmp_path / "synthetic.m4a"
    audio.write_bytes(b"test input; pipeline is not reached")
    monkeypatch.setattr("sys.argv", ["smoke_beta", "--url", "https://backend.invalid", "--audio", str(audio)])
    user_id = str(uuid4()) if valid_id else "../existing-user"
    client = MagicMock()
    client.__enter__.return_value = client
    generated_email = None

    def response(payload, status=200):
        return httpx.Response(status, json=payload, request=httpx.Request("GET", "https://test.supabase.co"))

    def request(method, path, **kwargs):
        nonlocal generated_email
        if path == "/health":
            return response({"status": "ok"})
        if path == "/auth/status":
            return response({"username_password_ready": True})
        if path == "/auth/username/sign-up":
            generated_email = kwargs["json"]["username"] + "@users.mirra.local"
            return response({"access_token": "untrusted", "user": {"id": user_id}})
        raise RuntimeError("Stop after account validation")

    client.request.side_effect = request
    monkeypatch.setattr(smoke_beta.httpx, "Client", lambda **kwargs: client)
    lookup = MagicMock(side_effect=lambda *args, **kwargs: response({
        "id": user_id, "email": generated_email if own_account else "existing-user@example.com",
    }, lookup_status))
    delete = MagicMock(return_value=response({}))
    monkeypatch.setattr(smoke_beta.httpx, "get", lookup)
    monkeypatch.setattr(smoke_beta.httpx, "delete", delete)

    expected_error = ValueError if not valid_id else httpx.HTTPStatusError if lookup_status != 200 else RuntimeError
    with pytest.raises(expected_error):
        smoke_beta.main()
    assert lookup.call_count == int(valid_id)
    can_delete = own_account and valid_id and lookup_status == 200
    assert delete.call_count == int(can_delete)
    if valid_id:
        assert lookup.call_args.args[0] == smoke_beta.settings.supabase_url.rstrip("/") + "/auth/v1/admin/users/" + user_id
    if can_delete:
        assert delete.call_args.args[0] == lookup.call_args.args[0]
