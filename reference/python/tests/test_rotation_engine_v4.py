from __future__ import annotations

from datetime import date, timedelta
from fractions import Fraction
import random

import pytest

from rotation_engine_v4 import (
    Absence,
    Adjustment,
    AssignmentRecorded,
    Engine,
    Outcome,
    OutcomeConflictError,
    OutcomeRecorded,
    Person,
    RosterChanged,
    Rotation,
    RotationConfigChanged,
    WeightChanged,
)


START = date(2026, 1, 1)


def people(*ids: str) -> list[Person]:
    return [Person(person_id, person_id) for person_id in ids]


def daily_rotation(
    rotation_id: str = "daily",
    *,
    type: str = "burden",
    start: date = START,
    weight: int = 1,
    cap: int = 2,
    order: int = 0,
    restricted: bool = False,
) -> Rotation:
    return Rotation(
        rotation_id,
        rotation_id,
        type,
        "daily",
        start,
        weight,
        cap,
        order,
        restricted,
    )


def assignments(records, rotation_id: str = "daily") -> list[str | None]:
    return [record.assignee for record in records if record.rotation.id == rotation_id]


def test_every_slot_is_exactly_zero_sum_and_auditable() -> None:
    engine = Engine(
        people("A", "B", "C"),
        [daily_rotation()],
        {"daily": ["A", "B", "C"]},
        START + timedelta(days=29),
    )

    records, balances = engine.run()

    assert all(sum(record.deltas.values(), Fraction(0)) == 0 for record in records)
    assert sum(balances.values(), Fraction(0)) == 0
    assert all(set(record.deltas) == {"A", "B", "C"} for record in records)


def test_adjustments_are_the_only_source_of_non_zero_global_sum() -> None:
    adjustment = Adjustment("credit-a", START + timedelta(days=2), "A", "1.25", "manual credit")
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START + timedelta(days=5),
        adjustments=[adjustment],
    )

    _, balances = engine.run()

    assert sum(balances.values(), Fraction(0)) == Fraction(5, 4)


@pytest.mark.parametrize("rotation_type", ["burden", "privilege"])
def test_absent_people_are_frozen_not_charged(rotation_type: str) -> None:
    absence = Absence("a-away", "A", START, START + timedelta(days=9))
    engine = Engine(
        people("A", "B"),
        [daily_rotation(type=rotation_type)],
        {"daily": ["A", "B"]},
        START + timedelta(days=15),
        absences=[absence],
    )

    records, _ = engine.run()
    away_records = records[:10]
    return_records = records[10:]

    assert all(record.assignee == "B" for record in away_records)
    assert all(record.accounting_roster == ("B",) for record in away_records)
    assert all(record.deltas == {"B": Fraction(0)} for record in away_records)
    assert away_records[-1].balances == {"A": Fraction(0), "B": Fraction(0)}
    assert assignments(return_records) == ["A", "B", "A", "B", "A", "B"]


def test_absent_trade_recipient_is_rejected() -> None:
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
        absences=[Absence("b-away", "B", START, START)],
    )

    with pytest.raises(ValueError, match="absent"):
        engine.run(lambda _context, _assignee: Outcome("trade", "B"))


def test_restricted_rotation_never_posts_deltas_to_non_members() -> None:
    engine = Engine(
        people("A", "B", "C", "D"),
        [daily_rotation("perk", type="privilege", restricted=True)],
        {"perk": ["A", "B"]},
        START + timedelta(days=20),
    )

    records, balances = engine.run()

    assert all(set(record.deltas) <= {"A", "B"} for record in records)
    assert balances["C"] == balances["D"] == 0


def test_shared_balance_intentionally_can_change_other_rotation_assignments() -> None:
    members = people("A", "B", "C", "D")
    chore = Rotation("chore", "chore", "burden", "weekly", START, 1, 2, 1)
    baseline = Engine(members, [chore], {"chore": ["A", "B", "C", "D"]}, date(2026, 2, 28))
    perk = daily_rotation("perk", type="privilege", weight=3, order=0, restricted=True)
    combined = Engine(
        members,
        [perk, chore],
        {"perk": ["A", "B"], "chore": ["A", "B", "C", "D"]},
        date(2026, 2, 28),
    )

    baseline_records, _ = baseline.run()
    combined_records, _ = combined.run()

    assert assignments(baseline_records, "chore") == ["A", "B", "C", "D", "A", "B", "C", "D", "A"]
    assert assignments(combined_records, "chore") != assignments(baseline_records, "chore")


def test_trade_to_non_roster_member_is_rejected_even_if_unrestricted() -> None:
    engine = Engine(
        people("A", "B", "C"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
    )

    with pytest.raises(ValueError, match="not in the slot roster"):
        engine.run(lambda _context, _assignee: Outcome("trade", "C"))


def test_valid_trade_charges_the_coverer_and_preserves_zero_sum() -> None:
    engine = Engine(
        people("A", "B", "C"),
        [daily_rotation()],
        {"daily": ["A", "B", "C"]},
        START,
    )

    records, balances = engine.run(lambda _context, _assignee: Outcome("trade", "B"))

    assert records[0].assignee == "A"
    assert records[0].served_by == "B"
    assert records[0].deltas == {
        "A": Fraction(1, 3),
        "B": Fraction(-2, 3),
        "C": Fraction(1, 3),
    }
    assert sum(balances.values(), Fraction(0)) == 0


def test_outside_cover_flips_transaction_and_keeps_audit_zero_sum() -> None:
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
    )

    records, _ = engine.run(lambda _context, _assignee: Outcome("outside_cover", "parent"))

    assert records[0].assignee == "A"
    assert records[0].served_by == "parent"
    assert records[0].deltas == {"A": Fraction(1, 2), "B": Fraction(-1, 2)}


def test_max_consecutive_holds_when_outcomes_are_recorded() -> None:
    engine = Engine(
        people("A", "B", "C"),
        [daily_rotation(cap=2)],
        {"daily": ["A", "B", "C"]},
        START + timedelta(days=119),
    )

    records, _ = engine.run()
    sequence = assignments(records)

    assert all(not (sequence[index] == sequence[index + 1] == sequence[index + 2]) for index in range(len(sequence) - 2))


def test_single_member_empty_eligible_fallback_is_defined() -> None:
    engine = Engine(
        people("A"),
        [daily_rotation(cap=1)],
        {"daily": ["A"]},
        START + timedelta(days=3),
    )

    records, balances = engine.run()

    assert assignments(records) == ["A", "A", "A", "A"]
    assert balances == {"A": Fraction(0)}


def test_empty_roster_produces_no_eligible_records() -> None:
    engine = Engine(people("A"), [daily_rotation()], {"daily": []}, START + timedelta(days=2))

    records, balances = engine.run()

    assert [record.outcome for record in records] == ["no_eligible"] * 3
    assert balances == {"A": Fraction(0)}


def test_weight_changes_are_non_retroactive() -> None:
    change_date = START + timedelta(days=5)
    base = Engine(
        people("A", "B", "C"),
        [daily_rotation()],
        {"daily": ["A", "B", "C"]},
        START + timedelta(days=10),
    )
    changed = Engine(
        people("A", "B", "C"),
        [daily_rotation()],
        {"daily": ["A", "B", "C"]},
        START + timedelta(days=10),
        weight_events=[WeightChanged("heavier", change_date, "daily", 3)],
    )

    base_records, _ = base.run()
    changed_records, _ = changed.run()

    before = lambda records: [
        (record.slot, record.assignee, record.deltas, record.balances)
        for record in records if record.slot.date < change_date
    ]
    assert before(base_records) == before(changed_records)
    assert changed_records[5].deltas != base_records[5].deltas


def test_roster_churn_only_applies_inside_effective_window() -> None:
    events = [
        RosterChanged("add-c", START + timedelta(days=2), "daily", "C", "add"),
        RosterChanged("remove-c", START + timedelta(days=5), "daily", "C", "remove"),
    ]
    engine = Engine(
        people("A", "B", "C"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START + timedelta(days=7),
        roster_events=events,
    )

    records, _ = engine.run()

    assert all("C" not in record.active_roster for record in records[:2])
    assert all("C" in record.active_roster for record in records[2:5])
    assert all("C" not in record.active_roster for record in records[5:])


def test_replay_is_independent_of_input_event_order() -> None:
    members = people("A", "B", "C")
    rotations = [daily_rotation("second", order=1), daily_rotation("first", type="privilege", order=0)]
    events = [
        RosterChanged("02-remove", START + timedelta(days=6), "second", "C", "remove"),
        RosterChanged("01-add", START + timedelta(days=2), "first", "C", "add"),
    ]
    weights = [WeightChanged("02-weight", START + timedelta(days=7), "second", 3)]
    kwargs = dict(
        people=members,
        initial_roster={"first": ["A", "B"], "second": ["A", "B", "C"]},
        end=START + timedelta(days=20),
    )

    one = Engine(rotations=rotations, roster_events=events, weight_events=weights, **kwargs)
    two = Engine(rotations=list(reversed(rotations)), roster_events=list(reversed(events)), weight_events=list(reversed(weights)), **kwargs)

    assert one.run() == two.run()


def test_duplicate_event_ids_are_rejected() -> None:
    engine_args = (
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
    )

    with pytest.raises(ValueError, match="duplicate event id"):
        Engine(
            *engine_args,
            absences=[Absence("same", "A", START, START)],
            adjustments=[Adjustment("same", START, "B", 1, "duplicate")],
        )


def test_persisted_outcome_is_replayed_without_callback() -> None:
    event = OutcomeRecorded(
        "trade-recorded",
        "daily:2026-01-01",
        Outcome("trade", "B"),
    )
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
        outcome_events=[event],
    )

    records, _ = engine.run()

    assert records[0].assignee == "A"
    assert records[0].served_by == "B"
    assert records[0].outcome == "trade"


def test_recorded_assignment_anchors_the_assignee() -> None:
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
        adjustments=[Adjustment("favor-b", START, "B", 10, "would derive B")],
        assignment_events=[
            AssignmentRecorded("shown-a", "daily:2026-01-01", "A")
        ],
    )

    records, _ = engine.run()

    assert records[0].assignee == "A"
    assert records[0].assignment_source == "recorded"


def test_multiple_recorded_assignments_for_one_slot_are_rejected() -> None:
    with pytest.raises(ValueError, match="multiple recorded assignments"):
        Engine(
            people("A", "B"),
            [daily_rotation()],
            {"daily": ["A", "B"]},
            START,
            assignment_events=[
                AssignmentRecorded("phone-a", "daily:2026-01-01", "A"),
                AssignmentRecorded("phone-b", "daily:2026-01-01", "B"),
            ],
        )


def test_recorded_assignment_must_still_be_present_and_in_roster() -> None:
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
        absences=[Absence("a-away", "A", START, START)],
        assignment_events=[AssignmentRecorded("shown-a", "daily:2026-01-01", "A")],
    )

    with pytest.raises(ValueError, match="not present"):
        engine.run()


def test_concurrent_slot_outcomes_surface_a_conflict() -> None:
    events = [
        OutcomeRecorded("device-a", "daily:2026-01-01", Outcome("trade", "B")),
        OutcomeRecorded("device-b", "daily:2026-01-01", Outcome("outside_cover", "parent")),
    ]
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
        outcome_events=events,
    )

    with pytest.raises(OutcomeConflictError) as error:
        engine.run()

    assert error.value.event_ids == ("device-a", "device-b")


def test_one_correction_can_resolve_multiple_concurrent_outcomes() -> None:
    events = [
        OutcomeRecorded("device-a", "daily:2026-01-01", Outcome("trade", "B")),
        OutcomeRecorded("device-b", "daily:2026-01-01", Outcome("outside_cover", "parent")),
        OutcomeRecorded(
            "parent-resolution",
            "daily:2026-01-01",
            Outcome("excused"),
            ("device-a", "device-b"),
        ),
    ]
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
        outcome_events=list(reversed(events)),
    )

    records, balances = engine.run()

    assert records[0].outcome == "excused"
    assert records[0].deltas == {}
    assert balances == {"A": Fraction(0), "B": Fraction(0)}


def test_resolved_outcome_replay_is_stable_across_event_permutations() -> None:
    base_events = [
        OutcomeRecorded("phone-a", "daily:2026-01-01", Outcome("trade", "B")),
        OutcomeRecorded("phone-b", "daily:2026-01-01", Outcome("outside_cover", "parent")),
        OutcomeRecorded(
            "resolved",
            "daily:2026-01-01",
            Outcome("as_scheduled"),
            ("phone-a", "phone-b"),
        ),
    ]
    expected = None
    rng = random.Random(47)
    for _ in range(100):
        events = list(base_events)
        rng.shuffle(events)
        result = Engine(
            people("A", "B"),
            [daily_rotation()],
            {"daily": ["A", "B"]},
            START + timedelta(days=5),
            outcome_events=events,
        ).run()
        expected = result if expected is None else expected
        assert result == expected


def test_outcome_supersession_cycles_are_rejected() -> None:
    events = [
        OutcomeRecorded("a", "daily:2026-01-01", Outcome(), ("b",)),
        OutcomeRecorded("b", "daily:2026-01-01", Outcome(), ("a",)),
    ]
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START,
        outcome_events=events,
    )

    with pytest.raises(ValueError, match="supersession cycle"):
        engine.run()


def test_outcome_for_non_generated_slot_is_rejected() -> None:
    event = OutcomeRecorded("future", "daily:2030-01-01", Outcome())
    engine = Engine(
        people("A"),
        [daily_rotation()],
        {"daily": ["A"]},
        START,
        outcome_events=[event],
    )

    with pytest.raises(ValueError, match="unknown generated slot"):
        engine.run()


def test_future_configuration_changes_leave_prior_history_identical() -> None:
    change_date = START + timedelta(days=5)
    baseline = Engine(
        people("A", "B", "C"),
        [daily_rotation()],
        {"daily": ["A", "B", "C"]},
        START + timedelta(days=18),
    )
    changed = Engine(
        people("A", "B", "C"),
        [daily_rotation()],
        {"daily": ["A", "B", "C"]},
        START + timedelta(days=18),
        config_events=[
            RotationConfigChanged(
                "weekly-heavy",
                change_date,
                "daily",
                cadence="weekly",
                desirability=3,
                max_consecutive=1,
            )
        ],
    )

    baseline_records, _ = baseline.run()
    changed_records, _ = changed.run()

    baseline_prefix = [record for record in baseline_records if record.slot.date < change_date]
    changed_prefix = [record for record in changed_records if record.slot.date < change_date]
    assert baseline_prefix == changed_prefix
    assert [record.slot.date for record in changed_records] == [
        START,
        START + timedelta(days=1),
        START + timedelta(days=2),
        START + timedelta(days=3),
        START + timedelta(days=4),
        change_date,
        change_date + timedelta(days=7),
    ]
    assert changed_records[5].rotation.cadence == "weekly"
    assert changed_records[5].rotation.desirability == 3


def test_archive_and_reactivation_do_not_create_phantom_slots() -> None:
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START + timedelta(days=9),
        config_events=[
            RotationConfigChanged("archive", START + timedelta(days=3), "daily", active=False),
            RotationConfigChanged("resume", START + timedelta(days=7), "daily", active=True),
        ],
    )

    records, _ = engine.run()

    assert [record.slot.date for record in records] == [
        START,
        START + timedelta(days=1),
        START + timedelta(days=2),
        START + timedelta(days=7),
        START + timedelta(days=8),
        START + timedelta(days=9),
    ]


def test_retroactive_archive_surfaces_orphaned_outcome() -> None:
    engine = Engine(
        people("A", "B"),
        [daily_rotation()],
        {"daily": ["A", "B"]},
        START + timedelta(days=3),
        config_events=[
            RotationConfigChanged("archive", START + timedelta(days=1), "daily", active=False)
        ],
        outcome_events=[
            OutcomeRecorded("old-confirm", "daily:2026-01-03", Outcome("as_scheduled"))
        ],
    )

    with pytest.raises(ValueError, match="unknown generated slot"):
        engine.run()


def test_conflicting_same_day_configuration_is_rejected() -> None:
    events = [
        RotationConfigChanged("device-a", START, "daily", cadence="weekly"),
        RotationConfigChanged("device-b", START, "daily", cadence="daily"),
    ]

    with pytest.raises(ValueError, match="conflicting config events"):
        Engine(
            people("A"),
            [daily_rotation()],
            {"daily": ["A"]},
            START,
            config_events=events,
        )


def test_seeded_six_to_twenty_four_month_stress_matrix() -> None:
    """Broad invariant search across household, roster, cadence and weight shapes."""

    for seed in range(100):
        rng = random.Random(seed)
        person_ids = [f"P{index}" for index in range(rng.randint(2, 8))]
        members = people(*person_ids)
        duration = rng.randint(180, 730)
        rotations: list[Rotation] = []
        rosters: dict[str, list[str]] = {}
        for index in range(rng.randint(1, 5)):
            rotation_id = f"R{index}"
            cadence = rng.choice(["daily", "weekly"])
            rotations.append(
                Rotation(
                    rotation_id,
                    rotation_id,
                    rng.choice(["burden", "privilege"]),
                    cadence,
                    START + timedelta(days=rng.randint(0, 14)),
                    rng.randint(1, 5),
                    rng.randint(1, 4),
                    index,
                    rng.choice([True, False]),
                )
            )
            size = rng.randint(1, len(person_ids))
            rosters[rotation_id] = rng.sample(person_ids, size)

        absence_events = []
        for index in range(rng.randint(0, len(person_ids) * 2)):
            absence_start = START + timedelta(days=rng.randint(0, duration - 1))
            absence_events.append(
                Absence(
                    f"absence-{index}",
                    rng.choice(person_ids),
                    absence_start,
                    min(START + timedelta(days=duration), absence_start + timedelta(days=rng.randint(1, 30))),
                )
            )

        engine = Engine(
            members,
            rotations,
            rosters,
            START + timedelta(days=duration),
            absences=absence_events,
        )
        records, balances = engine.run()

        assert sum(balances.values(), Fraction(0)) == 0, f"seed={seed}"
        for record in records:
            assert sum(record.deltas.values(), Fraction(0)) == 0, f"seed={seed} slot={record.slot.id}"
            assert set(record.deltas) <= set(record.accounting_roster)
            if record.assignee is not None:
                assert record.assignee in record.accounting_roster
                assert not engine.is_absent(record.assignee, record.slot.date)


def test_systematic_dodger_is_corrected_when_outside_covers_are_logged() -> None:
    def run(logged: bool) -> tuple[int, int]:
        assigned = 0
        actually_served = 0

        def resolver(_context, assignee):
            nonlocal assigned, actually_served
            if assignee != "D":
                return None
            assigned += 1
            dodges = assigned % 10 not in (0, 8, 9)
            if not dodges:
                actually_served += 1
            if dodges and logged:
                return Outcome("outside_cover", "parent")
            return None

        engine = Engine(
            people("A", "B", "C", "D"),
            [daily_rotation(cap=2)],
            {"daily": ["A", "B", "C", "D"]},
            START + timedelta(days=83),
        )
        engine.run(resolver)
        return assigned, actually_served

    unlogged_assignments, unlogged_service = run(False)
    logged_assignments, logged_service = run(True)

    assert logged_assignments > unlogged_assignments
    assert logged_service > unlogged_service
