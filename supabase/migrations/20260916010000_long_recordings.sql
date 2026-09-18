-- Complete a resumable recording and charge it exactly once, in the same transaction.
create function public.complete_recording(owner_id uuid, target_id uuid, payload jsonb, monthly_cap integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  saved public.debriefs;
  month text := to_char(timezone('utc', now()), 'YYYY-MM');
  new_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || target_id::text, 0));
  if exists(select 1 from public.debrief_deletions where user_id = owner_id and debrief_id = target_id) then
    raise exception 'recording_deleted';
  end if;
  select * into saved from public.debriefs where user_id = owner_id and id = target_id;
  if found then return to_jsonb(saved); end if;
  insert into public.debrief_usage(user_id, month_key, count) values(owner_id, month, 0)
    on conflict(user_id, month_key) do nothing;
  update public.debrief_usage set count = count + 1
    where user_id = owner_id and month_key = month and count < monthly_cap returning count into new_count;
  if not found then raise exception 'monthly_debrief_limit'; end if;
  insert into public.debriefs(id, user_id, session_id, observation, pattern_to_reduce, thing_to_try_next, stats, transcript)
    values(target_id, owner_id, payload->>'session_id', payload->>'observation',
           payload->>'pattern_to_reduce', payload->>'thing_to_try_next', payload->'stats', payload->>'transcript')
    returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.complete_recording(uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.complete_recording(uuid, uuid, jsonb, integer) to service_role;

-- Also tombstone pending recordings so cancellation cannot race the final debrief insert.
create or replace function public.delete_debrief_permanently(owner_id uuid, target_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || target_id::text, 0));
  insert into public.debrief_deletions(user_id, debrief_id) values(owner_id, target_id) on conflict do nothing;
  delete from public.debriefs where user_id = owner_id and id = target_id;
end;
$$;

create function public.recording_uploads_ready() returns boolean language sql set search_path = public as $$
  select to_regprocedure('public.complete_recording(uuid,uuid,jsonb,integer)') is not null;
$$;
revoke all on function public.recording_uploads_ready() from public, anon, authenticated;
grant execute on function public.recording_uploads_ready() to service_role;
