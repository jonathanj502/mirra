# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mirra is a conversational coaching iOS/Android app. It records real conversations, analyzes the user's speech for social signals (talk/listen ratio, question frequency, interruptions, energy, vocabulary), and surfaces a debrief card with coaching bullets and an AI-powered Reflect chat.

This is a monorepo with two top-level packages:
- `app/` — React Native (Expo bare workflow + TypeScript)
- `backend/` — FastAPI (Python 3.11+)

## Commands

### App (`app/`)
```bash
cd app
npm install
npx expo prebuild          # generate ios/ and android/ native code
npx expo run:ios           # run on iOS simulator
npx expo run:android       # run on Android emulator
```

### Backend (`backend/`)
```bash
cd backend
uv sync                    # or: pip install -e ".[dev]"
uvicorn app.main:app --reload
pytest                     # all tests
pytest tests/test_pipeline.py  # pipeline tests only
pytest tests/test_usage_gate.py
```

## Architecture

### Audio Pipeline (the core product)

All audio capture happens on-device via `expo-av` (`useRecordAudio.ts`), encoded as `.m4a` (`.webm` on web) — not WAV; no streaming or on-device VAD. On stop, the app uploads the file to `POST /sessions`. The backend accepts several container formats (`SUPPORTED_AUDIO_TYPES` in `main.py`: aac, mp4/m4a, mpeg, ogg, wav, webm) and decodes with `soundfile`, falling back to `librosa.load` for formats it can't parse (`coordinator.py`). The backend runs a synchronous pipeline in order:

1. `pipeline/vad.py` — Silero VAD extracts speech segments with timestamps and energy levels
2. `pipeline/speaker.py` — Adaptive energy-clustering heuristic (2-means over segment log-energy, not a fixed percentile): splits segments into a loud and a soft group and keeps the louder group as the user. Backs off and keeps everything if the two groups aren't well-separated (single-speaker guard). **User segments only** are passed forward; other-party audio is discarded.
3. `pipeline/whisper.py` — Concatenates user segments with 200ms silence pads → OpenAI Whisper API → transcript
4. `pipeline/prosody.py` — librosa: pitch (yin), RMS energy, WPM from transcript/duration
5. `pipeline/claude.py` — Anthropic `claude-sonnet-4-6` with `tool_use` for structured `DebriefCard` output. 2-retry on schema mismatch. System prompt + tool definition use `cache_control: ephemeral` (prompt caching).
6. `pipeline/coordinator.py` — orchestrates steps 1–5
7. Writes to Supabase `debriefs` table, increments `debrief_usage`

### Auth & JWT

The backend verifies Supabase JWTs on every request (`app/auth.py`). Uses `python-jose` to verify ES256 signatures against the project's public JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`), fetched once and cached for the process lifetime — no per-request network call and no shared secret. The Supabase project uses asymmetric signing keys; there is no `SUPABASE_JWT_SECRET` setting. `user_id` comes from the token's `sub` claim and is threaded through all DB operations.

Username/password sign-in is a thin wrapper: the backend maps `<username>` to the fake email `<username>@users.mirra.local` and drives Supabase's REST auth API directly. Sign-up needs `SUPABASE_SERVICE_ROLE_KEY` on the backend (`POST /auth/v1/admin/users`); sign-in only needs the password grant. `GET /auth/status` reports whether username sign-up and Google OAuth are currently available so the app can gate its UI.

### Data Models

The canonical types live in two places — keep them in sync:

**TypeScript** (`app/src/models/`):
```ts
interface DebriefCard {
  id: string; sessionId: string; createdAt: string;
  observation: string; patternToReduce: string; thingToTryNext: string;
  stats: ConversationStats;
}
interface ConversationStats {
  talkListenRatio: number; questionCount: number; interruptionCount: number;
  sessionDurationMinutes: number; userSpeechDurationMinutes: number; estimatedWPM: number;
}
```

**Python** (`backend/app/models/debrief.py`): same fields in `snake_case`. The API returns `snake_case`; `api/client.ts` converts to `camelCase` at the boundary.

### IPC for iOS-only triggers (Phase 5)

Control Center widget, Back Tap, and Lock Screen Shortcut all fire `ToggleRecordingIntent` (Swift AppIntents extension). The intent writes a command to a shared `UserDefaults` App Group container and posts a Darwin notification. A native `RCTEventEmitter` module in the main app listens for that Darwin notification and emits an event into RN, where `useRecorder.toggle()` is called. All four targets share App Group `group.com.<yourname>.mirra`.

### Audio file import

`useImportAudio.ts` uses `expo-document-picker` (not an OS share-sheet intent) to let the user pick an existing audio file on either platform. Client-side guards: 25MB cap, MIME sniffed from the file extension when the picker returns `application/octet-stream`. Duration is read via a throwaway `Audio.Sound.createAsync`/`unloadAsync` before upload. Goes through the same `uploadSession()` → `POST /sessions` path as a live recording, wired into `HomeScreen.tsx` alongside `useRecordAudio`.

Note: the original plan called for `react-native-receive-sharing-intent` handling Android `ACTION_SEND` intents (share-sheet import, confirmation card instead of a manual picker) — that package was never installed and no intent filter exists in `AndroidManifest.xml`. The document-picker approach above is what actually shipped; treat any reference to `useSharedFile.ts` elsewhere as stale.

## Critical Gotchas

- **Expo prebuild + iOS extensions** — Phase 5 extension targets (`MirraIntents`, `MirraWidgets`, `MirraShare`) are not managed by Expo. After generating `ios/` with `expo prebuild`, either commit `ios/` and stop re-running prebuild, or write `withMod` config plugins. Re-running prebuild will clobber manual target additions.

- **Background recording** — iOS requires `UIBackgroundModes: ["audio"]` in `app.config.ts` and an active `AVAudioSession`. Android requires a foreground service with a persistent notification. Validate on real devices, not simulators, with screen locked for 5+ minutes.

- **Claude structured output** — always use `tool_use`, never free-text JSON parsing. The 2-retry loop in `claude.py` is mandatory before surfacing an error to the user.

- **Speaker classification accuracy** — the energy heuristic requires the user to be consistently closer to the mic. Document this constraint in onboarding. The 2-means split in `speaker.py` was kept deliberately over a simpler max-gap split: max-gap picks the single widest adjacent gap in sorted energy values, so one loud transient VAD segment (a laugh, a door, a mic bump) can hijack the split point and discard nearly all real user audio for that session. 2-means clusters by group mean, so the same outlier gets absorbed into the correct cluster instead. A dedicated speaker diarization model is planned for v2.

- **Whisper 25MB limit** — recordings are compressed (`.m4a`/`.webm`, not WAV), so 25MB covers well over 20 minutes in practice; `main.py` enforces the cap directly (`MAX_AUDIO_BYTES`, 413 if exceeded) before the pipeline runs. Chunk at 20-minute boundaries if allowing longer sessions.

- **JWT verification is ES256/JWKS, not a shared secret** — this Supabase project signs tokens with asymmetric keys, so an HS256 `SUPABASE_JWT_SECRET` can never verify them (this once silently broke every authenticated request). `app/auth.py` fetches the public JWKS once and caches it for the process lifetime; restart the backend if Supabase signing keys are ever rotated.

- **Prompt caching** — mark the Claude system prompt and tool definition as `cache_control: ephemeral`. Track hit rate via `usage.cache_read_input_tokens` in SDK responses.

## Supabase Schema

- `users` — managed by Supabase Auth
- `debrief_usage(user_id, month_key UNIQUE WITH user_id, count int)` — monthly usage counter
- `debriefs(id uuid, user_id, created_at, observation, pattern_to_reduce, thing_to_try_next, stats jsonb, transcript text)`
- `user_settings(user_id, notifications_enabled, weekly_summary_day, weekly_summary_time, reflection_reminders, product_updates, save_transcripts, include_transcript_in_reflect, coaching_tone, coaching_depth)` — one row per user, backend-managed (`app/user_settings.py`)
- `billing_subscriptions(user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, trial_end, cancel_at_period_end)` — Stripe subscription state, mutated by the backend service role and Stripe webhooks (`app/billing.py`)

All tables have RLS enabled with `(select auth.uid()) = user_id` read policies; writes go through the backend's service-role key, not the client directly.

Free tier cap: 5 debriefs/month. Enforced server-side — `POST /sessions` returns 402 when at cap.

## Backend API

| Endpoint | Description |
|---|---|
| `POST /sessions` | multipart `audio` (WAV/M4A ≤25MB) + JSON metadata → runs pipeline → returns `{ debrief, usedThisMonth, remaining }` |
| `GET /debriefs`, `GET /debriefs/{id}` | paginated debrief history / single debrief for the authenticated user |
| `GET /usage` | `{ usedThisMonth, remaining, resetsAt }` |
| `GET /auth/status` | which sign-in methods are currently available (username/password, Google, email) |
| `POST /auth/username/sign-up`, `POST /auth/username/sign-in` | username+password auth, backed by Supabase email/password under the hood |
| `GET /profile/summary` | profile stats for ProfileScreen |
| `GET /account/export` | account data export |
| `GET /settings`, `PATCH /settings` | notification/coaching-tone user settings |
| `GET /billing/status`, `POST /billing/checkout`, `POST /billing/portal`, `POST /billing/webhook` | Stripe subscription status, checkout/portal session creation, webhook receiver |
| `GET /analytics/progress` | weekly aggregated stats for ProgressScreen/InsightsIndexScreen |
| `POST /reflect` | Reflect chat — calls `open_model.py`, not the Claude debrief pipeline |

## Backend Integration Status

The frontend is fully wired to the backend — no more mock data. `src/data/recents.ts` and `src/data/weeks.ts` (the old static mocks) are deleted. Every screen fetches through a hook in `src/hooks/` (`useDebriefs`, `useUsage`, `useBilling`, `useUserSettings`, `useProfileSummary`, `useProgressSummary`, `useRecordAudio`, `useImportAudio`), which goes through `app/src/api/client.ts`.

**API boundary:** all fetch calls go through `app/src/api/client.ts`, which handles snake_case → camelCase conversion. New hooks should use this file.

- Auth (username/password + Google, via Supabase) — `src/auth/AuthContext.tsx`, `src/api/auth.ts`, `backend/app/auth.py` / `main.py`'s `/auth/*` routes.
- Billing (Stripe) — `useBilling`, `backend/app/billing.py`, `/billing/*` routes.
- User settings (notifications, coaching tone) — `useUserSettings`, `backend/app/user_settings.py`, `/settings` routes.
- Dashboard/analytics — `useProgressSummary`, `backend/app/dashboard.py`, `/analytics/progress`.
- Reflect chat — `useDebriefs` + `api/client.ts`'s reflect call, `backend/app/open_model.py`, `/reflect`. `src/data/reflect.ts` still exists but only for seed/starter-prompt copy and canned replies used if the live call fails — not conversation data.

**Data models are already aligned** — `backend/app/models/debrief.py` matches the TypeScript `DebriefCard`/`ConversationStats` interfaces in `app/src/models/`.
