# Unified planning workspace design QA

final result: passed

## 2026-10-04 shared Today / Planner release

Approved scope: adapt Doslash's linked task/calendar interaction, not its entire visual identity. Both routes now use one task-first workspace with day/week/month views. Retain the product font, blue-accent tokens, logo, Lucide icons, goal/review functionality and existing data. No raster asset replacement is appropriate for this UI.

Source `/tmp/doslash-ux-audit-CMfjlf/07-linked-task-and-calendar.jpg` (1728 × 826 CSS/pixel, 1×) and final implementation captures were opened in the same comparison input. Implementation evidence in `/tmp/planner-workspace-qa-CNcfyT/`:

- `09-desktop-day-final.png` and `10-planner-week-final.png`: 1728 × 825 CSS/pixel, 1×; authenticated 2026-10-05 task list and linked 19–21 study block. The one-pixel viewport-height difference does not affect this flow comparison. No density rescaling is needed.
- `12-desktop-create-final.png`: same viewport, focused title/start/end entry with 18–20 preview. Different dates, content, list position and branding from Doslash are intentional adaptations.
- `04-mobile-tasks.png`, `05-mobile-timeline.png`, `08-mobile-create-390.png`: 390 × 844 CSS/pixel, 1×. `07-mobile-create-320.png`: 320 × 740, 1×. Phone tabs and a bottom-sheet editor intentionally replace compressed desktop columns. These are responsive checks, not pixel comparisons with a desktop source.
- `13-tablet-week-final.png`: 1024 × 768 CSS/pixel, 1×; a horizontally scrollable week keeps day columns readable and confines overflow to the calendar.

Comparison history and resolved findings:

- P1, route inconsistency: `/planner` still exposed the old goal-row matrix while `/today` showed a linked task/calendar. Final `/planner` week capture now shows the same task-first workspace. Advanced goal allocation/split/carry-over remains available behind an explicit disclosure.
- P2, calendar scale: previous production capture `/tmp/planner-time-audit-S2wfOP/03-timeline.png` had an 823 × 369px scroll area. Final day capture measures 1138 × 486px at the same 1728px width. Hour geometry grows from 64 to 96px; quarter-hour guides are 24px, not mismatched decoration. Tick labels, two-hour titles and controls are legible; unnecessary instructions no longer occupy another toolbar row.
- P0, mobile new-entry form: `06-mobile-create-blocked.png` exposed legacy child-grid rules collapsing time fields to 26px and clipping action buttons. Isolated `.timeline-create-form` styling resolves this. Second captures `07`/`08` show complete title, paired start/end and actions. At 320px, time fields measure 123 × 48px, close 44 × 44px, save/cancel 46px high; document width equals viewport. A pointer-event guard prevents the portalled form from restarting calendar selection on input clicks. Unit and actual-server E2E exercise entry/save again.
- P2, tablet week density: `11-tablet-week-blocked.png` compressed columns to 61px and truncated time labels. The second `13` capture uses a 900px minimum calendar canvas with internal horizontal scroll; day view remains available without seven-column compression.
- P2, entry clarity/focus: start/end fields and preview now reflect the actual values; invalid/overlapping times retain title and show an inline error. Editing a time does not re-focus the title. 24:00 is an explicit end-of-day option.

No outstanding P0/P1/P2 in the captured core surfaces. Typography, neutral/accent surfaces, focus states, spacing, touch targets, wrapping and control order were inspected. Week columns share one scroll axis; full-width desktop exposes all seven days. This QA does not certify every advanced screen, physical mobile keyboards or first-time human intuitiveness.

Verification: `verify:release` passed with 396 tests; real Spring/MySQL authenticated desktop/mobile CRUD, shared route day/week/reload, 390/320px entry/save, and two independent-session merge/offline/conflict journeys passed. Latest visible-update timings: 1313 / 546 / 1068 / 1325 / 819 / 1116 / 1559ms. An earlier loaded run exceeded the unchanged 2000ms test limit once (2066ms); the complete rerun passed. These localhost measurements do not guarantee internet/device latency.

## Previous task-first release evidence

### Scope and visual evidence

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
