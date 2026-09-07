import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup } from './backup'
import { changeActivityArchive, replayActivities } from '../rotation/activities'
import { missingAssignmentEvents } from '../rotation/engine'
import type { HouseholdConfiguration } from '../rotation/types'

const configuration: HouseholdConfiguration = {
  rolesInitialized: true,
  people: [{ id: 'parent', name: 'Parent', role: 'administrator' }, { id: 'a', name: 'Alex', role: 'editor' }, { id: 'b', name: 'Sam', role: 'viewer', active: false }],
  startDate: '2026-09-07', rotation: { id: 'seat', name: 'Middle seat', type: 'burden', cadence: 'daily', desirability: 1, maxConsecutive: 2, order: 0, restricted: false, roster: ['a', 'b'] },
}
const events = missingAssignmentEvents(replayActivities(configuration, [], '2026-09-07')[0].records, [])
const source = () => JSON.parse(createBackup({ configuration, events }, '2026-09-07'))

describe('versioned backups', () => {
  it('round-trips roles, inactive members, archived periods, and original records', () => {
    const archived = changeActivityArchive(configuration, events, '2026-09-07', 'seat', true)
    const text = createBackup({ configuration: archived, events }, '2026-09-07')
    const restored = parseBackup(text, '2026-09-20')
    expect(restored.configuration).toEqual(archived)
    expect(restored.events).toEqual(events)
    expect(replayActivities(restored.configuration, restored.events, '2026-09-20')[0].records).toHaveLength(1)
  })

  it.each([
    ['unsupported version', (data: ReturnType<typeof source>) => { data.version = 2 }],
    ['bad role', (data: ReturnType<typeof source>) => { data.configuration.people[0].role = 'owner' }],
    ['no administrator', (data: ReturnType<typeof source>) => { data.configuration.people[0].active = false }],
    ['unknown participant', (data: ReturnType<typeof source>) => { data.configuration.rotation.roster = ['missing'] }],
    ['invalid cadence', (data: ReturnType<typeof source>) => { data.configuration.rotation.cadence = 'monthly' }],
    ['bad date', (data: ReturnType<typeof source>) => { data.configuration.startDate = '2026-02-30' }],
    ['unknown activity history', (data: ReturnType<typeof source>) => { data.events[0].slotId = 'missing:2026-09-07' }],
    ['duplicate event', (data: ReturnType<typeof source>) => { data.events.push(data.events[0]) }],
    ['unsupported event', (data: ReturnType<typeof source>) => { data.events[0].type = 'adjustment-recorded' }],
    ['invalid number', (data: ReturnType<typeof source>) => { data.configuration.rotation.desirability = -5 }],
    ['prototype key', (data: ReturnType<typeof source>) => { data.configuration.people[0].id = '__proto__' }],
    ['invalid recorded attendance', (data: ReturnType<typeof source>) => { data.events[0].absentIds = ['missing'] }],
    ['duplicate recorded attendance', (data: ReturnType<typeof source>) => { data.events[0].absentIds = ['a', 'a'] }],
  ])('rejects %s before replacement', (_, mutate) => {
    const data = source(); mutate(data)
    expect(() => parseBackup(JSON.stringify(data), '2026-09-07')).toThrow()
  })

  it('rejects malformed JSON, unresolved outcomes, and broken replacement references', () => {
    expect(() => parseBackup('{', '2026-09-07')).toThrow('not valid JSON')
    const data = source()
    data.events.push({ type: 'outcome-recorded', eventId: 'fix', slotId: 'seat:2026-09-07', outcome: 'no-trip', supersedes: ['missing'] })
    expect(() => parseBackup(JSON.stringify(data), '2026-09-07')).toThrow('unknown event')
    data.events.at(-1).supersedes = []
    data.events.push({ ...data.events.at(-1), eventId: 'conflict' })
    expect(() => parseBackup(JSON.stringify(data), '2026-09-07')).toThrow('More than one outcome')
  })

  it.each([
    { personId: 'missing' }, { activityIds: ['missing'] }, { activityIds: [] },
    { start: '2026-02-30' }, { end: '2026-09-01' }, { id: '__proto__' },
  ])('rejects invalid absence data %j', (change) => {
    const data = source()
    data.configuration.absences = [{ id: 'away', personId: 'a', activityIds: ['seat'], start: '2026-09-08', end: '2026-09-10', ...change }]
    expect(() => parseBackup(JSON.stringify(data), '2026-09-07')).toThrow()
  })

  it('rejects duplicate absence IDs', () => {
    const data = source()
    const range = { id: 'away', personId: 'a', activityIds: ['seat'], start: '2026-09-08', end: '2026-09-10' }
    data.configuration.absences = [range, range]
    expect(() => parseBackup(JSON.stringify(data), '2026-09-07')).toThrow('unique IDs')
  })
})
