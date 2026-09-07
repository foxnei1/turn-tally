import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { hostedFixture } from '../test/hostedFixture'
import { SupabaseRotationRepository, SyncConflictError } from './supabaseRepository'

function fixture() {
  const initial = { household_id: 'family-1', snapshot: hostedFixture(), revision: 5, person_id: 'adult', role: 'editor' }
  const rpc = vi.fn().mockResolvedValue({ data: initial, error: null })
  const repository = new SupabaseRotationRepository({ rpc } as unknown as SupabaseClient)
  return { initial, rpc, repository }
}

describe('Supabase repository', () => {
  it('uses a consistent snapshot until explicit refresh and saves with its revision', async () => {
    const { repository, rpc, initial } = fixture()
    await repository.refresh()
    const configuration = await repository.loadConfiguration()
    configuration!.rotation.name = 'Changed'
    expect((await repository.loadConfiguration())!.rotation.name).toBe('Middle seat')
    rpc.mockResolvedValueOnce({ data: { revision: 6 }, error: null })
    await repository.saveConfiguration(configuration!)
    expect(rpc).toHaveBeenLastCalledWith('turntally_save', expect.objectContaining({ expected_revision: 5, operation: 'edit' }))
    expect(repository.revision).toBe(6)
    expect(initial.snapshot.configuration!.rotation.name).toBe('Middle seat')
  })
  it('preserves an attempted conflicting edit without advancing or retrying it', async () => {
    const { repository, rpc } = fixture()
    await repository.refresh()
    const next = hostedFixture(); next.configuration!.rotation.name = 'My edit'
    rpc.mockResolvedValueOnce({ data: null, error: { code: '40001', message: 'conflict' } })
    await expect(repository.replaceSnapshot(next)).rejects.toBeInstanceOf(SyncConflictError)
    expect(repository.conflict?.proposed).toEqual(next)
    expect(repository.revision).toBe(5)
    expect((await repository.loadConfiguration())!.rotation.name).toBe('Middle seat')
    await expect(repository.replaceSnapshot(next)).rejects.toBeInstanceOf(SyncConflictError)
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('rejects viewer writes locally and clears data after access is revoked', async () => {
    const { repository, rpc, initial } = fixture()
    initial.role = 'viewer'; initial.person_id = 'child'
    await repository.refresh()
    await expect(repository.saveConfiguration(hostedFixture().configuration!)).rejects.toThrow(/view only/)
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Access revoked' } })
    await expect(repository.refresh()).rejects.toThrow('Access revoked')
    await expect(repository.readSnapshot()).rejects.toThrow(/Connect and load/)
  })
  it('keeps the old snapshot and revision after a network failure', async () => {
    const { repository, rpc } = fixture()
    await repository.refresh()
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Network unavailable' } })
    const next = hostedFixture(); next.configuration!.rotation.name = 'Unsaved'
    await expect(repository.replaceSnapshot(next)).rejects.toThrow('Network unavailable')
    expect(repository.revision).toBe(5)
    expect((await repository.loadConfiguration())!.rotation.name).toBe('Middle seat')
  })
  it('does not send stale restore previews or invalid data', async () => {
    const { repository, rpc } = fixture()
    await repository.refresh()
    await expect(repository.restoreSnapshot(hostedFixture(), 'outdated')).rejects.toThrow(/family changed/)
    await expect(repository.replaceSnapshot({ configuration: null, events: [] })).rejects.toThrow(/no family/)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
