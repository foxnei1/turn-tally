# September iteration: simpler daily turns

The daily screen now answers who takes the middle seat, with one correction action. Unchanged days count automatically. The daily confirmation button and decimal balance display are removed. Assignment explanations and the last 14 days of history are available on demand.

## Changed behavior

- Corrections show the person who actually took the seat in both today's card and history.
- “No trip this day” and “Parental coverage” skip the turn without changing anyone's balance or advancing the last-turn order.
- “Someone is away” records attendance for that day only. The absent person's balance is frozen, the present people share the turn, and an absent assignee is replaced. Fewer than two people present means no turn is counted.
- Absence replacements are saved to keep later history corrections from silently changing the person shown.
- Correction menus exclude absent people from the list of possible coverers. Attendance can be corrected from the same menu.
- Explanations use the selection state before today's credit is applied. They describe a smaller share of turns, time since the last turn, starting order, or an already-shown assignment retained after a correction.
- Save failures keep the correction open with a retry message.

## Compatibility

The existing local-storage keys and event history are retained. New outcome kinds add neutral skips and day-specific attendance. Missing attendance on old outcomes means everyone was present.

Historical `outside-cover` events retain their original effect and are labeled as using the previous penalty rule. Replacing one with the new parental-coverage option removes that penalty through an explicit correction. The Python reference engines remain historical, and the old concept is retained in `concept-v4.2.md`.

## Validation

Automated checks cover normal rotation, neutral skips, absence and return, absent-coverer rejection, correction replacement, pinned assignments, persisted corrections, explanations, and failed-save retry. Run `npm run check` in `web` for lint, TypeScript, tests, and a production build.

The next product check is a parent-and-child walkthrough of a normal day, a sibling covering, an absence, and a no-trip day. Automated checks establish behavior; they do not establish whether families find the rules intuitive.

## Follow-up: configurable chores

The home screen now lists current assignments for seating and chores. Add an activity using the kitchen, bathroom, living room, and dining room shortcuts or a custom name. Configure daily or weekly turns, participants, the starting person, and a start date. Weekly turns last seven days from that date. Each activity has independent replay, balances, corrections, and history.

Names update immediately. Cadence and participant changes take effect at the next turn boundary through dated revisions. Earlier records retain their original cadence and participants, including when corrected later. An activity that has not started yet can still have its start date and first person edited.

The legacy seating configuration is normalized in memory and gains an activity list on the first configuration save. Existing event keys and seating slot IDs are retained. No reset is required.

Additional automated checks cover legacy-data compatibility, weekly boundaries, independent balances, future starts, one-person chores, validation, prospective configuration changes, and creating/editing/correcting activities through the UI with browser-storage restoration.
