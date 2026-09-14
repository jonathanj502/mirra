# Mirra release record

Updated September 14, 2026. **Prelaunch; not approved for public app distribution.** This record distinguishes implemented controls from external setup and physical-device evidence. A working web preview is not an iOS release test.

## What is prepared

- Expo 54 app with a generated native project, branded icon/splash, EAS preview/production profiles, and a production build guard against local or insecure endpoints.
- Permission before audio collection and explicit, versioned consent before OpenAI processing. The backend independently enforces consent. Transcript saving is off for new accounts. Profile supports withdrawal, export, conversation deletion and account deletion.
- Recoverable email-link sign-in. Existing username accounts can sign in; new username-only accounts are disabled. iOS uses the app's email account system; Google is offered only on Android/web when enabled.
- Durable, account-isolated recording and import queues. Uploads refresh authentication, are idempotent by recording ID, and retain unacknowledged audio. Android has a foreground microphone service. Pending audio is excluded from Android backup; the iOS config plugin excludes Documents from backup.
- FFmpeg decoding is limited to supported audio demuxers, mono 16 kHz output, 60 minutes and a 120-second decoder timeout. Uploads remain limited to 25 MB. A single pipeline runs at a time because the shared VAD model has mutable state. Busy requests preserve queued audio.
- Live, labeled Reflect responses with no fabricated model-success fallback. Reflect allows 60 requests per account per hour in the single-worker launch deployment.
- Marketing, privacy, terms, support and authenticated web-deletion pages. Download links stay disabled until actual store URLs exist. The current website identifies itself as a prelaunch preview and does not collect email while deletion infrastructure is unconfigured.
- Container build, automated app/backend/database checks, Android and unsigned iOS simulator builds, dependency notices and store copy below. Account/settings sheets scroll on small screens, and shared navigation and controls expose accessible roles and state.

## Verified evidence

- Local TypeScript validation and 20 passing behavior tests cover callback-token cleanup, account isolation, offline recovery, consent, imports, both sign-out paths, deletion, archive rules and loading errors. Production JavaScript export passed for web and both native platforms, including Hermes bytecode. CI now runs all-platform export as well as native compilation.
- All 136 backend tests passed in CI, covering auth, settings, AI consent, usage refunds, duplicate processing, pipeline output, ownership checks, export, deletion and private error logging.
- A live OpenAI smoke check used two synthetic voices: transcription found two speakers, structured coaching and Reflect both succeeded (22.8 seconds for the complete smoke check). No customer content, account or database row was used. Reproduce intentionally with `python scripts/smoke_ai.py --live` from `backend`; this incurs API charges.
- [GitHub Actions run 34822843697](https://github.com/sheanrahman192/mirra/actions/runs/34822843697), at `50c6018`, passed all six jobs: app/prebuild, backend, PostgreSQL schema/privacy checks, container, Android compilation, and unsigned iOS simulator compilation. Subsequent UI, website and archive-rule changes have their local evidence above; the PR lists the final workflow result.
- The [published website](https://sheanrahman192.github.io/mirra/) was checked at phone width; landing and privacy pages had no horizontal overflow. Three website tests pass. A browser check caught a CSS rule overriding the hidden deletion form; it is fixed with a submission guard and versioned assets, and the published page was verified to hide the form. No email is collected while release services are unconfigured.
- EAS's repository-copy implementation was exercised locally: website release checks are included, and local credentials, backend contents and generated native contents are excluded. `.easignore` belongs at the repository root. Full `eas build:inspect` requires Expo authentication and was not completed; this copy check is not a signed cloud build.

## Launch blockers and their current evidence

| Requirement | State and reason |
|---|---|
| Consent schema migration | `20260914010000_processing_consent.sql` and `20260914020000_deletion_tombstones.sql` are prepared but not applied to the hosted project. Available service-role credentials access application data, not SQL administration. No linked database credential or Supabase management session was available. `/ready` fails until the migration is present. |
| Production API hosting | No authenticated hosting account or production HTTPS endpoint was available. `backend/Dockerfile` is built by CI. The current app development address is a LAN address and cannot be shipped. |
| Email delivery and redirects | Supabase public configuration is readable, but production SMTP, delivery, redirect allowlists and recovery need an authenticated project configuration session and an actual inbox round trip. These are not verified. |
| Operator and private support | The legal operator, business contact, release territories, support mailbox, retention schedule and processor agreements are not established by the repository. The website deliberately leaves them unconfirmed. Do not turn `privacyApproved` on based only on these draft texts. |
| Apple Developer / App Store Connect | No signed-in account, development team, distribution certificate, provisioning profile, App Store app record, review access or paid enrollment was available. Ownership/availability of `com.mirra.app` is unverified. |
| EAS account | No Expo authentication or project ID was configured. EAS profiles are prepared; no signed build or TestFlight upload exists. |
| Physical-device testing | No connected iPhone/Android device was available. Background/locked-screen capture, phone-call interruption, Bluetooth, permission denial, and recovery need device evidence. An unsigned simulator build cannot establish these behaviors. |
| Final store assets | The icon and copy are prepared. Screenshots must be captured from the actual release build after a successful authenticated flow. The website's illustrative phone card is not an App Store screenshot. |
| Dependency review | Compatible fixes removed the critical npm advisory. Remaining transitive advisories include build-tool image parsers and URI/UUID utilities. See the dependency notes below; the audit is not clean. |

Missing account sessions, legally attributable facts and device evidence are not values that automation can truthfully invent. The release check remains closed until they are established.

## Deployment order

1. Apply both September 14 migrations to the intended Supabase project using a migration-capable database connection. Verify the live schema, read policies, removal of direct settings write policies, and the existing `auth.users` cascading foreign keys.
2. Configure the backend's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ENVIRONMENT=production` and explicit `CORS_ORIGINS`. Keep service-role and OpenAI keys entirely server-side.
3. Deploy the tested container behind HTTPS with a 26 MB request-body limit and a request timeout greater than the app's processing window. Run one worker and one instance initially; the current request budget and VAD serialization are process-local. Provision at least 4 GB RAM and measure peak memory with supported long audio. Set provider spending alerts and an OpenAI project budget. Never log bearer tokens, audio, transcripts or prompts.
4. Verify `/health`, `/ready`, signed-in history/settings, a consented upload, usage reservation/refund, Reflect, export and deletion in the deployed environment. `/ready` checks credentials are present and the consent columns are queryable; it is not proof that OpenAI billing or every provider is healthy.
5. Configure Supabase production SMTP, SPF/DKIM/DMARC where applicable, and only intended redirect URLs. Native sign-in uses `mirra://auth`; web deletion uses the exact public `/delete-account.html` URL. Test a real email round trip. Keep development localhost/LAN redirect entries out of a dedicated production project.
6. Finalize operator/support/territories/provider retention, review the actual privacy policy and terms, update `website/release.json`, rebuild, and publish. Align app privacy disclosures, the Apple privacy questionnaire and Google Data safety answers with the deployed behavior.
7. Configure the EAS project and production public environment. Run the production build guard, native CI, the device matrix below, then build and submit a signed iOS binary. Stage through internal TestFlight before public release. Add verified store URLs to the website only when the corresponding app records are available.
8. Release manually after review. Keep the previous signed build and container revision available for rollback. Preserve schema/consent records during rollback; never roll back to an AI-processing path that bypasses consent.

## Acceptance matrix

Record device, OS, build number and result for every row. Use synthetic or explicitly consented test conversations and disposable test accounts.

| Flow | Required outcome |
|---|---|
| Fresh install, email sign-in, expired link | Successful link opens Mirra; invalid links show an error without leaking URL credentials. |
| Consent decline/accept/withdraw | Decline allows account management; no upload or Reflect request reaches OpenAI. Accepted version has a server timestamp. Withdrawal stops subsequent processing on all clients when online. |
| Record, lock screen 5+ minutes, foreground, stop | Audible complete recording, preserved timing, microphone indicator and Android ongoing notification. Notification returns to the app. |
| Phone call, Bluetooth disconnect, mic permission revoked | No crash or silently lost clip. Available audio can be saved; errors explain the real state. |
| Airplane mode, stop, force-quit, relaunch | After Stop/save completes the clip survives; uploading resumes when foregrounded and online. A force-quit during active recording is not guaranteed recoverable. |
| Storage full and failed upload | Original audio is retained, another capture cannot overwrite an unsaved clip, and no successful debrief is invented. |
| Lost response and repeated upload | One saved debrief and one net usage reservation for the same recording ID. |
| Sign out/account switch during queue | Audio from one account is never uploaded with another account's token. |
| Import M4A/MP3/WAV/OGG/AAC/WebM | File is copied durably before upload. Unsupported/oversized input is rejected without deleting the original. |
| Empty/noisy/overlapping speech | Empty audio gives neutral feedback. Approximate speaker/metric limitations remain visible. |
| Usage limit and next UTC month | Five successful debriefs per month; failed processing is refunded; deleting a completed conversation does not refund use. |
| Conversation deletion | Confirmation required, failures retain content, successful deletion removes history/detail access for that account. |
| Account deletion in app and website | Only authenticated owner's data is deleted; database cascades verified; local queued files on the deleting device cleared; other-device local-data limitation disclosed. |
| Export native/web | Complete saved history and settings; native share sheet works and temporary export file is removed. |
| Accessibility | VoiceOver/TalkBack names, focus order, large text, keyboard dismissal, contrast, touch targets, reduced motion, and no clipped controls on small screens. |

## App Store package

Suggested initial category: Lifestyle. Intended audience: adults 18+. Complete Apple's current age-rating questionnaire based on actual content and features; an 18+ product policy does not automatically answer that questionnaire.

**Name:** Mirra: Conversation Coach

**Subtitle:** Notice how you connect

**Promotional text:** Make a little more room for connection. Record with everyone's permission, reflect on your conversational habits, and choose one small thing to try next time.

**Description:**

Mirra is a quiet space to reflect on how you listen, ask questions and respond.

Record a conversation with everyone's permission, or import an audio file. Mirra transcribes the conversation, estimates conversational signals, and returns a short debrief: one observation, a pattern to reduce and something to try next time.

Use Reflect to explore a moment with an AI conversation coach. Review saved conversations and weekly patterns, export your data, or delete a conversation or your account.

Recordings you stop and save can wait on your device until you are back online. Keep Mirra open to finish uploading. The first release includes five debriefs per month, with no subscriptions or paid plans.

Mirra uses OpenAI for transcription and coaching. You review and agree to this processing before using it, and you can withdraw consent in Profile. Transcript saving is off by default for new accounts.

AI can be wrong. Mirra estimates that the loudest speaker is you; microphone placement, overlapping voices and transcription errors can affect results. These are prompts for reflection, not verified assessments of a person. Mirra is not medical or mental-health care. For adults 18 and over. Always obtain permission from everyone involved before recording or uploading their conversation.

**Keywords:** conversation,listening,reflection,communication,habits,coaching,questions

**Review notes:** Explain microphone/background audio as user-initiated conversation recording; there is no passive listening. Identify the consent screen, the permanent deletion path and the offline queue. Provide an authenticated disposable review account or another working review-access method in App Store Connect's private review fields, never in this repository. Explain the free five-debrief limit and reset review usage before review. No purchases, subscriptions, ads or tracking are implemented. Do not advertise widgets, Apple Watch, notifications or speaker correction; these are not shipped.

**Screenshot sequence:** (1) actual Home/record screen, (2) consent disclosure, (3) completed synthetic conversation debrief, (4) Reflect response, (5) weekly insights, (6) Profile privacy/deletion controls. Capture at Apple's required dimensions from the current release build. Remove test identities and personal content; clearly distinguish synthetic demonstration content. Include an Android feature graphic/screenshots only when the Android build is validated.

## Privacy questionnaire worksheet

Conservative draft, not a submitted questionnaire. Verify every SDK and the final hosting setup first.

| Data | Current processing | Purpose |
|---|---|---|
| Email, account ID and provider identifiers | Linked to the account in Supabase | App functionality and authentication |
| Audio | Device queue, temporary backend decoding, OpenAI transcription | App functionality |
| Transcript, debrief and chat content | Linked saved debriefs; optional transcript storage; text sent to OpenAI | App functionality |
| Derived conversation statistics and usage count | Linked to the account | App functionality |
| IP/security/operational logs | Provider processing and configured hosting logs | Security and operation |

No advertising identifier, contact-list upload, location feature or advertising tracking is implemented. No customer analytics/crash-reporting SDK is configured. Do not label provider processing as zero retention merely because requests use `store=False`. Audio may contain sensitive information incidentally; review applicable sensitive-data categories, processor terms, backup retention, international transfers and release territories. Document requests to access, delete, correct and export data; establish a private support channel and an incident response owner before public launch.

## Dependency and operational notes

- Expo 54 was retained for the existing `expo-av` recording implementation. A forced SDK jump solely to silence npm audit would require a separate audio migration and device validation.
- Compatible npm updates and a PostCSS override removed the critical advisory and a vulnerable PostCSS dependency. The audit still reports transitive issues. Image-size advisories affect malformed image inputs in build tooling; only reviewed repository assets should enter builds. Do not turn this into an untrusted image-upload service. URI/UUID advisories require separate compatibility-tested dependency upgrades.
- `app/scripts/generate-notices.mjs` collects installed production dependency notices for the app's notices screen. Regenerate after dependency changes and review packages that provide only SPDX metadata. CocoaPods/Gradle dependencies and production backend/image licenses also need to remain available with their distributions.
- Monitor health/readiness, error rates, request latency, queue failures, AI cost and storage growth without recording sensitive content. Provider dashboards and spending alerts are not configured by source code alone.
- Deleted conversation IDs are retained as content-free tombstones until account deletion. An SQL advisory lock and insert trigger prevent in-flight or delayed uploads from restoring deleted conversations. The account export includes these IDs. Apply the tombstone migration before deploying this backend.

## Sources checked

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — privacy, third-party AI disclosure, account deletion and sign-in requirements.
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/) — deletion must be available in the app.
- [Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/) and [Expo's SDK 26 submission guidance](https://expo.dev/blog/app-store-connect-minimum-sdk-26) — current iOS SDK/toolchain requirements. The EAS production profile selects the SDK 54 build image.
- [Expo build infrastructure](https://docs.expo.dev/build-reference/infrastructure/) — build image selection and SDK aliases.
- [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) — in-app and web deletion paths.
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) — endpoint-specific retention and training defaults.
- [Supabase passwordless email authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless) — email links and redirect configuration.
- [Reporters Committee recording guide](https://www.rcfp.org/reporters-recording-guide/) — recording requirements vary by jurisdiction and circumstances. The product asks for all participants' permission; that is not a guarantee of legal compliance in every situation.
