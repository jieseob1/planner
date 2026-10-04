# Task-first Today design QA

final result: passed

## Scope and visual evidence

This is a flow adaptation, not a pixel clone of Doslash. The approved implementation prompt requests its inline entry, linked list/calendar, contextual details and postponement patterns while keeping this product's goals/review and providing a separate mobile layout.

Inspected together at 1728 × 826 CSS/pixel viewport (1× screenshots):

- Source: `/tmp/doslash-ux-audit-CMfjlf/07-linked-task-and-calendar.jpg`.
- Initial implementation: `/tmp/doslash-ux-audit-CMfjlf/planner-desktop-linked.jpg`.
- Final implementation: `/tmp/doslash-ux-audit-CMfjlf/planner-desktop-final.jpg`.
- Combined initial/final comparisons: `desktop-comparison.jpg`, `desktop-comparison-final.jpg` in the same evidence directory.
- Mobile list and time editor: `planner-mobile.jpg`, `planner-mobile-time.jpg`, 390 × 844.
- Long title at 320 × 740: `planner-320.jpg`.

Both desktop captures show an authenticated selected-day list and its linked time blocks. Their dates, task content and product branding differ; these are expected, not fidelity errors. Mobile uses task/timetable tabs intentionally rather than reproducing the source's overflowing three-column desktop layout. No claim about Doslash persistence or cross-device sync is made.

## Findings, fixes and second comparison

- P2, calendar readability: first capture's two-hour block used an 11px title centered in a large card. Final capture moves content to the top and uses a 15px title/12px time on blocks over an hour. Short blocks retain compact layouts. The final combined comparison shows the same task and time legibly in both representations.
- P2, mobile touch target: authenticated E2E found a 42px input in the task editor. Mobile modal inputs/selects and quick-entry controls now have at least 44px height. The final 390px time-editor capture shows visible start/end, preview, cancel and save controls; DOM measurement found no visible dialog control below 44px.
- P2, ambiguous selected date: tomorrow's list was still headed “오늘 할 일”. It now says “이 날짜의 할 일”; the final desktop and mobile captures show the corrected heading.
- P1, mobile presentation: the old list-only popup obscured the calendar and re-mounted entry state. Replaced with persistent task/timetable panels and explicit tabs. 320/390px captures have document width equal to viewport width, including a long Korean title.

No outstanding P0/P1/P2 visual issue in the captured core flow. P3 follow-up: secondary timetable instructions remain dense; evaluate their usefulness in a first-use session before adding more controls.

## Required surfaces

- Typography: existing product font/fallback and blue-accent identity retained; list titles 15px with wrapping; long mobile title wraps without truncation. Two-hour block title is now readable. Small timeline ticks are secondary information.
- Layout rhythm: entry → day/later filter → rows is consistent. Desktop list/calendar share a workspace; phone uses tabs, not compressed columns. Contextual detail on desktop and viewport-constrained modal on phones keep the editing task in context.
- Colors/tokens: retained existing accent/text/border tokens, pale neutral surfaces, visible selected/focus states. Event/Google distinctions remain. Branding intentionally differs from Doslash.
- Assets: this flow has UI controls, not custom raster illustrations. Existing logo and library icons retained; no reference photographs or generated images are needed.
- Copy/content: explicit “시간 지정/시간 수정”, “날짜 변경”, completion/undo and server/offline/conflict labels communicate actions and state. Goal association is optional.

## Interaction evidence and limits

Direct browser journey completed: inline “개인 공부” → 18–20 → 19–21 → tomorrow → complete → undo. Same title/time appeared in list and timetable and server-save state was visible. Mobile input, long title, time form, and horizontal overflow were inspected directly. Automated authenticated E2E separately exercises keyboard, viewport fitting and server-backed CRUD.

This is not a full accessibility certification or a physical iOS/Android keyboard test. First-time human usability remains unverified; the five-minute protocol is in `docs/UX_SYNC_RELIABILITY.md`. These limits do not invalidate the captured visual comparison.

## Release checklist

- [x] Combined source/implementation inspected.
- [x] Fixed high-impact findings and captured a second comparison.
- [x] Desktop and phone core form inspected.
- [x] Reference interaction patterns retained; product-specific deviations documented.
- [x] No P0/P1/P2 remains in the captured core-flow comparison.
