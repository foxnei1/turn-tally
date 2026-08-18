"""
Reference implementation of the Family Rotation App fairness engine.
Implements concept brief v3 section 3, plus an experimental `normalized`
mode used to test a suspected flaw in the shared-balance design.

  spec mode  (normalized=False): taker takes the full signed delta.
  norm mode  (normalized=True):  every slot is zero-sum within its own roster.
"""
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal, Optional, Callable


@dataclass
class Person:
    id: str
    name: str
    age: int


@dataclass
class Rotation:
    id: str
    name: str
    type: Literal["burden", "privilege"]
    cadence: Literal["daily", "weekly"]
    desirability: float = 1.0
    max_consecutive: int = 2
    order: int = 0


@dataclass
class RosterChanged:
    date: date; rotation_id: str; person_id: str; action: str

@dataclass
class WeightChanged:
    date: date; rotation_id: str; desirability: float

@dataclass
class Absence:
    start: date; end: date; person_id: str

@dataclass
class Adjustment:
    date: date; person_id: str; delta: float; note: str

@dataclass
class Slot:
    id: str
    date: date
    rotation: Rotation
    assignee: Optional[str] = None
    served_by: Optional[str] = None
    outcome: str = "as_scheduled"
    recorded: bool = True
    deltas: dict = field(default_factory=dict)
    snapshot: dict = field(default_factory=dict)


class Engine:
    def __init__(self, people, rotations, initial_roster, start, end,
                 normalized=False):
        self.people = {p.id: p for p in people}
        self.rotations = {r.id: r for r in rotations}
        self.initial_roster = {k: list(v) for k, v in initial_roster.items()}
        self.start, self.end = start, end
        self.normalized = normalized
        self.roster_events: list[RosterChanged] = []
        self.weight_events: list[WeightChanged] = []
        self.absences: list[Absence] = []
        self.adjustments: list[Adjustment] = []

    def generate_slots(self):
        slots = []
        for rot in self.rotations.values():
            d = self.start
            if rot.cadence == "weekly":
                while d.weekday() != 0:
                    d += timedelta(days=1)
            while d <= self.end:
                slots.append(Slot(id=f"{rot.id}:{d.isoformat()}", date=d, rotation=rot))
                d += timedelta(days=1 if rot.cadence == "daily" else 7)
        slots.sort(key=lambda s: (s.date, s.rotation.order))   # date order across rotations
        return slots

    def roster_at(self, rid, on):
        m = list(self.initial_roster.get(rid, []))
        for ev in sorted(self.roster_events, key=lambda e: e.date):
            if ev.rotation_id != rid or ev.date > on:
                continue
            if ev.action == "add" and ev.person_id not in m:
                m.append(ev.person_id)
            elif ev.action == "remove" and ev.person_id in m:
                m.remove(ev.person_id)
        return m

    def weight_at(self, rot, on):
        w = rot.desirability
        for ev in sorted(self.weight_events, key=lambda e: e.date):
            if ev.rotation_id == rot.id and ev.date <= on:
                w = ev.desirability
        return w

    def absent(self, pid, on):
        return any(a.person_id == pid and a.start <= on <= a.end for a in self.absences)

    def run(self, world: Optional[Callable] = None):
        """
        world(slot, assignee) -> (outcome, coverer, recorded) or None.
        outcome in {trade, outside_cover, excused}.
        If recorded is False the ledger behaves as if the turn went as
        scheduled, but the slot still reports the ground truth.
        """
        bal = {pid: 0.0 for pid in self.people}
        consec, last = {}, {}
        history = []
        adjs = sorted(self.adjustments, key=lambda a: a.date); ai = 0

        for slot in self.generate_slots():
            while ai < len(adjs) and adjs[ai].date <= slot.date:
                bal[adjs[ai].person_id] += adjs[ai].delta; ai += 1

            rot = slot.rotation
            w = self.weight_at(rot, slot.date)
            signed = -w if rot.type == "burden" else +w
            roster = self.roster_at(rot.id, slot.date)
            pool = [p for p in roster if not self.absent(p, slot.date)]
            elig = [p for p in pool if consec.get((rot.id, p), 0) < rot.max_consecutive] or pool
            if not elig:
                slot.outcome = "no_eligible"; history.append(slot); continue

            def key(pid):
                lt = last.get((rot.id, pid))
                stale = (slot.date - lt).days if lt else 10_000
                idx = roster.index(pid)
                return (-bal[pid], -stale, idx) if rot.type == "burden" else (bal[pid], -stale, idx)

            assignee = sorted(elig, key=key)[0]
            slot.assignee = assignee
            n = max(len(roster), 1)

            ev = world(slot, assignee) if world else None
            outcome, coverer, recorded = ev if ev else ("as_scheduled", None, True)
            slot.outcome, slot.recorded = outcome, recorded
            effective = outcome if recorded else "as_scheduled"

            def apply(taker, flip=False):
                d = -signed if flip else signed
                if self.normalized:
                    for p in roster:
                        bal[p] -= d / n
                bal[taker] += d
                return {taker: d}

            if effective == "trade":
                slot.served_by = coverer
                slot.deltas = apply(coverer); taker = coverer
            elif effective == "outside_cover":
                slot.served_by = coverer
                slot.deltas = apply(assignee, flip=True); taker = None
            elif effective == "excused":
                slot.served_by = coverer; taker = None
            else:
                slot.served_by = assignee
                slot.deltas = apply(assignee); taker = assignee

            # ground truth may differ from what the ledger believes
            if not recorded:
                if outcome == "trade":
                    slot.served_by = coverer
                elif outcome in ("outside_cover", "excused"):
                    slot.served_by = coverer

            for p in roster:
                k = (rot.id, p)
                consec[k] = consec.get(k, 0) + 1 if p == taker else 0
            if taker:
                last[(rot.id, taker)] = slot.date

            slot.snapshot = dict(bal)
            history.append(slot)

        return history, bal
