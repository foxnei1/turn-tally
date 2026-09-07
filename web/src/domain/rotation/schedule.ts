import { addDays, format, parseISO } from 'date-fns'
import type { CalendarDate, Rotation, RotationId, SlotId } from './types'

export function rotationAt(rotation: Rotation, date: CalendarDate): Rotation {
  const revision = [...(rotation.revisions ?? [])]
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .filter((item) => item.effectiveDate <= date).at(-1)
  return revision ? { ...rotation, cadence: revision.cadence, roster: revision.roster } : rotation
}

export function nextTurnDate(date: CalendarDate, rotation: Rotation): CalendarDate {
  return format(addDays(parseISO(date), rotation.cadence === 'weekly' ? 7 : 1), 'yyyy-MM-dd')
}

export function* scheduledTurns(rotation: Rotation, startDate: CalendarDate, endDate: CalendarDate) {
  let date = startDate
  while (date <= endDate) {
    const current = rotationAt(rotation, date)
    yield { date, rotation: current }
    date = nextTurnDate(date, current)
  }
}

export function createSlotId(rotationId: RotationId, date: CalendarDate): SlotId {
  return `${rotationId}:${date}`
}
