import { isMatch } from 'date-fns'

import { replayRotation, type RotationReplay } from './engine'
import type { RotationEvent } from './events'
import { nextTurnDate } from './schedule'
import type { Activity, ActivityDraft, CalendarDate, HouseholdConfiguration } from './types'

export interface ActivityView extends RotationReplay {
  activity: Activity
}

export function householdActivities(configuration: HouseholdConfiguration): readonly Activity[] {
  return configuration.activities ?? [{ ...configuration.rotation, kind: 'seating', startDate: configuration.startDate }]
}

export function replayActivities(configuration: HouseholdConfiguration, events: readonly RotationEvent[], today: CalendarDate): ActivityView[] {
  return householdActivities(configuration).map((activity) => ({
    activity,
    ...replayRotation({
      configuration: { people: configuration.people, rotation: activity, startDate: activity.startDate },
      events: events.filter((event) => 'slotId' in event && event.slotId.startsWith(activity.id + ':')),
      endDate: today,
    }),
  }))
}

export function configureActivity(configuration: HouseholdConfiguration, draft: ActivityDraft, today: CalendarDate, id: string, existingView?: ActivityView): HouseholdConfiguration {
  const activities = householdActivities(configuration)
  const name = draft.name.trim()
  if (!name || name.length > 60) throw new Error('Use an activity name between 1 and 60 characters.')
  if (activities.some((activity) => activity.id !== id && activity.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('An activity with that name already exists.')
  }
  if (!['daily', 'weekly'].includes(draft.cadence)) throw new Error('Choose daily or weekly turns.')
  if (!isMatch(draft.startDate, 'yyyy-MM-dd')) throw new Error('Choose a valid start date.')
  const knownIds = new Set(configuration.people.filter((person) => person.active !== false).map((person) => person.id))
  if (draft.roster.length < 1 || new Set(draft.roster).size !== draft.roster.length || draft.roster.some((person) => !knownIds.has(person))) {
    throw new Error('Choose at least one family member for this activity.')
  }
  if (existingView?.activity.kind === 'seating' && draft.roster.length < 2) throw new Error('Choose at least two people to share the seat.')
  if (existingView?.activity.kind === 'seating' && draft.cadence !== 'daily') throw new Error('Seating uses daily turns.')

  let updated: Activity
  if (existingView) {
    const activity = existingView.activity
    const current = existingView.records.at(-1)
    if (current) {
      const effectiveDate = nextTurnDate(current.date, current.rotation ?? activity)
      updated = {
        ...activity, name,
        revisions: [
          ...(activity.revisions ?? []).filter((revision) => revision.effectiveDate < effectiveDate),
          { effectiveDate, cadence: draft.cadence, roster: [...draft.roster] },
        ],
      }
    } else {
      if (draft.startDate < today) throw new Error('New activities can start today or later.')
      updated = { ...activity, ...draft, name, revisions: [] }
    }
  } else {
    if (draft.startDate < today) throw new Error('New activities can start today or later.')
    updated = {
      id, name, kind: 'chore', type: 'burden', cadence: draft.cadence, startDate: draft.startDate,
      roster: [...draft.roster], desirability: 1, maxConsecutive: 2, order: activities.length, restricted: false,
    }
  }
  return { ...configuration, activities: existingView ? activities.map((activity) => activity.id === id ? updated : activity) : [...activities, updated] }
}
