-- Remember deleted recording IDs without retaining conversation content. A delayed offline
-- upload must never resurrect something the user deleted on another signed-in device.
create table public.debrief_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  debrief_id uuid not null,
  primary key (user_id, debrief_id)
);
alter table public.debrief_deletions enable row level security;
create policy "Users can read their own deletion markers" on public.debrief_deletions
  for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.debrief_deletions to authenticated;
grant all on public.debrief_deletions to service_role;

create function public.delete_debrief_permanently(owner_id uuid, target_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || target_id::text, 0));
  insert into public.debrief_deletions(user_id, debrief_id)
    select user_id, id from public.debriefs where user_id = owner_id and id = target_id
    on conflict do nothing;
  delete from public.debriefs where user_id = owner_id and id = target_id;
end;
$$;
revoke all on function public.delete_debrief_permanently(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_debrief_permanently(uuid, uuid) to service_role;

create function public.prevent_deleted_debrief_replay()
returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || new.id::text, 0));
  if exists(select 1 from public.debrief_deletions where user_id = new.user_id and debrief_id = new.id) then
    raise exception 'recording_deleted';
  end if;
  return new;
end;
$$;
create trigger prevent_deleted_debrief_replay before insert on public.debriefs
  for each row execute function public.prevent_deleted_debrief_replay();
