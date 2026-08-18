# Browser prototype findings

*Daily seating vertical slice · August 2026*

## Outcome

The static seating card is now a working local prototype. A family can enter its members, receive a calculated middle-seat assignment, confirm it or report who covered, review recent days, and inspect the balance behind the next assignment. Refreshing or closing the browser does not lose the setup or history.

The TypeScript checks cover the UI, local-storage adapter, and the daily burden reducer. The Python v4.2 suite remains the broader policy contract.

## Decisions encoded

1. **The prototype begins on setup day.** It does not invent history from before the family started using it.
2. **An opened day is anchored.** When the app calculates a current assignment, it appends an `AssignmentRecorded` event. A later correction can change balances but cannot rewrite what the family had already seen.
3. **No report means as assigned.** A past day without an outcome is shown as “Assigned; no change reported.” This follows the exception-only logging policy.
4. **A family member covering is a burden trade.** The person who took the middle seat receives the normal burden credit.
5. **An adult covering is an outside cover.** The original assignee receives the flipped transaction and will generally be offered the burden again sooner.
6. **Corrections replace rather than edit history.** A new immutable outcome explicitly supersedes the previous active outcome for that day.
7. **Local dates are calendar dates.** Slots use `yyyy-MM-dd` values derived in the browser’s local timezone.
8. **Changing the family is a prototype reset.** It clears both configuration and event history after a browser confirmation.

## Tests added

- Equal-weight daily rotations for household sizes two through eight over two years stay within one assignment of round robin.
- Every tested transaction remains zero-sum within floating-point tolerance.
- The consecutive-turn cap holds across a longer run.
- Roster-member trades and adult outside covers apply different ledger effects.
- Invalid trade recipients are rejected.
- Displayed future assignments remain anchored after a late correction.
- Concurrent outcomes fail closed until one replacement supersedes them.
- Supersession cycles are rejected.
- Setup, correction, refresh, and local-storage restoration work as one browser-level flow.

## Issues to address next

1. **Roster changes need prospective events.** The current reset is acceptable for testing, but adding or removing a member should not erase history.
2. **Absence is not in the interface.** The Python policy freezes absent members, but the browser flow cannot record an absence yet.
3. **No-trip wording needs a product choice.** The concept currently consumes a seating day even when the car is unused. The UI should either state that plainly or offer a distinct no-trip event with defined ledger behavior.
4. **Numbers are JavaScript floating point.** The reducer constructs zero-sum deltas and tests conservation with a tolerance. Before full engine parity, balances should use rational, decimal, or scaled-integer storage.
5. **Local storage is device-local.** Clearing site data, changing browsers, or using another device loses access to this prototype history. Export/import would be useful before server sync.
6. **Privilege rotations remain out of scope.** The critical privilege-gift buy-out policy is still unresolved and should not be exposed in the UI yet.
7. **Past corrections can create pressure.** Anchored assignments preserve audit history, but several late corrections may make the current balance look surprising. The history view will need a clearer explanation of that effect.

## Recommended next iteration

Add effective-dated roster changes and absences to the daily seating flow, then port the remaining Python structural cases to the TypeScript reducer. After that, add weekly burden rotations and weights. Keep privilege rotations blocked until the gift/decline policy is chosen.
