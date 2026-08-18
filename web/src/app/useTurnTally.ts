import { useCallback, useEffect, useState } from 'react'

import type { TurnTallyRepository } from '../data/RotationRepository'
import {
  getActiveOutcomeIds,
  missingAssignmentEvents,
  replayRotation,
  type RotationRecord,
} from '../domain/rotation/engine'
import type { OutcomeRecorded, RotationEvent } from '../domain/rotation/events'
import type {
  BalanceMap,
  CalendarDate,
  HouseholdConfiguration,
  PersonId,
} from '../domain/rotation/types'

type AppPhase = 'loading' | 'setup' | 'ready' | 'error'

interface TurnTallyState {
  phase: AppPhase
  configuration: HouseholdConfiguration | null
  records: readonly RotationRecord[]
  balances: BalanceMap
  events: readonly RotationEvent[]
  error: string | null
}

const EMPTY_STATE: TurnTallyState = {
  phase: 'loading',
  configuration: null,
  records: [],
  balances: {},
  events: [],
  error: null,
}

function newEventId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}:${suffix}`
}

export function useTurnTally(repository: TurnTallyRepository, today: CalendarDate) {
  const [state, setState] = useState<TurnTallyState>(EMPTY_STATE)

  const load = useCallback(async () => {
    try {
      const configuration = await repository.loadConfiguration()
      if (!configuration) {
        setState({ ...EMPTY_STATE, phase: 'setup' })
        return
      }

      let events = await repository.listEvents()
      const initialReplay = replayRotation({ configuration, events, endDate: today })
      const missingAssignments = missingAssignmentEvents(initialReplay.records, events)
      for (const assignment of missingAssignments) {
        await repository.appendEvent(assignment)
      }
      if (missingAssignments.length > 0) {
        events = await repository.listEvents()
      }
      const replay = replayRotation({ configuration, events, endDate: today })
      setState({
        phase: 'ready',
        configuration,
        records: replay.records,
        balances: replay.balances,
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
      const people = names.map((name, index) => ({ id: `member-${index + 1}`, name: name.trim() }))
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
      await repository.clear()
      await repository.saveConfiguration(configuration)
      await load()
    },
    [load, repository, today],
  )

  const recordOutcome = useCallback(
    async (
      slotId: string,
      outcome: OutcomeRecorded['outcome'],
      covererId?: PersonId,
    ) => {
      const event: OutcomeRecorded = {
        type: 'outcome-recorded',
        eventId: newEventId('outcome'),
        slotId,
        outcome,
        ...(covererId ? { covererId } : {}),
        supersedes: getActiveOutcomeIds(state.events, slotId),
      }
      await repository.appendEvent(event)
      await load()
    },
    [load, repository, state.events],
  )

  const reset = useCallback(async () => {
    await repository.clear()
    setState({ ...EMPTY_STATE, phase: 'setup' })
  }, [repository])

  return { ...state, createHousehold, recordOutcome, reset, reload: load }
}
