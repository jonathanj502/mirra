# Website content and coaching review

Reviewed September 15, 2026. Covers the homepage, interactive examples, metadata, privacy, terms, support, and account-deletion page. Product claims were checked against the current source, not assumed from earlier release notes. This is a research-informed content review, not validation that Mirra improves social outcomes or a completed legal review.

## What Mirra should help with

Offer one optional, concrete action grounded in a conversation and the person's chosen goal. Describe observable behavior before interpreting it. Do not manufacture a deficit, rank personalities, or optimize a speaking metric as a substitute for a useful conversation. Keep recording manual and Reflect optional. Low interaction time is a design choice; the site must not imply automatic all-day recording or a measured time saving.

Confidence coaching should help someone express a position clearly and respectfully. It should not remove honest uncertainty or treat dominance as confidence. Listening coaching should respond to the substance of what someone said. Friendship coaching should support mutual exchange, not a quota of questions or a promise of making friends. Clarity and assertiveness should support understandable points, specific requests, and boundaries without pressure.

## Evidence, limits, and changes

| Topic and source | What the evidence supports | Application and limit |
| --- | --- | --- |
| Clear expression: [WA Health, Assertive communication](https://www.health.wa.gov.au/sitecore/content/Healthy-WA/Articles/A_E/Assertive-communication) | Public-health guidance recommends expressing a view or request directly while respecting others. | Replace the confidence example with a proposal and reason: “Let’s meet Thursday so we have time to prepare.” This is an original illustration of the guidance, not a tested script or a guarantee of perceived confidence. |
| Uncertainty and disagreement: [Yeomans et al., 2020](https://receptiveness.net/assets/papers/Conversational.pdf) | Receptive language can improve engagement with opposing views. Hedging is one part of a broader strategy. | Do not prescribe “I think” as a confidence technique, but do not classify it as inherently weak either. Preserve genuine uncertainty and respectful disagreement. Much of the evidence concerns written disagreements, not everyday spoken confidence. No correction or retraction was found in the publisher/author checks performed; this is not an independent audit of the data. |
| Follow-ups: [Huang et al., 2017](https://www.hbs.edu/ris/Publication%20Files/Huang%20et%20al%202017_6945bc5e-3b3e-4c0a-addd-254c9e603c60.pdf), [2025 correction](https://pubmed.ncbi.nlm.nih.gov/40111841/) | Question-asking was associated with responsiveness and liking in getting-acquainted conversations, with relevant follow-ups playing a role. | Keep the specific new-job follow-up. Remove the implication that a high count itself demonstrates curiosity. Question type was not independently randomized; speed-dating results were observational. The correction reports minor reporting errors without changing substantive conclusions. These studies do not demonstrate lasting friendship or a universal question quota. |
| Listening: [Weger et al., 2014](https://www.tandfonline.com/doi/abs/10.1080/10904018.2013.813234) | A bundle of active-listening responses made people feel more understood in short initial interactions. | Use a relevant check of understanding before advice. The sample asks what the speaker meant by unclear priorities. Do not attribute unstated emotions or mechanically paraphrase every turn. The study did not isolate our wording or establish effectiveness across all relationships and cultures. |
| Timing: [Templeton et al., 2022](https://doi.org/10.1073/pnas.2116915119), [Templeton et al., 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC9985966/) | Faster responses were associated with connection in the first study; the second found that long gaps function differently for friends and strangers. | Remove all blanket advice to pause longer. These findings also do not justify telling users to rush. Recommend a timing change only when the conversation supplies a relevant reason, with uncertainty about the recording's turn boundaries. |
| Speaking share: [Hirschi et al., 2022](https://dtg.sites.fas.harvard.edu/HIRSCHI%20WILSON%20GILBERT%202022.pdf) | In short stranger conversations with assigned speaking shares between 30% and 70%, speaking less was not the likability advantage participants expected. | Do not promote 43/57, 50/50, or another universal target. Rename the sample metric “Speaking share” and label its estimates. This study does not establish a replacement ideal ratio. Silent time cannot establish attention or understanding. |
| Website comprehension: [NN/g homepage principles](https://www.nngroup.com/articles/homepage-design-principles/) and [reading research](https://www.nngroup.com/articles/how-users-read-on-the-web/) | Concrete purpose, scannable content, and restrained claims support comprehension. | Keep the main page concise, distinguish illustrative examples from real results, and put source links in an optional FAQ. Do not add scientific-looking outcome scores or claims that Mirra is proven. Earlier layout decisions are in `WEBSITE-UX.md`. |

## Audit of every website area

| Area | Decision and verification |
| --- | --- |
| Hero and metadata | State the recording-to-debrief mechanism and goals as choices. Replace the claim that a quick glance is “enough” with an invitation to reflect at the user's pace. Remove em dashes, including browser titles and social metadata. |
| Goal cards | Keep relevant follow-up questions, replace the confidence lead-in, and ground listening in checking an explicitly stated difficulty. Retain the no-guaranteed-outcome disclosure. |
| Illustrated phone | Describe the observed new-job follow-up. Replace generic pause advice with checking understanding. Identify the ratio as estimated speaking share, with speakers labeled. |
| Interactive Record | Manual start and stop remain explicit. Replace “no personal data needed” with “no microphone access or sign-in needed,” because website hosting logs exist. |
| Interactive Debrief | Remove the causal claim that questions made the conversation deeper. Label detected questions as a transcript estimate. Numbers are descriptive examples, not targets or listening scores. |
| Interactive Reflect | Replace a generic delay prescription with one relevant clarification. Keep the sample and AI-limit labels. |
| Process and passive-use copy | Matches `useRecordAudio.ts`, `usePendingRecordings.ts`, and native recording configuration: the user starts/stops, waits for saving, and keeps the app foregrounded for upload. No auto-start, guaranteed processing time, or force-quit upload claim. Physical-device background reliability remains a release check. |
| Privacy summary and policy | Confirmed transcript saving defaults on, optional Reflect transcript inclusion, account-scoped storage/deletion/export, per-device consent, and transient backend audio handling. Added GitHub Pages hosting disclosure. Do not claim zero provider retention or completed operator/legal setup. |
| Terms | Preserve permission requirements, uncertain speaker attribution, no medical/diagnostic use, usage limits, and service limitations. These are prelaunch terms with unresolved operator/jurisdiction facts, not a certification of legal compliance. |
| Support and offline FAQ | Specify mobile-app offline capture after sign-in/approval, waiting for save completion, and a connection for initial browser loading. Remove unconditional “safely” language. |
| Account deletion | Explain that the web flow is gated by release configuration and requires access to the account email. Username-only synthetic addresses cannot receive links; direct those users to the app's deletion control. Do not promise web deletion is currently available. |
| Availability, navigation, footer | Actual store links remain configuration-dependent. No invented store listing, testimonial, user count, launch date, conversion gain, or clinical validation. Adults-only intended use remains explicit. |

## Provider checks

- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data): API content is not used for training by default; text abuse-monitoring retention can still apply with `store=False`. Endpoint-specific handling remains linked rather than replaced with a blanket no-retention claim. The implementation uses transcription and Responses endpoints.
- [Supabase privacy policy](https://supabase.com/privacy): supports naming the authentication/database provider; it does not establish Mirra's actual production region or backup schedule. Those remain release facts to verify.
- [GitHub Pages data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection): visitor IP addresses are logged for security. Added this to the website policy.

## Implementation and checks

The shared `backend/app/coaching_goals.py` instructions feed both debriefs and Reflect. They now discourage unsupported metric targets, distinguish estimates from validated assessments, retain honest uncertainty, and prohibit em dashes. Prompt instructions are not a guarantee of model behavior. Mocked API-request tests check that both paths receive them; they do not establish advice quality or product efficacy.

The website test checks all rendered pages for literal and HTML-encoded em dashes. Build/link/keyboard/deletion tests and responsive browser checks remain required. Before claiming outcome improvements, Mirra would need evaluation with intended users and varied real contexts, including relevance, factual grounding, unwanted pressure, and whether suggestions were useful. No such study was completed in this review.
