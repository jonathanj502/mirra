# Website UX review: September 15, 2026

Mirra is prelaunch. The website should explain the product, demonstrate its value, and make availability clear. It should not manufacture clicks or imply that an unavailable app can be downloaded.

## References and decisions

| Source | Finding | Applied to Mirra |
| --- | --- | --- |
| [Willow](https://willowvoice.com/): [YC Spring 2025](https://www.ycombinator.com/companies/willow) | The homepage identifies voice dictation immediately and offers actual downloads. | Explain the recording-to-coaching mechanism in the opening paragraph. Show plain launch status until a verified store URL exists; then link directly to that store. |
| [Granola](https://www.granola.ai/) | Specific sample output supports its promise of attention returned to conversation. | Retain the illustrated debrief and working sample controls, alongside specific goal-based suggestions. |
| [Linear](https://linear.app/) | Signup/login and feature destinations provide concrete actions. | Keep navigation for orientation and reserve prominent action styling for an available task. Do not create a new page merely to justify a button. |
| [NN/g: Homepage Design Principles](https://www.nngroup.com/articles/homepage-design-principles/) | A homepage should quickly communicate its purpose and help visitors find relevant content. | Preserve the brand headline but make supporting copy explicit about the product, audience goals and output. |
| [NN/g: Descriptive Links](https://www.nngroup.com/articles/learn-more-links/) | Link labels should set expectations about the destination; redundant or vague links add uncertainty. | Remove the three promotional scroll prompts. Use descriptive privacy/support links and label sample controls by the view they actually open. Keep normal navigation anchors. |
| [NN/g: Reading on the Web](https://www.nngroup.com/articles/how-users-read-on-the-web/) | Research supports concise, scannable and objective content. | Remove the repeated manifesto, use concrete section headings, shorten process copy and increase explanatory text sizes. |
| [GOV.UK: Buttons](https://design-system.service.gov.uk/components/button/) | Action hierarchy should be clear; competing primary buttons weaken it. | Remove unavailable button-shaped store placeholders and the misleading Get Mirra jump. Real store links become the primary action when configured. |
| [Google: Web Vitals](https://web.dev/articles/vitals) | Loading speed, responsiveness and visual stability matter alongside visual design. | Keep the static build, local fonts and small deferred script; add no dependency, tracker, autoplay media or new animation. Field Web Vitals have not been measured. |

These are observed patterns and research-informed judgments, not proof that this exact layout maximizes conversions. There is no Mirra audience study or A/B test supporting a numerical uplift. Descriptive navigation within a page remains useful; the removed links were redundant promotional prompts in the reading path.

## Checks

- Build and existing automated checks cover local destinations/assets, unique IDs, keyboard-operated preview tabs, mobile-menu dismissal and web-deletion safeguards.
- Desktop and phone browser review checks the hero, larger body copy, goal cards, sample interactions, navigation and page overflow.
- The first screen and final availability section state that the app is preparing for launch. Downloads appear only for configured Apple/Google store URLs.
- No testimonials, customer logos, user counts, waitlist endpoint, release date or performance claims were invented.
