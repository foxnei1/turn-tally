import { describe, expect, it } from 'vitest'
import { changeActivityArchive, configureActivity, isArchived, replayActivities } from './activities'
import { missingAssignmentEvents } from './engine'
import type { HouseholdConfiguration } from './types'

const configuration: HouseholdConfiguration = {
  people: [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Sam' }], startDate: '2026-09-07',
  rotation: { id: 'seat', name: 'Middle seat', type: 'burden', cadence: 'daily', desirability: 1, maxConsecutive: 2, order: 0, restricted: false, roster: ['a', 'b'] },
}

describe('activity lifecycle', () => {
  it('keeps today and its history, stops new turns, and resumes without counting the gap', () => {
    const baseline = replayActivities(configuration, [], '2026-09-07')[0]
    const events = missingAssignmentEvents(baseline.records, [])
    const archived = changeActivityArchive(configuration, events, '2026-09-07', 'seat', true)
    const paused = replayActivities(archived, events, '2026-09-20')[0]
    expect(isArchived(paused.activity)).toBe(true)
    expect(paused.records.map((record) => record.date)).toEqual(['2026-09-07'])
    expect(paused.balances).toEqual(baseline.balances)
    const restored = changeActivityArchive(archived, events, '2026-09-20', 'seat', false)
    const resumed = replayActivities(restored, events, '2026-09-20')[0]
    expect(resumed.records.map((record) => record.date)).toEqual(['2026-09-07', '2026-09-20'])
    expect(resumed.records[1].assigneeId).toBe('b')
  })

  it('keeps a weekly turn when restored within that week and resets the weekly start after a gap', () => {
    const config = configureActivity(configuration, { name: 'Kitchen', cadence: 'weekly', roster: ['a', 'b'], startDate: '2026-09-07' }, '2026-09-07', 'kitchen')
    const events = missingAssignmentEvents(replayActivities(config, [], '2026-09-09').flatMap((view) => view.records), [])
    const archived = changeActivityArchive(config, events, '2026-09-09', 'kitchen', true)
    const sameWeek = changeActivityArchive(archived, events, '2026-09-10', 'kitchen', false)
    expect(replayActivities(sameWeek, events, '2026-09-10')[1].records).toHaveLength(1)
    const restored = changeActivityArchive(archived, events, '2026-09-16', 'kitchen', false)
    expect(replayActivities(restored, events, '2026-09-23')[1].records.map((record) => record.date)).toEqual(['2026-09-07', '2026-09-16', '2026-09-23'])
    expect(replayActivities(restored, events, '2026-09-23')[0]).toEqual(replayActivities(config, events, '2026-09-23')[0])
  })

  it('supports repeated archive cycles and archiving before an activity starts', () => {
    const config = configureActivity(configuration, { name: 'Kitchen', cadence: 'weekly', roster: ['a'], startDate: '2026-10-01' }, '2026-09-07', 'kitchen')
    let next = changeActivityArchive(config, [], '2026-09-07', 'kitchen', true)
    expect(replayActivities(next, [], '2026-10-20')[1].records).toHaveLength(0)
    next = changeActivityArchive(next, [], '2026-09-10', 'kitchen', false)
    next = changeActivityArchive(next, [], '2026-09-11', 'kitchen', true)
    next = changeActivityArchive(next, [], '2026-10-20', 'kitchen', false)
    expect(replayActivities(next, [], '2026-10-20')[1].records.map((record) => record.date)).toEqual(['2026-10-20'])
  })
})
