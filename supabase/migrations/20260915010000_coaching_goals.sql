-- A goal is chosen once per account and applies when a new debrief or Reflect reply is generated.
alter table public.user_settings
  add column coaching_goal text not null default 'general'
  check (coaching_goal in ('general', 'make_friends', 'confidence', 'listening', 'clarity', 'assertiveness'));

comment on column public.user_settings.coaching_goal is
  'User-selected conversational goal. Existing debriefs retain their original goal in stats.metadata.';
