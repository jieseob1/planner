# Period goals / Today / Review — current design QA

Date: 2026-09-07. Local implementation and bounded desktop/mobile browser QA verified; public save recovery and deployment remain unverified.

- Source targets: option 2 `exec-6aace716-c29e-4cea-bef6-3a026d85a3b6.png` (Today), option 1 `exec-ff628d07-65ff-4dab-b317-6754a5bc8768.png` (Goals), option 3 `exec-6701b5fe-bf8c-4cd1-bbac-69f60fad53e5.png` (Review), in `/Users/jisubpark/.codex/generated_images/01a0554e-3f56-7000-a3e6-a286b1de46c5/`.
- Source images opened: yes; each 1487 × 1058. Existing icons and UI typography reused; no new raster asset is required by these application screens.
- Implementation captures: `docs/screenshots/period-goals-review/` contains goals/today/review desktop, Today/Review mobile, and Goals 320px. Captured directly from Chrome using an isolated local Spring/MySQL fixture, not user production data.
- Target viewports verified: 1487 × 1058, 390 × 844, 320 × 740. DOM clientWidth and scrollWidth matched at the tested widths. Reference and desktop captures were opened together at the source dimensions (1487 × 1058); no image resampling was used. Fixture text/data differ from the illustrative reference, so this is a layout comparison, not an identical-data pixel comparison.
- Existing typography, indigo/neutral tokens, icon assets, Korean copy, card padding and control spacing were visually reviewed. DOM tests/build success were not substituted for screenshot review.
- Actual Chrome interactions: title-only goal creation, reload persistence, edit/completion, 320px editor note/save, Today task completion, day reflection save, review/date isolation and return, mobile reflection expansion, and keyboard access following the review jump link.
- Console error entries in the attached local QA session: 0. This does not describe the complete history of the public user session.
- Functional DOM and Spring/MySQL tests are tracked separately in `docs/PERIOD_GOALS_REVIEWS.md` and `.unlazy/period-goals-review/GATES.md`. On 2026-09-07 the complete production E2E passed, including period documents and subtasks, desktop/mobile CRUD, persistence, conflicts, mock Google, account deletion and keyboard/zoom checks.

## Revisions after visual and interaction review

1. Widened the desktop Today task/reflection pane, made its reflection editor initially expanded, and re-compared the resulting screenshot with option 2.
2. Wrapped Today timeline guidance and the keyboard-create toolbar after the narrower timetable exposed clipping.
3. Fixed the review completion checkbox's inherited column-label layout and kept the label touch target at least 44px high.
4. Kept three review metrics compact on mobile and added `회고 쓰기` to jump past a long goal list. Confirmed the focus target and subsequent keyboard access to the first text input.
5. Tested the 320px goal editor through its bottom action row and saved a changed note to the real local API.

## Intentional adaptation and limitations

- Option 1's docked goal inspector is implemented as the existing product's modal editor. Optional links are progressively disclosed; no parent goal or measurement is forced for a title-only goal.
- Today retains the existing unscheduled-task list, completed-task disclosure and manual-time flow rather than replacing execution logic with illustrative cards.
- Actual-time segments are not fabricated: current time entries do not contain precise start/end intervals. Review shows recorded durations, with the attribution limitation stated in the UI.
- Review charts show dates with stored activity rather than seven illustrative bars. An absent timer record is labelled as unrecorded, not proof that no work happened.
- Existing navigation/chrome and fixture contents differ from the generated sources. The chosen information hierarchy is implemented; pixel-perfect source fidelity is not claimed.
- Native iOS/Android gesture/device QA and the original public save rejection's root cause remain outside this verified local result. Deployment is evidenced separately by main CI and the live image/version SHA.

final result: local functional, responsive and full browser E2E QA passed within the documented scope; deployment is a separate acceptance gate.

## Subtasks and release regression (2026-09-07)

- Added a shared, one-level checklist editor in the task and timetable editors; creation, inline title editing, check/uncheck, reorder, delete and last-deletion undo are explicit. Parent status/time metrics stay independent.
- Actual Chrome saved and reloaded two checklist items with 1/2 progress against isolated Spring/MySQL. Screenshots: `docs/screenshots/subtasks/desktop.png` (1440x900), `mobile.png` (390x844). These are fixture data, not public user content.
- Full E2E found an over-tall desktop scheduling modal, a 320px seven-day strip overflow and an undersized mobile goal navigation target. Fixed internal modal scrolling, flexible day columns and touch targets. Also made review textarea accessible labels stable after populated reloads.
- Full E2E verifies 320px subtask editing, title change, ordering, shared timetable edit, deletion, reload and parent cascade deletion. Component tests additionally cover IME Enter and undo state isolation across task selections. Total frontend299/backend49 tests.

## Historical QA — previous implementation, not evidence for the current changes

# Today task-first redesign — previous design QA

## Source of visual truth

- Selected direction: option 2, task-first split view
- Reference: `/Users/a2485/.codex/generated_images/01a05d0e-3fde-7533-afe1-6dbfc37ddc46/exec-19092c5c-89e3-441d-bf37-537aebc1fbea.png`
- Reference pixels: 1487 × 1058
- Implementation route: `http://localhost:4173/today`
- Implementation capture: `docs/screenshots/design-qa/implementation-today-focus-desktop.png`

## Same-input visual comparison

- Full comparison: `docs/screenshots/design-qa/compare-today-focus-desktop.png`
- Focused controls comparison: `docs/screenshots/design-qa/compare-today-focus-detail.png`
- CSS viewport: 1440 × 1024
- Device pixel ratio: 1.2
- Normalization: the reference was aspect-fit onto a white 1440 × 1024 canvas. The in-app browser returned the 1440 × 1024 CSS viewport in a DPR-adjusted 1200 × 853 rendered area, which was cropped and resampled to 1440 × 1024 before the side-by-side comparison.

## Iteration history

1. P1 — the first implementation used two panes, making the timeline too wide and hiding the always-available memo shown in the selected direction.
   - Moved the date/week header into the task pane.
   - Added a persistent third memo pane on wide screens.
   - Rebalanced the task, schedule, and memo columns.
2. P2 — the schedule initially opened at midnight, so the most useful daytime hours were below the fold.
   - Kept all 00:00–24:00 slots but auto-positioned the internal timeline near 07:00.
3. P2 — drag-and-drop could not be fully exercised through browser CUA.
   - Added an automated HTML drag/drop test proving that dropping a task on 15:00 opens a prefilled 15:00–16:00 schedule form.
4. Re-captured the same desktop state after the fixes and compared the full page and primary task/schedule controls again.

## Functional and accessibility verification

- Clicked an empty time slot and confirmed that the start/end form opens with the selected interval.
- Started the primary task, opened the stop flow, and confirmed both continuation and completion controls.
- Confirmed quick capture input, task completion controls, scheduling controls, and persistent memo input have accessible names.
- Confirmed the focused Today layout keeps the Settings and integrations route directly accessible from the sidebar.
- Confirmed all 24 hourly drop/click targets are present from 00:00 through 24:00.
- Confirmed the current-time indicator is visible and correctly positioned.
- Browser console: no warnings or errors after the final reload.
- Automated frontend suite: 119 tests passed.
- Production frontend build: passed.

## Intentional differences

- The selected reference contains illustrative calendar events; the implementation capture uses the current seeded application state, so its timeline is empty until the user schedules a task.
- Existing planner persistence, synchronization, timer, completion, and calendar-only event behavior were preserved rather than replaced by static mock interactions.
- On widths below 1180px the memo moves to the existing collapsible in-page memo; below 900px the task and schedule panes stack for usable mobile reading.

Historical result (previous implementation): passed
