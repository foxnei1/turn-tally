import type { RotationEvent } from '../domain/rotation/events'
import type { HouseholdConfiguration } from '../domain/rotation/types'

export interface RotationRepository {
  listEvents(): Promise<readonly RotationEvent[]>
  appendEvent(event: RotationEvent): Promise<void>
}

export interface TurnTallyRepository extends RotationRepository {
  readonly hosted?: boolean
  readonly readOnly?: boolean
  readonly identity?: { personId: string | null; role: import('../domain/rotation/types').FamilyRole | null }
  refresh?(): Promise<void>
  restoreSnapshot?(snapshot: HouseholdSnapshot, expectedState: string): Promise<void>
  loadConfiguration(): Promise<HouseholdConfiguration | null>
  saveConfiguration(configuration: HouseholdConfiguration): Promise<void>
  clear(): Promise<void>
  readSnapshot(): Promise<HouseholdSnapshot>
  replaceSnapshot(snapshot: HouseholdSnapshot, expectedState?: string): Promise<void>
}

export interface HouseholdSnapshot {
  configuration: HouseholdConfiguration | null
  events: readonly RotationEvent[]
}
