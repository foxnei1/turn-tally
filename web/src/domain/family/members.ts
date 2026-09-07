import { householdActivities, replayActivities } from '../rotation/activities'
import type { RotationEvent } from '../rotation/events'
import { nextTurnDate, rotationAt } from '../rotation/schedule'
import type { CalendarDate, FamilyRole, HouseholdConfiguration, MemberDraft, PersonId } from '../rotation/types'

export const roleLabels: Record<FamilyRole, string> = {
  administrator: 'Parent · administrator', editor: 'Adult child · editor', viewer: 'Minor child · viewer',
}

export function canEdit(configuration: HouseholdConfiguration, actorId: PersonId | null): boolean {
  const actor = configuration.people.find((person) => person.id === actorId && person.active !== false)
  return configuration.rolesInitialized === true && (actor?.role === 'administrator' || actor?.role === 'editor')
}

export function canAdminister(configuration: HouseholdConfiguration, actorId: PersonId | null): boolean {
  return canEdit(configuration, actorId) && configuration.people.find((person) => person.id === actorId)?.role === 'administrator'
}

export function requirePermission(configuration: HouseholdConfiguration, actorId: PersonId | null, permission: 'edit' | 'administer') {
  if (!(permission === 'edit' ? canEdit(configuration, actorId) : canAdminister(configuration, actorId))) {
    throw new Error(permission === 'edit' ? 'This profile cannot make changes.' : 'Only an administrator can manage the family or reset its data.')
  }
}

function validateMember(configuration: HouseholdConfiguration, draft: MemberDraft, id: PersonId) {
  const name = draft.name.trim()
  if (!name || name.length > 60) throw new Error('Use a name between 1 and 60 characters.')
  if (configuration.people.some((person) => person.id !== id && person.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('Each family member needs a different name.')
  }
  if (!['administrator', 'editor', 'viewer'].includes(draft.role)) throw new Error('Choose a valid role.')
  return name
}

export function initializeRoles(configuration: HouseholdConfiguration, choice: { personId: PersonId } | { name: string }, newId: PersonId): { configuration: HouseholdConfiguration; administratorId: PersonId } {
  if (configuration.rolesInitialized) throw new Error('An administrator has already been set up.')
  const administratorId = 'personId' in choice ? choice.personId : newId
  if ('personId' in choice && !configuration.people.some((person) => person.id === choice.personId && person.active !== false)) {
    throw new Error('Choose an active family member.')
  }
  const people = configuration.people.map((person) => ({ ...person, role: person.id === administratorId ? 'administrator' as const : 'viewer' as const, active: person.active !== false }))
  if ('name' in choice) {
    const name = validateMember(configuration, { name: choice.name, role: 'administrator', active: true }, newId)
    people.push({ id: newId, name, role: 'administrator', active: true })
  }
  return { configuration: { ...configuration, people, rolesInitialized: true }, administratorId }
}

export function saveFamilyMember(configuration: HouseholdConfiguration, events: readonly RotationEvent[], today: CalendarDate, actorId: PersonId | null, draft: MemberDraft, id: PersonId, existing = false): HouseholdConfiguration {
  requirePermission(configuration, actorId, 'administer')
  const previous = configuration.people.find((person) => person.id === id)
  if (existing && !previous) throw new Error('This family member could not be found.')
  if (!existing && previous) throw new Error('This member already exists.')
  const name = validateMember(configuration, draft, id)
  const person = { ...(previous ?? {}), id, name, role: draft.role, active: draft.active }
  const people = existing ? configuration.people.map((member) => member.id === id ? person : member) : [...configuration.people, person]
  if (!people.some((member) => member.active !== false && member.role === 'administrator')) {
    throw new Error('Keep at least one active administrator. Add another administrator first.')
  }
  let activities = householdActivities(configuration)
  if (previous && previous.active !== false && !draft.active) {
    const views = replayActivities(configuration, events, today)
    activities = views.map(({ activity, records }) => {
      const current = records.at(-1)
      if (!current) {
        return { ...activity, roster: activity.roster.filter((memberId) => memberId !== id), revisions: activity.revisions?.map((revision) => ({ ...revision, roster: revision.roster.filter((memberId) => memberId !== id) })) }
      }
      const effectiveDate = nextTurnDate(current.date, current.rotation ?? activity)
      const next = rotationAt(activity, effectiveDate)
      return {
        ...activity,
        revisions: [
          ...(activity.revisions ?? []).filter((revision) => revision.effectiveDate < effectiveDate),
          { effectiveDate, cadence: next.cadence, roster: next.roster.filter((memberId) => memberId !== id) },
          ...(activity.revisions ?? []).filter((revision) => revision.effectiveDate > effectiveDate).map((revision) => ({ ...revision, roster: revision.roster.filter((memberId) => memberId !== id) })),
        ],
      }
    })
  }
  return { ...configuration, people, activities }
}
