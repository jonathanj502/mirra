# Mirra release record

Updated September 15, 2026. **Prelaunch; not approved for public app distribution.** This record distinguishes implemented controls from external setup and physical-device evidence. A working web preview is not an iOS release test.

As of September 16, website copy uses the owner's explicit assumption that both iPhone and Android apps are available (`website/release.json` → `iphoneAvailable` and `androidAvailable`). This is a copy premise, not verified store-release evidence. Store destinations remain unverified, so `appStoreUrl` and `playStoreUrl` stay empty and no download links are invented. Operator/privacy approval, web deletion and backend readiness retain their actual configuration. Apple's September 15 public US lookup for `com.mirra.app` returned an unrelated app, Mirra Support (`id6755451137`); confirm an owned bundle identifier and listing before a native release. Do not link to that unrelated product.

## What is prepared

- Optional conversation goals, chosen from Record → Your focus or Profile → Your conversation goal. Friendship, confidence, listening, clarity and assertiveness tailor both debriefs and Reflect; Everyday connection is the default. The server reads the saved goal when processing starts, including offline uploads, and stores it in each debrief's metadata. Changing a goal does not rewrite past debriefs. Account export/deletion cover the preference. No additional API key is needed.

- Expo 54 app with a generated native project, branded icon/splash, EAS preview/production profiles, and a production build guard against local or insecure endpoints.
- Upstream owns privacy choices through `app/src/privacy/aiConsent.ts`: approval and withdrawal are per account on the current device. Recording/import/Reflect request approval and queued uploads recheck it before sending. The duplicate release-branch consent provider, age/terms gate, server enforcement and schema migration have been removed. Transcript saving follows upstream’s enabled default; the existing switches remain available.
- Username/password sign-up, sign-in and configured Google OAuth follow upstream. The release branch no longer replaces onboarding with email links. Account export and deletion remain implemented.
- Durable, account-isolated recording and import queues. Uploads refresh authentication, are idempotent by recording ID, and retain unacknowledged audio. Android has a foreground microphone service and offers notification visibility permission on Android 13+ when recording starts; declining leaves the service visible in the OS Task Manager. Pending audio is excluded from Android backup; the iOS config plugin excludes Documents from backup.
- Long recordings and imports support up to 24 hours and 2 GiB through resumable 4 MiB uploads and a durable background worker. FFmpeg decodes to disk-backed mono 16 kHz PCM with a 900-second timeout; ten-minute analysis chunks stay below the provider upload limit. Temporary voice excerpts help match speakers across chunks. One pipeline runs at a time; local originals remain until the saved debrief or cancellation is acknowledged.
- Live, labeled Reflect responses with no fabricated model-success fallback. Reflect allows 60 requests per account per hour in the single-worker launch deployment.
- Marketing, privacy, terms, support and authenticated web-deletion pages. Download links stay absent until actual store URLs exist. Availability copy follows the owner's iPhone/Android premise above. Policy details remain pending and the website does not collect email while deletion infrastructure is unconfigured.
- Container build, automated app/backend/database checks, Android and unsigned iOS simulator builds, dependency notices and store copy below. Account/settings sheets scroll on small screens, and shared navigation and controls expose accessible roles and state.

## Verified evidence

- September 16 visual refinement: larger editorial typography, illustrated goal cards, a clearer product stage, compact phone/tablet tabs and a forest-green closing section. The people photo and both WebP sources were subsequently removed at the user's request. The hero now illustrates background recording leading to a specific friendship-focused suggestion, using HTML, CSS and SVG with no generated people images. Five website tests pass, including responsive tab orientation. Earlier browser review covered 320, 393, 768, 1024 and 1440 pixel viewports, sample controls, keyboard operation and navigation dismissal; the recording-to-debrief hero passed browser review at 320, 393, 1024 and 1440 pixels with no horizontal overflow or clipped text. The site remains static with no added dependencies. References and verification limits are in `docs/WEBSITE-UX.md`.
- September 16 passive-recording copy: the homepage, sample recording and support steps emphasize background recording during sessions throughout the day. Participant-permission reminders were removed from marketing/getting-started copy; policy terms and the app's consent behavior were not changed. The homepage FAQ states manual session start/stop. The old duration/upload sentence was removed when long-recording support was implemented. No uninterrupted all-day capture, automatic session splitting or auto-start is claimed. Five website tests pass.

- September 15 website content research: audited all five pages against communication research, provider documentation, and the app/backend implementation. Replaced the confidence hedge example and universal pause advice, relabeled speaking share and detected questions, added research sources and limitations, and corrected website-hosting, offline-use, and web-deletion disclosures. All rendered pages pass the new no-em-dash check. Five website tests and 59 targeted backend tests pass; the shared debrief/Reflect instructions now include contextual coaching and metric limitations. Browser checks cover 320, 393, 768, and 1440 pixels, the revised sample, research FAQ, privacy, and disabled web-deletion page. Full evidence and limits: `docs/WEBSITE-CONTENT-REVIEW.md`. Website publication does not deploy the backend changes.

- September 15 website usability review: removed promotional links that only scroll to the next section, replaced unavailable download buttons with plain launch status, made copy/headings more specific, and enlarged explanatory text. Five website tests pass, including prelaunch/iPhone/Android availability branches. Browser checks cover 320, 393, 768, 1024 and 1440 pixels, sample controls, keyboard operation and mobile navigation. Research and decisions are recorded in `docs/WEBSITE-UX.md`; no conversion uplift or field-performance measurement is claimed.

- September 15 coaching goals: TypeScript, 25 app tests, 144 backend tests and 4 website tests pass. Tests cover default and invalid goals, persisted preferences, AI request instructions, no-speech behavior, upload replay retaining the original goal, export, and picker/API mapping. The new database migration is included in schema CI; hosted schema application and backend/app release remain separate deployment steps.

- September 15 website redesign: original forest-green/ivory design, illustrated app preview, keyboard-accessible Record/Debrief/Reflect tabs, responsive navigation and FAQ. References reviewed: [Linear](https://linear.app/), [Granola](https://www.granola.ai/), [Willow](https://willowvoice.com/), [Touchy](https://touchyapp.com/) and [Apple](https://www.apple.com/airpods-pro/). Four website tests cover preview interactions, menu behavior, local links/assets/anchors and deletion protections. Browser checks cover 320, 393, 768, 1024 and 1440 pixel viewports. Demo content is explicitly illustrative; store links remain unavailable until real listings exist.
- September 15 removal checks: TypeScript, 24 app tests (including upstream consent/queue/Reflect regressions), 135 backend tests, and 3 website tests pass. The upstream consent helper and authentication screen match `upstream/main` at `f628b73`; no hosted database mutation was performed.

The native-build and published-website evidence below predates the September 15 removal of duplicate privacy/onboarding controls. The saved iOS sign-in screenshot shows the superseded email-link screen; it is historical evidence, not a screenshot of the current onboarding.

- Expo Doctor passed all 18 checks. Local TypeScript validation and 23 passing checks cover callback-token cleanup, account isolation, offline recovery, consent, imports, both sign-out paths, deletion, archive rules, loading errors and shared color contrast. Production JavaScript export passed for web and both native platforms, including Hermes bytecode. CI now runs all-platform export as well as native compilation.
- Shared text colors meet 4.5:1 contrast on all four paper surfaces; primary button labels meet 4.5:1. Inactive tabs and chart labels no longer use faded text. Decorative recording loops are removed, Reflect uses the native progress indicator, and report forms avoid the iOS keyboard. This does not replace the physical-device accessibility matrix below.
- All 138 backend tests passed locally and in CI, covering auth, settings, AI consent, usage refunds, duplicate processing, pipeline output, ownership checks, export, deletion and error logging.
- A live OpenAI smoke check used two synthetic voices: transcription found two speakers, structured coaching and Reflect both succeeded (22.8 seconds for the complete smoke check). No customer content, account or database row was used. Reproduce intentionally with `python scripts/smoke_ai.py --live` from `backend`; this incurs API charges.
- [GitHub Actions run 34827309526](https://github.com/sheanrahman192/mirra/actions/runs/34827309526), at code revision `3995610`, passed all six jobs: app/all-platform export/prebuild, backend, PostgreSQL schema/privacy checks for all three migrations, container, Android compilation, and an unsigned iOS Release build and simulator launch. The [captured iOS launch](ios-release-launch.png) was inspected: sign-in controls, bundled fonts and privacy text render correctly without a development server. Authenticated flows and background recording still require the acceptance matrix below.
- The [published website](https://sheanrahman192.github.io/mirra/) was checked at phone width; landing and privacy pages had no horizontal overflow. Three website tests pass. A browser check caught a CSS rule overriding the hidden deletion form; it is fixed with a submission guard and versioned assets, and the published page was verified to hide the form. No email is collected while release services are unconfigured.
- Generated native artifacts were inspected: Android includes microphone/foreground-service/notification permissions, disables backups and main-app cleartext traffic, and removes legacy storage/overlay permissions. iOS includes its microphone disclosure, audio background mode, backup exclusion and privacy manifest.
- EAS's repository-copy implementation was exercised locally: website release checks are included, and local credentials, backend contents and generated native contents are excluded. `.easignore` belongs at the repository root. Full `eas build:inspect` requires Expo authentication and was not completed; this copy check is not a signed cloud build.

## Launch blockers and their current evidence

| Requirement | State and reason |
|---|---|
| Release schema migrations | The September 14 tombstone, September 15 goal and September 16 long-recording migrations are prepared but not applied to the hosted project. Available service-role credentials access application data, not SQL administration. No linked database credential or Supabase management session was available. `/ready` fails until the migration is present. |
| Production API hosting | No authenticated hosting account or production HTTPS endpoint was available. `backend/Dockerfile` is built by CI. The current app development address is a LAN address and cannot be shipped. |
| Email delivery and redirects | Supabase public configuration is readable, but production SMTP, delivery, redirect allowlists and recovery need an authenticated project configuration session and an actual inbox round trip. These are not verified. Legacy username-only accounts use non-deliverable local addresses and need a verified real-email migration before they can recover a lost password. |
| Operator and private support | The legal operator, business contact, release territories, support mailbox, retention schedule and processor agreements are not established by the repository. The website deliberately leaves them unconfirmed. Do not turn `privacyApproved` on based only on these draft texts. |
| Apple Developer / App Store Connect | No signed-in account, development team, distribution certificate, provisioning profile, App Store app record, review access or paid enrollment was available. Ownership/availability of `com.mirra.app` is unverified. |
| EAS account | No Expo authentication or project ID was configured. EAS profiles are prepared; no signed build or TestFlight upload exists. |
| Physical-device testing | No connected iPhone/Android device was available. Background/locked-screen capture, phone-call interruption, Bluetooth, permission denial, and recovery need device evidence. An unsigned simulator build cannot establish these behaviors. |
| Final store assets | The icon and copy are prepared. Screenshots must be captured from the actual release build after a successful authenticated flow. The website's illustrative phone card is not an App Store screenshot. |
| Dependency review | Compatible fixes removed the critical npm advisory. Remaining transitive advisories include build-tool image parsers and URI/UUID utilities. See the dependency notes below; the audit is not clean. |

Missing account sessions, legally attributable facts and device evidence are not values that automation can truthfully invent. The release check remains closed until they are established.

## Long-recording validation

- A separate full-day synthetic WAV (1,382,400,044 bytes) passed real FFmpeg decoding and timeline coverage: 24 hours, 144 chunks, at most 600 seconds per chunk, and cleaned temporary PCM in 39.8 seconds. VAD was stubbed for this storage/duration stress check; live speech processing is covered separately below.
- All 152 backend tests, TypeScript, 28 app checks, five website tests and all-platform Expo export pass. PostgreSQL 17 schema tests passed in [CI run 35061703522](https://github.com/sheanrahman192/mirra/actions/runs/35061703522), including atomic completion, lost-response replay, quota rollback, pending cancellation and account deletion. Temporary server audio is excluded from Git, Docker inputs and EAS archives. The Supabase management page was checked again and redirected to an unsigned GitHub login; hosted migration application remains unavailable in this session.
- A real two-hour WAV larger than 25 MB decodes and covers the entire timeline in 12 bounded chunks. Automated checks cover upload offsets, lost acknowledgements, account isolation, chunk size, restart recovery, cancellation, expiry, full-transcript summary coverage and temporary speaker references.
- A paid OpenAI smoke check with repeated synthetic voices completed three chunks, structured coaching and Reflect in 35.3 seconds. Two source voices produced three estimated speaker labels, demonstrating that reference matching is still imperfect. No customer content or account rows were used.
- Mobile hook checks accept a 256 MiB import and save a simulated eight-hour recording. Actual battery life, uninterrupted all-day capture and hardware memory behavior still require physical-device evidence. Source changes and website publication do not deploy a native app or apply hosted migrations.

## Deployment order

1. Apply every migration in `supabase/migrations/`, including September 14 deletion tombstones, September 15 coaching goals and September 16 atomic recording completion, to the intended Supabase project using a migration-capable database connection. Verify the live schema, read policies, removal of direct settings write policies, and the existing `auth.users` cascading foreign keys.
2. Configure the backend's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ENVIRONMENT=production` and explicit `CORS_ORIGINS`. Keep service-role and OpenAI keys entirely server-side.
3. Deploy the tested container behind HTTPS. Allow 4 MiB chunk requests and retain a 26 MB body limit for legacy multipart sessions; current recording jobs do not hold open an HTTP request throughout analysis. Run one worker and one instance against a persistent private volume with at least 32 GB at `RECORDING_STORAGE_DIR`. Exclude temporary audio from backups and static serving. Provision at least 4 GB RAM and measure peak memory and disk use with supported long audio before launch. Set provider spending alerts and an OpenAI project budget. Never log bearer tokens, audio, transcripts or prompts.
4. Verify `/health`, `/ready`, signed-in history/settings, a consented resumable upload, atomic usage accounting, worker restart/cancellation, Reflect, export and deletion in the deployed environment. `/ready` checks credentials are present and the deletion-marker table, coaching-goal column and recording-completion RPC are queryable; it is not proof that OpenAI billing or every provider is healthy.
5. Configure Supabase production SMTP, SPF/DKIM/DMARC where applicable, and only intended redirect URLs. Native sign-in uses `mirra://auth`; web deletion uses the exact public `/delete-account.html` URL. Test a real email round trip. Keep development localhost/LAN redirect entries out of a dedicated production project.
6. Finalize operator/support/territories/provider retention, review the actual privacy policy and terms, update `website/release.json`, rebuild, and publish. Align app privacy disclosures, the Apple privacy questionnaire and Google Data safety answers with the deployed behavior.
7. Configure the EAS project and production public environment. Run the production build guard, native CI, the device matrix below, then build and submit a signed iOS binary. Stage through internal TestFlight before public release. Add verified store URLs to the website only when the corresponding app records are available.
8. Release manually after review. Keep the previous signed build and container revision available for rollback. Preserve data-deletion protections and upstream’s device privacy choices during rollback.

## Acceptance matrix

Record device, OS, build number and result for every row. Use synthetic or explicitly consented test conversations and disposable test accounts.

| Flow | Required outcome |
|---|---|
| Fresh install, email sign-in, expired link | Successful link opens Mirra; invalid links show an error without leaking URL credentials. |
| Consent decline/accept/withdraw | Decline keeps drafts and local audio; queued uploads and Reflect remain paused on that device. Acceptance persists for the current account on that device. Withdrawal pauses subsequent uploads, including after reading queued audio. There is no cross-device server-consent record. |
| Record for multiple hours, lock screen, foreground, stop | Audible complete recording, preserved timing, microphone indicator and Android ongoing notification. Notification returns to the app. |
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

Mirra uses OpenAI for transcription and coaching. The app asks before sharing with OpenAI, and you can withdraw that device’s approval in Profile. You control transcript saving in Voice & privacy.

AI can be wrong. Mirra estimates that the loudest speaker is you; microphone placement, overlapping voices and transcription errors can affect results. These are prompts for reflection, not verified assessments of a person. Mirra is not medical or mental-health care. For adults 18 and over. Always obtain permission from everyone involved before recording or uploading their conversation.

**Keywords:** conversation,listening,reflection,communication,habits,coaching,questions

**Review notes:** Explain microphone/background audio as user-initiated conversation recording; there is no passive listening. Identify the upstream Privacy & AI prompt, the permanent deletion path and the offline queue. Provide an authenticated disposable review account or another working review-access method in App Store Connect's private review fields, never in this repository. Explain the free five-debrief limit and reset review usage before review. No purchases, subscriptions, ads or tracking are implemented. Do not advertise widgets, Apple Watch, notifications or speaker correction; these are not shipped.

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
- [Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission) — Android 13+ notification visibility and foreground-service behavior after denial.
- [Google AI-generated content policy](https://support.google.com/googleplay/android-developer/answer/13985936) — in-app reporting of offensive AI content without leaving the app.
- [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) — in-app and web deletion paths.
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) — endpoint-specific retention and training defaults.
- [Supabase passwordless email authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless) — email links and redirect configuration.
- [Reporters Committee recording guide](https://www.rcfp.org/reporters-recording-guide/) — recording requirements vary by jurisdiction and circumstances. The product asks for all participants' permission; that is not a guarantee of legal compliance in every situation.
