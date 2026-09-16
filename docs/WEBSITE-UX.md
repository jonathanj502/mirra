# Website UX review

The website should explain the product, demonstrate its value, and make availability clear. On September 16, the user explicitly asked that both iPhone and Android be presented as available. That is the current copy premise, not independent verification of a store release. Actual download buttons remain gated on configured, verified store URLs. Do not invent a listing or turn availability text into a dead button.

## September 15: content and action hierarchy

The initial review used prelaunch messaging. The availability premise above supersedes that wording while preserving the rule that a download action must have a real destination.

| Source | Finding | Applied to Mirra |
| --- | --- | --- |
| [Willow](https://willowvoice.com/): [YC Spring 2025](https://www.ycombinator.com/companies/willow) | The homepage identifies voice dictation immediately and offers actual downloads. | Explain the recording-to-coaching mechanism in the opening paragraph. Show plain availability text until a verified store URL exists; then link directly to that store. |
| [Granola](https://www.granola.ai/) | Specific sample output supports its promise of attention returned to conversation. | Retain the illustrated debrief and working sample controls, alongside specific goal-based suggestions. |
| [Linear](https://linear.app/) | Signup/login and feature destinations provide concrete actions. | Keep navigation for orientation and reserve prominent action styling for an available task. Do not create a new page merely to justify a button. |
| [NN/g: Homepage Design Principles](https://www.nngroup.com/articles/homepage-design-principles/) | A homepage should quickly communicate its purpose and help visitors find relevant content. | Preserve the brand headline but make supporting copy explicit about the product, audience goals and output. |
| [NN/g: Descriptive Links](https://www.nngroup.com/articles/learn-more-links/) | Link labels should set expectations about the destination; redundant or vague links add uncertainty. | Remove the three promotional scroll prompts. Use descriptive privacy/support links and label sample controls by the view they actually open. Keep normal navigation anchors. |
| [NN/g: Reading on the Web](https://www.nngroup.com/articles/how-users-read-on-the-web/) | Research supports concise, scannable and objective content. | Remove the repeated manifesto, use concrete section headings, shorten process copy and increase explanatory text sizes. |
| [GOV.UK: Buttons](https://design-system.service.gov.uk/components/button/) | Action hierarchy should be clear; competing primary buttons weaken it. | Remove unavailable button-shaped store placeholders and the misleading Get Mirra jump. Real store links become the primary action when configured. |
| [Google: Web Vitals](https://web.dev/articles/vitals) | Loading speed, responsiveness and visual stability matter alongside visual design. | Keep the static build, local fonts and small deferred script; add no dependency, tracker or autoplay media. The initial review added no animation; the September 16 direction permits restrained interaction transitions. Field Web Vitals have not been measured. |

These are observed patterns and research-informed judgments, not proof that this exact layout maximizes conversions. There is no Mirra audience study or A/B test supporting a numerical uplift. Descriptive navigation within a page remains useful; the removed links were redundant promotional prompts in the reading path.

## September 16: visual direction

The current rendered homepages of Granola, Willow, Linear and Wispr Flow were inspected. These observations inform an original MIRRA composition rather than a reproduction of another brand.

| Reference | Observed visual pattern | MIRRA direction |
| --- | --- | --- |
| [Granola](https://www.granola.ai/) | Large editorial serif type, an asymmetrical product composition and a colorful art field create a clear focal point. | Keep the existing Inter and Instrument Serif fonts. Give the headline more presence and pair it with the existing MIRRA mark, a recording chip and an illustrative coaching card on a soft green field. |
| [Willow](https://willowvoice.com/) | Sparse copy, generous whitespace and a high-contrast action lead into a broad product demonstration. | Keep the opening message short and the interface secondary. A small, clearly illustrative takeaway sits within the brand composition; the existing interactive sample remains the place to explore the product. |
| [Linear](https://linear.app/) | Consistent alignment, restrained borders and large product regions create a deliberate page rhythm. | Alternate open editorial sections with contained demonstrations. Use distinctive goal line art and a forest-colored closing section instead of repeating equally weighted card grids throughout. |
| [Wispr Flow](https://wisprflow.ai/) | A warm cream field, oversized serif and italic typography, and a limited contrasting accent give voice software a recognizable identity. | Develop MIRRA's own warm ivory, forest and apricot palette. Use expressive serif details selectively and keep body text simple and legible. |
| [NN/g: Visual Hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) | Scale, contrast and grouping guide attention; too many equally prominent treatments weaken hierarchy. | Give each section one focal point, leave generous space between sections and keep related labels, examples and explanations close together. |
| [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | Nonessential interaction motion should be suppressible for people who need reduced motion. | Limit motion to restrained 180 to 220 ms interaction transitions and honor `prefers-reduced-motion`. Avoid continuously floating objects, autoplay demonstrations and scroll hijacking. |

The hero should communicate attention to people and passive recording during sessions throughout the day. It must not suggest automatic or uninterrupted all-day recording. At the user's request, the people photo and both WebP sources were removed. The hero reuses the existing MIRRA mark, recording chip and illustrative coaching card. Goal examples retain their existing research and context; visual polish does not justify new universal speaking rules or promises of guaranteed outcomes.

Implementation stays in the static site with no new dependencies. Preserve real product examples, accessible preview controls, legal and AI limitations links, deletion safeguards and the store-link gating. Do not fabricate testimonials, customer logos, user counts, release dates or performance claims.

## Redesign verification

- The static build and five tests pass. Checks cover local assets and destinations, unique IDs, real store-link gating, preview selection and keyboard behavior, responsive tab orientation, menu dismissal and deletion safeguards.
- The earlier redesign was reviewed at 320, 393, 768, 1024 and 1440 pixel viewports. The updated hero was reviewed at 393 and 1440 pixels, with no overflow or photo element. Goal cards use native CSS subgrid to align their content, with a flex fallback.
- Mobile Record, Debrief and Reflect controls sit in one compact row. Their ARIA orientation changes with the layout. Arrow keys, End, sample actions, navigation links and Escape dismissal were exercised.
- The updated hero uses the existing SVG brand mark and HTML/CSS composition. Both people-photo WebPs and their build references were removed. The coaching card keeps its illustrative caption.
- The reduced-motion stylesheet disables animations, transitions and smooth scrolling. Otherwise a single 650 ms entrance and short interaction transitions add finishing detail without continuous movement. Reduced-motion behavior was inspected in code, not tested with a changed OS setting.
- Existing recording limits and contextual coaching caveats remain. All generated pages pass the no-em-dash check. No backend or native app behavior changes in this redesign.
- Field performance, conversion uplift and physical-device rendering are not measured by this review.
