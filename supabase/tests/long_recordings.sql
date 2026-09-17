begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000009');
set local role service_role;
do $$
declare
  owner uuid := '00000000-0000-0000-0000-000000000009';
  first_id uuid := '10000000-0000-0000-0000-000000000091';
  second_id uuid := '10000000-0000-0000-0000-000000000092';
  cancelled_id uuid := '10000000-0000-0000-0000-000000000093';
  body jsonb := '{"session_id":"recording-job","observation":"o","pattern_to_reduce":"p","thing_to_try_next":"t","stats":{}}';
  saved jsonb;
begin
  assert public.recording_uploads_ready();
  assert not has_function_privilege('authenticated','public.complete_recording(uuid,uuid,jsonb,integer)','EXECUTE');
  assert not has_function_privilege('anon','public.complete_recording(uuid,uuid,jsonb,integer)','EXECUTE');
  saved := public.complete_recording(owner, first_id, body, 2);
  assert public.complete_recording(owner, first_id, body, 2) = saved, 'Lost response created a second debrief';
  assert (select count from public.debrief_usage where user_id = owner) = 1, 'Replay was charged again';
  begin
    perform public.complete_recording(owner, second_id, body - 'observation', 2);
    raise exception 'Invalid debrief was saved';
  exception when not_null_violation then null;
  end;
  assert (select count from public.debrief_usage where user_id = owner) = 1, 'Failed insert retained its charge';
  perform public.complete_recording(owner, second_id, body, 2);
  begin
    perform public.complete_recording(owner, cancelled_id, body, 2);
    raise exception 'Monthly cap was bypassed';
  exception when raise_exception then
    if SQLERRM <> 'monthly_debrief_limit' then raise; end if;
  end;
  perform public.delete_debrief_permanently(owner, cancelled_id);
  begin
    perform public.complete_recording(owner, cancelled_id, body, 5);
    raise exception 'Cancelled pending recording was resurrected';
  exception when raise_exception then
    if SQLERRM <> 'recording_deleted' then raise; end if;
  end;
  perform public.delete_debrief_permanently(owner, first_id);
  assert (select count from public.debrief_usage where user_id = owner) = 2, 'Deletion refunded completed work';
  assert (select count(*) from public.debriefs where user_id = owner) = 1;
end $$;
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000009';
do $$ begin
  assert not exists(select from public.debrief_usage where user_id = '00000000-0000-0000-0000-000000000009');
  assert not exists(select from public.debrief_deletions where user_id = '00000000-0000-0000-0000-000000000009');
end $$;
rollback;
