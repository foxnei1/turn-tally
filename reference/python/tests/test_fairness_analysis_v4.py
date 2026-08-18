from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from fractions import Fraction

import pytest

from rotation_engine_v4 import (
    AssignmentRecorded,
    Engine,
    Outcome,
    OutcomeRecorded,
    Person,
    Rotation,
)


START = date(2026, 1, 1)


def make_people(count: int) -> list[Person]:
    return [Person(f"P{index}", f"P{index}") for index in range(count)]


def count_served(records, rotation_id: str) -> dict[str, int]:
    counts = Counter(
        record.served_by
        for record in records
        if record.rotation.id == rotation_id and record.served_by is not None
    )
    return dict(counts)


@pytest.mark.parametrize("rotation_type", ["burden", "privilege"])
@pytest.mark.parametrize("household_size", range(2, 9))
def test_single_rotation_matches_round_robin_count_bound(
    rotation_type: str,
    household_size: int,
) -> None:
    members = make_people(household_size)
    rotation = Rotation(
        "turn",
        "turn",
        rotation_type,
        "daily",
        START,
        1,
        2,
    )
    engine = Engine(
        members,
        [rotation],
        {"turn": [person.id for person in members]},
        START + timedelta(days=729),
    )

    records, _ = engine.run()
    counts = count_served(records, "turn")

    assert max(counts.values()) - min(counts.values()) <= 1


def test_zero_exception_multi_rotation_is_not_each_rotations_pointer_sequence() -> None:
    """The shared ledger has a pointer-like floor globally, not per rotation."""

    members = make_people(3)
    rotations = [
        Rotation("r1", "r1", "burden", "daily", START, order=0),
        Rotation("r2", "r2", "burden", "daily", START, order=1),
    ]
    engine = Engine(
        members,
        rotations,
        {"r1": ["P0", "P1", "P2"], "r2": ["P0", "P1", "P2"]},
        START + timedelta(days=5),
    )

    records, balances = engine.run()
    r1 = [record.assignee for record in records if record.rotation.id == "r1"]
    r2 = [record.assignee for record in records if record.rotation.id == "r2"]

    assert r1 == ["P0", "P2", "P1", "P0", "P2", "P1"]
    assert r2 == ["P1", "P0", "P2", "P1", "P0", "P2"]
    assert r1 != ["P0", "P1", "P2"] * 2
    assert sum(balances.values(), Fraction(0)) == 0


def test_mixed_cadence_same_roster_stays_close_over_two_years() -> None:
    members = make_people(4)
    rotations = [
        Rotation("daily", "daily", "burden", "daily", START, 1, 2, 0),
        Rotation("weekly", "weekly", "burden", "weekly", START, 3, 2, 1),
    ]
    engine = Engine(
        members,
        rotations,
        {rotation.id: [person.id for person in members] for rotation in rotations},
        START + timedelta(days=729),
    )

    records, balances = engine.run()

    for rotation in rotations:
        counts = count_served(records, rotation.id)
        assert max(counts.values()) - min(counts.values()) <= 1
    assert max(balances.values()) - min(balances.values()) <= 3


def test_late_outcome_cannot_rewrite_subsequent_assignment_history() -> None:
    members = [Person("A", "A"), Person("B", "B")]
    rotation = Rotation("turn", "turn", "burden", "daily", START)
    baseline = Engine(
        members,
        [rotation],
        {"turn": ["A", "B"]},
        START + timedelta(days=5),
    )
    baseline_records, _ = baseline.run()
    assignment_events = [
        AssignmentRecorded(
            f"assignment-{record.slot.id}",
            record.slot.id,
            record.assignee,
        )
        for record in baseline_records
        if record.assignee is not None
    ]
    corrected = Engine(
        members,
        [rotation],
        {"turn": ["A", "B"]},
        START + timedelta(days=5),
        assignment_events=assignment_events,
        outcome_events=[
            OutcomeRecorded("late-trade", "turn:2026-01-01", Outcome("trade", "B"))
        ],
    )

    corrected_records, _ = corrected.run()

    assert [record.assignee for record in corrected_records[1:]] == [
        record.assignee for record in baseline_records[1:]
    ]


@pytest.mark.xfail(
    strict=True,
    reason="open policy: trading away every assigned privilege currently buys out of burdens without bound",
)
def test_forgoing_privileges_cannot_create_unbounded_buy_out() -> None:
    """Desired guardrail; retained as an expected failure until policy is chosen."""

    members = [Person(person_id, person_id) for person_id in "ABCD"]
    rotations = [
        Rotation("perk", "perk", "privilege", "daily", START, 1, 2, 0),
        Rotation("chore", "chore", "burden", "weekly", START, 3, 2, 1),
    ]

    def always_forgo(context, assignee):
        if context.rotation.id == "perk" and assignee == "D":
            return Outcome("trade", "A")
        return None

    engine = Engine(
        members,
        rotations,
        {rotation.id: list("ABCD") for rotation in rotations},
        START + timedelta(days=729),
    )

    records, balances = engine.run(always_forgo)
    chore_counts = count_served(records, "chore")

    assert max(chore_counts.values()) - min(chore_counts.values()) <= 10
    assert max(balances.values()) - min(balances.values()) <= 12
