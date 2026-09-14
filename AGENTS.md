# AGENTS.md

This file provides project-specific guidance to Codex when working in this repository.

Verify implementation details against the code before relying on descriptions of current status.

## Project Overview

Mirra is a conversational coaching iOS/Android app. It records real conversations, analyzes the user's speech for social signals (talk/listen ratio, question frequency, interruptions, energy, vocabulary), and surfaces a debrief card with coaching bullets and an AI-powered Reflect chat.

This is a monorepo with two top-level packages:
- `app/` — React Native (Expo 54 generated native projects + TypeScript)
- `backend/` — FastAPI (Python 3.11+)

## Commands

### App (`app/`)
```bash
cd app
npm install
npm run typecheck         # TypeScript validation
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

All audio capture happens on-device via `expo-av` (`useRecordAudio.ts`), encoded as `.m4a` (`.webm` on web) — not WAV; no streaming or on-device VAD. On stop, the app uploads the file to `POST /sessions`. The backend accepts several container formats (`SUPPORTED_AUDIO_TYPES` in `main.py`: aac, mp4/m4a, mpeg, ogg, wav, webm) and decodes through FFmpeg into bounded mono 16 kHz PCM (`coordinator.py`). Playlist/network demuxers are disabled; decoding times out after 120 seconds and recordings longer than 60 minutes are rejected. The backend runs a synchronous pipeline in order:

1. `pipeline/vad.py` — Silero VAD checks whether any speech is present; it does not filter the audio sent to transcription.
2. `pipeline/transcription.py` — Sends the complete recording to `gpt-4o-transcribe-diarize` with `diarized_json` output and automatic server chunking. Speaker labels and timestamps refer to the original timeline.
3. `pipeline/speaker.py` — Merges overlapping intervals of the same speaker and estimates the user as the speaker with the highest duration-weighted RMS. Keeps every turn with that label, including quieter turns. This remains an unconfirmed microphone-placement assumption.
4. `pipeline/prosody.py` — Computes acoustic, word, question, filler, and speaking-rate statistics for the selected speaker. Other-speaker labels supply comparison durations. Interruption counts estimate overlap initiated by the user.
5. `pipeline/coaching.py` — Sends the full labeled conversation and selected-speaker stats to OpenAI `gpt-4.1` using Responses API structured outputs validated by Pydantic. The prompt explains identity and timing uncertainty. Retains two retries for invalid output; the SDK retries transient API errors twice.
6. `pipeline/coordinator.py` — Orchestrates these stages; returns a neutral debrief without calling the coaching model when no speech is found.
7. `POST /sessions` reserves free usage before processing, saves the debrief and diarization metadata, and refunds failed processing. The full labeled transcript is stored only when transcript saving is enabled.

See `backend/app/pipeline/README.md` for request limits, timing caveats, and validation.

### Auth & JWT

The backend verifies Supabase JWTs on every request (`app/auth.py`). Uses `python-jose` to verify ES256 signatures against the project's public JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`), cached for ten minutes and refreshed on an unknown signing-key ID (at most once per 30 seconds) — no per-request network call and no shared secret. The Supabase project uses asymmetric signing keys; there is no `SUPABASE_JWT_SECRET` setting. `user_id` comes from the token's `sub` claim and is threaded through all DB operations.

Username/password sign-in is a thin wrapper: the backend maps `<username>` to the fake email `<username>@users.mirra.local` and drives Supabase's REST auth API directly. New username sign-up is disabled (410); existing users can still sign in through the password grant. New accounts use email links. `GET /auth/status` reports whether username sign-up and Google OAuth are currently available so the app can gate its UI.

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

### Native builds

Native projects are generated with Expo prebuild and excluded from git/EAS uploads. `app/app.json`, `app/app.config.ts`, and `app/plugins/withRecordingService.js` are canonical. The plugin installs the Android foreground microphone service and excludes iOS Documents (pending audio) from device backups. There are no implemented iOS AppIntent/widget/share-extension targets. Changes to native behavior belong in a config plugin, not generated directories.

### Offline recording queue

`RecordingProvider` (`app/src/hooks/useRecordAudio.ts`) sits under AuthProvider and above the routes. Stopped recordings are saved before upload, using `src/storage/pendingRecordings.ts` (native documents directory) or `.web.ts` (IndexedDB blobs and metadata). `usePendingRecordings.ts` restores the per-account queue and uploads serially on launch, foreground/online events, and a 15-second foreground poll. Each upload refreshes auth and checks account identity. Only acknowledged uploads or explicit discards remove queued audio. Storage failures retain the original clip and block another capture until saving succeeds.

The optional `recording_id` form field on `POST /sessions` produces an account-scoped deterministic debrief primary key. Replays return the existing debrief before reserving usage. A process-local in-flight guard returns 409 for simultaneous retries; across processes the database primary key prevents duplicate rows and duplicate-insert reservations are refunded. Deletion tombstones require the `20260914020000_deletion_tombstones.sql` migration; they prevent delayed uploads from restoring deleted conversations. The queue survives restarts after Stop/save completes; uploads resume when the app is foregrounded, not while force-quit. Browser offline app-shell loading and OS background upload jobs are not implemented.

### Audio file import

`useImportAudio.ts` uses `expo-document-picker`. It validates supported MIME types/extensions and the 25 MB cap, confirms participant permission, then copies audio into the same durable account queue as a recording. The queue refreshes auth and uses an idempotent recording ID. Import does not use an OS share-sheet intent. Duration probing is best effort; FFmpeg performs authoritative server decoding.

## Critical Gotchas

- **Expo prebuild** — native files are disposable generated output. Preserve custom behavior through `app/plugins/`, including background recording and backup exclusions. There are no manual iOS extension targets to preserve.

- **Background recording** — iOS requires `UIBackgroundModes: ["audio"]` in `app.config.ts` and an active `AVAudioSession`. Android requires a foreground service with a persistent notification. Validate on real devices, not simulators, with screen locked for 5+ minutes.

- **OpenAI structured output** — use `responses.parse` with the `CoachingOutput` Pydantic schema, never free-text JSON parsing. Keep two retries for invalid output in `coaching.py`; reject missing or incomplete output rather than saving an invalid debrief.

- **Speaker classification accuracy** — diarization groups voices but does not identify the recording owner. `speaker.py` still assumes the user is closer to the mic and chooses the loudest speaker by duration-weighted RMS. Document this constraint in onboarding. All turns of the chosen label are retained; speaker splitting and mixed-voice overlap can still affect metrics. `stats.metadata.diarization.user_speaker_confirmed` is false; there is no voice enrollment or speaker-correction UI.

- **Transcription 25MB limit** — `main.py` limits uploaded bytes before processing. `transcription.py` separately checks encoded PCM against the API's 25,000,000-byte limit and uses the original supported compressed recording when PCM is too large. If neither fits, return 413 and refund reserved usage. Do not split into independent requests without a strategy to reconcile speaker IDs; labels are local to each request.

- **JWT verification is ES256/JWKS, not a shared secret** — this Supabase project signs tokens with asymmetric keys, so an HS256 `SUPABASE_JWT_SECRET` can never verify them (this once silently broke every authenticated request). `app/auth.py` caches public JWKS for ten minutes and refreshes unknown signing-key IDs at most once per 30 seconds.

- **One AI credential** — `OPENAI_API_KEY` powers transcription, debriefs, and Reflect. Optional `OPENAI_DEBRIEF_MODEL` / `OPENAI_REFLECT_MODEL` overrides default to `gpt-4.1` / `gpt-4.1-mini`. Text requests use `store=False`; Reflect includes transcripts only when the user's settings allow it.

- **Prompt caching** — keep stable instructions and the output schema before varying conversation content. OpenAI caches eligible prompt prefixes automatically; no provider-specific cache-control fields are needed.

## Supabase Schema

- `users` — managed by Supabase Auth
- `debrief_usage(user_id, month_key UNIQUE WITH user_id, count int)` — monthly usage counter
- `debriefs(id uuid, user_id, created_at, observation, pattern_to_reduce, thing_to_try_next, stats jsonb, transcript text)`
- `user_settings(user_id, notifications_enabled, weekly_summary_day, weekly_summary_time, reflection_reminders, product_updates, save_transcripts, include_transcript_in_reflect, coaching_tone, coaching_depth)` — one row per user, backend-managed (`app/user_settings.py`)

All tables have RLS enabled with `(select auth.uid()) = user_id` read policies; writes go through the backend's service-role key, not the client directly.

Monthly cap: 5 debriefs per user, configured by `FREE_TIER_CAP`. Enforced server-side — `POST /sessions` returns 402 when at cap. There are no paid tiers or subscription bypasses.

## Backend API

| Endpoint | Description |
|---|---|
| `POST /sessions` | multipart `audio` (WAV/M4A ≤25MB) + JSON metadata → runs pipeline → returns `{ debrief, usedThisMonth, remaining }` |
| `GET /debriefs`, `GET /debriefs/{id}` | paginated debrief history / single debrief for the authenticated user |
| `DELETE /debriefs/{id}` | permanently delete an owned debrief and its saved transcript; returns 204 even if already absent; does not refund usage |
| `GET /usage` | `{ usedThisMonth, remaining, resetsAt }` |
| `GET /auth/status` | which sign-in methods are currently available (username/password, Google, email) |
| `POST /auth/username/sign-up`, `POST /auth/username/sign-in` | username+password auth, backed by Supabase email/password under the hood |
| `GET /profile/summary` | profile stats for ProfileScreen |
| `GET /account/export` | account data export |
| `GET /settings`, `PATCH /settings` | notification/coaching-tone user settings |
| `GET /analytics/progress` | weekly aggregated stats for ProgressScreen/InsightsIndexScreen |
| `POST /reflect` | Reflect chat — calls OpenAI through `reflection.py` |

## Backend Integration Status

The frontend is fully wired to the backend — no more mock data. `src/data/recents.ts` and `src/data/weeks.ts` (the old static mocks) are deleted. Every screen fetches through a hook in `src/hooks/` (`useDebriefs`, `useUsage`, `useUserSettings`, `useProfileSummary`, `useProgressSummary`, `useRecordAudio`, `useImportAudio`), which goes through `app/src/api/client.ts`.

**API boundary:** all fetch calls go through `app/src/api/client.ts`, which handles snake_case → camelCase conversion. New hooks should use this file.

- Auth (username/password + Google, via Supabase) — `src/auth/AuthContext.tsx`, `src/api/auth.ts`, `backend/app/auth.py` / `main.py`'s `/auth/*` routes.
- User settings (notifications, coaching tone) — `useUserSettings`, `backend/app/user_settings.py`, `/settings` routes.
- Dashboard/analytics — `useProgressSummary`, `backend/app/dashboard.py`, `/analytics/progress`.
- Reflect chat — `useDebriefs` + `api/client.ts`'s reflect call, `backend/app/reflection.py`, `/reflect`. Uses the same OpenAI key as transcription and debriefs, with a local fallback when no model reply is available. `src/data/reflect.ts` still exists but only for seed/starter-prompt copy and canned replies used if the live call fails — not conversation data.

**Data models are already aligned** — `backend/app/models/debrief.py` matches the TypeScript `DebriefCard`/`ConversationStats` interfaces in `app/src/models/`.

## Release privacy and operations

- Apply all three September 14 release migrations before deploying the current backend. `/health` reports liveness; `/ready` requires the consent columns, deletion-marker and content-report tables, and AI credential.
- AI consent uses version `2026-09-14`, is opt-in and checked server-side for sessions/Reflect. Consent timestamps are written by the backend. Settings updates only write supplied fields, so an unrelated change cannot restore withdrawn consent.
- `DELETE /account` removes the authenticated Supabase user with cascading data deletion. `DELETE /debriefs/{id}` uses an account-scoped SQL RPC and a content-free tombstone. SQL advisory locks serialize deletion and replay; the insert trigger rejects resurrection. Tombstones disappear on account deletion and are included in account exports.
- One pipeline/worker protects the stateful VAD model and memory budget. Reflect has a per-account 60-message/hour process-local limit. Move budgets to shared storage before scaling workers/instances.
- Product/release evidence and external blockers are tracked in `docs/RELEASE.md`. The website and policy pages remain a clearly labeled prelaunch preview until the operator, private support contact and deployment are finalized.

### Private content reporting

`POST /content-reports` accepts an authenticated, size-limited selected response, reason and optional note. Debrief links are ownership-checked. Reports have a separate 20/hour process-local limit, are stored in `content_reports` behind owner-read RLS and backend-only writes, and appear in account export. Linked-conversation and account deletion cascade to reports. Apply `20260914030000_content_reports.sql` before deployment. `ReportContent` is shared by debrief and Reflect screens; no full transcript or audio is attached. A private report-review owner/process must exist before launch.
