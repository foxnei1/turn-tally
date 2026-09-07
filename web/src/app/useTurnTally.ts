import { useCallback, useEffect, useRef, useState } from 'react'

import type { TurnTallyRepository } from '../data/RotationRepository'
import {
  getActiveOutcomeIds,
  missingAssignmentEvents,
} from '../domain/rotation/engine'
import { changeActivityArchive, configureActivity, replayActivities, type ActivityView } from '../domain/rotation/activities'
import { backupCounts, createBackup, parseBackup, type BackupPreview } from '../domain/backups/backup'
import { canAdminister, canEdit, initializeRoles, requirePermission, saveFamilyMember } from '../domain/family/members'
import { absenceSnapshot, addAbsence, endAbsence } from '../domain/rotation/absences'
import type { OutcomeRecorded, RotationEvent, TurnCorrection } from '../domain/rotation/events'
import type {
  ActivityDraft,
  AbsenceDraft,
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
  const loading = useRef<Promise<void> | null>(null)

  async function authorizedConfiguration(permission: 'edit' | 'administer') {
    if (repository.readOnly) throw new Error('This account can view only.')
    const configuration = await repository.loadConfiguration()
    if (!configuration) throw new Error('Set up a family first.')
    requirePermission(configuration, actorId, permission)
    return configuration
  }

  const load = useCallback(() => {
    if (loading.current) return loading.current
    const pending = (async () => {
    try {
      await repository.refresh?.()
      if (repository.hosted) setActorId(repository.identity?.personId ?? null)
      const configuration = await repository.loadConfiguration()
      if (!configuration) {
        setState({ ...EMPTY_STATE, phase: 'setup' })
        return
      }

      let events = await repository.listEvents()
      const initialReplay = replayActivities(configuration, events, today)
      const missingAssignments = missingAssignmentEvents(initialReplay.flatMap((view) => view.records), events)
      if (repository.hosted) {
        if (missingAssignments.length && !repository.readOnly) {
          await repository.replaceSnapshot({ configuration, events: [...events, ...missingAssignments] }, JSON.stringify({ configuration, events }))
        }
      } else {
        for (const assignment of missingAssignments) await repository.appendEvent(assignment)
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
    })()
    loading.current = pending
    void pending.finally(() => { if (loading.current === pending) loading.current = null })
    return pending
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
    if (repository.hosted) throw new Error('Sign out to use a different account.')
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

  async function setActivityArchived(activityId: string, archived: boolean) {
    const stored = await authorizedConfiguration('edit')
    const events = await repository.listEvents()
    const configuration = changeActivityArchive(stored, events, today, activityId, archived)
    replayActivities(configuration, events, today)
    await repository.saveConfiguration(configuration)
    await load()
  }

  async function exportBackup(): Promise<string> {
    if (repository.readOnly) throw new Error('This account can view only.')
    const snapshot = await repository.readSnapshot()
    if (!snapshot.configuration) throw new Error('There is no family to back up yet.')
    requirePermission(snapshot.configuration, actorId, 'edit')
    return createBackup(snapshot, today)
  }

  async function changeAbsence(draftOrId: AbsenceDraft | string) {
    if (repository.readOnly) throw new Error('This account can view only.')
    const snapshot = await repository.readSnapshot()
    if (!snapshot.configuration) throw new Error('Set up a family first.')
    requirePermission(snapshot.configuration, actorId, 'edit')
    // Pin all elapsed turns using the old plan before changing future attendance.
    const previous = replayActivities(snapshot.configuration, snapshot.events, today)
    const events = [...snapshot.events, ...missingAssignmentEvents(previous.flatMap((view) => view.records), snapshot.events)]
    const configuration = typeof draftOrId === 'string'
      ? endAbsence(snapshot.configuration, draftOrId, today)
      : addAbsence(snapshot.configuration, draftOrId, today, newEventId('absence'))
    const next = absenceSnapshot(configuration, events, today, () => newEventId('outcome'))
    await repository.replaceSnapshot(next, JSON.stringify(snapshot))
    await load()
  }

  async function previewBackup(text: string): Promise<BackupPreview> {
    if (repository.readOnly) throw new Error('This account can view only.')
    const snapshot = await repository.readSnapshot()
    if (snapshot.configuration) requirePermission(snapshot.configuration, actorId, 'administer')
    return { backup: parseBackup(text, today), expectedState: JSON.stringify(snapshot), current: backupCounts(snapshot.configuration, snapshot.events) }
  }

  async function importBackup(text: string, expectedState: string) {
    if (repository.readOnly) throw new Error('This account can view only.')
    const snapshot = await repository.readSnapshot()
    // An empty browser may bootstrap from a backup. Existing families always
    // require their current administrator, never a role claimed by the file.
    if (snapshot.configuration) requirePermission(snapshot.configuration, actorId, 'administer')
    const backup = parseBackup(text, today)
    const views = replayActivities(backup.configuration, backup.events, today)
    const assignments = missingAssignmentEvents(views.flatMap((view) => view.records), backup.events)
    const replace = repository.restoreSnapshot?.bind(repository) ?? repository.replaceSnapshot.bind(repository)
    await replace({ configuration: backup.configuration, events: [...backup.events, ...assignments] }, expectedState)
    setActorId(null)
    await load()
  }

  const reset = async () => {
    await authorizedConfiguration('administer')
    await repository.clear()
    setActorId(null)
    setState({ ...EMPTY_STATE, phase: 'setup' })
  }

  const storedActor = state.configuration?.people.find((person) => person.id === actorId && person.active !== false)
  const actor = storedActor && repository.hosted ? { ...storedActor, role: repository.identity?.role ?? 'viewer' as const } : storedActor
  return {
    ...state, actor, createHousehold, recordOutcome, saveActivity, saveMember, setupAdministrator, selectProfile, reset, reload: load,
    setActivityArchived, exportBackup, previewBackup, importBackup, changeAbsence,
    canEdit: !repository.readOnly && state.configuration ? canEdit(state.configuration, actorId) : false,
    canAdminister: !repository.readOnly && state.configuration ? canAdminister(state.configuration, actorId) : false,
  }
}
