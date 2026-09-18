# Mirra

Conversation coaching for iPhone and Android: record with permission, review a short AI debrief, and reflect on listening and speaking habits. Built with Expo/React Native, FastAPI, Supabase and one OpenAI API key.

**Prelaunch.** The [release record](docs/RELEASE.md) contains store copy, verified checks, deployment steps and remaining launch blockers. The [website preview](https://sheanrahman192.github.io/mirra/) is live; no store download is available yet.

## Development

Backend requirements: Python 3.11+, FFmpeg on PATH and libsndfile. Copy `backend/.env.example` to the ignored `.env`, then configure Supabase's URL/service-role key and `OPENAI_API_KEY`.

```sh
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
uv run pytest -q
```

Apply every migration under `supabase/migrations` to the intended database before running the current backend. `/health` is liveness; `/ready` checks required release schema and configuration. Production additionally requires `ENVIRONMENT=production` and explicit HTTPS `CORS_ORIGINS`.

App requirements: Node 22 and an Expo-supported native toolchain or EAS. Configure the following in ignored `app/.env.local`. A phone needs a reachable LAN address during local development; production requires public HTTPS endpoints.

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
EXPO_PUBLIC_MIRRA_BACKEND_URL=http://your-computer-lan-address:8000
EXPO_PUBLIC_WEBSITE_URL=https://sheanrahman192.github.io/mirra
```

```sh
cd app
npm ci
npm run typecheck
node --test tests/*.test.mjs
npx expo start --web
npx expo run:ios       # macOS + Xcode
npx expo run:android   # Android SDK + device/emulator
```

Native directories are generated and ignored. `app/app.json`, `app/app.config.ts` and `app/plugins/` are canonical. The plugin preserves the Android microphone service and iOS audio-backup exclusion during prebuild. Put durable native changes in the plugin. Expo Go does not contain Mirra's Android recording service; use a native build.

## Website and release checks

```sh
node website/build.mjs
node --test website/*.test.mjs
node website/release-check.mjs
```

`website/release.json` contains public configuration only. Unknown store URLs render as coming soon. Privacy documents remain marked as previews until operator/support details and review are complete. GitHub Pages serves the built contents from the fork's `gh-pages` branch. Never include `.env`, a service-role key or an OpenAI key in the website or app bundle.

The GitHub workflow validates the app, backend, database migrations, container, Android compilation and an unsigned iOS simulator build. `app/eas.json` prepares preview and signed production builds; a developer account, EAS project and signing credentials are still required. The repository-root `.easignore` excludes backend files, local credentials and generated native projects from the EAS archive while retaining the website release check. Profile displays Mirra Free and the $8/month Mirra Pro plan. Payment processing and verified Pro entitlements still need a replacement for the removed Stripe integration; purchases are explicitly unavailable in this build. There are no advertising trackers.

Regenerate dependency notices after package updates with `node app/scripts/generate-notices.mjs`. Optional real-provider verification is available from `backend` with `python scripts/smoke_ai.py --live`; it incurs API charges and uses only synthetic test audio.
