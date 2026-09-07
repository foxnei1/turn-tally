# TurnTally

TurnTally remembers whose turn it is and adjusts when someone else takes a turn. Families can share the middle seat and configure daily or weekly chores, including kitchen duty and room cleaning. Each activity keeps its own turns and history.

The repository contains the React web app and historical Python models of an earlier fairness policy.

## Project documents

- [Concept brief](docs/concept.md)
- [September iteration](docs/iteration-september-2026.md)
- [Cloudflare pilot setup](docs/cloudflare-pilot.md)
- [Supabase backend setup](docs/supabase-backend.md)
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

## Hosted pilot

The pilot is deployed at [turntally-pilot.turntally-family.workers.dev](https://turntally-pilot.turntally-family.workers.dev), with Supabase email/password sign-in and shared household data. Accounts require explicit provisioning; public signup is disabled. Use **Refresh** to load another device's changes. Conflicting saves are rejected and the attempted version can be downloaded. See the [backend setup](docs/supabase-backend.md) for provisioning and remaining viewer-device, recovery, offline, and validation work.

## Local prototype

The browser prototype shows all current activities and their assigned people. Use **Add activity** to choose a suggested chore or enter your own, select participants, choose daily or weekly turns, and set the first person and start date. **Edit activity** changes names immediately and applies schedule or participant changes at the next turn. Earlier history is preserved.

Unchanged turns count automatically. Each activity has corrections, absence reporting, an assignment explanation, and history. Weekly chores last seven days from their start date. Data stays in local browser storage, and existing seating-only data loads without a reset.

Use **Family** to add, rename, deactivate/reactivate members, and assign roles. Parents administer the family, adult children edit activities, and minor children view only. Existing households explicitly choose an administrator on upgrade. Deactivation preserves earlier turns and removes future participation. The local profile selector previews these roles; authenticated sign-in and server enforcement will arrive with hosting and sync.

Archive activities to retire them without losing history, and restore them from **Archived activities**. Use **Backups** to download the complete family as a JSON file. Administrators can preview and confirm a replacement from a backup; an empty browser can restore during setup. Storage updates commit configuration and history together so a failed import leaves previous data intact.

Data is currently limited to one browser. Use **Set up a different family** only when you intend to clear the local prototype history.

Use **Absences** to plan time away across selected activities. Dates are inclusive; weekly chores check attendance on their first day. Editors can cancel future absences or end ongoing ones after today, preserving recorded turns. Backups include these plans. See the [roadmap](docs/roadmap.md) for hosting and sync next, and the new History calendar item 7.

## Repository layout

- `web`: React, Vite, TypeScript, Tailwind, and Vitest
- `reference/python`: Python reference engines and stress tests
- `docs`: product concept and validation findings
- `.github/workflows`: continuous integration
