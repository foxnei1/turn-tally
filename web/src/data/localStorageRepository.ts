import type { RotationEvent } from '../domain/rotation/events'
import type { HouseholdConfiguration } from '../domain/rotation/types'
import type { HouseholdSnapshot, TurnTallyRepository } from './RotationRepository'

const DEFAULT_KEY = 'turn-tally.events.v1'
const DEFAULT_CONFIGURATION_KEY = 'turn-tally.configuration.v1'

export class LocalStorageRotationRepository implements TurnTallyRepository {
  private readonly storage: Storage
  private readonly key: string
  private readonly configurationKey: string
  private readonly snapshotKey: string

  constructor(storage: Storage, key = DEFAULT_KEY, configurationKey = DEFAULT_CONFIGURATION_KEY) {
    this.storage = storage
    this.key = key
    this.configurationKey = configurationKey
    this.snapshotKey = configurationKey + '.snapshot.v2'
  }

  private read(): HouseholdSnapshot {
    const snapshot = this.storage.getItem(this.snapshotKey)
    if (snapshot !== null) return JSON.parse(snapshot) as HouseholdSnapshot
    const configuration = this.storage.getItem(this.configurationKey)
    const events = this.storage.getItem(this.key)
    return { configuration: configuration ? JSON.parse(configuration) as HouseholdConfiguration : null, events: events ? JSON.parse(events) as RotationEvent[] : [] }
  }

  private write(snapshot: HouseholdSnapshot) {
    // One atomic setItem commits configuration and history together. A quota
    // failure leaves the previous snapshot (or legacy keys) untouched.
    this.storage.setItem(this.snapshotKey, JSON.stringify(snapshot))
    // The snapshot is authoritative even if cleanup of old keys fails.
    try {
      this.storage.removeItem(this.configurationKey)
      this.storage.removeItem(this.key)
    } catch { /* Legacy cleanup must not turn a successful commit into an error. */ }
  }

  async readSnapshot(): Promise<HouseholdSnapshot> { return this.read() }

  async replaceSnapshot(snapshot: HouseholdSnapshot, expectedState?: string): Promise<void> {
    if (expectedState !== undefined && JSON.stringify(this.read()) !== expectedState) {
      throw new Error('The family changed before saving. Reload to review the latest data. For a backup restore, choose the file again to refresh its preview.')
    }
    this.write(snapshot)
  }

  async listEvents(): Promise<readonly RotationEvent[]> { return this.read().events }

  async appendEvent(event: RotationEvent): Promise<void> {
    const snapshot = this.read()
    if (snapshot.events.some((existing) => existing.eventId === event.eventId)) return
    this.write({ ...snapshot, events: [...snapshot.events, event] })
  }

  async loadConfiguration(): Promise<HouseholdConfiguration | null> { return this.read().configuration }

  async saveConfiguration(configuration: HouseholdConfiguration): Promise<void> {
    this.write({ ...this.read(), configuration })
  }

  async clear(): Promise<void> {
    // A durable empty snapshot also prevents old keys from resurfacing.
    this.write({ configuration: null, events: [] })
  }
}
