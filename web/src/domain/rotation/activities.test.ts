import { describe, expect, it } from 'vitest'

import { configureActivity, householdActivities, replayActivities } from './activities'
import { missingAssignmentEvents } from './engine'
import type { RotationEvent } from './events'
import type { ActivityDraft, HouseholdConfiguration } from './types'

const configuration: HouseholdConfiguration = {
  people: [{ id: 'a', name: 'Elena' }, { id: 'b', name: 'Priya' }, { id: 'c', name: 'Sam' }],
  startDate: '2026-09-06',
  rotation: { id: 'middle-seat', name: 'Middle seat', type: 'burden', cadence: 'daily', roster: ['a', 'b', 'c'], desirability: 1, maxConsecutive: 2, order: 0, restricted: false },
}
const bathroom: ActivityDraft = { name: 'Bathroom cleaning', cadence: 'weekly', roster: ['b', 'c'], startDate: '2026-09-06' }

describe('independent activities', () => {
  it('keeps legacy seating history when a weekly chore is added', () => {
    const baseline = replayActivities(configuration, [], '2026-09-12')
    const assignments = missingAssignmentEvents(baseline.flatMap((view) => view.records), [])
    const expanded = configureActivity(configuration, bathroom, '2026-09-06', 'bathroom')
    const views = replayActivities(expanded, assignments, '2026-09-12')
    expect(views[0].records.map((record) => record.servedById)).toEqual(baseline[0].records.map((record) => record.servedById))
    expect(views[0].balances).toEqual(baseline[0].balances)
    expect(views[1].records).toHaveLength(1)
    expect(views[1].records[0].servedById).toBe('b')
    expect(replayActivities(expanded, assignments, '2026-09-13')[1].records.at(-1)?.servedById).toBe('c')
  })

  it('isolates corrections, absences, and balances to their own activity', () => {
    const expanded = configureActivity(configuration, bathroom, '2026-09-06', 'bathroom')
    const baseline = replayActivities(expanded, [], '2026-09-20')
    const events: RotationEvent[] = [
      { type: 'assignment-recorded', eventId: 'assigned', slotId: 'bathroom:2026-09-06', personId: 'b' },
      { type: 'outcome-recorded', eventId: 'covered', slotId: 'bathroom:2026-09-06', outcome: 'trade', covererId: 'c', absentIds: ['b'], supersedes: [] },
    ]
    const corrected = replayActivities(expanded, events, '2026-09-20')
    expect(corrected[0]).toEqual(baseline[0])
    expect(corrected[1].records[0].servedById).toBe('c')
    expect(corrected[1].records[0].balances.b).toBe(0)
    expect(corrected[1].records[0].explanation).toContain('handled the chore')
  })

  it('applies cadence and roster edits only at the next weekly boundary', () => {
    const expanded = configureActivity(configuration, bathroom, '2026-09-06', 'bathroom')
    const baseline = replayActivities(expanded, [], '2026-09-09')
    const assignments = missingAssignmentEvents(baseline.flatMap((view) => view.records), [])
    const updated = configureActivity(expanded, { ...bathroom, name: 'Upstairs bathroom', cadence: 'daily', roster: ['a', 'c'] }, '2026-09-09', 'bathroom', baseline[1])
    const views = replayActivities(updated, assignments, '2026-09-15')
    expect(views[1].records.map((record) => record.date)).toEqual(['2026-09-06', '2026-09-13', '2026-09-14', '2026-09-15'])
    expect(views[1].records[0]).toMatchObject({ servedById: 'b', rotation: { roster: ['b', 'c'], cadence: 'weekly' } })
    expect(views[1].records.slice(1).every((record) => record.servedById !== 'b')).toBe(true)
    expect(views[1].records[1].rotation?.roster).toEqual(['a', 'c'])
    expect(views[1].records[0].balances).toEqual(baseline[1].records[0].balances)
  })

  it('allows historical corrections against the original roster after a roster edit', () => {
    const expanded = configureActivity(configuration, bathroom, '2026-09-06', 'bathroom')
    const baseline = replayActivities(expanded, [], '2026-09-09')
    const updated = configureActivity(expanded, { ...bathroom, roster: ['a', 'c'] }, '2026-09-09', 'bathroom', baseline[1])
    const events: RotationEvent[] = [{ type: 'outcome-recorded', eventId: 'cover', slotId: 'bathroom:2026-09-06', outcome: 'trade', covererId: 'c', supersedes: [] }]
    expect(replayActivities(updated, events, '2026-09-20')[1].records[0].servedById).toBe('c')
  })

  it('starts a future chore without backfilling earlier turns', () => {
    const expanded = configureActivity(configuration, { ...bathroom, startDate: '2026-09-10' }, '2026-09-06', 'bathroom')
    expect(replayActivities(expanded, [], '2026-09-09')[1].records).toHaveLength(0)
    expect(replayActivities(expanded, [], '2026-09-10')[1].records[0].date).toBe('2026-09-10')
  })

  it('supports one-person chores and skips them when nobody is available', () => {
    const expanded = configureActivity(configuration, { ...bathroom, roster: ['a'] }, '2026-09-06', 'bathroom')
    expect(replayActivities(expanded, [], '2026-09-06')[1].records[0].servedById).toBe('a')
    const events: RotationEvent[] = [{ type: 'outcome-recorded', eventId: 'away', slotId: 'bathroom:2026-09-06', outcome: 'absence', absentIds: ['a'], supersedes: [] }]
    const record = replayActivities(expanded, events, '2026-09-06')[1].records[0]
    expect(record.servedById).toBeNull()
    expect(Object.values(record.balances)).toEqual([0, 0, 0])
  })

  it.each([
    { ...bathroom, name: '  ' },
    { ...bathroom, name: 'middle SEAT' },
    { ...bathroom, roster: [] },
    { ...bathroom, roster: ['unknown'] },
    { ...bathroom, startDate: '2026-09-05' },
  ])('rejects invalid configuration: %j', (draft) => {
    expect(() => configureActivity(configuration, draft, '2026-09-06', 'bathroom')).toThrow()
  })

  it('replaces pending settings without altering earlier revisions', () => {
    const expanded = configureActivity(configuration, bathroom, '2026-09-06', 'bathroom')
    const edited = configureActivity(expanded, { ...bathroom, cadence: 'daily' }, '2026-09-08', 'bathroom', replayActivities(expanded, [], '2026-09-08')[1])
    const updated = configureActivity(edited, { ...bathroom, roster: ['a', 'c'] }, '2026-09-09', 'bathroom', replayActivities(edited, [], '2026-09-09')[1])
    expect(householdActivities(updated)[1].revisions).toEqual([{ effectiveDate: '2026-09-13', cadence: 'weekly', roster: ['a', 'c'] }])
  })
})
