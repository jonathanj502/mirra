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
| [Granola](https://www.granola.ai/) | Large editorial serif type, an asymmetrical product composition and a colorful art field create a clear focal point. | Keep the existing Inter and Instrument Serif fonts. Give the headline more presence and pair it with an original lifestyle image of people in conversation, making everyday life the hero subject. |
| [Willow](https://willowvoice.com/) | Sparse copy, generous whitespace and a high-contrast action lead into a broad product demonstration. | Keep the opening message short and the interface secondary. A small, clearly illustrative takeaway overlays the lifestyle image; the existing interactive sample remains the place to explore the product. |
| [Linear](https://linear.app/) | Consistent alignment, restrained borders and large product regions create a deliberate page rhythm. | Alternate open editorial sections with contained demonstrations. Use distinctive goal line art and a forest-colored closing section instead of repeating equally weighted card grids throughout. |
| [Wispr Flow](https://wisprflow.ai/) | A warm cream field, oversized serif and italic typography, and a limited contrasting accent give voice software a recognizable identity. | Develop MIRRA's own warm ivory, forest and apricot palette. Use expressive serif details selectively and keep body text simple and legible. |
| [NN/g: Visual Hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) | Scale, contrast and grouping guide attention; too many equally prominent treatments weaken hierarchy. | Give each section one focal point, leave generous space between sections and keep related labels, examples and explanations close together. |
| [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | Nonessential interaction motion should be suppressible for people who need reduced motion. | Limit motion to restrained 180 to 220 ms interaction transitions and honor `prefers-reduced-motion`. Avoid continuously floating objects, autoplay demonstrations and scroll hijacking. |

The hero should communicate attention to people and passive recording during sessions throughout the day. It must not suggest automatic or uninterrupted all-day recording. The photo is illustrative, not a testimonial or evidence of actual customers. Goal examples retain their existing research and context; visual polish does not justify new universal speaking rules or promises of guaranteed outcomes.

Implementation stays in the static site with no new dependencies. Preserve real product examples, accessible preview controls, legal and AI limitations links, deletion safeguards and the store-link gating. Do not fabricate testimonials, customer logos, user counts, release dates or performance claims.

## Redesign verification

- The static build and five tests pass. Checks cover local assets and destinations, unique IDs, real store-link gating, preview selection and keyboard behavior, responsive tab orientation, menu dismissal and deletion safeguards.
- Browser review covers 320, 393, 768, 1024 and 1440 pixel viewports. The narrow headline remains on its intended two lines; tablet layouts stack before the photograph or text becomes cramped. Goal cards use native CSS subgrid to align their content, with a flex fallback.
- Mobile Record, Debrief and Reflect controls sit in one compact row. Their ARIA orientation changes with the layout. Arrow keys, End, sample actions, navigation links and Escape dismissal were exercised.
- The hero has descriptive alternative text, declared image dimensions, responsive sources, and a visible illustrative caption. Its largest WebP is 156,688 bytes; the smaller source is 55,336 bytes. Neither image is evidence of real customers.
- The reduced-motion stylesheet disables animations, transitions and smooth scrolling. Otherwise a single 650 ms entrance and short interaction transitions add finishing detail without continuous movement. Reduced-motion behavior was inspected in code, not tested with a changed OS setting.
- Existing recording limits and contextual coaching caveats remain. All generated pages pass the no-em-dash check. No backend or native app behavior changes in this redesign.
- Field performance, conversion uplift and physical-device rendering are not measured by this review.

## Original hero asset

Created with the built-in image-generation tool, then encoded as responsive WebP files without changing the composition:

- `website/conversation.webp` (1536 × 1024)
- `website/conversation-small.webp` (768 × 512)

Final generation prompt:

> Use case: photorealistic-natural. Asset type: premium consumer app website hero photograph for MIRRA, a passive conversation coach whose message is More real life, less app. Create one editorial lifestyle photograph, landscape 3:2 composition, no text or graphics. Two young adult friends having a relaxed, attentive conversation at a small outdoor cafe table in warm late afternoon sunlight. A dark-haired woman in an understated cream linen shirt on the left, a man with short curly dark hair and an olive shirt on the right, both 25-35, shown from waist up in natural side/three-quarter profiles turned toward each other, thoughtful warm expressions and tiny natural smiles, no exaggerated stock-photo laughing. Faces in the upper half. Beautiful pale buttery plaster wall, subtle shadows of leaves, olive greenery at edges, warm honey light with rich forest green shadows, soft terracotta cup and simple water glass on the round table in lower third. Elegant analog film color, fine grain, tactile linen and wood, natural imperfect lived-in detail, candid cinematic crop, luxury independent magazine art direction, calm and genuinely human. Keep both people fully recognizable in central 80 percent of image so it crops gracefully to a nearly square layout. The bottom 25 percent should be simple table and shadow, suitable for a separately coded UI card overlay. No one looking at camera. No phones, computers, screens, logos, words, borders, watermarks, app UI, collage, conspicuous jewelry, extreme bokeh, or airbrushed plastic skin. This is an evocative illustrative brand image, not a customer testimonial.
