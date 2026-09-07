# TurnTally

TurnTally remembers whose turn it is and adjusts when someone else takes a turn. Families can share the middle seat and configure daily or weekly chores, including kitchen duty and room cleaning. Each activity keeps its own turns and history.

The repository contains the React web app and historical Python models of an earlier fairness policy.

## Project documents

- [Concept brief](docs/concept.md)
- [September iteration](docs/iteration-september-2026.md)
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

`reference/python/rotation_engine_v4.py` validates the historical v4.2 shared-balance policy. `reference/python/rotation_engine_v3.py` reproduces earlier findings. These are not the policy contract for the current web iteration; see the [current concept](docs/concept.md).

Run the test suite with:

```powershell
python -m pytest -q -rxX
```

The current expected result is 49 passing tests and one expected failure. The expected failure tracks the unresolved privilege buy-out policy described in the validation findings.

## Current prototype

The browser prototype shows all current activities and their assigned people. Use **Add activity** to choose a suggested chore or enter your own, select participants, choose daily or weekly turns, and set the first person and start date. **Edit activity** changes names immediately and applies schedule or participant changes at the next turn. Earlier history is preserved.

Unchanged turns count automatically. Each activity has corrections, absence reporting, an assignment explanation, and history. Weekly chores last seven days from their start date. Data stays in local browser storage, and existing seating-only data loads without a reset.

Use **Family** to add, rename, deactivate/reactivate members, and assign roles. Parents administer the family, adult children edit activities, and minor children view only. Existing households explicitly choose an administrator on upgrade. Deactivation preserves earlier turns and removes future participation. The local profile selector previews these roles; authenticated sign-in and server enforcement will arrive with hosting and sync.

Data is currently limited to one browser. Use **Set up a different family** only when you intend to clear the local prototype history.

## Repository layout

- `web`: React, Vite, TypeScript, Tailwind, and Vitest
- `reference/python`: Python reference engines and stress tests
- `docs`: product concept and validation findings
- `.github/workflows`: continuous integration
