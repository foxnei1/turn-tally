import type { CalendarDate, PersonId, RotationId, SlotId } from './types'

interface EventBase {
  eventId: string
}

export interface AssignmentRecorded extends EventBase {
  type: 'assignment-recorded'
  slotId: SlotId
  personId: PersonId | null
  absentIds?: readonly PersonId[]
}

export interface OutcomeRecorded extends EventBase {
  type: 'outcome-recorded'
  slotId: SlotId
  // The persisted adult-cover value is displayed as Parental coverage.
  outcome: 'as-scheduled' | 'trade' | 'outside-cover' | 'excused' | 'no-trip' | 'adult-cover' | 'absence'
  covererId?: PersonId
  absentIds?: readonly PersonId[]
  supersedes: readonly string[]
  source?: 'absence-range'
}

export type TurnCorrection = Pick<OutcomeRecorded, 'outcome' | 'covererId' | 'absentIds'>

export interface RosterChanged extends EventBase {
  type: 'roster-changed'
  rotationId: RotationId
  effectiveDate: CalendarDate
  personId: PersonId
  action: 'add' | 'remove'
}

export interface AbsenceRecorded extends EventBase {
  type: 'absence-recorded'
  personId: PersonId
  start: CalendarDate
  end: CalendarDate
}

export interface AdjustmentRecorded extends EventBase {
  type: 'adjustment-recorded'
  effectiveDate: CalendarDate
  personId: PersonId
  delta: number
  note: string
  byPersonId: PersonId
}

export type RotationEvent =
  | AssignmentRecorded
  | OutcomeRecorded
  | RosterChanged
  | AbsenceRecorded
  | AdjustmentRecorded
