import { beforeEach, describe, expect, it } from 'vitest'

import type { AssignmentRecorded } from '../domain/rotation/events'
import { LocalStorageRotationRepository } from './localStorageRepository'

const assignment: AssignmentRecorded = {
  type: 'assignment-recorded',
  eventId: 'assignment-1',
  slotId: 'middle-seat:2026-08-17',
  personId: 'elena',
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
})
