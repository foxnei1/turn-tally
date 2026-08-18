import { describe, expect, it } from 'vitest'

import { missingAssignmentEvents, replayRotation } from './engine'
import type { RotationEvent } from './events'
import type { HouseholdConfiguration } from './types'

const configuration: HouseholdConfiguration = {
  people: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ],
  startDate: '2026-08-17',
  rotation: {
    id: 'middle-seat',
    name: 'Middle seat',
    type: 'burden',
    cadence: 'daily',
    desirability: 1,
    maxConsecutive: 2,
    order: 0,
    restricted: false,
    roster: ['a', 'b', 'c'],
  },
}

describe('replayRotation', () => {
  it('rotates a single equal-weight burden evenly and conserves the balance', () => {
    const replay = replayRotation({ configuration, events: [], endDate: '2026-08-25' })

    expect(replay.records.map((record) => record.assigneeId)).toEqual([
      'a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c',
    ])
    expect(Object.values(replay.balances).reduce((total, value) => total + value, 0)).toBeCloseTo(0)
  })

  it('credits a roster member who covered and validates the trade', () => {
    const events: RotationEvent[] = [{
      type: 'outcome-recorded',
      eventId: 'trade-1',
      slotId: 'middle-seat:2026-08-17',
      outcome: 'trade',
      covererId: 'b',
      supersedes: [],
    }]

    const replay = replayRotation({ configuration, events, endDate: '2026-08-17' })

    expect(replay.records[0].servedById).toBe('b')
    expect(replay.records[0].deltas).toEqual({ a: 1 / 3, b: -2 / 3, c: 1 / 3 })
  })

  it('flips a burden when an adult outside the roster covers', () => {
    const events: RotationEvent[] = [{
      type: 'outcome-recorded',
      eventId: 'adult-1',
      slotId: 'middle-seat:2026-08-17',
      outcome: 'outside-cover',
      supersedes: [],
    }]

    const replay = replayRotation({ configuration, events, endDate: '2026-08-17' })

    expect(replay.records[0].servedById).toBeNull()
    expect(replay.records[0].deltas).toEqual({ a: 2 / 3, b: -1 / 3, c: -1 / 3 })
  })

  it('keeps a displayed future assignment anchored after a late correction', () => {
    const baseline = replayRotation({ configuration, events: [], endDate: '2026-08-18' })
    const assignments = missingAssignmentEvents(baseline.records, [])
    const events: RotationEvent[] = [
      ...assignments,
      {
        type: 'outcome-recorded',
        eventId: 'late-trade',
        slotId: 'middle-seat:2026-08-17',
        outcome: 'trade',
        covererId: 'b',
        supersedes: [],
      },
    ]

    const corrected = replayRotation({ configuration, events, endDate: '2026-08-18' })

    expect(corrected.records[1].assigneeId).toBe(baseline.records[1].assigneeId)
    expect(corrected.records[1].assignmentSource).toBe('recorded')
  })

  it('uses an explicit replacement outcome and rejects unresolved conflicts', () => {
    const conflicts: RotationEvent[] = [
      { type: 'outcome-recorded', eventId: 'phone-a', slotId: 'middle-seat:2026-08-17', outcome: 'trade', covererId: 'b', supersedes: [] },
      { type: 'outcome-recorded', eventId: 'phone-b', slotId: 'middle-seat:2026-08-17', outcome: 'outside-cover', supersedes: [] },
    ]
    expect(() => replayRotation({ configuration, events: conflicts, endDate: '2026-08-17' })).toThrow('More than one outcome')

    const resolved: RotationEvent[] = [
      ...conflicts,
      { type: 'outcome-recorded', eventId: 'resolved', slotId: 'middle-seat:2026-08-17', outcome: 'as-scheduled', supersedes: ['phone-a', 'phone-b'] },
    ]
    expect(replayRotation({ configuration, events: resolved, endDate: '2026-08-17' }).records[0].outcome).toBe('as-scheduled')
  })

  it('never exceeds the configured consecutive-turn cap', () => {
    const replay = replayRotation({
      configuration: {
        ...configuration,
        rotation: { ...configuration.rotation, maxConsecutive: 1 },
      },
      events: [],
      endDate: '2026-09-30',
    })
    const assignments = replay.records.map((record) => record.assigneeId)

    expect(assignments.every((personId, index) => index === 0 || personId !== assignments[index - 1])).toBe(true)
  })

  it.each([2, 3, 4, 5, 6, 7, 8])(
    'stays within one turn of round robin for %i people over two years',
    (householdSize) => {
      const people = Array.from({ length: householdSize }, (_, index) => ({
        id: `p${index}`,
        name: `Person ${index}`,
      }))
      const replay = replayRotation({
        configuration: {
          people,
          startDate: '2026-01-01',
          rotation: {
            ...configuration.rotation,
            roster: people.map((person) => person.id),
          },
        },
        events: [],
        endDate: '2027-12-31',
      })
      const counts = Object.fromEntries(people.map((person) => [person.id, 0]))
      for (const record of replay.records) {
        counts[record.assigneeId] += 1
        expect(Object.values(record.deltas).reduce((total, delta) => total + delta, 0)).toBeCloseTo(0)
      }

      expect(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts))).toBeLessThanOrEqual(1)
    },
  )

  it('rejects a correction that names someone outside the rotation', () => {
    const events: RotationEvent[] = [{
      type: 'outcome-recorded',
      eventId: 'invalid-trade',
      slotId: 'middle-seat:2026-08-17',
      outcome: 'trade',
      covererId: 'not-a-member',
      supersedes: [],
    }]

    expect(() => replayRotation({ configuration, events, endDate: '2026-08-17' })).toThrow(
      'Trade coverer is not in the rotation roster',
    )
  })

  it('rejects supersession cycles instead of silently choosing an outcome', () => {
    const events: RotationEvent[] = [
      { type: 'outcome-recorded', eventId: 'a', slotId: 'middle-seat:2026-08-17', outcome: 'as-scheduled', supersedes: ['b'] },
      { type: 'outcome-recorded', eventId: 'b', slotId: 'middle-seat:2026-08-17', outcome: 'as-scheduled', supersedes: ['a'] },
    ]

    expect(() => replayRotation({ configuration, events, endDate: '2026-08-17' })).toThrow(
      'Outcome supersession contains a cycle',
    )
  })

  it('rejects events for slots outside the generated date range', () => {
    const events: RotationEvent[] = [{
      type: 'outcome-recorded',
      eventId: 'future',
      slotId: 'middle-seat:2030-01-01',
      outcome: 'as-scheduled',
      supersedes: [],
    }]

    expect(() => replayRotation({ configuration, events, endDate: '2026-08-17' })).toThrow(
      'Event references an unknown generated slot',
    )
  })
})
