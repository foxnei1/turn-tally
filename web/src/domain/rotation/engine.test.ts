import { describe, expect, it } from 'vitest'

import { selectAssignee } from './engine'
import type { Rotation } from './types'

const burden: Rotation = {
  id: 'middle-seat',
  name: 'Middle seat',
  type: 'burden',
  cadence: 'daily',
  desirability: 1,
  maxConsecutive: 2,
  order: 0,
  restricted: false,
  roster: ['a', 'b', 'c'],
}

describe('selectAssignee', () => {
  it('selects the highest balance for a burden', () => {
    expect(
      selectAssignee({
        rotation: burden,
        eligible: burden.roster,
        balances: { a: -1, b: 2, c: 0 },
        lastTurn: {},
      }),
    ).toBe('b')
  })

  it('selects the lowest balance for a privilege', () => {
    expect(
      selectAssignee({
        rotation: { ...burden, type: 'privilege' },
        eligible: burden.roster,
        balances: { a: -1, b: 2, c: 0 },
        lastTurn: {},
      }),
    ).toBe('a')
  })

  it('breaks ties by oldest turn and then roster order', () => {
    expect(
      selectAssignee({
        rotation: burden,
        eligible: burden.roster,
        balances: { a: 0, b: 0, c: 0 },
        lastTurn: { a: '2026-08-15', b: '2026-08-10', c: '2026-08-10' },
      }),
    ).toBe('b')
  })

  it('returns null when nobody is eligible', () => {
    expect(
      selectAssignee({
        rotation: burden,
        eligible: [],
        balances: {},
        lastTurn: {},
      }),
    ).toBeNull()
  })
})
