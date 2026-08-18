import type { RotationEvent } from '../domain/rotation/events'
import type { HouseholdConfiguration } from '../domain/rotation/types'

export interface RotationRepository {
  listEvents(): Promise<readonly RotationEvent[]>
  appendEvent(event: RotationEvent): Promise<void>
}

export interface TurnTallyRepository extends RotationRepository {
  loadConfiguration(): Promise<HouseholdConfiguration | null>
  saveConfiguration(configuration: HouseholdConfiguration): Promise<void>
  clear(): Promise<void>
}
