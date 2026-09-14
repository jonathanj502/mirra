begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.debriefs(id,user_id,session_id,observation,pattern_to_reduce,thing_to_try_next,stats) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','one','observation','pattern','try','{}'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','two','observation','pattern','try','{}');
insert into public.user_settings(user_id) values ('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert not (select save_transcripts from public.user_settings limit 1);
  assert not has_function_privilege('authenticated','public.delete_debrief_permanently(uuid,uuid)','EXECUTE');
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
do $$ declare affected integer; begin
  assert (select count(*) from public.debriefs) = 1, 'RLS leaked another account';
  update public.user_settings set ai_consent_version = 'forged' where user_id = auth.uid();
  get diagnostics affected = row_count;
  assert affected = 0, 'Client overwrote server-managed consent';
  begin
    insert into public.user_settings(user_id, ai_consent_version) values ('00000000-0000-0000-0000-000000000002','forged');
    raise exception 'Client bypassed backend consent validation';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role service_role;
select public.delete_debrief_permanently('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
do $$ begin
  assert (select count(*) from public.debriefs) = 2, 'Deletion affected the wrong account';
end $$;
select public.delete_debrief_permanently('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
select public.delete_debrief_permanently('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.debrief_deletions) = 1;
  begin
    insert into public.debriefs(id,user_id,session_id,observation,pattern_to_reduce,thing_to_try_next,stats) values
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','replay','o','p','t','{}');
    raise exception 'Deleted recording was resurrected';
  exception when raise_exception then
    if SQLERRM <> 'recording_deleted' then raise; end if;
  end;
end $$;
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';
do $$ begin
  assert not exists(select from public.debrief_deletions), 'Account deletion retained deletion markers';
  assert not exists(select from public.user_settings), 'Account deletion retained settings';
  assert (select count(*) from public.debriefs) = 1, 'Account deletion affected another account';
end $$;
rollback;
