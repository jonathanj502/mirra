"""Real SQL checks. Opt in with MIRRA_TEST_PG_SOCKET pointing to a disposable local cluster.

Uses only psql/stdlib; creates and drops its own database, never connects to a remote host.
The isolated cluster must allow local trust auth and creation of the Supabase test roles.
"""
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from fastapi import HTTPException, UploadFile
from postgrest.exceptions import APIError
from starlette.datastructures import Headers

from app import main, usage
from app.models.settings import UserSettings

OWNER = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
PAYLOAD = {"session_id": "test-session", "observation": "Test", "pattern_to_reduce": "Test",
           "thing_to_try_next": "Test", "stats": {}, "transcript": None}


class Postgres:
    def __init__(self, args):
        self.args = args

    def sql(self, statement, role="service_role"):
        result = subprocess.run(self.args, input=(f"set role {role};\n" if role else "") + statement,
                                text=True, capture_output=True, timeout=15)
        if result.returncode:
            code = re.search(r"ERROR:\s+(\w{5}):", result.stderr)
            raise APIError({"code": code[1] if code else "unknown", "message": result.stderr,
                            "details": "", "hint": ""})
        return result.stdout.strip()

    def rpc(self, name, params):
        assert name in {"reserve_debrief", "release_debrief", "complete_debrief"}
        args = []
        for key, value in params.items():
            value = json.dumps(value) if isinstance(value, dict) else str(value)
            args.append(f"{key} => '{value.replace(chr(39), chr(39) * 2)}'")
        call = f"public.{name}({', '.join(args)})"
        query = f"select coalesce(json_agg(r), '[]') from {call} r;" if name == "complete_debrief" else f"select to_json({call});"
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=json.loads(self.sql(query) or "null")))

    def count(self, owner=OWNER, month="2026-09"):
        return int(self.sql(f"select coalesce((select count from public.debrief_usage where user_id='{owner}' and month_key='{month}'),0);"))


@pytest.fixture(scope="module")
def cluster():
    socket = os.environ.get("MIRRA_TEST_PG_SOCKET")
    if not socket:
        pytest.skip("Set MIRRA_TEST_PG_SOCKET for the isolated PostgreSQL transaction checks")
    assert Path(socket).is_absolute(), "Only a local Unix socket is supported"
    args = ["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
            "-h", socket, "-p", os.environ.get("MIRRA_TEST_PG_PORT", "55438"), "-d"]
    admin = Postgres([*args, "postgres"])
    name = "mirra_receipts_" + uuid4().hex
    admin.sql(f"create database {name};", role=None)
    pg = Postgres([*args, name])
    try:
        for role in ("anon", "authenticated", "service_role"):
            admin.sql(f"""do $$ begin
                if not exists (select 1 from pg_roles where rolname = '{role}') then
                  create role {role} {'bypassrls' if role == 'service_role' else ''};
                end if; end $$;""", role=None)
        pg.sql("""create schema auth;
            create table auth.users(id uuid primary key);
            create function auth.uid() returns uuid language sql as $$select null::uuid$$;
            grant usage on schema public to anon, authenticated, service_role;""", role=None)
        migrations = Path(__file__).resolve().parents[2] / "supabase/migrations"
        pg.sql((migrations / "20260609050530_create_debriefs_and_debrief_usage.sql").read_text(), role=None)
        pg.sql("grant select, insert, update, delete on public.debriefs, public.debrief_usage to service_role;", role=None)
        pg.sql((migrations / "20260918010000_durable_debrief_receipts.sql").read_text(), role=None)
        yield pg
    finally:
        admin.sql(f"drop database {name};", role=None)


@pytest.fixture
def pg(cluster):
    cluster.sql("truncate auth.users cascade;", role=None)
    cluster.sql(f"insert into auth.users values ('{OWNER}'), ('{OTHER}');", role=None)
    return cluster


def reserve(pg, key, attempt, owner=OWNER, month="2026-09", cap=5):
    return usage._receipt_rpc(pg, "reserve_debrief", owner, key, attempt, p_month_key=month, p_cap=cap)


def test_concurrent_cap_checks_and_same_id_attempts_are_atomic(pg):
    keys = [str(uuid4()) for _ in range(8)]

    def request(key):
        try:
            return reserve(pg, key, str(uuid4()))
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(request, keys))
    assert outcomes.count(True) == 5 and outcomes.count(402) == 3
    assert pg.count() == 5
    key = keys[outcomes.index(True)]
    attempts = [str(uuid4()) for _ in range(8)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert all(pool.map(lambda attempt: reserve(pg, key, attempt), attempts))
    assert pg.count() == 5
    current = pg.sql(f"select attempt_id from public.debrief_receipts where debrief_id='{key}';")
    stale = next(attempt for attempt in attempts if attempt != current)
    usage.release(pg, OWNER, key, stale)
    with pytest.raises(HTTPException) as exc:
        usage.complete_debrief(pg, OWNER, key, stale, PAYLOAD)
    assert exc.value.status_code == 409
    first = usage.complete_debrief(pg, OWNER, key, current, PAYLOAD)
    assert usage.complete_debrief(pg, OWNER, key, current, PAYLOAD) == first
    usage.release(pg, OWNER, key, current)
    assert pg.count() == 5
    assert pg.sql("select count(*) from public.debriefs;") == "1"


def test_month_rollover_refund_and_account_isolation(pg):
    key, old, new = (str(uuid4()) for _ in range(3))
    assert reserve(pg, key, old)
    assert reserve(pg, key, new, month="2026-10")
    assert (pg.count(), pg.count(month="2026-10")) == (1, 0)
    with pytest.raises(HTTPException) as exc:
        reserve(pg, key, str(uuid4()), owner=OTHER)
    assert exc.value.status_code == 409
    usage.release(pg, OTHER, key, new)
    usage.release(pg, OWNER, key, old)
    assert pg.count() == 1
    usage.release(pg, OWNER, key, new)
    usage.release(pg, OWNER, key, new)
    assert pg.count() == 0
    assert reserve(pg, key, str(uuid4()), month="2026-10")
    assert pg.count(month="2026-10") == 1


def test_completion_rollback_and_deleted_completed_id_cannot_refund_or_recreate(pg):
    key, attempt = str(uuid4()), str(uuid4())
    reserve(pg, key, attempt)
    with pytest.raises(APIError):
        usage.complete_debrief(pg, OWNER, key, attempt, {**PAYLOAD, "observation": None})
    assert pg.sql("select count(*) from public.debriefs;") == "0"
    assert pg.sql("select completed from public.debrief_receipts;") == "f"
    usage.complete_debrief(pg, OWNER, key, attempt, PAYLOAD)
    pg.sql(f"delete from public.debriefs where id='{key}';")
    assert reserve(pg, key, str(uuid4())) is False
    usage.release(pg, OWNER, key, attempt)
    assert pg.count() == 1
    with pytest.raises(HTTPException) as exc:
        usage.complete_debrief(pg, OWNER, key, attempt, PAYLOAD)
    assert exc.value.status_code == 410


@pytest.mark.parametrize("completed", [False, True])
def test_process_death_after_reserve_or_commit_reuses_one_charge(pg, completed):
    key, attempt = str(uuid4()), str(uuid4())
    script = f"""import os, runpy
ns = runpy.run_path({str(Path(__file__).resolve())!r})
pg = ns['Postgres']({pg.args!r})
ns['reserve'](pg, {key!r}, {attempt!r})
if {completed!r}:
    ns['usage'].complete_debrief(pg, ns['OWNER'], {key!r}, {attempt!r}, ns['PAYLOAD'])
os._exit(17)
"""
    result = subprocess.run([sys.executable, "-c", script], timeout=30)
    assert result.returncode == 17
    assert pg.count() == 1
    fresh = str(uuid4())
    assert reserve(pg, key, fresh) is (not completed)
    usage.complete_debrief(pg, OWNER, key, fresh, PAYLOAD)
    assert pg.count() == 1
    assert pg.sql("select count(*) from public.debriefs;") == "1"


def test_rpc_and_receipts_are_service_role_only(pg):
    key, attempt = str(uuid4()), str(uuid4())
    for role in ("anon", "authenticated"):
        for query in (
            "select * from public.debrief_receipts;",
            f"select public.reserve_debrief('{OWNER}','{key}','{attempt}','2026-09',5);",
            f"select public.release_debrief('{OWNER}','{key}','{attempt}');",
            f"select public.complete_debrief('{OWNER}','{key}','{attempt}','{{}}');",
        ):
            with pytest.raises(APIError) as exc:
                pg.sql(query, role=role)
            assert exc.value.code == "42501"
    assert pg.sql("select relrowsecurity from pg_class where oid='public.debrief_receipts'::regclass;", role=None) == "t"


def test_real_receipts_with_competing_uploads_busy_replay_timeout_and_legacy_requests(pg, monkeypatch):
    monkeypatch.setattr(usage, "_month_key", lambda: "2026-09")
    monkeypatch.setattr(main, "fetch_user_settings", lambda *_: UserSettings())
    monkeypatch.setattr(main, "get_usage", lambda _db, owner: {"used_this_month": pg.count(owner), "remaining": 5 - pg.count(owner)})
    monkeypatch.setattr(main, "_fetch_debrief_row", lambda _db, owner, key: json.loads(pg.sql(
        f"select coalesce((select row_to_json(d) from public.debriefs d where user_id='{owner}' and id='{key}'),'null');")))
    entered, finish = Event(), Event()

    def process(*_args, **_kwargs):
        entered.set()
        assert finish.wait(5)
        return PAYLOAD

    monkeypatch.setattr(main.coordinator, "run", process)

    def upload(key):
        audio = UploadFile(filename="test.wav", file=io.BytesIO(b"audio"), headers=Headers({"content-type": "audio/wav"}))
        try:
            return main.create_session(audio, None, None, None, key, OWNER, pg)
        except HTTPException as exc:
            if exc.status_code in {409, 503}:
                assert audio.file.tell() == 0, 'Admission rejection must precede reading audio bytes'
            raise

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(upload, "first")
        assert entered.wait(5)
        try:
            for key, status in (("first", 409), ("second", 503)):
                with pytest.raises(HTTPException) as exc:
                    upload(key)
                assert exc.value.status_code == status
                if status == 503:
                    assert exc.value.headers["Retry-After"] == "60"
            assert pg.count() == 1
        finally:
            finish.set()
        saved = first.result(timeout=5)
        entered.clear()
        finish.clear()
        second = pool.submit(upload, "second")
        assert entered.wait(5)
        try:
            assert upload("first")["debrief"]["id"] == saved["debrief"]["id"]
        finally:
            finish.set()
        second.result(timeout=5)
    assert pg.count() == 2
    import httpx
    from openai import APITimeoutError

    def timeout(*_args, **_kwargs):
        raise APITimeoutError(request=httpx.Request("POST", "https://test.invalid"))

    monkeypatch.setattr(main.coordinator, "run", timeout)
    with pytest.raises(APITimeoutError):
        upload("provider-timeout")
    assert pg.count() == 2
    monkeypatch.setattr(main.coordinator, "run", lambda *_args, **_kwargs: PAYLOAD)
    recovered = upload("provider-timeout")
    assert upload("provider-timeout")["debrief"]["id"] == recovered["debrief"]["id"]
    legacy = [upload(None)["debrief"]["id"] for _ in range(2)]
    assert legacy[0] != legacy[1] and pg.count() == 5
    assert not main._audio_pipeline_lock.locked() and not main._processing_sessions
    key = str(uuid5(NAMESPACE_URL, f"mirra:{OWNER}:provider-timeout"))
    pg.sql(f"delete from public.debriefs where id='{key}';")
    with pytest.raises(HTTPException) as exc:
        upload("provider-timeout")
    assert exc.value.status_code == 410
    assert pg.count() == 5
