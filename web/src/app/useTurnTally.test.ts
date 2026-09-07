import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import type { HouseholdConfiguration } from '../domain/rotation/types'
import { useTurnTally } from './useTurnTally'

const configuration: HouseholdConfiguration = {
  rolesInitialized: true,
  people: [{ id: 'parent', name: 'Parent', role: 'administrator' }, { id: 'adult', name: 'Alex', role: 'editor' }, { id: 'child', name: 'Sam', role: 'viewer' }],
  startDate: '2026-09-07',
  rotation: { id: 'middle-seat', name: 'Middle seat', type: 'burden', cadence: 'daily', roster: ['adult', 'child'], desirability: 1, maxConsecutive: 2, order: 0, restricted: false },
}
const draft = { name: 'Kitchen', cadence: 'daily' as const, roster: ['adult', 'child'], startDate: '2026-09-07' }

describe('application permissions', () => {
  beforeEach(() => localStorage.clear())

  it('rejects every viewer mutation even when called without UI controls', async () => {
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    const { result } = renderHook(() => useTurnTally(repository, '2026-09-07'))
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    await act(() => result.current.selectProfile('child'))
    const before = await repository.readSnapshot()
    await expect(result.current.saveActivity(draft)).rejects.toThrow('cannot make changes')
    await expect(result.current.recordOutcome('middle-seat:2026-09-07', { outcome: 'no-trip' })).rejects.toThrow('cannot make changes')
    await expect(result.current.saveMember({ name: 'Sam', role: 'administrator', active: true }, 'child')).rejects.toThrow('Only an administrator')
    await expect(result.current.reset()).rejects.toThrow('Only an administrator')
    await expect(result.current.createHousehold(['New', 'Family'])).rejects.toThrow('already exists')
    await expect(result.current.setupAdministrator({ personId: 'child' })).rejects.toThrow('already been set up')
    await expect(result.current.setActivityArchived('middle-seat', true)).rejects.toThrow('cannot make changes')
    await expect(result.current.exportBackup()).rejects.toThrow('cannot make changes')
    await expect(result.current.previewBackup('{}')).rejects.toThrow('Only an administrator')
    await expect(result.current.importBackup('{}', '')).rejects.toThrow('Only an administrator')
    await expect(result.current.changeAbsence({ personId: 'adult', activityIds: ['middle-seat'], start: '2026-09-07', end: '2026-09-09' })).rejects.toThrow('cannot make changes')
    await expect(result.current.changeAbsence('some-range')).rejects.toThrow('cannot make changes')
    expect(await repository.loadConfiguration()).toEqual(configuration)
    expect(await repository.readSnapshot()).toEqual(before)
  })

  it('allows editor activity and outcome changes but denies administration', async () => {
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    const { result } = renderHook(() => useTurnTally(repository, '2026-09-07'))
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    await act(() => result.current.selectProfile('adult'))
    await act(() => result.current.saveActivity(draft))
    await act(() => result.current.recordOutcome('middle-seat:2026-09-07', { outcome: 'no-trip' }))
    expect(result.current.activities).toHaveLength(2)
    expect(result.current.activities[0].records[0].outcome).toBe('no-trip')
    await expect(result.current.saveMember({ name: 'Alex', role: 'administrator', active: true }, 'adult')).rejects.toThrow('Only an administrator')
    await expect(result.current.reset()).rejects.toThrow('Only an administrator')
    await act(() => result.current.setActivityArchived('middle-seat', true))
    expect(await result.current.exportBackup()).toContain('turntally-backup')
    await expect(result.current.previewBackup('{}')).rejects.toThrow('Only an administrator')
    await expect(result.current.importBackup('{}', '')).rejects.toThrow('Only an administrator')
  })

  it('checks stored role changes even when a stale view still shows editor controls', async () => {
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    const { result } = renderHook(() => useTurnTally(repository, '2026-09-07'))
    await waitFor(() => expect(result.current.phase).toBe('ready'))
    await act(() => result.current.selectProfile('adult'))
    const savedAction = result.current.saveActivity
    const savedAbsenceAction = result.current.changeAbsence
    await repository.saveConfiguration({ ...configuration, people: configuration.people.map((person) => person.id === 'adult' ? { ...person, role: 'viewer' } : person) })
    await expect(savedAction(draft)).rejects.toThrow('cannot make changes')
    await expect(savedAbsenceAction('some-range')).rejects.toThrow('cannot make changes')
  })
})
