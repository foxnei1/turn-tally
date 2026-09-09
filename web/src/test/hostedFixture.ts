import type { HouseholdSnapshot } from '../data/RotationRepository'

export function hostedFixture(): HouseholdSnapshot {
  return {
    configuration: {
      rolesInitialized: true,
      people: [
        { id: 'parent', name: 'Parent', role: 'administrator', active: true },
        { id: 'adult', name: 'Adult Child', role: 'editor', active: true },
        { id: 'child', name: 'Child', role: 'viewer', active: true },
      ],
      startDate: '2026-09-07',
      rotation: { id: 'middle-seat', name: 'Middle seat', type: 'burden', cadence: 'daily', desirability: 1, maxConsecutive: 2, order: 0, restricted: false, roster: ['adult', 'child'] },
    },
    events: [],
  }
}
