# Family Rotation App — v4.2 Validation Findings

*Three executable iterations · August 2026*

## Outcome

The v4 reference implementation is in `reference/python/rotation_engine_v4.py`, alongside the historical v3 prototype. The pytest suite is the executable contract.

Current result: **49 passed, 1 expected failure**. Coverage includes 100 deterministic structural seeds spanning 6–24 simulated months, persisted event conflicts, effective-dated configuration, round-robin comparisons, and two-year policy scenarios.

The expected failure is intentional: the current trade policy permits an unbounded privilege-for-burden buy-out. It remains red until a product policy is selected and encoded.

## Decisions encoded

1. **Present-roster accounting.** Absent people are not assigned and receive no ledger deltas for missed slots. Their balance is frozen for those slots.
2. **Exact zero-sum transactions.** The engine uses `fractions.Fraction`; every slot sums exactly to zero. Parental adjustments are the only allowed source of a non-zero global sum.
3. **Shared means shared.** A restricted rotation directly changes only its members, but their resulting global balances can affect later broader rotations. This is intentional cross-payment, not full rotation isolation.
4. **Validated trades.** A trade recipient must be a different, present member of the effective roster. `restricted` is UI/policy metadata; unrestricted rotations do not weaken ledger validation.
5. **Visible outcome conflicts.** Concurrent active outcomes for a slot stop replay with `OutcomeConflictError`. A later immutable event resolves them by explicitly superseding every conflicting event. Collection order never selects a winner.
6. **Materialized assignments.** Future slot candidates are generated, but the assignee shown when a slot becomes current is stored as `AssignmentRecorded`. Late outcome corrections may change balances and future derived assignments, but cannot rewrite who the app previously displayed for an anchored slot.
7. **Effective-dated configuration.** Type, cadence, desirability, cap, order, restriction, and archive state can change prospectively. The rotation start date is immutable. Cadence changes and reactivation establish a new cadence anchor on their effective date.
8. **Configuration conflicts fail closed.** Different values written to the same rotation field on the same effective date are rejected. A user-facing resolution mechanism is still required for multi-device sync.
9. **Auditable deltas.** Each slot record includes assignment source, active roster, accounting roster, all participant deltas, and the resulting balance snapshot.

## Findings

### F1 — privilege buy-out is unbounded

**Severity: critical · product-policy decision required**

The original brief treated buy-out as a possible legitimate strategy and expected `maxConsecutive` to bound it. A two-year test shows that it does not.

Four children share a daily weight-1 privilege and a weekly weight-3 chore. Baseline results are balanced:

| Scenario | Privileges A/B/C/D | Chores A/B/C/D | Final balance range |
|---|---:|---:|---:|
| Baseline | 184 / 182 / 182 / 182 | 27 / 26 / 26 / 26 | 1 |
| D trades every offered privilege to A | 724 / 3 / 3 / 0 | 70 / 12 / 12 / 11 | 547 |

D is offered the privilege 721 times because a trade makes A the taker; D's consecutive counter does not advance and D remains lowest balance. A receives nearly every privilege and consequently takes 70 chores. The balances diverge to A `+410.25` and everyone else `−136.75`.

This is not merely a missing guard. It exposes two policies currently conflated by `Trade`:

- A **burden substitution** should credit the person who actually served.
- A **voluntarily gifted or declined privilege** may need to charge the person who received the opportunity, even when someone else enjoyed the outcome.

Recommended v4.3 default: distinguish `burden_trade` from `privilege_gift`. Charge a privilege gift to the original assignee; represent a true future-turn swap as an explicit atomic exchange. Alternative decisions are separate burden/privilege balances, a balance cap, or accepting strategic buy-out and displaying it clearly.

### F2 — fully derived past assignments are not auditable

**Severity: high · architecture decision resolved in v4.2**

Without stored assignments, adding a late trade on Jan 1 changed the reducer's Jan 2 assignee from B to A and shifted every later assignment. Jan 2 may already have occurred as an unlogged, as-scheduled turn, so replay would manufacture a false history.

Resolution: generate future candidates, but append an idempotent `AssignmentRecorded` event when each slot becomes current. The test now anchors all displayed assignments and verifies that late corrections do not rewrite them.

Operational requirement: the backend must author or atomically accept one assignment event per slot. Multiple assignment facts currently fail closed.

### F3 — the zero-exception schedule is not a pointer per rotation

**Severity: medium · wording corrected**

With two daily burden rotations and three people, the first rotation produced `P0, P2, P1`; an independent pointer produces `P0, P1, P2`. The second rotation consumes global balance between the first rotation's slots.

The ledger still produced equal totals and zero balance, so the useful claim is narrower: a single equal-weight rotation has a pointer-equivalent count bound. The product should not promise pointer-identical sequences once rotations share a balance.

### F4 — late configuration can invalidate stored facts

**Severity: high · operational policy required**

Archiving a rotation retroactively can remove a generated slot that already has an outcome or assignment event. The engine detects the orphan and stops instead of silently discarding it.

Recommended policy: ordinary configuration is prospective and cannot take effect before the latest materialized slot. Historical repair should be a separate parental migration that previews affected facts and appends an audit record.

### F5 — append-only merge still has semantic conflicts

**Severity: high · event rule resolved, UX remains**

One hundred permutations of concurrent outcome events plus an explicit resolution replay identically. Concurrent unresolved outcomes, supersession cycles, cross-slot supersession, unknown slots, and duplicate IDs are rejected.

The remaining work is interaction design: a parent needs a small conflict inbox showing both reports and a one-tap choice or replacement outcome.

### F6 — logging corrects systematic dodging, with visible pressure

**Severity: informational**

In the current 84-day deterministic test, an unlogged 70% dodger was assigned 21 times and actually served 6. With misses logged, the child was assigned 54 times, served 15, and the other children served 10 each. The direction of the original finding holds: logging patterns changes outcomes decisively.

The resulting `+25.5` balance is intentionally visible debt, but repeated assignment plus 39 parent covers may feel punitive. This reinforces the need for `maxConsecutive` to be described as a service/occupancy cap, not a cap on repeated offers after misses.

## Findings that remained clean

- Single daily burden and privilege rotations, household sizes 2–8, stayed within one turn of round robin over 730 days.
- A daily weight-1 burden plus weekly weight-3 burden on the same four-person roster stayed within one assignment per rotation over two years; final balance range was at most 3.
- Present-roster absence semantics passed burden-only and privilege-only counterexamples.
- The 100-seed matrix preserved exact conservation, roster-local deltas, and presence-safe assignment across 2–8 people, 1–5 rotations, mixed cadence/types, weights 1–5, caps 1–4, overlapping rosters, and absences up to 30 days.
- Future cadence/configuration changes left every prior slot record identical. Archive/reactivation produced no phantom slots.
- Persisted outcomes and assignment anchors replay independently of input collection order.

## Decisions still needed

1. **Privilege transfer policy:** charge the original assignee for a gift/decline, separate ledgers, cap balances, or explicitly accept buy-out.
2. **Historical configuration repair:** adopt the recommended prospective-only rule and define who can run an audited migration.
3. **Configuration conflict resolution:** add supersession to config events or require a parent-authored replacement snapshot.
4. **Seating state machine:** distinguish assignment displayed, confirmed, corrected, no trip, trade, outside cover, and excused absence.
5. **Annual reset:** choose the dismissal default and specify whether a reset is a set of visible balancing adjustments or a ledger epoch boundary.

## Running the suite

```powershell
python -m pytest -q -rxX
```

Expected result: `49 passed, 1 xfailed` until F1 is resolved.
