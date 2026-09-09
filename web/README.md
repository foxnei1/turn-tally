# TurnTally web app

The TurnTally client is a React and TypeScript app built with Vite. Tailwind handles styling, Vitest covers the pure domain and repository layers, and React Testing Library covers user interactions.

On first launch, enter at least two family members in the order you want to start. The app starts a daily middle-seat rotation from the current local date. Unchanged turns count automatically. Use “Change who took it” to record a sibling covering, no trip, parental coverage, or someone away for that day. Assignments and corrections persist in `localStorage`.

The overview lists all activities with their current person. Use **Add activity** for a suggested or custom chore, then choose daily or weekly turns, participants, a starting person, and a start date. Kitchen duty defaults to daily; bathroom, living room, and dining room cleaning default to weekly. Weekly turns span seven days from the chosen date. Each activity has its own balance and history.

Use **Edit activity** to rename an activity or change its schedule and participants. Schedule and roster changes begin at the next turn boundary; the current turn and earlier history retain their original schedule and roster. New activities may start today or later. Future activities can be edited before they begin.

“Why [name]?” explains the assignment using the state before the turn. History stays collapsed until needed. No-trip days and parental coverage are neutral; absent members neither earn credit nor accrue extra turns. Historical parental-cover penalties remain readable and can be explicitly corrected. See the [current concept](../docs/concept.md) for the policy.

## Commands

```powershell
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
npm run check
```

## Cloudflare hosting

Pilot hosting uses Cloudflare Workers Static Assets on the free tier. Run `npm run deploy:check` to build and validate the deployment without publishing, or `npm run preview:cloudflare` to preview asset routing locally. Deployment and the remaining authentication/sync work are described in the [Cloudflare pilot setup](../docs/cloudflare-pilot.md).

## Supabase backend

Hosted mode is configured with `VITE_TURNTALLY_MODE=hosted`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`; see `.env.example`. It uses provisioned Supabase accounts and revision-checked shared snapshots. Without these settings, the local prototype remains available. See the [Supabase backend setup](../docs/supabase-backend.md) for provisioning, migration, tests, and remaining pilot work.

## Source boundaries

- `src/domain/rotation`: pure fairness and scheduling logic with no React or persistence imports
- `src/features`: family-facing workflows such as seating, chores, history, and profiles
- `src/data`: persistence contracts and adapters
- `src/components`: shared presentation components

## Prototype limits

- Daily seating and configurable daily or weekly chores; no privilege rotations
- Local mode stores data in one browser. Hosted mode uses provisioned Supabase accounts and shared data with manual refresh; see the backend setup above.
- Family members can be added, renamed, deactivated, and reactivated without clearing history; only the administrator's explicit household reset clears data
- Absence ranges cover selected activities with inclusive dates; weekly attendance uses the turn's first day, with no partial-week splitting
- Activities can be archived and restored; there is no permanent activity deletion or backup merge
- Unreported past days are treated as completed as assigned

## Storage compatibility

Legacy configuration and event keys are still read. The next successful mutation saves both into one snapshot at `turn-tally.configuration.v1.snapshot.v2` and removes the old keys. Configuration and events are committed with a single `setItem`, so a quota failure cannot partially replace history. Custom repository keys derive their own snapshot key. An empty snapshot prevents cleared legacy data from resurfacing.

Configurations without an `activities` list are interpreted as the original seating activity. Activity revisions have future effective dates. Replay filters events by activity, so corrections and balances never cross between activities.

## Family roles

On upgrade, explicitly select an administrator or add a parent outside the current rotations. Other existing people become viewers until their roles are assigned in **Family**. Use the local profile selector to try administrator, editor, and viewer behavior. A refresh requires selecting a profile again.

Administrators manage members and roles and may reset the household. Editors manage activities and record outcomes. Viewers read assignments, explanations, and history. Application mutation methods check the stored role before saving, including when a stale screen still shows edit controls. The last active administrator cannot be removed or demoted.

Deactivating someone preserves their identity and history, hides their local profile, and removes them from each activity starting with its next turn. Pending cadence changes are retained. New or reactivated people must be explicitly enrolled in activities. Empty or undersized rotations keep their scheduled dates but record a null assignee and show “Needs participants”; later roster revisions can resume assignments.

These are local prototype controls, not authenticated accounts. Anyone with access to this browser can switch profiles or alter local storage. Server-enforced permissions and authenticated parental profile access are part of the hosting/sync milestone.

## Archive and backups

Open an activity, expand **Archive this activity**, and select **Archive activity**. Its history remains available under **Archived activities**. Restoring does not count missed turns during the archive gap. A still-current original turn is retained; otherwise the next turn starts on the restoration date. Weekly rotations resume seven-day periods from that date.

Use **Backups → Download backup** to save a versioned JSON file containing the complete family, activities, roles, archives, and history. Editors and administrators can export; viewers cannot. Files are not encrypted.

An administrator can select a backup file, inspect the preview, and explicitly replace the local household. Upload and preview do not mutate data. Validation is repeated before replacement and a stale preview is rejected if the household has changed. Restoring clears the selected profile. On an empty browser, **Restore a backup** is available during setup without creating a temporary family.

Version 1 backups support the web app's assignment and outcome events. Unknown versions or fields, unsupported events, invalid references, conflicting outcomes, files over 10 MB, and excessively large replay ranges are rejected before saving. Imports replace data rather than merging it. An older backup counts subsequent unreported active turns as planned; archived gaps stay skipped.

## Absence ranges

Use **Absences → Plan absence** to choose a person, inclusive first/last dates, and activities. Editors and administrators can manage ranges; viewers can read them. Plans start today or later. A weekly chore checks attendance when its turn begins: leaving or returning midweek keeps that turn unchanged. An individual activity correction can override the whole turn.

New plans update automatically counted turns starting today and apply to future turns. Explicitly reported outcomes and earlier turns are kept. Overlaps exclude a person only once and do not add catch-up debt. Plans affect participation only within the selected activities, including any later enrollment; archived periods generate no turns.

Cancel a future absence or end an ongoing one after today, with confirmation. Current daily and weekly turns remain as recorded. Correct today's attendance in the activity if needed; add another range to extend a plan. Backups include ranges and recorded attendance. Old snapshots without these optional fields remain readable.
