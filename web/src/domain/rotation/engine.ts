import { eachDayOfInterval, format, parseISO } from 'date-fns'

import type { AssignmentRecorded, OutcomeRecorded, RotationEvent } from './events'
import type {
  BalanceMap,
  CalendarDate,
  HouseholdConfiguration,
  LastTurnMap,
  PersonId,
  Rotation,
  SlotId,
} from './types'

interface SelectAssigneeInput {
  rotation: Rotation
  eligible: readonly PersonId[]
  balances: BalanceMap
  lastTurn: LastTurnMap
}

export function selectAssignee({
  rotation,
  eligible,
  balances,
  lastTurn,
}: SelectAssigneeInput): PersonId | null {
  if (eligible.length === 0) {
    return null
  }

  const rosterOrder = new Map(rotation.roster.map((personId, index) => [personId, index]))

  return [...eligible].sort((left, right) => {
    const balanceDifference =
      rotation.type === 'burden'
        ? (balances[right] ?? 0) - (balances[left] ?? 0)
        : (balances[left] ?? 0) - (balances[right] ?? 0)

    if (balanceDifference !== 0) {
      return balanceDifference
    }

    const lastTurnDifference = (lastTurn[left] ?? '').localeCompare(lastTurn[right] ?? '')
    if (lastTurnDifference !== 0) {
      return lastTurnDifference
    }

    return (rosterOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (rosterOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
  })[0]
}

export type SlotOutcome = 'assumed' | OutcomeRecorded['outcome']

export interface RotationRecord {
  slotId: SlotId
  date: CalendarDate
  assigneeId: PersonId
  servedById: PersonId | null
  outcome: SlotOutcome
  assignmentSource: 'derived' | 'recorded'
  deltas: BalanceMap
  balances: BalanceMap
}

interface ReplayInput {
  configuration: HouseholdConfiguration
  events: readonly RotationEvent[]
  endDate: CalendarDate
}

export interface RotationReplay {
  records: readonly RotationRecord[]
  balances: BalanceMap
}

function activeOutcomes(events: readonly RotationEvent[]): Map<SlotId, OutcomeRecorded> {
  const outcomes = events.filter((event): event is OutcomeRecorded => event.type === 'outcome-recorded')
  const eventsById = new Map<string, OutcomeRecorded>()
  for (const event of outcomes) {
    if (eventsById.has(event.eventId)) {
      throw new Error(`Duplicate outcome event id: ${event.eventId}`)
    }
    eventsById.set(event.eventId, event)
  }
  const supersededIds = new Set(outcomes.flatMap((event) => event.supersedes))

  for (const event of outcomes) {
    for (const supersededId of event.supersedes) {
      const supersededEvent = eventsById.get(supersededId)
      if (!supersededEvent) {
        throw new Error(`Outcome supersedes an unknown event: ${supersededId}`)
      }
      if (supersededEvent.slotId !== event.slotId) {
        throw new Error('An outcome cannot supersede an event from another slot.')
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(eventId: string) {
    if (visiting.has(eventId)) {
      throw new Error('Outcome supersession contains a cycle.')
    }
    if (visited.has(eventId)) {
      return
    }
    visiting.add(eventId)
    for (const supersededId of eventsById.get(eventId)?.supersedes ?? []) {
      visit(supersededId)
    }
    visiting.delete(eventId)
    visited.add(eventId)
  }
  for (const eventId of eventsById.keys()) {
    visit(eventId)
  }

  const activeBySlot = new Map<SlotId, OutcomeRecorded>()
  for (const event of outcomes) {
    if (supersededIds.has(event.eventId)) {
      continue
    }
    if (activeBySlot.has(event.slotId)) {
      throw new Error(`More than one outcome is active for ${event.slotId}`)
    }
    activeBySlot.set(event.slotId, event)
  }
  return activeBySlot
}

export function getActiveOutcomeIds(
  events: readonly RotationEvent[],
  slotId: SlotId,
): readonly string[] {
  const outcomes = events.filter(
    (event): event is OutcomeRecorded => event.type === 'outcome-recorded' && event.slotId === slotId,
  )
  const supersededIds = new Set(outcomes.flatMap((event) => event.supersedes))
  return outcomes.filter((event) => !supersededIds.has(event.eventId)).map((event) => event.eventId)
}

export function replayRotation({ configuration, events, endDate }: ReplayInput): RotationReplay {
  const { people, rotation, startDate } = configuration
  const roster = rotation.roster
  const knownPeople = new Set(people.map((person) => person.id))

  if (roster.length === 0 || roster.some((personId) => !knownPeople.has(personId))) {
    throw new Error('The rotation roster must contain known family members.')
  }
  if (endDate < startDate) {
    return { records: [], balances: Object.fromEntries(people.map((person) => [person.id, 0])) }
  }

  const balances: Record<PersonId, number> = Object.fromEntries(
    people.map((person) => [person.id, 0]),
  )
  const lastTurn: Partial<Record<PersonId, CalendarDate>> = {}
  const consecutive: Record<PersonId, number> = Object.fromEntries(roster.map((personId) => [personId, 0]))
  const assignments = new Map<SlotId, AssignmentRecorded>()
  for (const event of events) {
    if (event.type !== 'assignment-recorded') {
      continue
    }
    const existing = assignments.get(event.slotId)
    if (existing) {
      throw new Error(`More than one assignment is recorded for ${event.slotId}`)
    }
    assignments.set(event.slotId, event)
  }
  const outcomes = activeOutcomes(events)
  const records: RotationRecord[] = []

  for (const day of eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })) {
    const date = format(day, 'yyyy-MM-dd')
    const slotId = `${rotation.id}:${date}`
    const eligible = roster.filter((personId) => consecutive[personId] < rotation.maxConsecutive)
    const recordedAssignment = assignments.get(slotId)
    const assigneeId = recordedAssignment?.personId ?? selectAssignee({
      rotation,
      eligible: eligible.length > 0 ? eligible : roster,
      balances,
      lastTurn,
    })

    if (!assigneeId || !roster.includes(assigneeId)) {
      throw new Error(`Recorded assignment is not in the rotation roster: ${slotId}`)
    }

    const recordedOutcome = outcomes.get(slotId)
    const outcome: SlotOutcome = recordedOutcome?.outcome ?? 'assumed'
    let transaction = rotation.type === 'burden' ? -rotation.desirability : rotation.desirability
    let takerId: PersonId | null = assigneeId
    let servedById: PersonId | null = assigneeId

    if (outcome === 'trade') {
      if (!recordedOutcome?.covererId || !roster.includes(recordedOutcome.covererId)) {
        throw new Error(`Trade coverer is not in the rotation roster: ${slotId}`)
      }
      if (recordedOutcome.covererId === assigneeId) {
        throw new Error(`Trade coverer must differ from the assignee: ${slotId}`)
      }
      takerId = recordedOutcome.covererId
      servedById = recordedOutcome.covererId
    } else if (outcome === 'outside-cover') {
      transaction = -transaction
      servedById = null
    } else if (outcome === 'excused') {
      takerId = null
      servedById = null
    }

    const deltas: Record<PersonId, number> = {}
    if (takerId !== null) {
      const share = transaction / roster.length
      for (const personId of roster) {
        deltas[personId] = personId === takerId ? 0 : -share
      }
      deltas[takerId] = -Object.values(deltas).reduce((total, delta) => total + delta, 0)
      for (const personId of roster) {
        balances[personId] += deltas[personId]
      }
    }

    for (const personId of roster) {
      consecutive[personId] = personId === takerId ? consecutive[personId] + 1 : 0
    }
    if (takerId !== null) {
      lastTurn[takerId] = date
    }

    records.push({
      slotId,
      date,
      assigneeId,
      servedById,
      outcome,
      assignmentSource: recordedAssignment ? 'recorded' : 'derived',
      deltas: { ...deltas },
      balances: { ...balances },
    })
  }

  const validSlotIds = new Set(records.map((record) => record.slotId))
  for (const slotId of [...assignments.keys(), ...outcomes.keys()]) {
    if (!validSlotIds.has(slotId)) {
      throw new Error(`Event references an unknown generated slot: ${slotId}`)
    }
  }

  return { records, balances: { ...balances } }
}

export function missingAssignmentEvents(
  records: readonly RotationRecord[],
  events: readonly RotationEvent[],
): readonly AssignmentRecorded[] {
  const recordedSlots = new Set(
    events
      .filter((event): event is AssignmentRecorded => event.type === 'assignment-recorded')
      .map((event) => event.slotId),
  )
  return records
    .filter((record) => !recordedSlots.has(record.slotId))
    .map((record) => ({
      type: 'assignment-recorded',
      eventId: `assignment:${record.slotId}`,
      slotId: record.slotId,
      personId: record.assigneeId,
    }))
}
