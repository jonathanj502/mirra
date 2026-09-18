# CLAUDE.md

This file contains shared project guidance for Claude Code and Codex.

Verify implementation details against the code before relying on descriptions of current status.

## Current beta checkpoint

The user resumed beta work in six independent issue tasks/worktrees. Read
`docs/beta-workstreams.md` for ownership and integration, and `docs/beta-pause.md`
for the prior checkpoint. The user authorized a narrower limit:
**23 minutes 20 seconds (1400 seconds)** for capture and import, matching the
observed single-request transcription ceiling. One-hour support is deferred.
The completed code is combined locally on `codex/beta-integration-2026-09-17`.
The transcription branch passed a real 1400-second local API flow in 351.5 seconds;
integrated production, migration/PostgREST, and physical-device checks remain open.
Production and billing are unchanged. The new backend requires the durable-receipt
migration before deployment; see the reliability workstream's rollout instructions.

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

### TestFlight release preparation

`docs/testflight-acceptance.md` tracks the agreed beta gates, evidence, open
blockers, and physical-device results. Do not equate a JavaScript export or unit
test with a signed TestFlight build or real-device recording check.

Production backend: `https://mirra-backend-wp2b.onrender.com` (Render service
`srv-d9vp6orm8hqs73dvhd5g`). EAS project: `@jjiang25/mirra`.
`app/eas.json` defines production store builds and unsigned Simulator builds.
The EAS production environment holds the public backend URL and Supabase URL/key;
server credentials stay on the backend. `npm run check:production` validates
build variables; `npm run export:ios:production` clears Metro's cache, which can
otherwise preserve a previous development endpoint in an export.
Native projects remain checked in; restore SDK 57 pods with `pod install`.

Render's small service instance must not compile Librosa/Numba on the first
recording. After `uv sync`, build with
`NUMBA_CPU_NAME=generic uv run python -m scripts.warm_audio`; use the same
`NUMBA_CPU_NAME=generic` prefix on the Uvicorn start command so the compiled
cache is portable between Render's build and runtime CPUs. The warm-up uses
synthetic samples and checks the speech gate and batched pitch calculation.
The current memory candidate uses streaming mono decoding and Silero's bundled
ONNX model without importing PyTorch. Linux installations use CPU-only Torch
wheels for Silero's transitive dependencies. One audio request runs at a time
per server process; other requests receive retryable 503 before reserving usage.
Local Linux testing still exceeded 512 MiB; see the acceptance ledger before
assuming the free Render instance can run this pipeline reliably.

The MVP maximum is 23 minutes 20 seconds for both captured and imported conversations.
Native recording uses Expo's `record({ forDuration: 1400 })`; its finish event
saves through the existing durable device queue. Imports retain the 100 MiB cap.
Backend decoding enforces the duration independently. A compressed container
whose duration fits may decode up to one extra second of encoder padding; any
samples beyond 1400 seconds are removed before analysis/transcription. Overlong
containers and PCM return 413 and refund reserved usage. At-limit production
and physical-device acceptance remain open in the ledger.

### Audio Pipeline (the core product)

All audio capture happens on-device via `expo-audio` (`useRecordAudio.ts`), encoded as `.m4a` (`.webm` on web) — not WAV; no streaming or on-device VAD. On stop, the app saves the file to its per-account device queue before uploading to `POST /sessions` when connected and AI consent is active. The backend accepts several container formats (`SUPPORTED_AUDIO_TYPES` in `main.py`: aac, mp4/m4a, mpeg, ogg, wav, webm) and decodes in blocks with `soundfile`, falling back to `audioread` for formats it can't parse (`coordinator.py`). Each block is downmixed and resampled to mono 16 kHz before retaining it. The backend runs a synchronous pipeline in order:

1. `pipeline/vad.py` — Silero VAD checks whether any speech is present; it does not filter the audio sent to transcription.
2. `pipeline/transcription.py` — Sends the complete recording to `gpt-4o-transcribe-diarize` with `diarized_json` output and automatic server chunking. Speaker labels and timestamps refer to the original timeline.
3. `pipeline/speaker.py` — Merges overlapping intervals of the same speaker and estimates the user as the speaker with the highest duration-weighted RMS. Keeps every turn with that label, including quieter turns. This remains an unconfirmed microphone-placement assumption.
4. `pipeline/prosody.py` — Computes acoustic, word, question, filler, and speaking-rate statistics for the selected speaker. Other-speaker labels supply comparison durations. Interruption counts estimate overlap initiated by the user.
5. `pipeline/coaching.py` — Sends the full labeled conversation and selected-speaker stats to OpenAI `gpt-4.1` using Responses API structured outputs validated by Pydantic. The prompt explains identity and timing uncertainty. Retains two retries for invalid output; the SDK retries transient API errors twice.
6. `pipeline/coordinator.py` — Orchestrates these stages; returns a neutral debrief without calling the coaching model when no speech is found.
7. `POST /sessions` reserves usage through an account-scoped durable receipt, saves the debrief and completion marker atomically, and refunds only an uncommitted attempt. The full labeled transcript is stored only when transcript saving is enabled.

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

The optional `recording_id` form field on `POST /sessions` produces an account-scoped deterministic debrief primary key. Replays return existing rows before admission or quota reservation. A process-local in-flight guard returns 409 for simultaneous retries. The durable `debrief_receipts` table and reserve/release/complete RPCs reuse interrupted charges and prevent stale attempts from refunding or committing over newer attempts. Apply `20260918010000_durable_debrief_receipts.sql` before deploying this backend, and drain old writers; see `docs/beta-workstreams/reliability.md` for rollout/rollback limitations. A crashed reservation whose clip is abandoned remains counted in its original month; no automatic reconciliation job exists.

The queue survives restarts after Stop/save completes; uploads resume when the app is foregrounded, not while force-quit. It uses a provisional 2100-second upload timeout paired with transcription's 600-second attempts and one retry. Terminal 400/410/413/415/422 errors retain the original file and allow other clips to proceed. Imports use the same queue, stable recording IDs and title metadata. Native queue files have fixed internal names; original filenames remain upload metadata. Browser offline app-shell loading and OS background upload jobs are not implemented.

### Audio file import

`useImportAudio.ts` uses `expo-document-picker` (not an OS share-sheet intent). It checks nonempty size up to 100 MiB, supported MIME/extension, current account and saved AI consent, then durably enqueues the original with a stable recording ID. The shared `audioDuration.ts` reads metadata without playback. Client import checks allow one second of metadata padding (Apple reports 1400.076 seconds for a valid 1400-second MP3); the backend's actual 1400-second limit is unchanged. Recognized WebM may have unknown duration when Apple's player cannot read it; the UI says duration is checked during analysis and the advisory duration is omitted on upload. Other unreadable metadata fails clearly. Saved native capture uses the same duration helper with an audio-preserving fallback.

Note: the original plan called for `react-native-receive-sharing-intent` handling Android `ACTION_SEND` intents (share-sheet import, confirmation card instead of a manual picker) — that package was never installed and no intent filter exists in `AndroidManifest.xml`. The document-picker approach above is what actually shipped; treat any reference to `useSharedFile.ts` elsewhere as stale.

## Critical Gotchas

- **Privacy disclosures** — `app/src/privacy/aiConsent.ts` owns the concise no-sale/AI-sharing disclaimer. Recording, audio import, and Reflect require affirmative consent, remembered per account on the device; Voice & Privacy repeats the disclosure and allows withdrawal. Native recording explains screen-lock behavior on first use. Bump the consent-key version if data use changes. Do not promise that conversations are never stored or that privacy is guaranteed: transcript saving defaults on and debriefs are retained.

- **Expo prebuild + iOS extensions** — Phase 5 extension targets (`MirraIntents`, `MirraWidgets`, `MirraShare`) are not managed by Expo. After generating `ios/` with `expo prebuild --no-clean`, either commit `ios/` and stop re-running prebuild, or write `withMod` config plugins. Re-running prebuild will clobber manual target additions.

- **Background recording** — iOS requires `UIBackgroundModes: ["audio"]` in `app.config.ts` and an active `AVAudioSession`. Android requires a foreground service with a persistent notification. Validate on real devices, not simulators, with screen locked for 5+ minutes.

- **OpenAI structured output** — use `responses.parse` with the `CoachingOutput` Pydantic schema, never free-text JSON parsing. Keep two retries for invalid output in `coaching.py`; reject missing or incomplete output rather than saving an invalid debrief.

- **Speaker classification accuracy** — diarization groups voices but does not identify the recording owner. `speaker.py` still assumes the user is closer to the mic and chooses the loudest speaker by duration-weighted RMS. Document this constraint in onboarding. All turns of the chosen label are retained; speaker splitting and mixed-voice overlap can still affect metrics. `stats.metadata.diarization.user_speaker_confirmed` is false; there is no voice enrollment or speaker-correction UI.

- **Transcription limits** — `main.py` caps incoming uploads at 100 MiB; this is separate from OpenAI's 25,000,000-byte and observed 1400-second limits. `transcription.py` uses PCM WAV when it fits, then the supported original compressed file when it fits and has at least one second of duration headroom; otherwise FFmpeg encodes the bounded mono timeline as 48 kbps MP3 (about 8.4 MB at the maximum duration). The seekable output file preserves gapless metadata so encoder padding does not exceed the ceiling. FFmpeg with `libmp3lame` is required and checked by `scripts.warm_audio`. The generated file is size-checked before sending. Do not split into independent requests without reconciling speaker IDs; labels are local to each request.

- **JWT verification is ES256/JWKS, not a shared secret** — this Supabase project signs tokens with asymmetric keys, so an HS256 `SUPABASE_JWT_SECRET` can never verify them (this once silently broke every authenticated request). `app/auth.py` fetches the public JWKS once and caches it for the process lifetime; restart the backend if Supabase signing keys are ever rotated.

- **One AI credential** — `OPENAI_API_KEY` powers transcription, debriefs, and Reflect. Optional `OPENAI_DEBRIEF_MODEL` / `OPENAI_REFLECT_MODEL` overrides default to `gpt-4.1` / `gpt-4.1-mini`. Text requests use `store=False`; Reflect includes transcripts only when the user's settings allow it.

- **Prompt caching** — keep stable instructions and the output schema before varying conversation content. OpenAI caches eligible prompt prefixes automatically; no provider-specific cache-control fields are needed.

## Supabase Schema

- `users` — managed by Supabase Auth
- `debrief_usage(user_id, month_key UNIQUE WITH user_id, count int)` — monthly usage counter
- `debrief_receipts(debrief_id uuid PRIMARY KEY, user_id, month_key, attempt_id, completed)` — backend-only durable quota receipts; reserve/refund/complete transactions are service-role-only RPCs
- `debriefs(id uuid, user_id, created_at, observation, pattern_to_reduce, thing_to_try_next, stats jsonb, transcript text)`
- `user_settings(user_id, notifications_enabled, weekly_summary_day, weekly_summary_time, reflection_reminders, product_updates, save_transcripts, include_transcript_in_reflect, coaching_tone, coaching_depth)` — one row per user, backend-managed (`app/user_settings.py`)

Application tables have RLS enabled and owner read policies; writes go through the backend's service-role key. `debrief_receipts` has RLS and no client grants/policies; only the service role can access its rows or execute its accounting RPCs.

Monthly cap: 5 debriefs per user, configured by `FREE_TIER_CAP`. Enforced server-side — `POST /sessions` returns 402 when at cap. There are no paid tiers or subscription bypasses.

## Backend API

| Endpoint | Description |
|---|---|
| `POST /sessions` | multipart `audio` (supported format, ≤100 MiB and ≤23m20s) + form metadata → runs pipeline → returns `{ debrief, usedThisMonth, remaining }` |
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
