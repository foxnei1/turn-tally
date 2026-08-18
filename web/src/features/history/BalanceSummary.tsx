import type { BalanceMap, Person } from '../../domain/rotation/types'

interface BalanceSummaryProps {
  balances: BalanceMap
  people: readonly Person[]
}

function formatBalance(value: number): string {
  const rounded = Math.abs(value) < 0.005 ? 0 : value
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`
}

export function BalanceSummary({ balances, people }: BalanceSummaryProps) {
  return (
    <details className="mt-6 rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <summary className="cursor-pointer font-semibold text-stone-800">Why this order?</summary>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        A higher balance means someone is more likely to receive the next middle-seat turn. A lower balance means they are owed a break.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {people.map((person) => (
          <div key={person.id} className="rounded-xl bg-stone-100 px-3 py-3">
            <dt className="truncate text-xs font-medium text-stone-500">{person.name}</dt>
            <dd className="mt-1 font-mono text-sm font-semibold text-stone-800">{formatBalance(balances[person.id] ?? 0)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
