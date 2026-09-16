# Website and app feature audit

Reviewed September 16, 2026 against `website/home.html` and the support and policy pages in `website/build.mjs`. Website files were not changed for this audit.

Subsequent pricing correction: removing Stripe did not mean removing the paid plan. Profile now restores Mirra Pro at $8/month and its plan comparison. Purchasing and verified paid entitlements remain unconnected, with purchases explicitly unavailable in this build. The website's earlier "no paid plans" wording is stale; the app UI correction leaves website files unchanged as requested.

| Website feature | App implementation |
|---|---|
| User-started background recording | Home Record/Stop, the app-level recording provider, native audio background mode and Android microphone service. Sessions never start automatically. |
| Offline recording and later upload | Account-owned durable queue, resumable uploads, reconnect recovery and retained originals until acknowledgement. Imports use the same queue. |
| Brief debrief, optional deeper reflection | Three-part structured coaching, Home and conversation detail cards, optional Reflect chat and Progress tab. No mandatory daily check-in or exercise. |
| Suggestions curated for a saved goal | Home's Your focus and Profile's conversation goal save `coaching_goal`; both recording paths and Reflect load it. New debrief metadata preserves the processing-time goal. |
| Speaking share | Estimated user/other speaking durations and ratio from diarized turns; quiet time is not invented as another person's speech. No ideal-ratio target. |
| Open and closed questions | Transcript-based counts and classification, displayed in conversation details and weekly progress. Classification is an English wording heuristic, not a measure of question quality. |
| Turn-taking gaps and overlaps | Timestamp differences across speaker changes, signed timing chart, overlapping-start count and weekly aggregation. Zero gaps remain present; long gaps stay inside chart bounds. No fixed pause target. |
| Vocal energy, volume, pitch and pace | Saved energy timelines plus recorded dBFS, sampled pitch in Hz and speaking-time WPM for the estimated user and the other speakers combined. Per-conversation details and weekly user pace are visible. |
| Vocabulary and repeated words | Selected-speaker total/unique counts and up to ten most repeated words with counts. Frequencies are saved in debrief statistics, available without retaining the full transcript. |
| Possible filler words | A dedicated conversation panel with phrase counts. The app explains that phrase matches need context. |
| Transcript-saving controls and processing choices | Upstream's device/account consent helper and Profile controls; settings govern transcript storage and Reflect context. No second consent system was added. |
| Delete conversations, export data, delete account | Existing authenticated API and Profile/conversation controls, ownership checks, deletion tombstones and durable-queue cleanup. Added statistics are included in the same debrief export and deletion paths. |
| Five monthly debriefs with no paid plans | Server-side usage gate and atomic completion accounting. Failed analysis does not consume allowance; there is no subscription bypass. |

New pitch, volume, other-speaker pace and word-frequency fields are optional for historical records. Missing measurements are shown as unavailable, never reconstructed from every speaker's transcript or arbitrary defaults. New fields live in the existing `debriefs.stats` JSON; no additional migration is required for this audit.

Weekly observations now reuse the saved, contextual debriefs. Metric changes do not imply improvement or decline. The legacy composite acoustic/reference fields remain compatible with older clients, but the current interface labels their limitations and does not treat them as connection scores.

Validation: 157 backend tests, 31 app checks, TypeScript, five website tests and web/iOS/Android JavaScript exports pass. Regression coverage exercises the website's six statistics through the API conversion and actual conversation screen, synthetic audio measurements, silent/legacy records, turn-chart bounds, goals, offline recovery, account controls and Reflect failure recovery. Mobile layout previews use synthetic data and the actual React Native Web components at 320 and 393 pixels.

Upstream's Expo 57 upgrade is integrated with the durable queue. Its native recorder retains mono 24 kHz / 64 kbps capture, optional Android notification permission, OS-notification Stop handling and protection against stale completion events. The event listener uses the current account queue after sign-in. Android prebuild and the bundled iOS template's backup-protection insertion were checked. iOS native generation/compilation runs in macOS CI; Windows cannot complete that check locally.

This is implementation evidence, not proof of a published or deployed app. Store availability remains the owner's explicit copy assumption. Hosted migrations, production deployment, signing and physical-device locked-screen recording acceptance remain tracked in `RELEASE.md`. The less-than-five-minute statement describes the intended interaction flow, not a measured usage-study result.
