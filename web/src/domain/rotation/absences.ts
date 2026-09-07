import { isMatch } from 'date-fns'
import { householdActivities, isArchived, replayActivities } from './activities'
import { getActiveOutcomeIds, missingAssignmentEvents } from './engine'
import type { OutcomeRecorded, RotationEvent } from './events'
import type { AbsenceDraft, CalendarDate, HouseholdConfiguration } from './types'

export function addAbsence(configuration: HouseholdConfiguration, draft: AbsenceDraft, today: CalendarDate, id: string): HouseholdConfiguration {
  if (!configuration.people.some((person) => person.id === draft.personId && person.active !== false)) throw new Error('Choose an active family member.')
  if (![draft.start, draft.end].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && isMatch(date, 'yyyy-MM-dd'))) throw new Error('Choose valid start and end dates.')
  if (draft.start < today) throw new Error('Absence ranges start today or later. Correct older turns in History.')
  if (draft.end < draft.start) throw new Error('The last day away must be on or after the first day.')
  const activities = householdActivities(configuration)
  if (!draft.activityIds.length || new Set(draft.activityIds).size !== draft.activityIds.length || draft.activityIds.some((activityId) => !activities.some((activity) => activity.id === activityId && !isArchived(activity)))) throw new Error('Choose at least one active activity.')
  if (configuration.absences?.some((range) => range.id === id)) throw new Error('This absence already exists.')
  return { ...configuration, absences: [...(configuration.absences ?? []), { ...draft, activityIds: [...draft.activityIds], id }] }
}

export function endAbsence(configuration: HouseholdConfiguration, id: string, today: CalendarDate): HouseholdConfiguration {
  const range = configuration.absences?.find((item) => item.id === id)
  if (!range) throw new Error('This absence could not be found.')
  if (range.end <= today) throw new Error('This absence has no remaining future days.')
  // Today's turns have already begun. Keep their attendance, including weekly
  // turns, and allow the person back at the next turn boundary.
  return { ...configuration, absences: configuration.absences!.flatMap((item) => item.id !== id ? [item] : item.start > today ? [] : [{ ...item, end: today }]) }
}

export function absenceSnapshot(configuration: HouseholdConfiguration, events: readonly RotationEvent[], today: CalendarDate, newId: () => string): { configuration: HouseholdConfiguration; events: readonly RotationEvent[] } {
  const initial = replayActivities(configuration, events, today)
  let updated = [...events, ...missingAssignmentEvents(initial.flatMap((view) => view.records), events)]
  for (const view of initial) {
    const record = view.records.at(-1)
    if (!record || record.date !== today || isArchived(view.activity)) continue
    const activeIds = getActiveOutcomeIds(updated, record.slotId)
    const explicit = updated.some((event) => event.type === 'outcome-recorded' && activeIds.includes(event.eventId) && event.source !== 'absence-range')
    if (explicit) continue
    const planned = (record.rotation ?? view.activity).roster.filter((id) => configuration.absences?.some((range) => range.personId === id && range.activityIds.includes(view.activity.id) && range.start <= today && today <= range.end))
    const absentIds = [...new Set([...record.absentIds, ...planned])]
    if (absentIds.length === record.absentIds.length) continue
    const outcome: OutcomeRecorded = { type: 'outcome-recorded', eventId: newId(), slotId: record.slotId, outcome: 'absence', absentIds, supersedes: activeIds, source: 'absence-range' }
    const replacement = replayActivities(configuration, [...updated, outcome], today).find((item) => item.activity.id === view.activity.id)!.records.at(-1)!.servedById
    if (replacement) outcome.covererId = replacement
    updated = [...updated, outcome]
  }
  replayActivities(configuration, updated, today)
  return { configuration, events: updated }
}
