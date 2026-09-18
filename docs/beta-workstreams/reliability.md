# Retry, concurrency, and offline recovery evidence

Updated 2026-09-18 UTC. **Local candidate only. TF-4 and TF-7 remain open.**

Worktree: `/Users/jonathanj/.codex/worktrees/0f48/mirra`.
Branch: `codex/beta-reliability`.
Clean starting baseline: `773d35f3e554f8c8353f17c81b7bd847cc9078a1`.
The initially detached `f628b73` worktree was fast-forwarded to that baseline;
no other checkout was changed. No production traffic, migration, deployment,
push, merge into shared branches, or billing change was performed here.

Local implementation commits, in order:

- `ea2c446013c3d1e00251017fdbe76605483fe65d`: imported titles, safe native storage,
  source durability/restart checks. Imports already cherry-picked this support.
- `cbeb38242a52f75b263f52879ec21932df40b043`: unknown-duration metadata omission,
  terminal rejection retention, 35-minute deadline and retry/account checks.
- `ecb3413f3f8d1e0fa2547e3e8e0c007040a0ce3b`: quota migration, backend integration,
  updated mock tests and isolated PostgreSQL suite. Integrate with the imports
  task's separately owned input-validation changes; its old reservation/refund
  mock signatures need adapting to `(db, user_id, debrief_id, attempt_id)`.

No independent pre-push review was requested/performed here because this task
does not push. Integration must obtain the required code-critic review of the
exact eventual outgoing range, including the migration and merged changes.

## Confirmed defects and changes

- An upload that crashed after incrementing `debrief_usage`, but before inserting
  a debrief, left an anonymous charge. Retrying the same recording could increment
  again because only saved debriefs, not reservations, had an idempotency key.
  The new `debrief_receipts` migration ties each charge to a debrief ID and an
  attempt token. Reserve/cap check, refund, and final save each run in a database
  transaction. Final save commits the debrief and completion marker together.
- Completed uploads previously waited behind unrelated model work. Saved-response
  replay now precedes the processing lock and can acknowledge the existing row
  while another conversation is being analyzed.
- Imported display filenames could collide with the queue manifest or contain
  path separators. New native queue entries use a fixed internal `audio` filename;
  the original name and MIME remain upload metadata. Old queue filenames and iOS
  container-path rebasing still work.
- Queue entries can preserve imported titles. Unknown imported duration is omitted
  from advisory request metadata. The imports task owns picker validation, consent
  and account checks, enqueue routing, UI, and the web upload MIME correction.
- HTTP 400/410/413/415/422 clips remain on-device with the error, and the foreground
  poll proceeds to other clips without resubmitting the rejected clip. Explicit
  Discard removes it. The error/backoff map is in memory, so relaunch can recheck
  a rejected file once; no persistent failure schema was added.
- The queue has a bounded **2100-second / 35-minute** request deadline, coordinated
  with the transcription task's 600-second attempts and one retry. It is provisional
  headroom, not a guaranteed backend deadline or measured typical processing time.
  An abort retains audio and the same recording ID for replay. The provider task
  owns real maximum-length timing and the matching smoke deadline.

## Local validation

| Check | Result and limits |
| --- | --- |
| Full backend suite | **152 passed, 7 optional SQL checks skipped**, one existing Starlette/httpx warning. Run with a task-specific Numba cache; no credentials or provider calls. |
| PostgreSQL receipt suite | **7 passed**, PostgreSQL 14.23 on a disposable Unix-socket cluster. Explicit opt-in; creates and drops its own database. No Supabase/PostgREST deployment was involved. |
| Full app suite | **33 passed**, including 11 queue/storage/retry checks. Native APIs/network/auth are controlled boundaries; this is not iPhone evidence. |
| App TypeScript | **PASS**. Reused the main checkout's installed dependencies through a temporary local symlink; no install or main environment mutation. |
| Whitespace | `git diff --check` **PASS**. |

The real SQL suite covers eight simultaneous cap contenders (five admitted),
eight retries of the same ID (one receipt/charge), stale-attempt completion/refund,
failed-insert rollback, account isolation, duplicate refunds, September-to-October
retry/refund, completed debrief deletion, and client-role permission denial.
Two child processes actually exit with `os._exit(17)` immediately after reserve
or commit; a fresh attempt then completes/replays with one row and one charge.

It also runs the actual `main.create_session` flow against those SQL RPCs with
only audio/provider work mocked: same-ID 409, other-ID 503 with `Retry-After: 60`,
neither rejection reading audio bytes or reserving another unit; existing-row
replay during another active pipeline; propagated OpenAI `APITimeoutError`, refund,
same-ID recovery; and legacy requests without `recording_id` receiving distinct
server IDs. Existing HTTP tests still verify response/status behavior.

App checks cover the 60-second busy backoff, the 2100-second abort callback, lost
successful acknowledgment, refreshed token after 401, account switch during an
upload (abort, hide old account queue, retain its clip), consent withdrawal while
preparing/between uploads, serial reconnect uploads, stopped/saved clips across
relaunch, explicit discard, and original bytes retained through failed copy,
manifest write, or manifest rename. A completed temporary manifest is recoverable.

One repeated SQL run reported all 7 passed but then exited 134 with a native
`recursive_mutex lock failed` shutdown error. A fresh unchanged rerun passed all
7 and exited 0; the earlier first run also exited 0. Cause not established; retain
this observation for integrated runtime verification rather than claiming every
local process exit was clean. No production runtime conclusion follows from it.

### Reproduction

From the repository root, using an installed project environment:

```sh
cd backend
NUMBA_CACHE_DIR=/private/tmp/mirra-reliability-numba .venv/bin/python -m pytest -q
```

This worktree reused
`/Users/jonathanj/Projects/mirra/backend/.venv/bin/python` instead of creating a
new environment. The SQL tests intentionally skip unless explicitly configured.
Start a disposable PostgreSQL cluster, with `initdb`, `pg_ctl`, and `psql` on PATH:

```sh
mkdir -p /private/tmp/mirra-reliability-pg
initdb -D /private/tmp/mirra-reliability-pg/data -A trust --no-locale
pg_ctl -D /private/tmp/mirra-reliability-pg/data \
  -l /private/tmp/mirra-reliability-pg/server.log \
  -o '-k /private/tmp/mirra-reliability-pg -p 55438 -h 127.0.0.1' start
MIRRA_TEST_PG_SOCKET=/private/tmp/mirra-reliability-pg MIRRA_TEST_PG_PORT=55438 \
  .venv/bin/python -m pytest -q tests/test_receipt_transactions.py
pg_ctl -D /private/tmp/mirra-reliability-pg/data stop -m fast
```

Use a fresh task-specific directory/port if those are already in use. The test
cluster must permit creating the test database and Supabase-like roles; the
suite refuses a TCP hostname. The commands do not target the linked Supabase
project. From `app/`, run `node --test tests/*.test.mjs` and `npm run typecheck`.

## Migration and integration contract

Migration: `supabase/migrations/20260918010000_durable_debrief_receipts.sql`.
It is additive: one table, one owner index, three RPCs; it does not rewrite old
usage or debrief rows. Uses PostgreSQL transaction-level advisory locks, row locks,
PL/pgSQL, JSONB, and `hashtextextended`; verified on PostgreSQL 14.23. The linked
project declares PostgreSQL 15, which remains to be checked through its actual
Supabase/PostgREST environment. No extension or distributed job queue is needed.

- **Security:** `SECURITY INVOKER`, empty `search_path`, qualified table references.
  Receipt RLS is enabled with no client policies; explicit table and function
  privileges are revoked from PUBLIC/anon/authenticated and granted only to
  `service_role`. The authenticated backend chooses user, cap, month, and attempt;
  public clients cannot create, inspect, complete, or refund receipts. Receipt rows
  contain IDs/month/status only and cascade on account deletion.
- **Idempotency:** a recording ID still maps to an account-scoped UUID. A new attempt
  reuses its reservation and replaces the attempt token. A stale worker cannot
  refund or commit over the replacement. A completed receipt cannot refund, charge
  again, or recreate a deleted debrief; deleted completed IDs return 410. Saved
  rows created before this migration still replay through the existing row lookup.
- **Months:** retries reuse the original reservation month even after rollover;
  refunds target that stored month. A successfully refunded attempt followed by a
  later fresh reservation uses the new month. Current usage responses still show
  the current month. Deleted completed debriefs do not refund usage.
- **Legacy requests:** omitting `recording_id` remains accepted and gets a fresh
  server UUID before reservation. Such requests cannot identify a later replay and
  therefore do not gain cross-request deduplication. The current recording queue
  and the separately integrated import queue send stable IDs.

For an authorized rollout, review the exact integrated commits first, apply the
migration before deploying the new backend, verify RPC visibility and permissions,
then drain/stop old workers and switch to the candidate. The new backend must not
run against a schema missing these RPCs; it fails closed and keeps queued audio
on a retryable 500, with no fallback to the old counter mutation. Applying the
additive migration alone leaves the currently deployed code working as before,
but does not fix its anonymous reservations. Do not claim new guarantees for
mixed old/new worker traffic or already abandoned pre-migration charges.

For rollback, retain the receipt table and coordinate a write pause/reconciliation
before using the old writer: it cannot reuse pending receipts and can charge again.
Do not drop receipts or reset counters as an automatic rollback step. Old counter
leaks cannot safely be reconstructed from remaining debriefs because conversation
deletion intentionally does not refund usage; an audited manual decision is needed.

## Throughput ceilings and open checks

- One audio pipeline per **process**, same-ID 409 and competing-ID 503. The receipt
  transactions protect rows and quota across attempts; they do not limit memory
  across multiple workers or prevent duplicate provider work in separate workers.
  Keep single-worker deployment unless separate admission/capacity work proves more.
- Foreground retry polling is 15 seconds, busy/server errors wait 60 seconds, cap
  errors wait 5 minutes. There is no server FIFO/fairness guarantee or background
  upload job while the app is force-quit.
- A server-crashed reservation whose original clip is subsequently abandoned or
  discarded stays counted in its reservation month. Replaying that ID reuses it;
  explicit processing failure refunds it. No automatic stale-receipt reaper or
  cancel API was added. Add audited reconciliation if crash-then-discard refunds
  are required; do not free a reservation while another attempt might commit.
- Original audio is preserved when saving fails, but the user must keep the app
  open and retry saving; durability is established after Stop/save completes.
  Active recording termination before save and storage exhaustion remain device
  concerns. New fixed filenames do not change the encoded original bytes.
- Render's existing 512 MB memory failure, maximum-length real provider flow,
  production latency/connection timeouts, and physical TF-4 remain separate gates.
  No live load was placed on production for this workstream. Web IndexedDB was
  unchanged; this pass focused on native storage and the shared upload loop.

## Physical TF-4 checklist sent to integration/device

On the candidate build, record build number, iPhone/iOS version, timestamps and
usage deltas; use disposable accounts and consenting speech, not private fixtures.

1. Sign in as A, enable airplane mode, record/Stop two distinguishable clips.
   Confirm both saved; force-quit and relaunch offline, still two clips.
2. Reconnect in the foreground. Verify exactly two new debriefs and usage +2;
   relaunch and verify no duplicates. Repeat after an expired access token.
3. Queue an A clip, switch to B: B must not expose/upload A's clip. Return to A;
   its clip must resume once. Repeat a switch while the upload is in flight.
4. Withdraw AI consent with a clip queued. Confirm it remains saved and does not
   upload; restore consent and confirm one debrief/charge. An already sent request
   cannot retroactively be withdrawn, so distinguish queued from in-flight work.
5. Against an approved candidate test service, exercise busy/reconnect and a lost
   response. Verify stable recording/debrief ID, original retained until success,
   one final row/charge. Do not overload the current 512 MB production service.

All physical steps remain **OPEN** here. Integration, not this evidence file,
owns updates to the shared acceptance ledger.

Guidance used: [Supabase database functions and permissions](https://supabase.com/docs/guides/database/functions),
[Supabase function guidance](https://supabase.com/docs/guides/ai-tools/ai-prompts/database-functions),
[PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).
