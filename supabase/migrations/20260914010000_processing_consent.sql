-- Consent is opt-in; existing users must review the disclosure before more AI processing.
alter table public.user_settings
  add column if not exists ai_consent_version text,
  add column if not exists ai_consent_at timestamptz;
alter table public.user_settings alter column save_transcripts set default false;
alter table public.user_settings alter column notifications_enabled set default false;
alter table public.user_settings alter column product_updates set default false;
