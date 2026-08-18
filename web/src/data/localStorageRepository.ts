import type { RotationEvent } from '../domain/rotation/events'
import type { RotationRepository } from './RotationRepository'

const DEFAULT_KEY = 'turn-tally.events.v1'

export class LocalStorageRotationRepository implements RotationRepository {
  private readonly storage: Storage
  private readonly key: string

  constructor(storage: Storage, key = DEFAULT_KEY) {
    this.storage = storage
    this.key = key
  }

  async listEvents(): Promise<readonly RotationEvent[]> {
    const stored = this.storage.getItem(this.key)
    return stored ? (JSON.parse(stored) as RotationEvent[]) : []
  }

  async appendEvent(event: RotationEvent): Promise<void> {
    const events = await this.listEvents()
    if (events.some((existing) => existing.eventId === event.eventId)) {
      return
    }
    this.storage.setItem(this.key, JSON.stringify([...events, event]))
  }
}
