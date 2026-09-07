import { describe, expect, it } from 'vitest'
import { canAdminister, canEdit, initializeRoles, saveFamilyMember } from './members'
import { configureActivity, householdActivities, replayActivities } from '../rotation/activities'
import { missingAssignmentEvents } from '../rotation/engine'
import type { HouseholdConfiguration, MemberDraft } from '../rotation/types'

const family: HouseholdConfiguration = {
  rolesInitialized: true,
  people: [
    { id: 'parent', name: 'Parent', role: 'administrator', active: true },
    { id: 'adult', name: 'Alex', role: 'editor', active: true },
    { id: 'child', name: 'Sam', role: 'viewer', active: true },
  ],
  startDate: '2026-09-07',
  rotation: { id: 'middle-seat', name: 'Middle seat', type: 'burden', cadence: 'daily', roster: ['adult', 'child'], desirability: 1, maxConsecutive: 2, order: 0, restricted: false },
}
const adult: MemberDraft = { name: 'Alex', role: 'editor', active: true }

describe('family membership', () => {
  it('explicitly adds an administrator outside the existing rotations during upgrade', () => {
    const legacy = { ...family, rolesInitialized: undefined, people: family.people.slice(1).map(({ id, name }) => ({ id, name })) }
    const initialized = initializeRoles(legacy, { name: 'Mom' }, 'mom')
    expect(initialized.administratorId).toBe('mom')
    expect(initialized.configuration.rotation).toEqual(legacy.rotation)
    expect(initialized.configuration.people.map((person) => person.role)).toEqual(['viewer', 'viewer', 'administrator'])
    expect(() => initializeRoles(initialized.configuration, { personId: 'child' }, 'unused')).toThrow('already been set up')
    expect(canEdit(legacy, 'adult')).toBe(false)
  })

  it('never infers administrative authority from starting order', () => {
    const legacy = { ...family, rolesInitialized: false }
    const initialized = initializeRoles(legacy, { personId: 'child' }, 'unused').configuration
    expect(canAdminister(initialized, 'child')).toBe(true)
    expect(canAdminister(initialized, 'parent')).toBe(false)
  })

  it('keeps activity participation separate when adding a member', () => {
    const updated = saveFamilyMember(family, [], '2026-09-07', 'parent', { name: 'Taylor', role: 'viewer', active: true }, 'new')
    expect(updated.people.at(-1)).toMatchObject({ id: 'new', role: 'viewer', active: true })
    expect(householdActivities(updated)[0].roster).toEqual(['adult', 'child'])
  })

  it('renames a member without replacing their identity or outcomes', () => {
    const records = replayActivities(family, [], '2026-09-08')[0].records
    const events = missingAssignmentEvents(records, [])
    const updated = saveFamilyMember(family, events, '2026-09-08', 'parent', { ...adult, name: 'Alexandra' }, 'adult', true)
    expect(updated.people.find((person) => person.id === 'adult')?.name).toBe('Alexandra')
    expect(replayActivities(updated, events, '2026-09-08')[0].records.map((record) => record.assigneeId)).toEqual(records.map((record) => record.assigneeId))
  })

  it('deactivates prospectively at daily and weekly boundaries while preserving pending changes', () => {
    const chores = configureActivity(family, { name: 'Kitchen', cadence: 'weekly', roster: ['adult'], startDate: '2026-09-07' }, '2026-09-07', 'kitchen')
    const baseline = replayActivities(chores, [], '2026-09-09')
    const events = missingAssignmentEvents(baseline.flatMap((view) => view.records), [])
    const edited = configureActivity(chores, { name: 'Kitchen', cadence: 'daily', roster: ['adult'], startDate: '2026-09-07' }, '2026-09-09', 'kitchen', baseline[1])
    const updated = saveFamilyMember(edited, events, '2026-09-09', 'parent', { ...adult, active: false }, 'adult', true)
    expect(canEdit(updated, 'adult')).toBe(false)
    const sameDay = replayActivities(updated, events, '2026-09-09')
    expect(sameDay.map((view) => view.records.map((record) => record.servedById))).toEqual(baseline.map((view) => view.records.map((record) => record.servedById)))
    const future = replayActivities(updated, events, '2026-09-15')
    expect(future[0].records.find((record) => record.date === '2026-09-10')?.assigneeId).toBeNull()
    expect(future[1].records.map((record) => record.date)).toEqual(['2026-09-07', '2026-09-14', '2026-09-15'])
    expect(future[1].records.at(-1)?.assigneeId).toBeNull()
    expect(future[1].records[0].servedById).toBe('adult')
    const restored = saveFamilyMember(updated, events, '2026-09-09', 'parent', adult, 'adult', true)
    expect(householdActivities(restored)[1].revisions?.at(-1)?.roster).toEqual([])
  })

  it.each(['editor', 'viewer'] as const)('protects the last administrator against demotion to %s', (role) => {
    expect(() => saveFamilyMember(family, [], '2026-09-07', 'parent', { name: 'Parent', role, active: true }, 'parent', true)).toThrow('at least one active administrator')
  })

  it('protects the last administrator against deactivation', () => {
    expect(() => saveFamilyMember(family, [], '2026-09-07', 'parent', { name: 'Parent', role: 'administrator', active: false }, 'parent', true)).toThrow('at least one active administrator')
  })

  it('allows an administrator handoff', () => {
    const updated = saveFamilyMember(family, [], '2026-09-07', 'parent', { ...adult, role: 'administrator' }, 'adult', true)
    const handoff = saveFamilyMember(updated, [], '2026-09-07', 'parent', { name: 'Parent', role: 'viewer', active: true }, 'parent', true)
    expect(canAdminister(handoff, 'adult')).toBe(true)
    expect(canEdit(handoff, 'parent')).toBe(false)
  })

  it('handles deactivation before a future one-person activity starts', () => {
    const future = configureActivity(family, { name: 'Kitchen', cadence: 'weekly', roster: ['adult'], startDate: '2026-10-01' }, '2026-09-07', 'kitchen')
    const updated = saveFamilyMember(future, [], '2026-09-07', 'parent', { ...adult, active: false }, 'adult', true)
    expect(replayActivities(updated, [], '2026-10-01')[1].records[0].assigneeId).toBeNull()
    expect(() => configureActivity(updated, { name: 'Bathroom', cadence: 'daily', roster: ['adult'], startDate: '2026-09-07' }, '2026-09-07', 'bathroom')).toThrow('Choose at least one')
  })

  it.each(['adult', 'child', 'missing', null])('rejects family edits by %s', (actor) => {
    expect(() => saveFamilyMember(family, [], '2026-09-07', actor, adult, 'adult', true)).toThrow('Only an administrator')
  })
})
