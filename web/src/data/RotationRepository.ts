import type { RotationEvent } from '../domain/rotation/events'

export interface RotationRepository {
  listEvents(): Promise<readonly RotationEvent[]>
  appendEvent(event: RotationEvent): Promise<void>
}
