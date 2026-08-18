import type { BalanceMap, LastTurnMap, PersonId, Rotation } from './types'

interface SelectAssigneeInput {
  rotation: Rotation
  eligible: readonly PersonId[]
  balances: BalanceMap
  lastTurn: LastTurnMap
}

export function selectAssignee({
  rotation,
  eligible,
  balances,
  lastTurn,
}: SelectAssigneeInput): PersonId | null {
  if (eligible.length === 0) {
    return null
  }

  const rosterOrder = new Map(rotation.roster.map((personId, index) => [personId, index]))

  return [...eligible].sort((left, right) => {
    const balanceDifference =
      rotation.type === 'burden'
        ? (balances[right] ?? 0) - (balances[left] ?? 0)
        : (balances[left] ?? 0) - (balances[right] ?? 0)

    if (balanceDifference !== 0) {
      return balanceDifference
    }

    const lastTurnDifference = (lastTurn[left] ?? '').localeCompare(lastTurn[right] ?? '')
    if (lastTurnDifference !== 0) {
      return lastTurnDifference
    }

    return (rosterOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (rosterOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
  })[0]
}
