# Landing page design QA

## Source truth

- Claude Design: `https://claude.ai/design/p/f3f1e558-be1a-4ba2-b9a3-d9e323cc2cf4?file=Nowline+Landing.dc.html`
- Desktop references: `docs/screenshots/landing/reference-desktop-hero.png`, `docs/screenshots/landing/reference-desktop-value-1.png`, `docs/screenshots/landing/reference-desktop-advantages.png`, `docs/screenshots/landing/reference-desktop-comparison.png`, `docs/screenshots/landing/reference-desktop-cta.png`
- Mobile references: `docs/screenshots/landing/reference-mobile-hero.png`, `docs/screenshots/landing/reference-mobile-value-1.png`, `docs/screenshots/landing/reference-mobile-comparison.png`, `docs/screenshots/landing/reference-mobile-cta.png`

## Implementation evidence

- Desktop full view: `docs/screenshots/landing/implementation-desktop-full.png`
- Desktop focused views: `docs/screenshots/landing/implementation-desktop-hero.png`, `docs/screenshots/landing/implementation-desktop-value-1.png`
- Mobile full view: `docs/screenshots/landing/implementation-mobile-full.png`
- Mobile focused view: `docs/screenshots/landing/implementation-mobile-hero.png`
- Side-by-side inputs: `docs/screenshots/landing/comparison-desktop-hero.jpg`, `docs/screenshots/landing/comparison-desktop-value-1.jpg`, `docs/screenshots/landing/comparison-mobile-hero.jpg`

## Viewports and state

| Target | Viewport | Pixel density | State |
| --- | ---: | ---: | --- |
| Desktop source and implementation | 1440 × 1000 | 1x | first load, hero at top |
| Desktop focused source and implementation | 1440 × 1000 | 1x | first value section visible |
| Mobile source and implementation | 390 × 844 | 1x | first load, hero at top |

The Claude editor displays its desktop artboard scaled inside the editor, so exact screenshot pixels differ from the runtime CSS pixels. The implementation preserves the source proportions, type hierarchy, cobalt accent, ruled sections, product-proof imagery, comparison table, CTA, and dark footer at native runtime size.

## Findings and fix history

| Severity | Finding | Resolution | Evidence |
| --- | --- | --- | --- |
| P0 | None | — | Full desktop and mobile views |
| P1 | Source mobile frame had 454px content in a 390px viewport, clipping the navigation, hero copy, table, and CTA. | Kept the visual direction but collapsed secondary navigation, stacked CTAs, constrained all page content to 390px, and isolated the wide comparison table in a keyboard-focusable horizontal scroller. | Runtime `scrollWidth = clientWidth = 390`; table `780px / 370px`; `comparison-mobile-hero.jpg` |
| P2 | Hero text lost the Korean word boundary when the desktop line break was hidden on mobile. | Added an explicit space before the responsive line break and recaptured the mobile hero. | `implementation-mobile-hero.png` |
| P2 | Source release labels showed account login and deletion as not yet available although the product already implements them. | Marked account login and withdrawal as `제공 중`; kept Google Calendar public OAuth and store apps as `준비 중`. | Release status block and landing component test |

## Interaction and accessibility checks

- Primary CTA navigates from `/` to `/today`.
- Desktop `특장점` navigation updates the URL to `#value-1` and aligns the section below the sticky header.
- Mobile page has no document-level horizontal overflow.
- Primary mobile controls are 48px high; focus states and reduced-motion handling are present.
- The comparison table has a visible scroll hint, keyboard focus target, and internal horizontal scrolling.
- Browser error and warning log after landing interactions: empty.

## Final result

passed
