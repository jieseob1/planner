# Today screen UX audit

## Audit scope

- Surface: desktop and mobile Today screen.
- User goal: understand what to do next, see when it fits, and place work into an available time without leaving Today.
- Evidence before redesign: `01-current-today.png`.
- Evidence after redesign: `09-final-today-desktop.png`, `10-final-today-mobile.png`, `11-final-today-mobile-timeline.png`, and `03-time-block-dialog.png`.

## Overall verdict

The former screen exposed useful information but separated priorities from a read-only timeline and hid desktop navigation behind unlabeled icons. The redesign makes the task-to-time relationship the main workspace and gives every free hour an obvious path to scheduling.

## Flow steps

1. **Find the current area — healthy.** Desktop navigation now shows Korean labels plus short context; mobile keeps the labeled bottom navigation.
2. **Choose the next task — healthy.** Top 3 order, estimate, carryover state, and start action remain together in one panel.
3. **Find an available time — healthy.** The hour grid distinguishes free time, owned focus blocks, and striped read-only external events. Occupied slots are disabled.
4. **Define the block — healthy.** Clicking a free hour opens a labeled task/start/end panel with 30-minute precision, duration shortcuts, and a live summary.
5. **Confirm the plan — healthy.** Saving closes the panel, moves or creates the task block, updates the next-block summary, and announces the exact time range in a status message.

## Accessibility notes

- Interactive free-time rows are 54px high and have explicit accessible names.
- The sheet uses labeled native selects, visible focus, a live preview, and a role-alert conflict message.
- Mobile screenshots confirm no horizontal overflow at 390px.
- Screenshot review cannot confirm screen-reader announcement timing across all platforms or full keyboard traversal; automated DOM checks and browser interaction covered the primary path.
