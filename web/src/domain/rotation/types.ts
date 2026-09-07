export type PersonId = string
export type RotationId = string
export type SlotId = string
export type CalendarDate = string

export interface Person {
  id: PersonId
  name: string
  role?: FamilyRole
  active?: boolean
}

export type FamilyRole = 'administrator' | 'editor' | 'viewer'

export interface MemberDraft {
  name: string
  role: FamilyRole
  active: boolean
}

export type RotationType = 'burden' | 'privilege'
export type Cadence = 'daily' | 'weekly'

export interface Rotation {
  id: RotationId
  name: string
  type: RotationType
  cadence: Cadence
  desirability: number
  maxConsecutive: number
  order: number
  restricted: boolean
  roster: readonly PersonId[]
  kind?: 'seating' | 'chore'
  revisions?: readonly RotationRevision[]
}

export interface RotationRevision {
  effectiveDate: CalendarDate
  cadence: Cadence
  roster: readonly PersonId[]
}

export interface Activity extends Rotation {
  startDate: CalendarDate
}

export interface ActivityDraft {
  name: string
  cadence: Cadence
  roster: readonly PersonId[]
  startDate: CalendarDate
}

export type BalanceMap = Readonly<Record<PersonId, number>>
export type LastTurnMap = Readonly<Partial<Record<PersonId, CalendarDate>>>

export interface HouseholdConfiguration {
  people: readonly Person[]
  rotation: Rotation
  startDate: CalendarDate
  // The original rotation remains for compatibility with seating-only data.
  activities?: readonly Activity[]
  rolesInitialized?: boolean
}
