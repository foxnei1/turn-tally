"""Deterministic v4 reference engine for the Family Rotation App.

The engine is deliberately small and pure enough to replay from dated inputs.
Its central accounting rule is zero-sum within the *present* roster.  An absent
person is neither assignable nor charged/credited for slots during the absence.
Future slots are derived; recorded assignments anchor what the app displayed so
late outcome corrections cannot rewrite assignment history.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from fractions import Fraction
from typing import Callable, Iterable, Literal, Mapping, Optional


RotationType = Literal["burden", "privilege"]
Cadence = Literal["daily", "weekly"]
OutcomeKind = Literal["as_scheduled", "trade", "outside_cover", "excused"]
Number = int | float | str | Fraction


def amount(value: Number) -> Fraction:
    """Convert configuration values without importing binary-float noise."""

    if isinstance(value, Fraction):
        return value
    if isinstance(value, float):
        return Fraction(str(value))
    return Fraction(value)


@dataclass(frozen=True)
class Person:
    id: str
    name: str


@dataclass(frozen=True)
class Rotation:
    id: str
    name: str
    type: RotationType
    cadence: Cadence
    start: date
    desirability: Number = 1
    max_consecutive: int = 2
    order: int = 0
    restricted: bool = False

    def __post_init__(self) -> None:
        if self.cadence not in ("daily", "weekly"):
            raise ValueError(f"unsupported cadence: {self.cadence}")
        if self.type not in ("burden", "privilege"):
            raise ValueError(f"unsupported rotation type: {self.type}")
        if amount(self.desirability) <= 0:
            raise ValueError("desirability must be positive")
        if self.max_consecutive < 1:
            raise ValueError("max_consecutive must be at least 1")


@dataclass(frozen=True)
class RosterChanged:
    event_id: str
    effective_date: date
    rotation_id: str
    person_id: str
    action: Literal["add", "remove"]


@dataclass(frozen=True)
class WeightChanged:
    event_id: str
    effective_date: date
    rotation_id: str
    desirability: Number

    def __post_init__(self) -> None:
        if amount(self.desirability) <= 0:
            raise ValueError("desirability must be positive")


@dataclass(frozen=True)
class RotationConfigChanged:
    """Effective-dated changes to schedule-affecting rotation configuration.

    ``start`` is intentionally immutable.  Archiving and later reactivating a
    rotation is represented with ``active``; a cadence change or reactivation
    anchors a fresh cadence on the event's effective date.
    """

    event_id: str
    effective_date: date
    rotation_id: str
    type: Optional[RotationType] = None
    cadence: Optional[Cadence] = None
    desirability: Optional[Number] = None
    max_consecutive: Optional[int] = None
    order: Optional[int] = None
    restricted: Optional[bool] = None
    active: Optional[bool] = None

    def __post_init__(self) -> None:
        if self.type is not None and self.type not in ("burden", "privilege"):
            raise ValueError(f"unsupported rotation type: {self.type}")
        if self.cadence is not None and self.cadence not in ("daily", "weekly"):
            raise ValueError(f"unsupported cadence: {self.cadence}")
        if self.desirability is not None and amount(self.desirability) <= 0:
            raise ValueError("desirability must be positive")
        if self.max_consecutive is not None and self.max_consecutive < 1:
            raise ValueError("max_consecutive must be at least 1")


@dataclass(frozen=True)
class Absence:
    event_id: str
    person_id: str
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError("absence end cannot precede start")


@dataclass(frozen=True)
class Adjustment:
    event_id: str
    effective_date: date
    person_id: str
    delta: Number
    note: str


@dataclass(frozen=True)
class Outcome:
    kind: OutcomeKind = "as_scheduled"
    coverer: Optional[str] = None


@dataclass(frozen=True)
class OutcomeRecorded:
    """An immutable fact about a slot outcome.

    Corrections explicitly name every event they replace.  Concurrent active
    facts remain a conflict until another event supersedes all of them.
    """

    event_id: str
    slot_id: str
    outcome: Outcome
    supersedes: tuple[str, ...] = ()


class OutcomeConflictError(ValueError):
    def __init__(self, slot_id: str, event_ids: Iterable[str]) -> None:
        self.slot_id = slot_id
        self.event_ids = tuple(sorted(event_ids))
        super().__init__(
            f"conflicting active outcomes for {slot_id}: {', '.join(self.event_ids)}"
        )


@dataclass(frozen=True)
class AssignmentRecorded:
    """The assignee shown when a slot became current.

    Future assignments may be derived, but past assignments must be anchored by
    these facts so a late outcome correction cannot rewrite displayed history.
    """

    event_id: str
    slot_id: str
    person_id: str


@dataclass(frozen=True)
class Slot:
    id: str
    date: date
    rotation_id: str
    order: int


@dataclass(frozen=True)
class SlotContext:
    slot: Slot
    rotation: Rotation
    active_roster: tuple[str, ...]
    present_roster: tuple[str, ...]


@dataclass
class SlotRecord:
    slot: Slot
    rotation: Rotation
    active_roster: tuple[str, ...]
    accounting_roster: tuple[str, ...]
    assignee: Optional[str] = None
    assignment_source: Literal["derived", "recorded"] = "derived"
    served_by: Optional[str] = None
    outcome: str = "as_scheduled"
    deltas: dict[str, Fraction] = field(default_factory=dict)
    balances: dict[str, Fraction] = field(default_factory=dict)


OutcomeResolver = Callable[[SlotContext, str], Optional[Outcome]]


class Engine:
    """Replay dated configuration and outcomes into assignments and balances."""

    def __init__(
        self,
        people: Iterable[Person],
        rotations: Iterable[Rotation],
        initial_roster: Mapping[str, Iterable[str]],
        end: date,
        *,
        roster_events: Iterable[RosterChanged] = (),
        weight_events: Iterable[WeightChanged] = (),
        config_events: Iterable[RotationConfigChanged] = (),
        absences: Iterable[Absence] = (),
        adjustments: Iterable[Adjustment] = (),
        assignment_events: Iterable[AssignmentRecorded] = (),
        outcome_events: Iterable[OutcomeRecorded] = (),
    ) -> None:
        self.people = self._unique_by_id(people, "person")
        self.rotations = self._unique_by_id(rotations, "rotation")
        self.initial_roster = {
            rotation_id: tuple(person_ids)
            for rotation_id, person_ids in initial_roster.items()
        }
        self.end = end
        self.roster_events = tuple(roster_events)
        self.weight_events = tuple(weight_events)
        self.config_events = tuple(config_events)
        self.absences = tuple(absences)
        self.adjustments = tuple(adjustments)
        self.assignment_events = tuple(assignment_events)
        self.outcome_events = tuple(outcome_events)
        self._validate_inputs()

    @staticmethod
    def _unique_by_id(items: Iterable[object], label: str) -> dict[str, object]:
        result: dict[str, object] = {}
        for item in items:
            item_id = getattr(item, "id")
            if item_id in result:
                raise ValueError(f"duplicate {label} id: {item_id}")
            result[item_id] = item
        return result

    def _validate_inputs(self) -> None:
        event_ids: set[str] = set()
        events = (
            *self.roster_events,
            *self.weight_events,
            *self.config_events,
            *self.absences,
            *self.adjustments,
            *self.assignment_events,
            *self.outcome_events,
        )
        for event in events:
            if event.event_id in event_ids:
                raise ValueError(f"duplicate event id: {event.event_id}")
            event_ids.add(event.event_id)

        for rotation_id, roster in self.initial_roster.items():
            if rotation_id not in self.rotations:
                raise ValueError(f"roster references unknown rotation: {rotation_id}")
            if len(roster) != len(set(roster)):
                raise ValueError(f"duplicate person in roster: {rotation_id}")
            self._validate_people(roster)

        for event in self.roster_events:
            if event.rotation_id not in self.rotations:
                raise ValueError(f"roster event references unknown rotation: {event.rotation_id}")
            self._validate_people((event.person_id,))
        for event in self.weight_events:
            if event.rotation_id not in self.rotations:
                raise ValueError(f"weight event references unknown rotation: {event.rotation_id}")
        for event in self.config_events:
            if event.rotation_id not in self.rotations:
                raise ValueError(f"config event references unknown rotation: {event.rotation_id}")
        config_writes: dict[tuple[str, date, str], object] = {}
        for event in self.config_events:
            for field_name in (
                "type",
                "cadence",
                "desirability",
                "max_consecutive",
                "order",
                "restricted",
                "active",
            ):
                value = getattr(event, field_name)
                if value is None:
                    continue
                key = (event.rotation_id, event.effective_date, field_name)
                comparable = amount(value) if field_name == "desirability" else value
                previous = config_writes.get(key)
                if previous is not None and previous != comparable:
                    raise ValueError(
                        "conflicting config events for "
                        f"{event.rotation_id} on {event.effective_date}: {field_name}"
                    )
                config_writes[key] = comparable
        for event in self.absences:
            self._validate_people((event.person_id,))
        for event in self.adjustments:
            self._validate_people((event.person_id,))
        assignment_slots: dict[str, AssignmentRecorded] = {}
        for event in self.assignment_events:
            self._validate_people((event.person_id,))
            previous = assignment_slots.get(event.slot_id)
            if previous is not None:
                raise ValueError(
                    f"multiple recorded assignments for {event.slot_id}: "
                    f"{previous.event_id}, {event.event_id}"
                )
            assignment_slots[event.slot_id] = event

        outcomes_by_id = {event.event_id: event for event in self.outcome_events}
        for event in self.outcome_events:
            if event.event_id in event.supersedes:
                raise ValueError(f"outcome event cannot supersede itself: {event.event_id}")
            for replaced_id in event.supersedes:
                replaced = outcomes_by_id.get(replaced_id)
                if replaced is None:
                    raise ValueError(f"outcome supersedes unknown event: {replaced_id}")
                if replaced.slot_id != event.slot_id:
                    raise ValueError("outcome can only supersede events for the same slot")

    def _validate_people(self, person_ids: Iterable[str]) -> None:
        for person_id in person_ids:
            if person_id not in self.people:
                raise ValueError(f"unknown person: {person_id}")

    def generate_slots(self) -> list[Slot]:
        slots: list[tuple[date, int, str, Slot]] = []
        for rotation in self.rotations.values():
            current = rotation.start
            cadence = rotation.cadence
            cadence_anchor = rotation.start
            active = True
            config_events = sorted(
                (event for event in self.config_events if event.rotation_id == rotation.id),
                key=lambda event: (event.effective_date, event.event_id),
            )
            event_index = 0
            while current <= self.end:
                while (
                    event_index < len(config_events)
                    and config_events[event_index].effective_date <= current
                ):
                    event = config_events[event_index]
                    was_active = active
                    if event.cadence is not None and event.cadence != cadence:
                        cadence = event.cadence
                        cadence_anchor = current
                    if event.active is not None:
                        active = event.active
                        if active and not was_active:
                            cadence_anchor = current
                    event_index += 1

                effective = self.rotation_at(rotation.id, current)
                due = cadence == "daily" or (current - cadence_anchor).days % 7 == 0
                if active and due:
                    slot = Slot(
                        id=f"{rotation.id}:{current.isoformat()}",
                        date=current,
                        rotation_id=rotation.id,
                        order=effective.order,
                    )
                    slots.append((current, effective.order, rotation.id, slot))
                current += timedelta(days=1)
        return [item[3] for item in sorted(slots)]

    def rotation_at(self, rotation_id: str, on: date) -> Rotation:
        rotation = self.rotations[rotation_id]
        relevant = sorted(
            (event for event in self.config_events
             if event.rotation_id == rotation_id and event.effective_date <= on),
            key=lambda event: (event.effective_date, event.event_id),
        )
        for event in relevant:
            changes = {
                field_name: getattr(event, field_name)
                for field_name in (
                    "type",
                    "cadence",
                    "desirability",
                    "max_consecutive",
                    "order",
                    "restricted",
                )
                if getattr(event, field_name) is not None
            }
            if changes:
                rotation = replace(rotation, **changes)
        return rotation

    def roster_at(self, rotation_id: str, on: date) -> tuple[str, ...]:
        roster = list(self.initial_roster.get(rotation_id, ()))
        relevant = sorted(
            (event for event in self.roster_events
             if event.rotation_id == rotation_id and event.effective_date <= on),
            key=lambda event: (event.effective_date, event.event_id),
        )
        for event in relevant:
            if event.action == "add" and event.person_id not in roster:
                roster.append(event.person_id)
            elif event.action == "remove" and event.person_id in roster:
                roster.remove(event.person_id)
        return tuple(roster)

    def weight_at(self, rotation: Rotation, on: date) -> Fraction:
        weight = amount(rotation.desirability)
        relevant = sorted(
            (event for event in self.weight_events
             if event.rotation_id == rotation.id and event.effective_date <= on),
            key=lambda event: (event.effective_date, event.event_id),
        )
        for event in relevant:
            weight = amount(event.desirability)
        return weight

    def is_absent(self, person_id: str, on: date) -> bool:
        return any(
            event.person_id == person_id and event.start <= on <= event.end
            for event in self.absences
        )

    def resolved_outcomes(self, valid_slot_ids: Iterable[str]) -> dict[str, Outcome]:
        valid = set(valid_slot_ids)
        grouped: dict[str, list[OutcomeRecorded]] = {}
        for event in self.outcome_events:
            if event.slot_id not in valid:
                raise ValueError(f"outcome references unknown generated slot: {event.slot_id}")
            grouped.setdefault(event.slot_id, []).append(event)

        resolved: dict[str, Outcome] = {}
        for slot_id, events in grouped.items():
            by_id = {event.event_id: event for event in events}
            visiting: set[str] = set()
            visited: set[str] = set()

            def visit(event_id: str) -> None:
                if event_id in visiting:
                    raise ValueError(f"outcome supersession cycle for {slot_id}")
                if event_id in visited:
                    return
                visiting.add(event_id)
                for replaced_id in by_id[event_id].supersedes:
                    visit(replaced_id)
                visiting.remove(event_id)
                visited.add(event_id)

            for event_id in by_id:
                visit(event_id)

            superseded = {
                replaced_id
                for event in events
                for replaced_id in event.supersedes
            }
            active = [event for event in events if event.event_id not in superseded]
            if len(active) != 1:
                raise OutcomeConflictError(slot_id, (event.event_id for event in active))
            resolved[slot_id] = active[0].outcome
        return resolved

    def recorded_assignments(self, valid_slot_ids: Iterable[str]) -> dict[str, str]:
        valid = set(valid_slot_ids)
        assignments: dict[str, str] = {}
        for event in self.assignment_events:
            if event.slot_id not in valid:
                raise ValueError(f"assignment references unknown generated slot: {event.slot_id}")
            assignments[event.slot_id] = event.person_id
        return assignments

    def run(self, outcome_resolver: Optional[OutcomeResolver] = None) -> tuple[list[SlotRecord], dict[str, Fraction]]:
        balances = {person_id: Fraction(0) for person_id in self.people}
        consecutive: dict[tuple[str, str], int] = {}
        last_turn: dict[tuple[str, str], date] = {}
        records: list[SlotRecord] = []
        adjustments = sorted(
            self.adjustments,
            key=lambda event: (event.effective_date, event.event_id),
        )
        adjustment_index = 0

        slots = self.generate_slots()
        recorded_outcomes = self.resolved_outcomes(slot.id for slot in slots)
        recorded_assignments = self.recorded_assignments(slot.id for slot in slots)

        for slot in slots:
            while (
                adjustment_index < len(adjustments)
                and adjustments[adjustment_index].effective_date <= slot.date
            ):
                event = adjustments[adjustment_index]
                balances[event.person_id] += amount(event.delta)
                adjustment_index += 1

            rotation = self.rotation_at(slot.rotation_id, slot.date)
            active_roster = self.roster_at(rotation.id, slot.date)
            present_roster = tuple(
                person_id for person_id in active_roster
                if not self.is_absent(person_id, slot.date)
            )
            record = SlotRecord(
                slot=slot,
                rotation=rotation,
                active_roster=active_roster,
                accounting_roster=present_roster,
            )
            if not present_roster:
                record.outcome = "no_eligible"
                record.balances = dict(balances)
                records.append(record)
                continue

            eligible = tuple(
                person_id for person_id in present_roster
                if consecutive.get((rotation.id, person_id), 0) < rotation.max_consecutive
            ) or present_roster

            def selection_key(person_id: str) -> tuple[Fraction, int, int]:
                previous = last_turn.get((rotation.id, person_id))
                days_since = (slot.date - previous).days if previous else 1_000_000
                roster_order = active_roster.index(person_id)
                balance_key = -balances[person_id] if rotation.type == "burden" else balances[person_id]
                return balance_key, -days_since, roster_order

            recorded_assignee = recorded_assignments.get(slot.id)
            if recorded_assignee is not None:
                if recorded_assignee not in present_roster:
                    raise ValueError(
                        f"recorded assignee is not present in slot roster: {slot.id}"
                    )
                assignee = recorded_assignee
                record.assignment_source = "recorded"
            else:
                assignee = min(eligible, key=selection_key)
            record.assignee = assignee
            context = SlotContext(slot, rotation, active_roster, present_roster)
            recorded_outcome = recorded_outcomes.get(slot.id)
            if recorded_outcome is not None and outcome_resolver is not None:
                raise ValueError("cannot combine recorded outcomes with an outcome resolver")
            outcome = recorded_outcome
            if outcome is None and outcome_resolver is not None:
                outcome = outcome_resolver(context, assignee)
            outcome = outcome or Outcome()
            self._validate_outcome(outcome, assignee, active_roster, present_roster)

            signed = -self.weight_at(rotation, slot.date) if rotation.type == "burden" else self.weight_at(rotation, slot.date)
            taker: Optional[str]
            transaction = signed
            if outcome.kind == "trade":
                taker = outcome.coverer
                record.served_by = outcome.coverer
            elif outcome.kind == "outside_cover":
                taker = assignee
                transaction = -signed
                record.served_by = outcome.coverer
            elif outcome.kind == "excused":
                taker = None
                record.served_by = outcome.coverer
            else:
                taker = assignee
                record.served_by = assignee

            record.outcome = outcome.kind
            if taker is not None:
                share = transaction / len(present_roster)
                for person_id in present_roster:
                    record.deltas[person_id] = record.deltas.get(person_id, Fraction(0)) - share
                record.deltas[taker] = record.deltas.get(taker, Fraction(0)) + transaction
                for person_id, delta in record.deltas.items():
                    balances[person_id] += delta

            for person_id in active_roster:
                key = (rotation.id, person_id)
                consecutive[key] = consecutive.get(key, 0) + 1 if person_id == taker else 0
            if taker is not None:
                last_turn[(rotation.id, taker)] = slot.date

            record.balances = dict(balances)
            records.append(record)

        while adjustment_index < len(adjustments):
            event = adjustments[adjustment_index]
            if event.effective_date <= self.end:
                balances[event.person_id] += amount(event.delta)
            adjustment_index += 1
        return records, balances

    @staticmethod
    def _validate_outcome(
        outcome: Outcome,
        assignee: str,
        active_roster: tuple[str, ...],
        present_roster: tuple[str, ...],
    ) -> None:
        if outcome.kind == "as_scheduled":
            if outcome.coverer is not None:
                raise ValueError("as_scheduled outcome cannot specify a coverer")
            return
        if outcome.kind == "trade":
            if outcome.coverer is None:
                raise ValueError("trade requires a coverer")
            if outcome.coverer == assignee:
                raise ValueError("trade coverer must differ from assignee")
            if outcome.coverer not in active_roster:
                raise ValueError("trade coverer is not in the slot roster")
            if outcome.coverer not in present_roster:
                raise ValueError("trade coverer is absent")
            return
        if outcome.kind == "outside_cover":
            if outcome.coverer is not None and outcome.coverer in active_roster:
                raise ValueError("outside coverer must not be in the slot roster")
            return
        if outcome.kind == "excused":
            return
        raise ValueError(f"unknown outcome: {outcome.kind}")
