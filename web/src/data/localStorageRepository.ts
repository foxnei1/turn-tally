import type { RotationEvent } from '../domain/rotation/events'
import type { HouseholdConfiguration } from '../domain/rotation/types'
import type { TurnTallyRepository } from './RotationRepository'

const DEFAULT_KEY = 'turn-tally.events.v1'
const DEFAULT_CONFIGURATION_KEY = 'turn-tally.configuration.v1'

export class LocalStorageRotationRepository implements TurnTallyRepository {
  private readonly storage: Storage
  private readonly key: string
  private readonly configurationKey: string

  constructor(
    storage: Storage,
    key = DEFAULT_KEY,
    configurationKey = DEFAULT_CONFIGURATION_KEY,
  ) {
    this.storage = storage
    this.key = key
    this.configurationKey = configurationKey
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

  async loadConfiguration(): Promise<HouseholdConfiguration | null> {
    const stored = this.storage.getItem(this.configurationKey)
    return stored ? (JSON.parse(stored) as HouseholdConfiguration) : null
  }

  async saveConfiguration(configuration: HouseholdConfiguration): Promise<void> {
    this.storage.setItem(this.configurationKey, JSON.stringify(configuration))
  }

  async clear(): Promise<void> {
    this.storage.removeItem(this.key)
    this.storage.removeItem(this.configurationKey)
  }
}
