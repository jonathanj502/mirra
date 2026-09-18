"""Real atomic-completion SQL checks. Opt in with MIRRA_TEST_PG_SOCKET pointing to a disposable local cluster.

Uses only psql/stdlib; creates and drops its own database, never connects to a remote host.
The isolated cluster must allow local trust auth and creation of the Supabase test roles.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from app import usage

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
        assert name == "complete_recording"
        args = []
        for key, value in params.items():
            value = json.dumps(value) if isinstance(value, dict) else str(value)
            args.append(f"{key} => '{value.replace(chr(39), chr(39) * 2)}'")
        call = f"public.{name}({', '.join(args)})"
        query = f"select {call};"
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=json.loads(self.sql(query) or "null")))

    def count(self, owner=OWNER):
        return int(self.sql(f"select coalesce((select count from public.debrief_usage where user_id='{owner}' and month_key=to_char(timezone('utc',now()),'YYYY-MM')),0);"))


@pytest.fixture(scope="module")
def cluster():
    socket = os.environ.get("MIRRA_TEST_PG_SOCKET")
    if not socket:
        pytest.skip("Set MIRRA_TEST_PG_SOCKET for the isolated PostgreSQL transaction checks")
    assert Path(socket).is_absolute(), "Only a local Unix socket is supported"
    args = ["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
            "-h", socket, "-p", os.environ.get("MIRRA_TEST_PG_PORT", "55438"), "-d"]
    admin = Postgres([*args, "postgres"])
    name = "mirra_completion_" + uuid4().hex
    admin.sql(f"create database {name};", role=None)
    pg = Postgres([*args, name])
    try:
        for role in ("anon", "authenticated", "service_role"):
            admin.sql(f"""do $$ begin
                if not exists (select 1 from pg_roles where rolname = '{role}') then
                  create role {role} {'bypassrls' if role == 'service_role' else ''};
                end if; end $$;""", role=None)
        root = Path(__file__).resolve().parents[2]
        bootstrap = (root / "supabase/tests/bootstrap.sql").read_text()
        bootstrap = re.sub(r"^create role .*;\n", "", bootstrap, flags=re.M)
        pg.sql(bootstrap, role=None)
        for migration in sorted((root / "supabase/migrations").glob("*.sql")):
            pg.sql(migration.read_text(), role=None)
        pg.sql((root / "supabase/tests/privacy.sql").read_text(), role=None)
        pg.sql((root / "supabase/tests/long_recordings.sql").read_text(), role=None)
        yield pg
    finally:
        admin.sql(f"drop database {name};", role=None)


@pytest.fixture
def pg(cluster):
    cluster.sql("truncate auth.users cascade;", role=None)
    cluster.sql(f"insert into auth.users values ('{OWNER}'), ('{OTHER}');", role=None)
    return cluster


def test_concurrent_completion_cap_and_same_id_replay_are_atomic(pg):
    keys = [str(uuid4()) for _ in range(8)]
    def complete(key):
        try:
            usage.complete_recording(pg, OWNER, key, PAYLOAD)
            return True
        except HTTPException as exc:
            return exc.status_code
    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(complete, keys))
    assert outcomes.count(True) == 5 and outcomes.count(402) == 3
    assert pg.count() == 5
    key = keys[outcomes.index(True)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert all(pool.map(complete, [key] * 8))
    assert pg.count() == 5
    assert pg.sql("select count(*) from public.debriefs;") == "5"


def test_completion_failure_rolls_back_usage_and_cannot_cross_accounts(pg):
    key = str(uuid4())
    with pytest.raises(APIError):
        usage.complete_recording(pg, OWNER, key, {**PAYLOAD, "observation": None})
    assert pg.count() == 0
    usage.complete_recording(pg, OWNER, key, PAYLOAD)
    with pytest.raises(APIError):
        usage.complete_recording(pg, OTHER, key, PAYLOAD)
    assert pg.count(OTHER) == 0 and pg.count() == 1


def test_process_death_after_commit_replays_one_charge(pg):
    key = str(uuid4())
    script = f"""import os, runpy
ns = runpy.run_path({str(Path(__file__).resolve())!r})
pg = ns['Postgres']({pg.args!r})
ns['usage'].complete_recording(pg, ns['OWNER'], {key!r}, ns['PAYLOAD'])
os._exit(17)
"""
    result = subprocess.run([sys.executable, "-c", script], timeout=30)
    assert result.returncode == 17
    usage.complete_recording(pg, OWNER, key, PAYLOAD)
    assert pg.count() == 1
    assert pg.sql("select count(*) from public.debriefs;") == "1"


def test_cancellation_racing_completion_cannot_resurrect_recording(pg):
    key = str(uuid4())
    def cancel():
        pg.sql(f"select public.delete_debrief_permanently('{OWNER}', '{key}');")
    def complete():
        try:
            usage.complete_recording(pg, OWNER, key, PAYLOAD)
        except HTTPException as exc:
            assert exc.status_code == 410
    with ThreadPoolExecutor(max_workers=2) as pool:
        tasks = [pool.submit(cancel), pool.submit(complete)]
        for task in tasks:
            task.result()
    assert pg.sql("select count(*) from public.debriefs;") == "0"
    assert pg.sql("select count(*) from public.debrief_deletions;") == "1"
    before = pg.count()
    with pytest.raises(HTTPException) as exc:
        usage.complete_recording(pg, OWNER, key, PAYLOAD)
    assert exc.value.status_code == 410 and pg.count() == before
