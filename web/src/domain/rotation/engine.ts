import { scheduledTurns } from './schedule'

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
  assigneeId: PersonId | null
  servedById: PersonId | null
  outcome: SlotOutcome
  assignmentSource: 'derived' | 'recorded'
  deltas: BalanceMap
  balances: BalanceMap
  absentIds: readonly PersonId[]
  explanation: string
  rotation?: Rotation
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
  const { people, rotation: initialRotation, startDate } = configuration
  const roster = initialRotation.roster
  const knownPeople = new Set(people.map((person) => person.id))

  if (roster.some((personId) => !knownPeople.has(personId))) {
    throw new Error('The rotation roster must contain known family members.')
  }
  if (endDate < startDate) {
    return { records: [], balances: Object.fromEntries(people.map((person) => [person.id, 0])) }
  }

  const balances: Record<PersonId, number> = Object.fromEntries(
    people.map((person) => [person.id, 0]),
  )
  const lastTurn: Partial<Record<PersonId, CalendarDate>> = {}
  const consecutive: Record<PersonId, number> = Object.fromEntries(people.map((person) => [person.id, 0]))
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

  for (const { date, rotation } of scheduledTurns(initialRotation, startDate, endDate)) {
    const roster = rotation.roster
    if (new Set(roster).size !== roster.length || roster.some((id) => !knownPeople.has(id))) {
      throw new Error('The rotation roster must contain unique, known family members.')
    }
    const slotId = `${rotation.id}:${date}`
    const recordedOutcome = outcomes.get(slotId)
    const recordedAssignment = assignments.get(slotId)
    // Freeze attendance with each assignment. Later range changes must never
    // rewrite recorded history; explicit corrections override planned attendance.
    const plannedAbsentIds = roster.filter((id) => configuration.absences?.some((range) =>
      range.personId === id && range.activityIds.includes(rotation.id) && range.start <= date && date <= range.end))
    const absentIds = recordedOutcome ? recordedOutcome.absentIds ?? [] : recordedAssignment ? recordedAssignment.absentIds ?? [] : plannedAbsentIds
    if (absentIds.some((id) => !roster.includes(id)) || new Set(absentIds).size !== absentIds.length) {
      throw new Error('Absent people must be unique members of the rotation.')
    }
    const present = roster.filter((id) => !absentIds.includes(id))
    const eligible = present.filter((personId) => consecutive[personId] < rotation.maxConsecutive)
    const candidates = eligible.length > 0 ? eligible : present
    const suggestedId = selectAssignee({ rotation, eligible: candidates, balances, lastTurn })
    const minimum = rotation.kind === 'chore' ? 1 : 2
    const assigneeId = recordedAssignment ? recordedAssignment.personId : present.length >= minimum ? suggestedId : null

    if (assigneeId !== null && !roster.includes(assigneeId)) {
      throw new Error(`Recorded assignment is not in the rotation roster: ${slotId}`)
    }

    const outcome: SlotOutcome = recordedOutcome?.outcome ?? (absentIds.length ? 'absence' : 'assumed')
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
    } else if (outcome === 'excused' || outcome === 'no-trip' || outcome === 'adult-cover') {
      takerId = null
      servedById = null
    } else if (outcome === 'absence') {
      takerId = present.length < minimum ? null : recordedOutcome?.covererId ??
        (assigneeId !== null && present.includes(assigneeId) ? assigneeId : suggestedId)
      servedById = takerId
    }

    if (takerId !== null && !present.includes(takerId)) {
      throw new Error('Someone who is away cannot take this turn.')
    }

    const name = (id: PersonId) => people.find((person) => person.id === id)!.name
    let explanation: string
    if (outcome === 'no-trip') {
      explanation = 'No trip was taken. Nobody gets credit or owes an extra turn.'
    } else if (outcome === 'adult-cover' || outcome === 'excused') {
      explanation = 'This turn is skipped. Nobody gets credit or owes an extra turn.'
    } else if (outcome === 'outside-cover') {
      explanation = 'This older record used the previous parental-cover rule: the assigned person became due sooner. Change it to parental coverage to remove that penalty.'
    } else if (outcome === 'trade') {
      explanation = `${name(takerId!)} ${rotation.kind === 'chore' ? 'handled the chore' : 'took the seat'}${assigneeId ? ' instead of ' + name(assigneeId) : ''} and gets credit for it.`
      if (assigneeId && !absentIds.includes(assigneeId)) explanation += ` ${name(assigneeId)} is still due a turn.`
    } else if (takerId === null) {
      explanation = rotation.kind === 'chore' ? 'Nobody is available for this chore, so no turn is counted.' : 'Fewer than two people are here to share the seat, so no turn is counted.'
    } else if (takerId !== suggestedId) {
      explanation = `${name(takerId)} was already assigned this turn. Changes to earlier days affect future turns without changing this assignment.`
    } else {
      const tied = candidates.filter((id) => Math.abs((balances[id] ?? 0) - (balances[takerId!] ?? 0)) < 1e-10)
      const oldest = tied.filter((id) => (lastTurn[id] ?? '') === (lastTurn[takerId!] ?? ''))
      if (candidates.length === 1) {
        explanation = `${name(takerId)} is the only person eligible for this turn.`
      } else if (tied.length === 1) {
        explanation = `${name(takerId)} is due because they have had a smaller share of the turns among the people eligible today.`
      } else if (oldest.length === 1 && tied.length > 1) {
        explanation = `${name(takerId)} has waited longest among the people equally due a turn.`
      } else {
        explanation = `The people next in line are equally due. ${name(takerId)} comes first in your family’s starting order.`
      }
      if (eligible.length > 0 && eligible.length < present.length) {
        explanation = `People who have taken ${rotation.maxConsecutive} turns in a row get a break. ${explanation}`
      }
    }
    if (absentIds.length > 0) {
      explanation = `${absentIds.map(name).join(', ')}: away for this ${rotation.cadence === 'weekly' ? 'week' : 'day'}, with no credit or extra turns owed. ${explanation}`
    }

    const deltas: Record<PersonId, number> = {}
    if (takerId !== null) {
      const share = transaction / present.length
      for (const personId of present) {
        deltas[personId] = personId === takerId ? 0 : -share
      }
      deltas[takerId] = -Object.values(deltas).reduce((total, delta) => total + delta, 0)
      for (const personId of present) {
        balances[personId] += deltas[personId]
      }
    }

    if (takerId !== null) {
      for (const personId of present) {
        consecutive[personId] = personId === takerId ? consecutive[personId] + 1 : 0
      }
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
      absentIds: [...absentIds],
      explanation,
      rotation,
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
      absentIds: [...record.absentIds],
    }))
}
