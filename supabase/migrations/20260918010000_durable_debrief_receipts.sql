-- A receipt and its usage counter change in the same transaction. Retrying after
-- a process/connection loss reuses that charge, including across month boundaries.
-- ponytail: abandoned reservations stay charged until retry or month rollover;
-- add audited stale-reservation reconciliation if crash-then-discard needs refunds.
create table public.debrief_receipts (
  debrief_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null,
  attempt_id uuid not null,
  completed boolean not null default false
);
create index debrief_receipts_user_id_idx on public.debrief_receipts(user_id);
alter table public.debrief_receipts enable row level security;
revoke all on public.debrief_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.debrief_receipts to service_role;

-- Lock only short accounting transactions, not the audio pipeline. Account locks
-- serialize retries across month boundaries as well as concurrent cap checks.
create function public.reserve_debrief(
  p_user_id uuid, p_debrief_id uuid, p_attempt_id uuid, p_month_key text, p_cap integer
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  receipt public.debrief_receipts;
  used integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  select * into receipt from public.debrief_receipts where debrief_id = p_debrief_id;
  if found then
    if receipt.user_id <> p_user_id then
      raise sqlstate 'PT409' using message = 'Recording ID is unavailable.';
    end if;
    if receipt.completed then return false; end if;
    -- A fresh attempt replaces an interrupted one. Only this token may finish or
    -- refund; a late response from the previous worker cannot change its charge.
    update public.debrief_receipts set attempt_id = p_attempt_id where debrief_id = p_debrief_id;
    return true;
  end if;
  insert into public.debrief_usage(user_id, month_key, count)
    values (p_user_id, p_month_key, 0) on conflict do nothing;
  select count into used from public.debrief_usage
    where user_id = p_user_id and month_key = p_month_key for update;
  if used >= p_cap then
    raise sqlstate 'PT402' using message = 'Monthly debrief limit reached';
  end if;
  update public.debrief_usage set count = count + 1
    where user_id = p_user_id and month_key = p_month_key;
  insert into public.debrief_receipts(debrief_id, user_id, month_key, attempt_id)
    values (p_debrief_id, p_user_id, p_month_key, p_attempt_id);
  return true;
end;
$$;

create function public.release_debrief(p_user_id uuid, p_debrief_id uuid, p_attempt_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  reserved_month text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  delete from public.debrief_receipts
    where debrief_id = p_debrief_id and user_id = p_user_id
      and attempt_id = p_attempt_id and not completed
    returning month_key into reserved_month;
  if found then
    update public.debrief_usage set count = count - 1
      where user_id = p_user_id and month_key = reserved_month;
  end if;
end;
$$;

create function public.complete_debrief(
  p_user_id uuid, p_debrief_id uuid, p_attempt_id uuid, p_debrief jsonb
) returns setof public.debriefs
language plpgsql security invoker set search_path = ''
as $$
declare
  receipt public.debrief_receipts;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  select * into receipt from public.debrief_receipts
    where debrief_id = p_debrief_id and user_id = p_user_id;
  if not found then
    raise sqlstate 'PT409' using message = 'Recording reservation is unavailable. Please retry.';
  end if;
  if receipt.completed then
    return query select * from public.debriefs where id = p_debrief_id and user_id = p_user_id;
    if not found then
      raise sqlstate 'PT410' using message = 'This recording''s debrief has been deleted.';
    end if;
    return;
  end if;
  if receipt.attempt_id <> p_attempt_id then
    raise sqlstate 'PT409' using message = 'A newer attempt is processing this recording.';
  end if;
  return query insert into public.debriefs(
    id, user_id, session_id, observation, pattern_to_reduce, thing_to_try_next, stats, transcript
  ) values (
    p_debrief_id, p_user_id, p_debrief->>'session_id', p_debrief->>'observation',
    p_debrief->>'pattern_to_reduce', p_debrief->>'thing_to_try_next',
    p_debrief->'stats', p_debrief->>'transcript'
  ) returning *;
  update public.debrief_receipts set completed = true where debrief_id = p_debrief_id;
end;
$$;

-- Functions default to PUBLIC execution. Only the backend's service role may
-- choose an account, cap, or attempt token; no client can mutate these receipts.
revoke all on function public.reserve_debrief(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.release_debrief(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_debrief(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_debrief(uuid, uuid, uuid, text, integer) to service_role;
grant execute on function public.release_debrief(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_debrief(uuid, uuid, uuid, jsonb) to service_role;
