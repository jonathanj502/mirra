create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  debrief_id uuid references public.debriefs(id) on delete cascade,
  created_at timestamptz not null default now(),
  source text not null check (source in ('debrief', 'reflect')),
  content text not null check (length(content) between 1 and 8000),
  reason text not null check (reason in ('harmful', 'inaccurate', 'other')),
  comment text not null default '' check (length(comment) <= 1000)
);
create index content_reports_user_created on public.content_reports(user_id, created_at);
alter table public.content_reports enable row level security;
create policy "Read own content reports" on public.content_reports for select
  to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.content_reports from anon, authenticated;
grant select on public.content_reports to authenticated;
grant all on public.content_reports to service_role;
