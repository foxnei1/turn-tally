# TurnTally web app

The TurnTally client is a React and TypeScript app built with Vite. Tailwind handles styling, Vitest covers the pure domain and repository layers, and React Testing Library covers user interactions.

On first launch, enter at least two family members in the order you want to start. The app starts a daily middle-seat rotation from the current local date. Unchanged turns count automatically. Use “Change who took it” to record a sibling covering, no trip, adult coverage, or someone away for that day. Assignments and corrections persist in `localStorage`.

The overview lists all activities with their current person. Use **Add activity** for a suggested or custom chore, then choose daily or weekly turns, participants, a starting person, and a start date. Kitchen duty defaults to daily; bathroom, living room, and dining room cleaning default to weekly. Weekly turns span seven days from the chosen date. Each activity has its own balance and history.

Use **Edit activity** to rename an activity or change its schedule and participants. Schedule and roster changes begin at the next turn boundary; the current turn and earlier history retain their original schedule and roster. New activities may start today or later. Future activities can be edited before they begin.

“Why [name]?” explains the assignment using the state before the turn. History stays collapsed until needed. No-trip days and adult coverage are neutral; absent members neither earn credit nor accrue extra turns. Historical adult-cover penalties remain readable and can be explicitly corrected. See the [current concept](../docs/concept.md) for the policy.

## Commands

```powershell
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
npm run check
```

## Source boundaries

- `src/domain/rotation`: pure fairness and scheduling logic with no React or persistence imports
- `src/features`: family-facing workflows such as seating, chores, history, and profiles
- `src/data`: persistence contracts and adapters
- `src/components`: shared presentation components

## Prototype limits

- Daily seating and configurable daily or weekly chores; no privilege rotations
- One browser only; no accounts or device sync
- Family members can be added, renamed, deactivated, and reactivated without clearing history; only the administrator's explicit household reset clears data
- Absences apply to one activity's entire turn: a day or a seven-day week; no partial-week coverage or date ranges yet
- No activity archive/delete controls yet
- Unreported past days are treated as completed as assigned

## Storage compatibility

The existing configuration and event keys are retained. Configurations without an `activities` list are interpreted as the original seating activity. Saving an activity adds the list while retaining the legacy fields. Activity revisions have future effective dates. Replay filters events by activity, so corrections and balances never cross between activities.

## Family roles

On upgrade, explicitly select an administrator or add a parent outside the current rotations. Other existing people become viewers until their roles are assigned in **Family**. Use the local profile selector to try administrator, editor, and viewer behavior. A refresh requires selecting a profile again.

Administrators manage members and roles and may reset the household. Editors manage activities and record outcomes. Viewers read assignments, explanations, and history. Application mutation methods check the stored role before saving, including when a stale screen still shows edit controls. The last active administrator cannot be removed or demoted.

Deactivating someone preserves their identity and history, hides their local profile, and removes them from each activity starting with its next turn. Pending cadence changes are retained. New or reactivated people must be explicitly enrolled in activities. Empty or undersized rotations keep their scheduled dates but record a null assignee and show “Needs participants”; later roster revisions can resume assignments.

These are local prototype controls, not authenticated accounts. Anyone with access to this browser can switch profiles or alter local storage. Server-enforced permissions and authenticated adult profile access are part of the hosting/sync milestone.
