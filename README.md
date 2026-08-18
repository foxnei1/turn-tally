# TurnTally

TurnTally helps families share chores, seating, and privileges fairly over time. Instead of following a fixed list, it keeps a running balance of what each person has done and received. It also accounts for absences, trades, missed turns, and changes to the family roster.

The repository contains the React web app and the Python model used to validate its fairness rules.

## Project documents

- [Concept brief](docs/concept.md)
- [Original 12-week stress test](docs/stress-test-v3.md)
- [v4.2 validation findings](docs/validation-v4.md)

## Web app

```powershell
cd web
npm install
npm run dev
```

Run all web checks with:

```powershell
npm run check
```

## Python reference implementation

`reference/python/rotation_engine_v4.py` is the current Python reference engine. `reference/python/rotation_engine_v3.py` remains in the repository to reproduce findings from the earlier design.

Run the test suite with:

```powershell
python -m pytest -q -rxX
```

The current expected result is 49 passing tests and one expected failure. The expected failure tracks the unresolved privilege buy-out policy described in the validation findings.

## Repository layout

- `web`: React, Vite, TypeScript, Tailwind, and Vitest
- `reference/python`: Python reference engines and stress tests
- `docs`: product concept and validation findings
- `.github/workflows`: continuous integration
