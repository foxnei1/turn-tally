# TurnTally web app

The TurnTally client is a React and TypeScript app built with Vite. Tailwind handles styling, Vitest covers the pure domain and repository layers, and React Testing Library covers user interactions.

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
