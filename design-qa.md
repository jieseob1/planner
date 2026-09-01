# Today redesign design QA

## Comparison target

- Source visual truth: `/var/folders/g0/nljh9c990dj3dw6lyrrnh1380000gn/T/codex-clipboard-6f68aa16-aee4-4481-aa82-87aca723b2ec.png`
- Source pixels: `1222 × 1604`.
- Implementation: `docs/audit/09-final-today-desktop.png`.
- Implementation pixels / CSS viewport: `1280 × 720`; browser DPR was `2`, and the browser screenshot API normalized the capture to CSS-pixel dimensions.
- Responsive evidence: `docs/audit/10-final-today-mobile.png` and `docs/audit/11-final-today-mobile-timeline.png`, both `390 × 844` pixels at a `390 × 844` CSS viewport.
- State: Today screen with a planned focus block at `16:00–17:30`, external calendar blocks, and an available-time hover target.

## Evidence

- Full-view comparison: `docs/audit/design-comparison.png` places the supplied reference and the final desktop implementation in one image.
- Focused interaction comparison: `docs/audit/03-time-block-dialog.png` shows the desktop start/end/task panel; `docs/audit/08-time-block-dialog-mobile.png` shows the same flow as a mobile bottom sheet.
- Focused responsive evidence: `docs/audit/11-final-today-mobile-timeline.png` shows the time grid without horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: passed. The existing Pretendard/system stack, 400–600 weights, tabular time numerals, and Korean UI hierarchy remain consistent with the product design system and the reference's compact productivity UI.
- Spacing and layout rhythm: passed. Desktop navigation now has readable labels; Today uses a clear task/time two-column workspace; timeline rows, blocks, and the sheet follow the existing 4/8/12/16/24 spacing rhythm and 6–8px radii.
- Colors and visual tokens: passed. The existing cobalt accent, cool-neutral surfaces, subtle borders, warning color, and striped read-only calendar treatment are preserved.
- Image quality and asset fidelity: passed. The reference contains no required raster imagery. Existing library icons are used consistently; no placeholder, custom SVG, emoji, or CSS-drawn icon substitutes were introduced.
- Copy and content: passed. Labels say what users can do: `시간 블록 추가`, `시작`, `종료`, `무엇을 할까요?`, `오늘 계획에 추가`, and occupied slots are announced as already scheduled.

## Comparison history

### Pass 1

- Finding: `[P2]` half-hour empty-slot targets were only 27px tall on mobile.
- Fix: changed the direct timeline targets to one-hour rows (`54px`) while preserving 30-minute precision in the start/end selectors.
- Post-fix evidence: `docs/audit/11-final-today-mobile-timeline.png`; measured empty-slot height is `54px` and body width equals viewport width (`390px`).

### Final pass

- P0/P1/P2 findings: none.
- Fresh desktop and mobile browser tabs reported no console errors or warnings.
- Primary interactions tested: empty time click, sheet open, task/start/end preview, save, planned block render, occupied-slot disabling, existing-block edit entry, responsive reflow, and mobile bottom navigation.
- Automated verification: 27 Vitest tests passed; TypeScript/Vite production build passed; structure, visual-system, and usability gates passed.

## Follow-up polish

- `[P3]` Very short 30-minute focus blocks are intentionally visually compact inside the timeline, while the primary empty-slot targets remain 54px high.

final result: passed
