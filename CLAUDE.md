# CLAUDE.md

This file contains shared project guidance for Claude Code and Codex.

Verify implementation details against the code before relying on descriptions of current status.

## Project Overview

Mirra is a conversational coaching iOS/Android app. It records real conversations, analyzes the user's speech for social signals (talk/listen ratio, question frequency, interruptions, energy, vocabulary), and surfaces a debrief card with coaching bullets and an AI-powered Reflect chat.

This is a monorepo with two top-level packages:
- `app/` — React Native (Expo SDK 57, React Native 0.86 + TypeScript)
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

All audio capture happens on-device via `expo-audio` (`useRecordAudio.ts`), encoded as `.m4a` (`.webm` on web) — not WAV; no streaming or on-device VAD. On stop, the app saves the file to its per-account device queue before uploading to `POST /sessions` when connected and AI consent is active. The backend accepts several container formats (`SUPPORTED_AUDIO_TYPES` in `main.py`: aac, mp4/m4a, mpeg, ogg, wav, webm) and decodes with `soundfile`, falling back to `librosa.load` for formats it can't parse (`coordinator.py`). The backend runs a synchronous pipeline in order:

1. `pipeline/vad.py` — Silero VAD checks whether any speech is present; it does not filter the audio sent to transcription.
2. `pipeline/transcription.py` — Sends the complete recording to `gpt-4o-transcribe-diarize` with `diarized_json` output and automatic server chunking. Speaker labels and timestamps refer to the original timeline.
3. `pipeline/speaker.py` — Merges overlapping intervals of the same speaker and estimates the user as the speaker with the highest duration-weighted RMS. Keeps every turn with that label, including quieter turns. This remains an unconfirmed microphone-placement assumption.
4. `pipeline/prosody.py` — Computes acoustic, word, question, filler, and speaking-rate statistics for the selected speaker. Other-speaker labels supply comparison durations. Interruption counts estimate overlap initiated by the user.
5. `pipeline/coaching.py` — Sends the full labeled conversation and selected-speaker stats to OpenAI `gpt-4.1` using Responses API structured outputs validated by Pydantic. The prompt explains identity and timing uncertainty. Retains two retries for invalid output; the SDK retries transient API errors twice.
6. `pipeline/coordinator.py` — Orchestrates these stages; returns a neutral debrief without calling the coaching model when no speech is found.
7. `POST /sessions` reserves free usage before processing, saves the debrief and diarization metadata, and refunds failed processing. The full labeled transcript is stored only when transcript saving is enabled.

See `backend/app/pipeline/README.md` for request limits, timing caveats, and validation.

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

### Offline recording queue

`RecordingProvider` (`app/src/hooks/useRecordAudio.ts`) sits under AuthProvider and above the routes. Stopped recordings are saved before upload, using `src/storage/pendingRecordings.ts` (native documents directory) or `.web.ts` (IndexedDB blobs and metadata). `usePendingRecordings.ts` restores the per-account queue and uploads serially on launch, foreground/online events, and a 15-second foreground poll. Each upload refreshes auth, checks account identity, and verifies saved AI consent before sending. Withdrawal pauses queued uploads without deleting local audio; the Record tab lets the user review their privacy choice to resume. Only acknowledged uploads or explicit discards remove queued audio. Storage failures retain the original clip and block another capture until saving succeeds.

The optional `recording_id` form field on `POST /sessions` produces an account-scoped deterministic debrief primary key. Replays return the existing debrief before reserving usage. A process-local in-flight guard returns 409 for simultaneous retries; across processes the database primary key prevents duplicate rows and duplicate-insert reservations are refunded. No schema migration is required. The queue survives restarts after Stop/save completes; uploads resume when the app is foregrounded, not while force-quit. Browser offline app-shell loading and OS background upload jobs are not implemented.

### Audio file import

`useImportAudio.ts` uses `expo-document-picker` (not an OS share-sheet intent) to let the user pick an existing audio file on either platform. Client-side guards: 25MB cap, MIME sniffed from the file extension when the picker returns `application/octet-stream`. Duration is read via a temporary `createAudioPlayer` that waits for loaded metadata and is removed afterward before upload. Goes through the same `uploadSession()` → `POST /sessions` path as a live recording, wired into `HomeScreen.tsx` alongside `useRecordAudio`.

Note: the original plan called for `react-native-receive-sharing-intent` handling Android `ACTION_SEND` intents (share-sheet import, confirmation card instead of a manual picker) — that package was never installed and no intent filter exists in `AndroidManifest.xml`. The document-picker approach above is what actually shipped; treat any reference to `useSharedFile.ts` elsewhere as stale.

## Critical Gotchas

- **Privacy disclosures** — `app/src/privacy/aiConsent.ts` owns the concise no-sale/AI-sharing disclaimer. Recording, audio import, and Reflect require affirmative consent, remembered per account on the device; Voice & Privacy repeats the disclosure and allows withdrawal. Native recording explains screen-lock behavior on first use. Bump the consent-key version if data use changes. Do not promise that conversations are never stored or that privacy is guaranteed: transcript saving defaults on and debriefs are retained.

- **Expo prebuild + iOS extensions** — Phase 5 extension targets (`MirraIntents`, `MirraWidgets`, `MirraShare`) are not managed by Expo. After generating `ios/` with `expo prebuild --no-clean`, either commit `ios/` and stop re-running prebuild, or write `withMod` config plugins. Re-running prebuild will clobber manual target additions.

- **Background recording** — iOS requires `UIBackgroundModes: ["audio"]` in `app.config.ts` and an active `AVAudioSession`. Android requires a foreground service with a persistent notification. Validate on real devices, not simulators, with screen locked for 5+ minutes.

- **OpenAI structured output** — use `responses.parse` with the `CoachingOutput` Pydantic schema, never free-text JSON parsing. Keep two retries for invalid output in `coaching.py`; reject missing or incomplete output rather than saving an invalid debrief.

- **Speaker classification accuracy** — diarization groups voices but does not identify the recording owner. `speaker.py` still assumes the user is closer to the mic and chooses the loudest speaker by duration-weighted RMS. Document this constraint in onboarding. All turns of the chosen label are retained; speaker splitting and mixed-voice overlap can still affect metrics. `stats.metadata.diarization.user_speaker_confirmed` is false; there is no voice enrollment or speaker-correction UI.

- **Transcription 25MB limit** — `main.py` limits uploaded bytes before processing. `transcription.py` separately checks encoded PCM against the API's 25,000,000-byte limit and uses the original supported compressed recording when PCM is too large. If neither fits, return 413 and refund reserved usage. Do not split into independent requests without a strategy to reconcile speaker IDs; labels are local to each request.

- **JWT verification is ES256/JWKS, not a shared secret** — this Supabase project signs tokens with asymmetric keys, so an HS256 `SUPABASE_JWT_SECRET` can never verify them (this once silently broke every authenticated request). `app/auth.py` fetches the public JWKS once and caches it for the process lifetime; restart the backend if Supabase signing keys are ever rotated.

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
| `DELETE /debriefs/{id}` | deletes the authenticated owner's saved conversation, transcript, and metrics; returns 204 even if already absent; does not refund monthly usage |
| `GET /usage` | `{ usedThisMonth, remaining, resetsAt }` |
| `GET /auth/status` | which sign-in methods are currently available (username/password, Google, email) |
| `POST /auth/username/sign-up`, `POST /auth/username/sign-in` | username+password auth, backed by Supabase email/password under the hood |
| `GET /profile/summary` | profile stats for ProfileScreen |
| `GET /account/export` | account data export |
| `GET /settings`, `PATCH /settings` | notification/coaching-tone user settings |
| `GET /analytics/progress` | weekly aggregated stats for ProgressScreen/InsightsIndexScreen |
| `POST /reflect` | Reflect chat — calls OpenAI through `reflection.py` |

## Backend Integration Status

The frontend is fully wired to the backend — no more mock data. `src/data/recents.ts` and `src/data/weeks.ts` (the old static mocks) are deleted. Every screen fetches through a hook in `src/hooks/` (`useDebriefs`, `useUsage`, `usePendingRecordings`, `useUserSettings`, `useProfileSummary`, `useProgressSummary`, `useRecordAudio`, `useImportAudio`), which goes through `app/src/api/client.ts`.

**API boundary:** all fetch calls go through `app/src/api/client.ts`, which handles snake_case → camelCase conversion. New hooks should use this file.

- Auth (username/password + Google, via Supabase) — `src/auth/AuthContext.tsx`, `src/api/auth.ts`, `backend/app/auth.py` / `main.py`'s `/auth/*` routes.
- User settings (notifications, coaching tone) — `useUserSettings`, `backend/app/user_settings.py`, `/settings` routes.
- Dashboard/analytics — `useProgressSummary`, `backend/app/dashboard.py`, `/analytics/progress`.
- Conversation deletion — open a conversation in `AnalyticsScreen`, tap Delete, and confirm. The backend scopes deletion to the authenticated owner; history and summaries refresh on focus.
- Reflect chat — `useDebriefs` + `api/client.ts`'s reflect call, `backend/app/reflection.py`, `/reflect`. Uses the same OpenAI key as transcription and debriefs, with a local fallback when no model reply is available. `src/data/reflect.ts` still exists but only for seed/starter-prompt copy and canned replies used if the live call fails — not conversation data.

**Data models are already aligned** — `backend/app/models/debrief.py` matches the TypeScript `DebriefCard`/`ConversationStats` interfaces in `app/src/models/`.
