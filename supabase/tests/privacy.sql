begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.debriefs(id,user_id,session_id,observation,pattern_to_reduce,thing_to_try_next,stats) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','one','observation','pattern','try','{}'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','two','observation','pattern','try','{}');
insert into public.user_settings(user_id) values ('00000000-0000-0000-0000-000000000001');
do $$ begin
  assert not has_function_privilege('authenticated','public.delete_debrief_permanently(uuid,uuid)','EXECUTE');
  assert (select coaching_goal from public.user_settings) = 'general', 'Existing accounts need a default goal';
  update public.user_settings set coaching_goal = 'confidence';
  begin
    update public.user_settings set coaching_goal = 'unknown';
    raise exception 'Invalid goal was accepted';
  exception when check_violation then null;
  end;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.debriefs) = 1, 'RLS leaked another account';
  assert (select coaching_goal from public.user_settings) = 'confidence';
end $$;
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
do $$ begin
  assert not exists(select from public.user_settings), 'RLS leaked another account goal';
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
  assert (select count(*) from public.debrief_deletions) = 2;
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
