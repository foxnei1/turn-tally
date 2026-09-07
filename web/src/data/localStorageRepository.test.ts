import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssignmentRecorded } from '../domain/rotation/events'
import { LocalStorageRotationRepository } from './localStorageRepository'

const assignment: AssignmentRecorded = {
  type: 'assignment-recorded',
  eventId: 'assignment-1',
  slotId: 'middle-seat:2026-08-17',
  personId: 'elena',
}

const configuration = {
  people: [{ id: 'elena', name: 'Elena' }],
  startDate: '2026-08-17',
  rotation: {
    id: 'middle-seat',
    name: 'Middle seat',
    type: 'burden' as const,
    cadence: 'daily' as const,
    desirability: 1,
    maxConsecutive: 2,
    order: 0,
    restricted: false,
    roster: ['elena'],
  },
}

describe('LocalStorageRotationRepository', () => {
  beforeEach(() => localStorage.clear())

  it('appends and returns events', async () => {
    const repository = new LocalStorageRotationRepository(localStorage)

    await repository.appendEvent(assignment)

    await expect(repository.listEvents()).resolves.toEqual([assignment])
  })

  it('treats repeated event ids as idempotent writes', async () => {
    const repository = new LocalStorageRotationRepository(localStorage)

    await repository.appendEvent(assignment)
    await repository.appendEvent(assignment)

    await expect(repository.listEvents()).resolves.toHaveLength(1)
  })

  it('persists configuration and clears all prototype data', async () => {
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    await repository.appendEvent(assignment)

    await expect(repository.loadConfiguration()).resolves.toEqual(configuration)

    await repository.clear()
    await expect(repository.loadConfiguration()).resolves.toBeNull()
    await expect(repository.listEvents()).resolves.toEqual([])
  })

  it('reads legacy keys and migrates them on the next successful write', async () => {
    localStorage.setItem('turn-tally.configuration.v1', JSON.stringify(configuration))
    localStorage.setItem('turn-tally.events.v1', JSON.stringify([assignment]))
    const repository = new LocalStorageRotationRepository(localStorage)
    expect(await repository.readSnapshot()).toEqual({ configuration, events: [assignment] })
    await repository.saveConfiguration(configuration)
    expect(localStorage.getItem('turn-tally.configuration.v1')).toBeNull()
    expect(await repository.listEvents()).toEqual([assignment])
  })

  it('keeps the complete original data if the replacement write fails', async () => {
    const repository = new LocalStorageRotationRepository(localStorage)
    const original = { configuration, events: [assignment] }
    await repository.replaceSnapshot(original)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError') })
    await expect(repository.replaceSnapshot({ configuration: null, events: [] })).rejects.toThrow('Full')
    setItem.mockRestore()
    expect(await repository.readSnapshot()).toEqual(original)
  })

  it('rejects a stale restore preview instead of overwriting new edits', async () => {
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    const expected = JSON.stringify(await repository.readSnapshot())
    await repository.appendEvent(assignment)
    await expect(repository.replaceSnapshot({ configuration: null, events: [] }, expected)).rejects.toThrow('changed before saving')
    expect(await repository.listEvents()).toEqual([assignment])
  })
})
