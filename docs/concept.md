# Family Rotation App: Concept brief

*Status: draft v4.2, personal project*

This version uses a shared balance that stays at zero across the people who are present. It also checks that trades are safe, supports restricted rotations, adds a quick seating confirmation, and handles absences without creating debt.

The companion file, `stress-test-v3.md`, explains the 12-week simulation behind these choices. The later v4 tests are documented in `validation-v4.md`.

## 1. What the app does

The Family Rotation App helps families share turns fairly over time.

It can handle car seats, chores, dog walking, dinner choices, movie picks, console time, and similar family routines. Instead of following a fixed list, the app keeps track of what each person has done and received. When someone asks, "Why is it my turn?" the app can show the history behind the answer.

The goal is not perfect equality every day. The goal is a fair pattern over time, even when someone is sick, away, or needs to trade.

## 2. How the balance works

A fixed rotation works until real life interrupts it. If someone misses a turn, a simple list has to be rearranged, and that can affect people who had nothing to do with the change.

This app gives each person one running balance across all rotations. Doing an unpleasant job lowers the balance, which means the person is owed something later. Receiving a privilege raises the balance, which means the person has already benefited.

| Type | Examples | Serving a turn | Meaning |
|---|---|---|---|
| **Burden** | Middle seat, dish duty, trash, dog walking | Net balance goes **down** | You are owed |
| **Privilege** | Dinner pick, front seat, movie pick, console first | Net balance goes **up** | You have been paid |

The person with the highest balance gets the next burden. The person with the lowest balance gets the next privilege.

If two people have the same balance, the app chooses whoever has waited longest. If they are still tied, it follows the family's fixed roster order. It never picks at random.

### 2.1 Only people who are present share a turn

Each turn is balanced among the people who are both present and part of that rotation. The person taking the turn gets the full value, while everyone present shares the offset. This keeps the total at zero.

For example, if four people share a burden worth 1 point, each person first receives 0.25. The person doing the job then loses 1. Their final change is -0.75, while everyone else's change is +0.25.

For a front-seat privilege shared by two eligible children, one child ends at +0.5 and the other at -0.5. Younger children outside that rotation are not affected directly.

Technical formula:

```
pool   = roster_at(slot.date).filter(present)
n      = |pool|
signed = -weight   if burden
       = +weight   if privilege

for p in pool:    balance[p] -= signed / n      # present members pay the average
balance[taker]   += signed                       # taker takes the whole transaction
```

Earlier versions gave the full change only to the person taking the turn. That broke down when a privilege was limited to part of the family. In a 12-week test, the oldest child completed 47 units of chores while the youngest completed 7, even though all four balances looked nearly equal. Sharing each change within the eligible group removed most of that distortion.

The fix does not make every outcome equal. Older children may still get every front-seat turn because younger children are not eligible. It prevents that age rule from directly changing the younger children's balances. Since all rotations use one shared balance, a front-seat result can still affect a later chore assignment for the older children. That is part of the current shared-balance policy.

Each turn must add up to zero, except for a visible adjustment made by a parent. The Python reference engine uses exact fractions, and the tests check this rule.

### 2.2 Some turns can be worth more

Families can give heavier chores a larger weight. Everything starts at 1. A family might later decide that a week of dishes should count as 3.

Weights are settings, not something a person enters every time. A change applies only to future turns. In testing, changing dish duty from 1 to 3 did not alter earlier history.

There is one unresolved problem. A child can currently give away every privilege and use the lower balance to avoid chores. In a two-year test, that child completed 11 chores while the child receiving the privileges completed 70. The balance gap grew to 547. The next version must treat a privilege gift differently from a burden trade, or add another clear limit.

## 3. What happens in everyday use

### 3.1 The app records changes, not every completed turn

The app assumes the assigned person completed a turn unless someone reports otherwise. Families should not have to maintain a detailed daily log.

With one equal-weight rotation, this produces nearly the same turn counts as a simple round-robin list. With several rotations, the exact order will differ because every turn changes the shared balance.

Tests found that missing reports about random, occasional changes had little effect over time. Repeated avoidance was different. A child who avoided 70 percent of middle-seat turns served 4 times in three months when nobody reported the misses, but 25 times when every miss was reported.

This means reporting is most useful when there is a pattern. A sibling is also more likely to report repeated avoidance than a one-time mix-up.

Reporting a change should take one tap from the home screen. The reason and the person who covered can be edited later in history.

### 3.2 Daily seating and weekly chores

| Rotation | Cadence |
|---|---|
| Vehicle seating | Daily |
| Chores | Weekly |

The seating assignment lasts for the day. The app does not ask families to log every car trip or decide whether a long drive should count more than a short one. A day is consumed even if the car is not used, because days without trips are expected to be rare.

Chores use whole weeks. If someone handled a chore from Monday through Wednesday but missed Thursday, the app still treats the week as partly served rather than a completely missed turn.

Families set a rotation's weight once. The app does not support a different weight for each trip or event because that would require too much daily input.

### 3.3 Missed turns, trades, and exceptions

When the assigned person does not complete a turn, the family records one of these outcomes:

| Case | What occurred | Ledger effect |
|---|---|---|
| **Trade** | Another person *in the rotation* covered | Coverer becomes the taker; normal spread applies |
| **Outside cover** | A parent or non-participant covered | Assignee takes the **flipped** transaction; normal spread applies |
| **Excused** *(optional policy)* | Absence outside the member's control | No change to any balance |

For a burden trade, the person who did the work receives the credit. The original assignee will usually come up again sooner.

The app checks that the person accepting a trade belongs to that rotation and is present. This prevents unsafe trades, such as assigning a 7-year-old to a restricted front-seat rotation. Restricted rotations reject an invalid trade instead of showing a warning.

If a parent or someone outside the rotation covers, the original assignee moves one full weight behind the other people in the rotation. They may come up again soon, and their normal future turn still remains. This is the default because relying on a parent should not erase the missed turn.

Families can turn on an excused option for a rotation if they want sickness or another unavoidable absence to have no effect. It is off by default.

Privilege gifts still need a separate rule. Treating them exactly like burden trades creates the buy-out problem described in section 2.2.

### 3.4 Limits on repeated turns

By default, the app will not give one person more than two turns in a row within the same rotation. Any unpaid balance remains and is worked off gradually.

This limit depends on accurate reports. In one simulation, Elena took the middle seat for three days in a row because a trade on the second day was not reported. The app believed Priya had taken that day, so it thought Elena's streak had ended.

The seating card therefore needs a quick daily correction. It can show "Today: Elena" with a single "wasn't me" action. A second safeguard can flag a new assignment if the same person was recently reported as covering someone else's seat.

### 3.5 Absences

An absent person is not assigned and does not gain debt or credit for turns missed while away. Their balance stays unchanged until they return.

An earlier test charged absent people for missed turns and appeared to work because that child missed a convenient mix of burdens and privileges. A burden-only test exposed the problem: a ten-day absence created a +5 debt and caused repeated assignments after the child returned. Freezing the balance works consistently for families using only burdens, only privileges, or both.

The policy is simple: fairness applies to the people who had a chance to take that turn.

### 3.6 Who belongs to each rotation

Parents choose the members of every rotation. They can add a visiting cousin for a week, leave a guest out, add a child to a new chore, or remove someone who has outgrown a seating rule.

Tests covered additions, removals, and a five-day guest visit. Because all rotations share one balance, a person who leaves one rotation keeps their existing balance in the others. A parent can clear it with a visible adjustment if needed.

### 3.7 Parent adjustments and yearly review

Parents can make a manual adjustment, but it always appears in history with a note and the name of the parent who made it. The app never changes a balance silently.

Rotations continue from year to year. At the start of each calendar year, the app asks the family whether to carry balances forward or reset them to zero. This also gives the family a regular time to review weights, members, and rules. Parents can review them at any time.

## 4. What the family will see

### Version 1

- Daily seating assignments with a quick correction action
- Weekly chore assignments
- One-tap reporting when the assigned person did not serve
- Trade offers and acceptance, checked against the rotation roster
- History showing each person's shared balance and reported changes
- Parent controls for members, weights, and visible adjustments

### Planned later

- Privilege rotations such as dinner picks, front seat, movie choice, and first console turn
- Points or allowance tied to chores, with a reward store
- A shared grocery list
- Household reminders, including trash night and alternating recycling weeks
- Meal planning
- Streaks and completion statistics
- Carpool and ride assignments
- Packing checklists

### Not planned

- Separate online accounts for children. The family will use one account with profile switching and optional child PINs. The app stores only a first name for each child and does not require their email address or phone number.
- Logging every event or assigning a different weight to every trip
- Social features or sharing between families
- Support for multiple unrelated households in one account
- Monetization

## 5. How families should set it up

Families should agree on weights and missed-turn rules before a disagreement happens. The same rule is easier to accept when everyone approved it before knowing who would benefit.

Trades should be easy to offer and accept. Children are more likely to use a system when they can make reasonable arrangements within it.

The app should show both the balance and the history behind it. A number that looks equal while the actual workload is badly uneven would make the system less trustworthy, not more.

## 6. Developer notes

The rest of this document records the technical plan. Families do not need this section to understand or use the app.

### 6.1 Stored information

Future turn candidates come from dated configuration. When the app shows an assignment, it stores that assignment so a later correction cannot rewrite what the family previously saw. Outcomes are also stored as dated events. If two devices report different outcomes for one turn, a parent must choose which record replaces them.

```
Person         { id, name }
Rotation       { id, name, type: burden|privilege, cadence,
                 desirability, maxConsecutive, restricted, roster[] }

AssignmentRecorded { eventId, slotId, personId }
OutcomeRecorded { eventId, slotId, kind, coverer, supersedes[] }
RotationConfigChanged { eventId, rotationId, effectiveDate, changes }
RosterChanged  { rotationId, date, personId, action }
WeightChanged  { rotationId, date, desirability }
Absence        { personId, start, end }
Adjustment     { date, personId, delta, note, byPersonId }
YearAcknowledged { year, action: carry|reset, byPersonId }
```

An `Adjustment` applies to the person's global balance, so it has no `rotationId`. Configuration changes take effect on a stated date and do not alter earlier history. A rotation's start date cannot change. Once the app has stored an assignment, normal configuration changes must apply to a later date.

The engine processes all rotations together in date order:

```
slots = allRotations.flatMap(r => generateSlots(r, from, to)).sortBy(date, rotation.order)

for slot of slots:
  roster    = rosterAt(slot.rotation, slot.date)
  pool      = roster.filter(present)
  n         = pool.length
  weight    = weightAt(slot.rotation, slot.date)
  signed    = slot.rotation.type === 'burden' ? -weight : +weight
  eligible  = pool.filter(p => consecutive[p] < maxConsecutive) || pool
  assignee  = slot.rotation.type === 'burden' ? argmax(balances, eligible)
                                              : argmin(balances, eligible)
  taker     = resolveOutcome(slot, assignee)        // §3.3
  for (p of pool) balances[p] -= signed / n
  balances[taker] += signed
```

The order matters because Monday's dish duty can affect Monday's dinner pick. The engine is a pure reducer and has a unit-test suite based on the stress tests. Yearly balance snapshots can be added if replay becomes slow.

### 6.2 Technical choices

The web app is the main product. This project will not pay for an Apple Developer account, so iOS delivery will use an installed web app rather than a native App Store build.

| Concern | Choice | Rationale |
|---|---|---|
| Framework | React + Vite + TypeScript | Full CSS, full ecosystem, fast builds, no react-native-web translation layer |
| Styling | Tailwind | Direct, no RN styling subset |
| State | Zustand | Sufficient; no need for heavier tooling |
| Dates | date-fns | Calendar dates, **not** timestamps; timezone bugs are fatal to a date-keyed rotation |
| Persistence (POC) | Local storage behind a repository interface | Stage 2 becomes a swap, not a refactor |
| Persistence (v1) | Supabase: Postgres, auth, realtime, RLS | Generous free tier, fits the append-only model |
| iOS delivery | PWA, installed from Safari | $0. Web push works on iOS 16.4+ for installed PWAs |
| Android delivery | PWA, or Capacitor wrapper for a Play listing | Capacitor is a wrapper step, not a port |

The iOS web app will not have home-screen widgets or reliable background processing. Neither limitation prevents chore reminders.

Development will use Windows 11. Android tools run on Windows, and neither Windows nor Linux can build the planned iOS version because there is no native iOS build. WSL2 is available if a Unix shell is useful, but it is not required.

### 6.3 Build stages

Stage 0 should take one weekend. Port `reference/python/rotation_engine_v4.py` to TypeScript with its pytest tests. Build only daily seating, use a fixed roster, and store nothing on a server. The result should be a phone-friendly "who's today" card with confirmation and correction actions.

The tests are the contract for the TypeScript port. The old `reference/python/rotation_engine_v3.py` remains only to reproduce the v3 findings.

Stage 1 adds weekly chores, weights, history, local storage, and installation as a web app.

Stage 2 adds Supabase, sign-in, profile switching, device sync, parent controls, and the yearly review prompt.

Stage 3 adds privilege rotations, points and rewards, web notifications, and an optional Capacitor build for the Play Store.

## 7. Decisions already made

| Question | Resolution |
|---|---|
| Debt across roster changes | Survives because the balance is global |
| Rotation reset boundaries | Runs indefinitely with an annual carry-or-reset prompt |
| Shared vs independent balances | Shared, zero-sum within the present roster, signed by type |
| Guest participants | Parents choose whether to add them |
| Days with no vehicle use | The daily slot is consumed anyway |
| Absent members and the spread | Their balance is frozen; only present members share the turn |
| Trade validation | Every trade is checked against roster and presence; restricted rotations reject invalid trades |
| Repeated-turn limit | Tracked separately for each rotation |

## 8. Questions still open

- How should the app record a privilege that someone gives away or declines without allowing unlimited chore buy-out?
- If the yearly prompt is dismissed, should the app carry balances forward or reset them?
- Should the second repeated-turn safeguard show a warning or block the assignment?
- Does the seating confirmation need a reminder, or is showing it in the app enough?
- Should parents be able to repair old configuration through a previewed, logged migration, or should all changes be future-only?
- When devices save conflicting configuration, should a parent select the winning event or save a replacement snapshot?
