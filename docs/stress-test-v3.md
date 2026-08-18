# Family Rotation App — Simulation Stress Test

*Companion to Concept Brief v3 · 12-week simulation, 4 children, 5 rotations*

> Historical note: this document records the simulation that falsified v3. The subsequent v4.2 executable stress suite, decisions, and open issues are documented in `validation-v4.md`.

---

## 0. Headline

**The v3 shared-balance model fails.** Not marginally — catastrophically, and in a way no amount of desk-checking would have surfaced.

Over 12 simulated weeks the eldest child served **47 units of chores and the youngest served 7**, while the app's own fairness balance read approximately zero for all four children. The system was confident it was being fair while producing a 6:1 workload split.

The cause is identified, the fix is small, and the corrected model is validated below. Recommended amendments are in §7.

---

## 1. Method

A reference implementation of the v3 engine (`engine.py`, presented alongside this document) was run against a scripted family over 84 days. It is a faithful implementation of brief §3 — shared signed balance, desirability weights, `maxConsecutive`, exception-only logging, slots folded in date order.

The simulation separates two things the app cannot:

- **Ground truth** — what actually happened in the family.
- **The recorded log** — the subset anyone bothered to tap.

Deviations fire against the real world; each is independently marked logged or unlogged. The ledger only ever sees the logged ones and behaves as if the rest went as scheduled. Measurements are taken against ground truth. This is the only way to test whether exception-only logging actually holds up.

Deterministic seeding throughout, so every figure below is reproducible.

---

## 2. Test family

| Child | Age | Notes |
|---|---|---|
| Marcus | 14 | Eligible for front seat |
| Priya | 13 | Eligible for front seat |
| Elena | 9 | Back seat only |
| Toby | 7 | Back seat only; too young for trash duty |

Plus **Dev**, an 11-year-old cousin, visiting for five days in November.

### Rotations

| Rotation | Type | Cadence | Desirability | Roster |
|---|---|---|---|---|
| Middle back seat | burden | daily | 1 | all four |
| Front seat | privilege | daily | 1 | **Marcus, Priya only** |
| Dish duty | burden | weekly | 1 → 3 on Oct 19 | all four |
| Trash & recycling | burden | weekly | 1 | Marcus, Priya; Elena added Nov 2 |
| Dinner pick | privilege | weekly | 2 | all four |

The restricted front-seat roster is not contrived — it is the ordinary safety rule that children under 13 ride in back. It turns out to be the thing that breaks the model.

### Life events injected

- Marcus at grandparents, Sep 21–25 (marked absent)
- Priya on a school trip, Oct 12–23 (marked absent)
- Elena sick, Nov 3–5 (marked absent)
- Dish duty repriced 1 → 3 on Oct 19, after an argument
- Elena added to the trash rotation Nov 2
- Cousin Dev joins the seating rotation Nov 16–20
- Parental adjustment: Marcus credited 2 units on Nov 9
- Scripted misses, trades and parental covers throughout
- Background deviation rate: 7% of daily slots, 10% of weekly slots
- Logging rates by rotation: 55–85%

---

## 3. Sample schedule

Two weeks spanning Priya's return from her school trip and the dish-duty repricing. Corrected model.

| Date | Middle seat | Front seat | Exceptions |
|---|---|---|---|
| Mon Oct 19 | Marcus | Marcus | — |
| Tue Oct 20 | Toby | Marcus | — |
| Wed Oct 21 | Marcus | Marcus | — |
| Thu Oct 22 | Marcus | Marcus | — |
| Fri Oct 23 | Elena | Marcus | — |
| Sat Oct 24 | Marcus | Priya | *Priya returns* |
| Sun Oct 25 | Toby | Priya | — |
| Mon Oct 26 | Elena | Marcus | — |
| Tue Oct 27 | Marcus | Priya | — |
| Wed Oct 28 | Marcus | Marcus | — |
| Thu Oct 29 | Priya | Priya | — |
| Fri Oct 30 | Marcus | Marcus | — |
| Sat Oct 31 | Toby | Priya | — |
| Sun Nov 01 | Priya | Priya | — |

Weekly rotations across the full run:

| Week of | Dish duty | Trash | Dinner pick |
|---|---|---|---|
| Sep 07 | Elena | *parent covered* | Priya |
| Sep 14 | Toby | Marcus | Marcus |
| Sep 21 | Priya | *parent covered* | Elena |
| Sep 28 | Priya | Priya | Priya |
| Oct 05 | Marcus | Priya | Toby |
| Oct 12 | Marcus | *parent covered* | Elena |
| Oct 19 | Elena | Marcus | Elena |
| Oct 26 | *parent covered* | Marcus | Priya |
| Nov 02 | Marcus | Priya | Marcus |
| Nov 09 | Toby | Elena | Toby |
| Nov 16 | Marcus | Elena | Marcus |
| Nov 23 | Elena | Marcus | Elena |

16 deviations occurred across the run; 3 were never logged.

---

## 4. Finding 1 — Restricted-roster privileges destroy the shared balance

**Severity: critical. Blocks POC.**

Burden units served over 12 weeks, v3 spec model:

| Front-seat roster | Marcus | Priya | Elena | Toby | Spread |
|---|---|---|---|---|---|
| **Marcus + Priya (realistic)** | **47** | **36** | **7** | **13** | **40** |
| All four children | 29 | 25 | 19 | 30 | 11 |
| No front-seat rotation | 26 | 27 | 26 | 24 | 3 |

The mechanism is straightforward once seen. The front seat is awarded daily and only two children are eligible, so Marcus and Priya each accumulate roughly +42 credit over the period. Burden selection takes the **highest** balance. The two eldest therefore absorb nearly every chore in the house, and the two youngest are almost entirely exempt — Toby did the dishes zero times in three months.

The model is not malfunctioning. It is doing exactly what §3.1 specifies: treating privileges as fungible payment for burdens. Given that only the older children can be paid in front seats, it concludes that only the older children should work.

**This is the finding that matters most, because the app cannot detect it.** Final balances under the spec model were Marcus 0.0, Priya 1.0, Elena 0.0, Toby 0.0. Four children within one unit of each other, and a 6:1 workload split. The number the entire product's credibility rests on — brief §8, "show the number" — reports perfect fairness while the household is anything but.

---

## 5. Finding 2 — The fix: zero-sum normalization

Change §3.1 so that every slot is **zero-sum within its own roster**:

```
n      = len(roster_at(slot.date))
signed = -weight  (burden)  |  +weight  (privilege)

for p in roster:  balance[p] -= signed / n     # everyone pays the average
balance[taker]   += signed                     # taker takes the whole thing
```

A burden with four in the roster: taker −1, all four +0.25, taker net −0.75, sum zero. The front seat with two in the roster: taker +1, both −0.5, taker net +0.5, other −0.5, sum zero — **and Elena and Toby are untouched.**

Restricted rotations now post ledger deltas only among their own participants. Balances sum to zero globally. A shared balance still intentionally allows those participant balances to influence later assignments in broader rotations; normalization prevents unbounded inflation, not all cross-rotation influence.

Result under the same scenario:

| Model | Marcus | Priya | Elena | Toby | Spread |
|---|---|---|---|---|---|
| v3 spec | 47 | 36 | 7 | 13 | **40** |
| Normalized | 36 | 21 | 28 | 26 | **15** |

The residual max–min spread is 15 — substantially below 40, but not evidence of complete isolation. Priya was away for 12 days of the run. Broader v4 testing therefore treats direct ledger isolation and downstream shared-balance influence as separate properties.

**Outcome equality is not restored, and should not be.** Marcus and Priya still take 48 and 34 front seats to Elena's 0. That inequality is imposed by the physical world and no ledger can or should erase it. What normalization fixes is the *leakage* of that inequality into chores.

For miss resolution the assignee simply takes the flipped transaction under the same spread. Ordering is preserved, and the sum stays at zero.

---

## 6. Finding 3 — Exception logging is useless against noise and essential against patterns

Logging discipline was swept from 0% to 100% against random background deviation:

| Logging rate | Marcus | Priya | Elena | Toby | Spread | Invisible |
|---|---|---|---|---|---|---|
| 0% | 26 | 21 | 27 | 28 | 7 | 30 of 30 |
| ~25% | 22 | 29 | 22 | 28 | 7 | 22 |
| ~50% | 25 | 21 | 28 | 27 | 7 | 9 |
| ~70% | 25 | 19 | 29 | 28 | 10 | 6 |
| 100% | 28 | 22 | 25 | 26 | 6 | 0 |

Essentially flat. Against *random* deviation, unlogged exceptions cancel out and the ledger converges regardless.

Now the same test against a *systematic* deviation — Toby ducks the middle seat 70% of the time and a parent takes it:

| Logging rate | Marcus | Priya | Elena | **Toby** |
|---|---|---|---|---|
| Never logged | 23 | 17 | 23 | **4** |
| Half logged | 20 | 13 | 17 | **11** |
| Always logged | 5 | 6 | 1 | **25** |

Unlogged, Toby serves the middle seat 4 times in three months and gets away with it completely. Logged, the system corrects hard and puts him at 25 — and his balance climbs to +3.55, visibly, in the history view.

**This is the correct characterisation of exception logging, and it is good news.** It buys nothing against noise, and it is decisive against patterns. Systematic dodging is also precisely the case where a sibling has maximum incentive to report. The design's central bet holds — but the value proposition should be understood as *catching patterns*, not *maintaining accuracy*.

---

## 7. Finding 4 — `maxConsecutive` is silently defeated by unlogged trades

**Severity: high. This is the one place the "degrades gracefully to a pointer" claim is false.**

Observed sequence:

| Date | Assigned | Actually served | Logged? |
|---|---|---|---|
| Fri Nov 13 | Elena | Elena | yes |
| Sat Nov 14 | Priya | **Elena** | **no** |
| Sun Nov 15 | Elena | Elena | yes |

Elena rode the middle seat three days running. The ledger believed Priya served on the 14th, so it incremented Priya's consecutive counter and reset Elena's to zero — then assigned Elena again on the 15th. The app displayed a perfectly compliant rotation throughout.

`maxConsecutive` exists specifically to prevent the socially intolerable outcome (brief §3.6). It is the one guard that cannot tolerate missing data, and it sits in the one rotation with the highest deviation rate and the lowest logging rate.

Mitigation options, in order of preference:

1. **A one-tap daily confirm on the seating card only.** "Today: Elena" with a single "wasn't me" tap. Seating is the only rotation where the deviation is immediate, visible, and felt — it deserves a confirm the others don't.
2. **Detect the pattern instead.** If the same child is assigned within two days of a slot they were reported to have covered, flag rather than assign.
3. **Accept it** and rely on siblings reporting three-in-a-row. Weakest option; three consecutive days is exactly when a kid is most aggrieved, so reporting is likely — but the design shouldn't depend on it.

---

## 8. Finding 5 — Absence self-settles; no punitive return streak

Brief §3.6 predicted a child returning from two weeks away would ride the middle seat four days straight, and justified `maxConsecutive` on that basis. Under the normalized model this does not happen.

Priya's balance across her 12-day school trip:

| Date | Balance |
|---|---|
| Oct 11 (departure) | −1.00 |
| Oct 17 | −2.25 |
| Oct 23 (return) | −5.50 |
| Oct 30 | −3.00 |
| Nov 6 | −0.17 |

She drifts **negative**, not positive — because while away she also misses 12 days of front seat, and the zero-sum spread correctly puts her in credit for the privileges she didn't receive. On return she is first in line for privileges and last for burdens, and the whole thing settles inside two weeks with no streak.

Her middle-seat assignments in the ten days after returning: Elena, Marcus, Marcus, Toby, Toby, Elena, **Priya**, Toby, Toby, Elena.

This is better behaviour than the brief predicted and it emerged from the normalization change rather than being designed in. `maxConsecutive` remains worth keeping for other cases, but it is not load-bearing for absence.

---

## 9. Finding 6 — Trades are not validated against the roster

**Severity: medium. Trivial to fix, embarrassing to ship.**

Toby, aged 7, "covered" the front seat twice. Nothing in the engine checks that a trade recipient is a member of the rotation, and the front seat is roster-restricted for child-safety reasons.

Trades must be validated against `roster_at(slot.date)`. Rotations should also carry an explicit `restricted: bool` so the UI can refuse rather than warn on safety-constrained rotations.

---

## 10. Findings that came back clean

- **Date-ordered folding across rotations** behaved correctly. Monday's dish duty visibly influenced Monday's dinner pick.
- **Non-retroactive weight changes** worked. Dish duty repricing from 1 to 3 on Oct 19 applied forward only; September history was unaffected.
- **Roster changes mid-run** worked. Elena joined trash on Nov 2 and appeared in the Nov 9 rotation. Cousin Dev entered the seating rotation, took one turn during his five-day visit, and exited cleanly.
- **Parental adjustment** applied at the correct point in the fold and remained visible in history.
- **Absence handling** never assigned an absent child.
- **Balances sum to zero** under normalization, confirming the invariant.

---

## 11. Recommended amendments to the brief

| # | Section | Change | Priority |
|---|---|---|---|
| 1 | §3.1 | Replace full-delta-to-taker with zero-sum normalization within roster | **Blocking** |
| 2 | §3.5 | Validate trade recipients against the rotation roster; add `restricted` flag | **Blocking** |
| 3 | §3.6 | Add one-tap daily confirm on seating; note that `maxConsecutive` depends on logging | High |
| 4 | §3.6 | Downgrade the absence justification — normalization handles it | Low |
| 5 | §3.3 | Reframe logging value as pattern detection, not accuracy maintenance | Low |
| 6 | New | Decide explicitly whether absent members absorb the spread (currently yes; works well) | Medium |

The buy-out concern deferred in brief §3.2 did not materialise in simulation, but the run was too short to rule it out. Leave it deferred.

---

## 12. Test suite for the POC

These simulation scenarios should become the engine's unit tests before any UI is written. They are cheap, they are the tests that matter, and every one of them caught something.

1. **Zero-sum invariant** — after any sequence of slots, balances sum to zero (modulo logged adjustments).
2. **Restricted-roster isolation** — a privilege rotation restricted to a subset must not shift burden distribution outside that subset. *This is the regression test for Finding 1.*
3. **Roster-validated trades** — a trade to a non-member is rejected.
4. **`maxConsecutive` under complete logging** — no child exceeds the cap.
5. **`maxConsecutive` under incomplete logging** — documents the known gap; assert the confirm prompt fires.
6. **Non-retroactive weights** — repricing mid-run leaves prior history byte-identical.
7. **Absence** — absent members are never assigned; balance settles within ~2 weeks of return.
8. **Roster churn** — add and remove mid-run; guest takes turns only within their window.
9. **Determinism** — identical event log produces identical schedule on replay, on any device.
10. **Empty-eligible fallback** — when the cap excludes everyone, the fallback path is defined and does not crash.
11. **Systematic-dodger detection** — a child dodging 70% of turns, fully logged, converges to over-service. *Regression test for the product's core value claim.*

---

## 13. Verdict

The fairness model is sound in structure and was wrong in one coefficient. The ledger-over-pointer decision, exception-only logging, date-ordered folding, and set-once desirability weights all survived contact with a realistic 12-week household.

The shared balance needed normalization, trades need roster validation, and `maxConsecutive` needs a confirm signal it doesn't currently have. With those three changes the model produced a defensible schedule under absences, guests, repricing, roster churn, and a 19% logging failure rate.

Proceed to POC with amendments 1 and 2 applied.
