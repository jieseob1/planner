# Nowline high-fidelity UI source

- Source: [Claude Design · Planner_HighFidelity.dc.html](https://claude.ai/design/p/97a88bc6-c95f-4bc3-9e8f-ed453200caef?file=Planner_HighFidelity.dc.html)
- Captured: 2026-08-31
- Direction: cool neutral productivity OS with one cobalt accent. Relationships use dividers, surface levels, tables, and lanes instead of repeated rounded cards.
- Claude visual QA: six 1440 x 900 desktop screens and seven 390 x 844 mobile states; reported zero clipping, horizontal overflow, and wrapped button labels.

## Product layout

### Desktop

- Fixed 76px icon rail for Today, Planner, Goals, Review, and capture.
- 52px top bar with current context, command search, sync status, and saved time.
- Context panels use 296px, 326px, or 380px widths only where the screen needs them.
- Main content uses 24px padding, a 12-column grid, and 24px gutters.
- Weekly planner grid: 206px outcome lane header plus seven equal day columns.

### Mobile

- Target frame: 390 x 844; content inset: 18px.
- Four bottom tabs plus a 56px capture FAB. Navigation height is 64px and every target is at least 44 x 44px.
- Planning drag-and-drop becomes a bottom sheet for date, start time, and duration.
- Offline, pending-save, warning, and running states always include text or a symbol; color is never the only signal.
- Breakpoints: 390, 768, 1024, 1280, and 1440. Below 1024px a context panel becomes a collapsible top block; below 768px the mobile layout is used.

## Screen hierarchy

### Today

1. Compact page title, date, planned vs actual time, and execution percentage.
2. Carryover warning row with split/change date/stop actions.
3. Top 3 as divided task rows; one timer action per row.
4. Next time block and a four-day remaining-plan table.
5. Quick capture row.
6. Day timeline with external calendar stripes and owned focus blocks.
7. Day-close action at the bottom.

Running state replaces the execution summary with a 56px tabular timer, pause, add-time, and finish controls. Finishing opens an outcome panel while always preserving elapsed time.

### Weekly Planner

- 296px unscheduled-task context panel grouped by outcome.
- Main toolbar shows 21h / 24h capacity, 87% warning, range controls, carryover, and plan confirmation.
- Outcome lanes compare required, planned, and actual time across seven days.
- External calendar rows are read-only. Scheduled blocks, conflicts, empty targets, and drop targets have distinct states.

### Goals

- Year strip establishes Year -> Quarter context.
- Quarter outcome table prioritizes current/target, confidence, actual/planned time, next check, and status.
- Missing metric data is written as `data unavailable`, never zero.
- A decision queue leads with stale data, insufficient time, and stop/reduce/extend decisions.

### Weekly Review

- One continuous flow with four visible stages: metric update, blocker, next-week Top 3, and plan confirmation.
- Intermediate save status remains visible.
- Primary completion is enabled only when the review's minimum choices are present.

### Onboarding

- Progressive disclosure: one desired outcome, next action, then available time/placement.
- The representative screen uses a 28px display title, one focused input, one primary action, and a clear preview of later steps.

## Implementation tokens

### Color

| Token | Value | Use |
| --- | --- | --- |
| `accent` | `#2E56E8` | Primary, selection, goal link, focus |
| `accent-soft` | `#EDF1FE` | Selected surface |
| `accent-line` | `#C6D2FB` | Planned block, accent border |
| `text-1` | `#171B22` | Heading, body, numerals |
| `text-2` | `#5A6372` | Supporting copy and metadata |
| `text-3` | `#667085` | Secondary labels and placeholders; chosen to keep small meaningful text readable on white/subtle surfaces |
| `surface` | `#FFFFFF` | Base surface |
| `surface-sub` | `#F5F6F8` | Rail, context panel, table header |
| `surface-sunken` | `#F0F2F5` | Capacity track and weekend column |
| `border` | `#E4E7EC` | Default border |
| `border-subtle` | `#EDEFF3` | Row divider |
| `warning` | `#A9520C` | Carryover, over-plan, deadline risk |
| `warning-soft` | `#FBF3E9` | Warning surface |
| `warning-line` | `#EBD6BB` | Warning border |
| `danger` | `#BB362C` | Collision and save failure |
| `positive` | `#0F6B49` | Complete and healthy status |

### Typography

- Family: Pretendard with Apple and system fallbacks.
- Weights: 400, 500, 600 only. Positive tracking is reserved for eyebrow labels.
- Display: 28 / 600 / 1.3 / -0.02em.
- Timer numeral: 56 / 600 / 1.0 / -0.02em.
- Screen title: 22 / 600 / 1.2 / -0.01em.
- Block time: 24 / 600 / 1.1.
- Section title: 16 / 600 / 1.35.
- Row title: 14 / 500 / 1.4.
- Body: 13 / 400 / 1.55.
- Metadata: 12 / 400 / 1.45.
- Microcopy: 11.5 / 400 / 1.4.
- Eyebrow/table heading: 11 / 600 / 0.06em.
- All numerals use `font-variant-numeric: tabular-nums`.

### Spacing and depth

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40px.
- Radius: chips 4px, buttons 6px, panels 8px, app frames 10px, status pills fully rounded.
- Default border: 1px solid `#E4E7EC`; row divider: 1px solid `#EDEFF3`.
- Table head rule: 1px solid `#171B22`; lane accent: 3px solid `accent`; drop target: 1px dashed `#C8CDD6`.
- Small shadow: `0 1px 2px rgba(16, 19, 25, .06)`.
- Sheet/FAB shadow: `0 4px 12px rgba(16, 19, 25, .10)`.
- Focus ring: 2px solid `accent` with 2px offset.
- No decorative gradients or glows. A 45-degree stripe is allowed only for external calendar blocks.

## Component states

- Task row: base surface, `#F7F8FA` hover, accent-soft selected, `.45` disabled opacity, `recording` text for running, warning symbol plus copy for carryover.
- Buttons: primary, primary hover, secondary, accent quiet, disabled, and warning. Desktop heights 32/36/42px; mobile 44/46/50px.
- Metrics: 5-8px track on surface-sunken, 1.5px text-color need marker, explicit `data unavailable`, and a warning plus value-entry CTA after seven stale days.
- Motion: 150-200ms ease-out for position and opacity; 300ms metric fills. Remove all motion for `prefers-reduced-motion`.
