# Today task-first redesign — design QA

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

final result: passed
