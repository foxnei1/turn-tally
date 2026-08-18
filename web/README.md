# TurnTally web app

The TurnTally client is a React and TypeScript app built with Vite. Tailwind handles styling, Vitest covers the pure domain and repository layers, and React Testing Library covers user interactions.

On first launch, enter at least two family members. The app will start a daily middle-seat rotation from the current local calendar date. Confirm the displayed turn or record another family member or adult as the person who covered it. Assignments, outcomes, balances, and recent history persist in `localStorage`.

## Commands

```powershell
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
npm run check
```

## Source boundaries

- `src/domain/rotation`: pure fairness and scheduling logic with no React or persistence imports
- `src/features`: family-facing workflows such as seating, chores, history, and profiles
- `src/data`: persistence contracts and adapters
- `src/components`: shared presentation components

## Prototype limits

- One fixed daily burden rotation: middle seat
- One browser only; no accounts or device sync
- Changing the family clears the prototype history
- No absence, roster-change, chore, or privilege controls yet
- Unreported past days are treated as completed as assigned
