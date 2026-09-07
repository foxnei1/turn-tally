import { describe, expect, it } from 'vitest'
import { absenceSnapshot, addAbsence, endAbsence } from './absences'
import { changeActivityArchive, configureActivity, replayActivities } from './activities'
import { missingAssignmentEvents } from './engine'
import type { RotationEvent } from './events'
import type { AbsenceDraft, HouseholdConfiguration } from './types'
import { createBackup, parseBackup } from '../backups/backup'

const today = '2026-09-07'
const base: HouseholdConfiguration = {
  people: [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Sam' }, { id: 'c', name: 'Jo' }], startDate: today,
  rotation: { id: 'seat', name: 'Middle seat', type: 'burden', cadence: 'daily', roster: ['a', 'b', 'c'], desirability: 1, maxConsecutive: 2, order: 0, restricted: false },
}
const config = configureActivity(base, { name: 'Kitchen', cadence: 'weekly', roster: ['a', 'b', 'c'], startDate: today }, today, 'kitchen')
const draft: AbsenceDraft = { personId: 'a', activityIds: ['seat'], start: today, end: '2026-09-09' }
const pin = (configuration: HouseholdConfiguration, events: readonly RotationEvent[], day: string) => [...events, ...missingAssignmentEvents(replayActivities(configuration, events, day).flatMap((view) => view.records), events)]

describe('absence ranges', () => {
  it('includes both dates, freezes the absent balance, and keeps other activities independent', () => {
    const planned = addAbsence(config, draft, today, 'away')
    const views = replayActivities(planned, [], '2026-09-10')
    expect(views[0].records.slice(0, 3).map((record) => record.absentIds)).toEqual([['a'], ['a'], ['a']])
    expect(views[0].records.slice(0, 3).every((record) => !('a' in record.deltas) && record.balances.a === 0)).toBe(true)
    expect(views[0].records[3].absentIds).toEqual([])
    expect(views[1]).toEqual(replayActivities(config, [], '2026-09-10')[1])
    for (const record of views[0].records) expect(Object.values(record.deltas).reduce((sum, value) => sum + value, 0)).toBeCloseTo(0)
  })

  it('checks weekly attendance on the start date, including midweek returns and later boundaries', () => {
    const planned = addAbsence(config, { ...draft, activityIds: ['kitchen'], start: '2026-09-09', end: '2026-09-15' }, today, 'away')
    const weekly = replayActivities(planned, [], '2026-09-21')[1].records
    expect(weekly.map((record) => record.absentIds)).toEqual([[], ['a'], []])
    expect(weekly[1].date).toBe('2026-09-14')
    expect(weekly[1].deltas.a).toBeUndefined()
  })

  it('unions overlapping ranges and skips turns when too few people are available', () => {
    let planned = addAbsence(config, draft, today, 'away1')
    planned = addAbsence(planned, draft, today, 'away2')
    expect(replayActivities(planned, [], today)).toEqual(replayActivities(addAbsence(config, draft, today, 'single'), [], today))
    planned = addAbsence(planned, { ...draft, personId: 'b' }, today, 'away3')
    const seat = replayActivities(planned, [], today)[0].records[0]
    expect(seat.servedById).toBeNull()
    expect(seat.deltas).toEqual({})
    for (const id of ['a', 'b', 'c']) planned = addAbsence(planned, { ...draft, personId: id, activityIds: ['kitchen'] }, today, 'kitchen-' + id)
    expect(replayActivities(planned, [], today)[1].records[0].servedById).toBeNull()
  })

  it('updates today with a pinned replacement while preserving the original assignment and earlier records', () => {
    const day = '2026-09-08'
    const events = pin(config, [], day)
    const original = replayActivities(config, events, day)[0].records
    const planned = addAbsence(config, { ...draft, personId: original[1].assigneeId!, start: day }, day, 'away')
    const snapshot = absenceSnapshot(planned, events, day, () => 'range-outcome')
    const after = replayActivities(planned, snapshot.events, day)[0].records
    expect(after[0]).toEqual(original[0])
    expect(after[1].assigneeId).toBe(original[1].assigneeId)
    expect(after[1].servedById).not.toBe(original[1].servedById)
    expect(snapshot.events.at(-1)).toMatchObject({ source: 'absence-range', covererId: after[1].servedById })
    const corrected: RotationEvent = { type: 'outcome-recorded', eventId: 'older-fix', slotId: original[0].slotId, outcome: 'no-trip', supersedes: [] }
    expect(replayActivities(planned, [...snapshot.events, corrected], day)[0].records[1].servedById).toBe(after[1].servedById)
  })

  it('keeps explicit outcomes and attendance overrides, then resumes the plan next turn', () => {
    const events: RotationEvent[] = [...pin(config, [], today), { type: 'outcome-recorded', eventId: 'reported', slotId: 'seat:' + today, outcome: 'as-scheduled', absentIds: [], supersedes: [] }]
    const planned = addAbsence(config, draft, today, 'away')
    const snapshot = absenceSnapshot(planned, events, today, () => 'unused')
    expect(snapshot.events).toEqual(events)
    const records = replayActivities(planned, snapshot.events, '2026-09-08')[0].records
    expect(records[0].servedById).toBe('a')
    expect(records[0].absentIds).toEqual([])
    expect(records[1].absentIds).toEqual(['a'])
  })

  it('combines new ranges on an already replaced current turn', () => {
    let planned = addAbsence(config, draft, today, 'away1')
    const first = absenceSnapshot(planned, pin(config, [], today), today, () => 'replacement1')
    planned = addAbsence(planned, { ...draft, personId: 'b' }, today, 'away2')
    const second = absenceSnapshot(planned, first.events, today, () => 'replacement2')
    expect(second.events.at(-1)).toMatchObject({ supersedes: ['replacement1'], absentIds: ['a', 'b'] })
    expect(replayActivities(planned, second.events, today)[0].records[0].servedById).toBeNull()
  })

  it('applies a range to later enrollment without excluding a nonparticipant from earlier turns', () => {
    const activity = { ...config.activities![1], roster: ['b', 'c'], revisions: [{ effectiveDate: '2026-09-14', cadence: 'daily' as const, roster: ['a', 'b', 'c'] }] }
    const planned = addAbsence({ ...config, activities: [activity] }, { ...draft, activityIds: ['kitchen'], end: '2026-09-15' }, today, 'away')
    const records = replayActivities(planned, [], '2026-09-16')[0].records
    expect(records.map((record) => [record.date, record.absentIds])).toEqual([[today, []], ['2026-09-14', ['a']], ['2026-09-15', ['a']], ['2026-09-16', []]])
  })

  it('ends an ongoing absence prospectively and keeps a weekly turn in progress', () => {
    let planned = addAbsence(config, { ...draft, activityIds: ['seat', 'kitchen'], end: '2026-10-01' }, today, 'away')
    const events = pin(planned, [], '2026-09-09')
    const before = replayActivities(planned, events, '2026-09-09')
    planned = endAbsence(planned, 'away', '2026-09-09')
    expect(replayActivities(planned, events, '2026-09-09')).toEqual(before)
    const views = replayActivities(planned, events, '2026-09-14')
    expect(views[0].records[3].absentIds).toEqual([])
    expect(views[1].records.map((record) => record.absentIds)).toEqual([['a'], []])
    expect(() => endAbsence(planned, 'away', '2026-09-10')).toThrow('no remaining future days')
  })

  it('cancels future ranges, retains overlapping coverage, and skips archive gaps', () => {
    let planned = addAbsence(config, { ...draft, start: '2026-09-08', end: '2026-09-20' }, today, 'away1')
    planned = addAbsence(planned, { ...draft, start: '2026-09-08', end: '2026-09-20' }, today, 'away2')
    planned = endAbsence(planned, 'away1', today)
    expect(planned.absences?.map((range) => range.id)).toEqual(['away2'])
    expect(replayActivities(planned, [], '2026-09-08')[0].records[1].absentIds).toEqual(['a'])
    const events = pin(planned, [], today)
    planned = changeActivityArchive(planned, events, today, 'seat', true)
    planned = changeActivityArchive(planned, events, '2026-09-15', 'seat', false)
    expect(replayActivities(planned, events, '2026-09-15')[0].records.map((record) => [record.date, record.absentIds])).toEqual([[today, []], ['2026-09-15', ['a']]])
  })

  it('round-trips plans, recorded attendance, and current range corrections in backups', () => {
    const planned = addAbsence(config, { ...draft, activityIds: ['seat', 'kitchen'] }, today, 'away')
    let sequence = 0
    const snapshot = absenceSnapshot(planned, pin(config, [], today), today, () => 'range-' + ++sequence)
    const restored = parseBackup(createBackup(snapshot, today), '2026-09-10')
    expect(restored.configuration).toEqual(planned)
    expect(restored.events).toEqual(snapshot.events)
    expect(replayActivities(restored.configuration, restored.events, '2026-09-10')).toEqual(replayActivities(planned, snapshot.events, '2026-09-10'))
  })

  it.each([
    { start: '2026-09-06' }, { end: '2026-09-06' }, { start: '2026-02-30' },
    { activityIds: [] }, { activityIds: ['missing'] }, { activityIds: ['seat', 'seat'] }, { personId: 'missing' },
  ])('rejects an invalid plan %j', (change) => {
    expect(() => addAbsence(config, { ...draft, ...change }, today, 'away')).toThrow()
  })

  it('rejects plans for archived activities and inactive people', () => {
    expect(() => addAbsence(changeActivityArchive(config, [], today, 'seat', true), draft, today, 'away')).toThrow('active activity')
    expect(() => addAbsence({ ...config, people: config.people.map((person) => ({ ...person, active: false })) }, draft, today, 'away')).toThrow('active family member')
  })
})
