import { beforeEach, describe, expect, it } from 'vitest'

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
})
