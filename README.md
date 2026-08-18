# TurnTally

TurnTally helps families share chores, seating, and privileges fairly over time. Instead of following a fixed list, it keeps a running balance of what each person has done and received. It also accounts for absences, trades, missed turns, and changes to the family roster.

The project is currently in the concept and reference-engine stage.

## Project documents

- [Concept brief](family-app-concept-brief.md)
- [Original 12-week stress test](family-app-stress-test.md)
- [v4.2 validation findings](family-app-v4-validation.md)

## Reference implementation

`rotation_engine_v4.py` is the current Python reference engine. `rotation_engine.py` remains in the repository to reproduce findings from the earlier v3 design.

Run the test suite with:

```powershell
python -m pytest -q -rxX
```

The current expected result is 49 passing tests and one expected failure. The expected failure tracks the unresolved privilege buy-out policy described in the validation findings.
