import { useCallback, useEffect, useState } from 'react'

import type { TurnTallyRepository } from '../data/RotationRepository'
import {
  getActiveOutcomeIds,
  missingAssignmentEvents,
} from '../domain/rotation/engine'
import { configureActivity, replayActivities, type ActivityView } from '../domain/rotation/activities'
import { canAdminister, canEdit, initializeRoles, requirePermission, saveFamilyMember } from '../domain/family/members'
import type { OutcomeRecorded, RotationEvent, TurnCorrection } from '../domain/rotation/events'
import type {
  ActivityDraft,
  CalendarDate,
  HouseholdConfiguration,
  MemberDraft,
  PersonId,
} from '../domain/rotation/types'

type AppPhase = 'loading' | 'setup' | 'ready' | 'error'

interface TurnTallyState {
  phase: AppPhase
  configuration: HouseholdConfiguration | null
  activities: readonly ActivityView[]
  events: readonly RotationEvent[]
  error: string | null
}

const EMPTY_STATE: TurnTallyState = {
  phase: 'loading',
  configuration: null,
  activities: [],
  events: [],
  error: null,
}

function newEventId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}:${suffix}`
}

export function useTurnTally(repository: TurnTallyRepository, today: CalendarDate) {
  const [state, setState] = useState<TurnTallyState>(EMPTY_STATE)
  const [actorId, setActorId] = useState<PersonId | null>(null)

  async function authorizedConfiguration(permission: 'edit' | 'administer') {
    const configuration = await repository.loadConfiguration()
    if (!configuration) throw new Error('Set up a family first.')
    requirePermission(configuration, actorId, permission)
    return configuration
  }

  const load = useCallback(async () => {
    try {
      const configuration = await repository.loadConfiguration()
      if (!configuration) {
        setState({ ...EMPTY_STATE, phase: 'setup' })
        return
      }

      let events = await repository.listEvents()
      const initialReplay = replayActivities(configuration, events, today)
      const missingAssignments = missingAssignmentEvents(initialReplay.flatMap((view) => view.records), events)
      for (const assignment of missingAssignments) {
        await repository.appendEvent(assignment)
      }
      if (missingAssignments.length > 0) {
        events = await repository.listEvents()
      }
      const activities = replayActivities(configuration, events, today)
      setState({
        phase: 'ready',
        configuration,
        activities,
        events,
        error: null,
      })
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: 'error',
        error: error instanceof Error ? error.message : 'TurnTally could not load.',
      }))
    }
  }, [repository, today])

  useEffect(() => {
    void load()
  }, [load])

  const createHousehold = useCallback(
    async (names: readonly string[]) => {
      if (await repository.loadConfiguration()) throw new Error('A family already exists. Only an administrator can reset it.')
      const cleaned = names.map((name) => name.trim()).filter(Boolean)
      if (cleaned.length < 2 || new Set(cleaned.map((name) => name.toLocaleLowerCase())).size !== cleaned.length) throw new Error('Add at least two distinct names.')
      const people = cleaned.map((name, index) => ({ id: `member-${index + 1}`, name }))
      const configuration: HouseholdConfiguration = {
        people,
        startDate: today,
        rotation: {
          id: 'middle-seat',
          name: 'Middle seat',
          type: 'burden',
          cadence: 'daily',
          desirability: 1,
          maxConsecutive: 2,
          order: 0,
          restricted: false,
          roster: people.map((person) => person.id),
        },
      }
      await repository.saveConfiguration(configuration)
      await load()
    },
    [load, repository, today],
  )

  const recordOutcome = (
    async (
      slotId: string,
      correction: TurnCorrection,
    ) => {
      const configuration = await authorizedConfiguration('edit')
      const events = await repository.listEvents()
      const event: OutcomeRecorded = {
        type: 'outcome-recorded',
        eventId: newEventId('outcome'),
        slotId,
        ...correction,
        supersedes: getActiveOutcomeIds(events, slotId),
      }
      // Validate before saving. Pin an absence replacement so later corrections
      // cannot silently change the person the family was shown.
      const preview = replayActivities(configuration, [...events, event], today)
      const record = preview.flatMap((view) => view.records).find((record) => record.slotId === slotId)
      if (!record) throw new Error('This turn could not be found.')
      if (correction.outcome === 'absence') {
        const replacement = record.servedById
        if (replacement) event.covererId = replacement
      }
      await repository.appendEvent(event)
      await load()
    }
  )

  const saveActivity = async (draft: ActivityDraft, activityId?: string) => {
    const stored = await authorizedConfiguration('edit')
    const events = await repository.listEvents()
    const views = replayActivities(stored, events, today)
    const existing = activityId ? views.find((view) => view.activity.id === activityId) : undefined
    if (activityId && !existing) throw new Error('This activity could not be found.')
    const id = activityId ?? newEventId('activity')
    const configuration = configureActivity(stored, draft, today, id, existing)
    replayActivities(configuration, events, today)
    await repository.saveConfiguration(configuration)
    await load()
    return id
  }

  async function setupAdministrator(choice: { personId: PersonId } | { name: string }) {
    const stored = await repository.loadConfiguration()
    if (!stored) throw new Error('Set up a family first.')
    const result = initializeRoles(stored, choice, newEventId('member'))
    await repository.saveConfiguration(result.configuration)
    setActorId(result.administratorId)
    await load()
  }

  async function selectProfile(personId: PersonId) {
    const stored = await repository.loadConfiguration()
    if (!stored?.rolesInitialized || !stored.people.some((person) => person.id === personId && person.active !== false)) {
      throw new Error('Choose an active profile.')
    }
    setActorId(personId)
    await load()
  }

  async function saveMember(draft: MemberDraft, personId?: PersonId) {
    const stored = await authorizedConfiguration('administer')
    const events = await repository.listEvents()
    const id = personId ?? newEventId('member')
    const configuration = saveFamilyMember(stored, events, today, actorId, draft, id, !!personId)
    replayActivities(configuration, events, today)
    await repository.saveConfiguration(configuration)
    await load()
  }

  const reset = async () => {
    await authorizedConfiguration('administer')
    await repository.clear()
    setActorId(null)
    setState({ ...EMPTY_STATE, phase: 'setup' })
  }

  const actor = state.configuration?.people.find((person) => person.id === actorId && person.active !== false)
  return {
    ...state, actor, createHousehold, recordOutcome, saveActivity, saveMember, setupAdministrator, selectProfile, reset, reload: load,
    canEdit: state.configuration ? canEdit(state.configuration, actorId) : false,
    canAdminister: state.configuration ? canAdminister(state.configuration, actorId) : false,
  }
}
