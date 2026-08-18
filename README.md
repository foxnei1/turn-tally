# TurnTally

TurnTally helps families share chores, seating, and privileges fairly over time. Instead of following a fixed list, it keeps a running balance of what each person has done and received. It also accounts for absences, trades, missed turns, and changes to the family roster.

The repository contains the React web app and the Python model used to validate its fairness rules.

## Project documents

- [Concept brief](docs/concept.md)
- [Original 12-week stress test](docs/stress-test-v3.md)
- [v4.2 validation findings](docs/validation-v4.md)
- [Browser prototype findings](docs/browser-prototype-findings.md)

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

## Current prototype

The browser prototype supports a fixed family roster for a daily middle-seat rotation. It calculates and stores each displayed assignment, accepts confirmations and corrections, shows recent history and balances, and restores everything from local browser storage.

Data is currently limited to one browser. Use **Set up a different family** only when you intend to clear the local prototype history.

## Repository layout

- `web`: React, Vite, TypeScript, Tailwind, and Vitest
- `reference/python`: Python reference engines and stress tests
- `docs`: product concept and validation findings
- `.github/workflows`: continuous integration
