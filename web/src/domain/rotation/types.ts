export type PersonId = string
export type RotationId = string
export type SlotId = string
export type CalendarDate = string

export interface Person {
  id: PersonId
  name: string
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
}

export type BalanceMap = Readonly<Record<PersonId, number>>
export type LastTurnMap = Readonly<Partial<Record<PersonId, CalendarDate>>>

export interface HouseholdConfiguration {
  people: readonly Person[]
  rotation: Rotation
  startDate: CalendarDate
}
