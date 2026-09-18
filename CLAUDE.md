# CLAUDE.md

Shared project guidance for Codex and Claude Code.

Verify implementation details against the code before relying on descriptions of current status.

Never use em dashes in new or revised copy, generated coaching, or user-facing responses. Coaching examples must be supported by relevant research and conversation context; do not present speaking ratios, question counts, pauses, or confidence phrases as universal rules. See `docs/WEBSITE-CONTENT-REVIEW.md` for sources and limits.

## Current release checkpoint (2026-09-18)

The user selected newer main `64db03b`, including 24-hour/2-GiB recordings.
Reconciliation `dbb25dea` is integrated locally. Old 1400-second processing,
receipt migrations and whole-file optimizations are superseded; see
`docs/beta-workstreams/reconciliation.md` for the disposition of earlier work.

- Reconciled checks pass: 50 app checks, TypeScript, 170 backend tests, four
  PostgreSQL transaction tests, all-platform prebuild/export and five website tests.
  The buffer-cleanup follow-up passes 182 backend tests. Final combined review/CI and native compilation remain pending.
- Installed phone source `a4b3c14` is older. Preserve its six offline clips during
  an overlay update; never uninstall or clear its data. All six share one owner;
  establish usage and a reconnect plan around the five-debrief monthly cap.
- Production is still the old Render deployment with auto-deploy off. Required
  September 14/15/16 schema is unavailable through its API. The obsolete Render
  `scripts.warm_audio` build command must be replaced before deploying main.
- Three ten-minute probes passed at 2 GiB. After upload-buffer cleanup and a
  streaming mock correction, full-day/144-chunk and 2-GiB upload probes also
  pass in the exact Python 3.11.16 deployment image at 2 GiB. Three real-VAD
  speech jobs pass there too. Non-root Docker-volume access passes. Actual
  hosting, live providers and sustained headroom remain open; see rollout evidence.
- Production, new-device and TestFlight acceptance remain open. No paid hosting
  or Apple membership purchase is authorized. Current evidence and next steps:
  `docs/testflight-acceptance.md`, `docs/beta-workstreams.md`, `docs/beta-pause.md`.

## Project Overview

Mirra is a conversational coaching iOS/Android app. It records real conversations, analyzes the user's speech for social signals (talk/listen ratio, question frequency, interruptions, energy, vocabulary), and surfaces a debrief card with coaching bullets and an AI-powered Reflect chat.

This is a monorepo with two top-level packages:
- `app/`: React Native (Expo 57 generated native projects + TypeScript)
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

Audio capture uses `expo-audio` (`useRecordAudio.ts`), with mono 24 kHz, 64 kbps M4A on mobile and WebM on web. Stopped recordings and imports enter the durable account queue. Current clients use resumable `/recordings` uploads in at most 4 MiB pieces, supporting up to 24 hours and 2 GiB. Native file handles read only the requested range. The legacy `/sessions` multipart endpoint remains capped at 25 MiB.

1. `recording_jobs.py` stores authenticated upload offsets and a background queue on `RECORDING_STORAGE_DIR`. Use one process/worker/instance and a persistent private volume of at least 32 GB, excluded from backups. The queue permits four pending jobs per account, 1,024 pending jobs globally, and 16 GiB of received audio. Empty uploads expire after 15 minutes; incomplete/failed uploads with audio expire after 24 hours without progress. Cleanup runs on upload creation and between worker jobs. Completed audio is removed.
2. `pipeline/coordinator.py` decodes allowlisted audio formats through FFmpeg into disk-backed mono 16 kHz float PCM. Network/playlist demuxers are disabled. Decoding times out after 900 seconds and rejects over 24 hours. A full day needs about 5.5 GB temporary PCM. Memory-mapped audio is analyzed in ten-minute chunks, preferably split at a detected pause.
3. `pipeline/vad.py` detects speech per chunk. Silent chunks are skipped; speech-bearing chunks retain their pauses and full timeline. `transcription.py` sends bounded PCM16 WAV to `gpt-4o-transcribe-diarize`, with `diarized_json` and automatic provider chunking. Original timestamps are restored.
4. Up to four clean voice reference excerpts help reconcile speakers across requests. Anonymous labels are prefixed per chunk and are never merged based only on matching letters. References are not saved as voice enrollment. Unlinked labels can represent the same person; matching is an estimate.
5. `speaker.py` merges same-speaker overlaps and estimates the user from duration-weighted RMS, retaining every turn with that label. This remains an unconfirmed microphone-placement assumption. `prosody.py` computes selected-speaker statistics with bounded energy calculations and samples up to 64 five-second excerpts for pitch.
6. `coaching.py` covers long transcripts in bounded evidence summaries before generating structured coaching with `responses.parse`, the Pydantic schema and `store=False`. Invalid output gets two retries; the SDK retries transient text errors twice. Empty speech gets a neutral debrief.
7. Both legacy `/sessions` and background jobs use the `complete_recording` SQL RPC, which stores the debrief and charges monthly usage in one transaction. Replay cannot double-charge, failures do not consume allowance, and tombstones prevent resurrection after cancellation or deletion. Transcript settings are checked again at commit. Restarted jobs reprocess from the beginning; per-chunk checkpoints are not implemented.

See `backend/app/pipeline/README.md` for request limits, timing caveats, and validation.

### Auth & JWT

The backend verifies Supabase JWTs on every request (`app/auth.py`). Uses `python-jose` to verify ES256 signatures against the project's public JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`), cached for ten minutes and refreshed on an unknown signing-key ID (at most once per 30 seconds) — no per-request network call and no shared secret. The Supabase project uses asymmetric signing keys; there is no `SUPABASE_JWT_SECRET` setting. `user_id` comes from the token's `sub` claim and is threaded through all DB operations.

Username/password sign-in is a thin wrapper: the backend maps `<username>` to the fake email `<username>@users.mirra.local` and drives Supabase's REST auth API directly. Username sign-up and sign-in follow upstream’s username/password flow; Google OAuth is available when configured. `GET /auth/status` reports whether username sign-up and Google OAuth are currently available so the app can gate its UI.

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

Native projects are generated with Expo prebuild and excluded from git/EAS uploads. `app/app.json`, `app/app.config.ts`, and `app/plugins/withRecordingService.js` are canonical. Expo Audio supplies the Android foreground microphone service and notification Stop action. The local plugin disables Android backups and excludes iOS Documents (pending audio) from device backups. There are no implemented iOS AppIntent/widget/share-extension targets. Changes to native behavior belong in a config plugin, not generated directories.

### Offline recording queue

`RecordingProvider` (`app/src/hooks/useRecordAudio.ts`) sits under AuthProvider and above the routes. Stopped recordings are saved before upload, using `src/storage/pendingRecordings.ts` (native documents directory) or `.web.ts` (IndexedDB blobs and metadata). `usePendingRecordings.ts` restores the per-account queue and uploads serially on launch, foreground/online events, and a 15-second foreground poll. Each upload refreshes auth and checks account identity. Only acknowledged uploads or explicit discards remove queued audio. Storage failures retain the original clip and block another capture until saving succeeds.

The recording ID produces an account-scoped deterministic debrief key for both legacy sessions and background jobs. A resumed upload starts at the durable server byte offset. Each request refreshes auth and checks the same account and device consent. Only a saved debrief acknowledgement or acknowledged cancellation removes local audio. Cancelling active work creates a tombstone before deleting files, so a racing worker cannot restore it. Apply the September 14 tombstone and September 16 long-recording migrations.

The queue survives restarts after Stop/save completes. Uploads resume while foregrounded, not while force-quit; after upload completes, backend analysis continues independently. Browser offline app-shell loading and OS background upload jobs are not implemented.

### Audio file import

`useImportAudio.ts` uses `expo-document-picker`. It validates supported MIME types/extensions and the 2 GiB cap, uses the upstream AI-consent helper, then copies audio into the same durable account queue as a recording. The queue refreshes auth and uses an idempotent recording ID. Import does not use an OS share-sheet intent. Duration probing is best effort; FFmpeg performs authoritative server decoding.

## Critical Gotchas

- **Expo prebuild** — native files are disposable generated output. Preserve custom behavior through `app/plugins/`, including background recording and backup exclusions. There are no manual iOS extension targets to preserve.

- **Background recording**: iOS requires `UIBackgroundModes: ["audio"]` and Expo Audio background recording mode. Android requires a foreground service with a notification. On Android 13+, the recording hook offers notification permission once per app launch; denial still permits the service, visible in OS Task Manager. Validate on real devices, not simulators, with screen locked for 5+ minutes.

- **OpenAI structured output** — use `responses.parse` with the `CoachingOutput` Pydantic schema, never free-text JSON parsing. Keep two retries for invalid output in `coaching.py`; reject missing or incomplete output rather than saving an invalid debrief.

- **Speaker classification accuracy** — diarization groups voices but does not identify the recording owner. `speaker.py` still assumes the user is closer to the mic and chooses the loudest speaker by duration-weighted RMS. Keep this constraint in the product’s AI limitations disclosure. All turns of the chosen label are retained; speaker splitting and mixed-voice overlap can still affect metrics. `stats.metadata.diarization.user_speaker_confirmed` is false; there is no voice enrollment or speaker-correction UI.

- **Provider transcription limit** - Each ten-minute PCM16 request stays below OpenAI's 25,000,000-byte cap. Larger recordings use multiple requests with temporary known-speaker references. Never merge anonymous speaker letters across requests; keep unmatched labels separate and disclose uncertainty.

- **JWT verification is ES256/JWKS, not a shared secret** — this Supabase project signs tokens with asymmetric keys, so an HS256 `SUPABASE_JWT_SECRET` can never verify them (this once silently broke every authenticated request). `app/auth.py` caches public JWKS for ten minutes and refreshes unknown signing-key IDs at most once per 30 seconds.

- **One AI credential** — `OPENAI_API_KEY` powers transcription, debriefs, and Reflect. Optional `OPENAI_DEBRIEF_MODEL` / `OPENAI_REFLECT_MODEL` overrides default to `gpt-4.1` / `gpt-4.1-mini`. Text requests use `store=False`; Reflect includes transcripts only when the user's settings allow it.

- **Prompt caching** — keep stable instructions and the output schema before varying conversation content. OpenAI caches eligible prompt prefixes automatically; no provider-specific cache-control fields are needed.

## Supabase Schema

- `users` — managed by Supabase Auth
- `debrief_usage(user_id, month_key UNIQUE WITH user_id, count int)` — monthly usage counter
- `debriefs(id uuid, user_id, created_at, observation, pattern_to_reduce, thing_to_try_next, stats jsonb, transcript text)`
- `user_settings(user_id, notifications_enabled, weekly_summary_day, weekly_summary_time, reflection_reminders, product_updates, save_transcripts, include_transcript_in_reflect, coaching_tone, coaching_depth)` — one row per user, backend-managed (`app/user_settings.py`)

All tables have RLS enabled with `(select auth.uid()) = user_id` read policies. App writes go through the backend's service-role key. `user_settings` also permits owner-scoped INSERT/UPDATE, constrained by database types and allowed values; it contains no privileged quota, role, billing or consent fields.

Mirra Free includes 5 debriefs per month, configured by `FREE_TIER_CAP`. Mirra Pro is the $8/month paid plan with unlimited debriefs, restored in Profile and its Plans sheet. Stripe remains removed; replacement purchasing and verified paid entitlements are not connected. The UI discloses that purchases are unavailable in this build. All accounts currently retain the server-enforced free cap; `POST /sessions` returns 402 at the cap. Never grant Pro from a client-side flag or merely viewing the offer.

## Backend API

| Endpoint | Description |
|---|---|
| `POST /recordings`, `PUT /recordings/{id}/audio`, `POST /recordings/{id}/complete` | initialize/resume upload, append bounded bytes, enqueue background analysis |
| `GET /recordings/{id}`, `DELETE /recordings/{id}` | progress/saved result, cancel and tombstone an account-owned recording |
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

## Conversation goals

`user_settings.coaching_goal` is a validated preference: `general`, `make_friends`, `confidence`, `listening`, `clarity`, or `assertiveness`. It defaults to `general`. Users choose it from Home → Your focus or Profile → Your conversation goal. The recording worker and `/sessions` read the current saved goal when processing begins and passes it into `coordinator.run` → `coaching.analyze`; `/reflect` passes the current goal into `generate_reflection`. Shared guidance lives in `backend/app/coaching_goals.py`. Debrief metadata retains the processing-time goal so history is not relabeled after settings changes. Apply `20260915010000_coaching_goals.sql` before deploying; `/ready` checks this column.

## Backend Integration Status

The frontend is fully wired to the backend — no more mock data. `src/data/recents.ts` and `src/data/weeks.ts` (the old static mocks) are deleted. Every screen fetches through a hook in `src/hooks/` (`useDebriefs`, `useUsage`, `useUserSettings`, `useProfileSummary`, `useProgressSummary`, `useRecordAudio`, `useImportAudio`), which goes through `app/src/api/client.ts`.

**API boundary:** all fetch calls go through `app/src/api/client.ts`, which handles snake_case → camelCase conversion. New hooks should use this file.

- Auth (username/password + Google, via Supabase) — `src/auth/AuthContext.tsx`, `src/api/auth.ts`, `backend/app/auth.py` / `main.py`'s `/auth/*` routes.
- User settings (notifications, coaching tone) — `useUserSettings`, `backend/app/user_settings.py`, `/settings` routes.
- Dashboard/analytics — `useProgressSummary`, `backend/app/dashboard.py`, `/analytics/progress`.
- Reflect chat — `useDebriefs` + `api/client.ts`'s reflect call, `backend/app/reflection.py`, `/reflect`. Uses the same OpenAI key as transcription and debriefs, with a local fallback when no model reply is available. `src/data/reflect.ts` contains only introductory and starter-prompt copy. Any backend general-guidance fallback is labeled as AI unavailable in the UI; failed network requests retain the user message.

**Data models are already aligned** — `backend/app/models/debrief.py` matches the TypeScript `DebriefCard`/`ConversationStats` interfaces in `app/src/models/`.

## Release privacy and operations

- Apply the September 14 deletion-tombstone, September 15 coaching-goal and September 16 long-recording migrations before deploying the current backend. `/health` reports liveness; `/ready` requires the deletion-marker table, coaching-goal column, recording-completion RPC and AI credential.
- AI consent uses upstream’s `app/src/privacy/aiConsent.ts`: approval is stored per account on each device, recording/import/Reflect request it, queued uploads recheck it, and Profile can withdraw it on that device. There is no additional release-branch consent screen, server-side consent field or consent migration. Transcript defaults and username/Google onboarding follow upstream.
- `DELETE /account` removes the authenticated Supabase user with cascading data deletion. `DELETE /debriefs/{id}` uses an account-scoped SQL RPC and a content-free tombstone. SQL advisory locks serialize deletion and replay; the insert trigger rejects resurrection. Tombstones disappear on account deletion and are included in account exports.
- One pipeline/worker protects the stateful VAD model and memory budget. Reflect has a per-account 60-message/hour process-local limit. Move budgets to shared storage before scaling workers/instances.
- Product/release evidence and external blockers are tracked in `docs/RELEASE.md`. The website and policy pages remain a clearly labeled prelaunch preview until the operator, private support contact and deployment are finalized.
