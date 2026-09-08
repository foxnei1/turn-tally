import type { SupabaseClient } from '@supabase/supabase-js'
import { format } from 'date-fns'
import { createBackup, parseBackup } from '../domain/backups/backup'
import type { RotationEvent } from '../domain/rotation/events'
import type { FamilyRole, HouseholdConfiguration } from '../domain/rotation/types'
import type { HouseholdSnapshot, TurnTallyRepository } from './RotationRepository'

export interface HostedHousehold {
  household_id: string
  snapshot: HouseholdSnapshot | null
  revision: number
  person_id: string | null
  role: FamilyRole | null
  device?: import('../features/accounts/deviceApi').ViewerDeviceIdentity
}

export class SyncConflictError extends Error {
  readonly proposed: HouseholdSnapshot
  constructor(proposed: HouseholdSnapshot) {
    super('Another device changed this family. Your change was not saved. Download your attempted version before refreshing, then review and reapply the change.')
    this.name = 'SyncConflictError'
    this.proposed = structuredClone(proposed)
  }
}

// Reads within an action use one revision. Refresh is explicit so an open form
// cannot silently adopt a newer revision and overwrite another device's edits.
export class SupabaseRotationRepository implements TurnTallyRepository {
  readonly hosted = true
  private readonly client: Pick<SupabaseClient, 'rpc'>
  private state: HostedHousehold | null = null
  private saving = false
  private readonly notify: () => void
  conflict: SyncConflictError | null = null
  constructor(client: Pick<SupabaseClient, 'rpc'>, notify = () => {}) { this.client = client; this.notify = notify }

  get identity() { return { personId: this.state?.person_id ?? null, role: this.state?.role ?? null, device: this.state?.device } }
  get revision() { return this.state?.revision ?? 0 }
  get readOnly() { return this.identity.role === 'viewer' }

  forget() { this.state = null; this.conflict = null }

  async checkAccess(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const { data, error } = await Promise.race([
        this.client.rpc('turntally_access'),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Access check timed out. Reconnect and refresh to continue.')), 15000) }),
      ])
      if (error || !data || data.household_id !== this.state?.household_id || data.role !== this.state?.role) {
        throw new Error(error?.message ?? 'Family access changed. Reconnect to continue.')
      }
      // Deliberately preserve the current snapshot/revision for open forms.
    } catch (error) { this.forget(); throw error }
    finally { clearTimeout(timer) }
  }

  async refresh(): Promise<void> {
    if (this.saving) throw new Error('Wait for the current save to finish.')
    const { data, error } = await this.client.rpc('turntally_load')
    if (error) {
      // Fail closed on lost/revoked access; never fall back to another family.
      this.state = null
      throw new Error(error.message)
    }
    const next = data as HostedHousehold
    if (!next || !Number.isInteger(next.revision) || !next.household_id) throw new Error('Invalid family response.')
    if (next.snapshot) this.validate(next.snapshot)
    this.state = structuredClone(next)
  }

  private current(): HouseholdSnapshot {
    if (!this.state) throw new Error('Connect and load your family first.')
    return structuredClone(this.state.snapshot ?? { configuration: null, events: [] })
  }

  private validate(snapshot: HouseholdSnapshot) {
    // Reuse the existing bounded schema/replay validator before accepting or
    // sending remote data. Database checks enforce identity and write authority.
    createBackup(snapshot, format(new Date(), 'yyyy-MM-dd'))
  }

  private async commit(snapshot: HouseholdSnapshot, operation: 'edit' | 'restore' | 'initialize', administratorId?: string) {
    if (!this.state) throw new Error('Connect and load your family first.')
    if (this.readOnly) throw new Error('This account can view only.')
    if (this.saving) throw new Error('Wait for the current save to finish.')
    if (this.conflict) throw this.conflict
    this.validate(snapshot)
    this.saving = true
    const proposed = structuredClone(snapshot)
    try {
      const { data, error } = await this.client.rpc('turntally_save', {
        expected_revision: this.state.revision, proposed_snapshot: proposed,
        operation, administrator_id: administratorId ?? null,
      })
      if (error) {
        if (error.code === '40001') {
          this.conflict = new SyncConflictError(proposed)
          this.notify()
          throw this.conflict
        }
        throw new Error(error.message)
      }
      this.state = { ...this.state, snapshot: proposed, revision: data.revision,
        person_id: administratorId ?? this.state.person_id }
    } finally { this.saving = false }
  }

  async initialize(text: string, administratorId: string) {
    const backup = parseBackup(text, format(new Date(), 'yyyy-MM-dd'))
    await this.commit({ configuration: backup.configuration, events: backup.events }, 'initialize', administratorId)
    await this.refresh()
  }
  async readSnapshot() { return this.current() }
  async loadConfiguration() { return this.current().configuration }
  async listEvents() { return this.current().events }
  async saveConfiguration(configuration: HouseholdConfiguration) { await this.commit({ ...this.current(), configuration }, 'edit') }
  async appendEvent(event: RotationEvent) {
    const snapshot = this.current()
    const prior = snapshot.events.find((existing) => existing.eventId === event.eventId)
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(event)) throw new Error('This event ID is already in use.')
      return
    }
    await this.commit({ ...snapshot, events: [...snapshot.events, event] }, 'edit')
  }
  async replaceSnapshot(snapshot: HouseholdSnapshot, expectedState?: string) {
    this.checkExpected(expectedState)
    await this.commit(snapshot, 'edit')
  }
  async restoreSnapshot(snapshot: HouseholdSnapshot, expectedState: string) {
    this.checkExpected(expectedState)
    await this.commit(snapshot, 'restore')
  }
  private checkExpected(expectedState?: string) {
    if (expectedState !== undefined && JSON.stringify(this.current()) !== expectedState) throw new Error('The family changed. Review the latest data before saving.')
  }
  async clear(): Promise<void> { throw new Error('Hosted families cannot be reset from the local prototype controls.') }
}
