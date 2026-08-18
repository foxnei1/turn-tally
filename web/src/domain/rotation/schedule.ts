import type { CalendarDate, RotationId, SlotId } from './types'

export function createSlotId(rotationId: RotationId, date: CalendarDate): SlotId {
  return `${rotationId}:${date}`
}
