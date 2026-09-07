import { differenceInCalendarDays, isMatch, parseISO } from 'date-fns'
import type { HouseholdSnapshot } from '../../data/RotationRepository'
import { householdActivities, isArchived, replayActivities } from '../rotation/activities'
import type { RotationEvent } from '../rotation/events'
import type { CalendarDate, HouseholdConfiguration } from '../rotation/types'

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024
export interface Backup {
  format: 'turntally-backup'
  version: 1
  exportedAt: string
  configuration: HouseholdConfiguration
  events: readonly RotationEvent[]
}
export interface BackupPreview {
  backup: Backup
  expectedState: string
  current: { people: number; activities: number; events: number; absences: number }
}

function invalid(message: string): never { throw new Error('Invalid backup: ' + message) }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label + ' must be an object.')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid('The file contains unsupported fields. It may need a newer app version.')
}
function list(value: unknown, label: string, max = 10000): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(label + ' must be a supported list.')
  return value
}
function string(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(label + ' must be nonempty text.')
  return value
}
function id(value: unknown): string {
  const result = string(value, 'ID', 200)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(result) || ['constructor', 'prototype', '__proto__'].includes(result)) invalid('Unsupported ID.')
  return result
}
function date(value: unknown): CalendarDate {
  const result = string(value, 'Date', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !isMatch(result, 'yyyy-MM-dd')) invalid('Dates must use YYYY-MM-DD.')
  return result
}
function oneOf(value: unknown, values: readonly unknown[], label: string) {
  if (!values.includes(value)) invalid('Unsupported ' + label + '.')
}
function ids(value: unknown, known: Set<string>, label: string): string[] {
  const result = list(value, label, 1000).map(id)
  if (new Set(result).size !== result.length || result.some((item) => !known.has(item))) invalid(label + ' contains duplicate or unknown people.')
  return result
}

function validateConfiguration(input: unknown): HouseholdConfiguration {
  const config = object(input, 'Configuration')
  keys(config, ['people', 'rotation', 'startDate', 'activities', 'rolesInitialized', 'absences'])
  date(config.startDate)
  if (config.rolesInitialized !== undefined) oneOf(config.rolesInitialized, [true, false], 'role setup')
  const people = list(config.people, 'People', 1000).map((item) => {
    const person = object(item, 'Person')
    keys(person, ['id', 'name', 'role', 'active'])
    id(person.id); string(person.name, 'Name')
    if (person.role !== undefined) oneOf(person.role, ['administrator', 'editor', 'viewer'], 'role')
    if (person.active !== undefined) oneOf(person.active, [true, false], 'member status')
    return person
  })
  const known = new Set(people.map((person) => id(person.id)))
  if (!people.length || known.size !== people.length) invalid('People must have unique IDs.')
  if (new Set(people.map((person) => String(person.name).trim().toLocaleLowerCase())).size !== people.length) invalid('People must have distinct names.')
  if (config.rolesInitialized && !people.some((person) => person.active !== false && person.role === 'administrator')) invalid('The family needs an active administrator.')

  function rotation(input: unknown, activity: boolean) {
    const item = object(input, 'Activity')
    keys(item, ['id', 'name', 'type', 'cadence', 'desirability', 'maxConsecutive', 'order', 'restricted', 'roster', 'kind', 'revisions', 'pauses', ...(activity ? ['startDate'] : [])])
    id(item.id); string(item.name, 'Activity name')
    oneOf(item.type, ['burden'], 'activity type')
    oneOf(item.cadence, ['daily', 'weekly'], 'cadence')
    oneOf(item.restricted, [true, false], 'restriction')
    if (item.kind !== undefined) oneOf(item.kind, ['seating', 'chore'], 'activity kind')
    for (const field of ['desirability', 'maxConsecutive', 'order']) {
      if (typeof item[field] !== 'number' || !Number.isFinite(item[field]) || (item[field] as number) < (field === 'order' ? 0 : 1) || (item[field] as number) > 100000) invalid('Invalid activity values.')
    }
    if (!Number.isInteger(item.maxConsecutive) || !Number.isInteger(item.order)) invalid('Turn limits and order must be whole numbers.')
    ids(item.roster, known, 'Participants')
    const start = activity ? date(item.startDate) : date(config.startDate)
    let prior = ''
    if (item.revisions !== undefined) for (const value of list(item.revisions, 'Schedule changes')) {
      const revision = object(value, 'Schedule change')
      keys(revision, ['effectiveDate', 'cadence', 'roster'])
      const effective = date(revision.effectiveDate)
      if (effective < start || effective <= prior) invalid('Schedule changes must be ordered and start after the activity begins.')
      prior = effective
      oneOf(revision.cadence, ['daily', 'weekly'], 'cadence')
      ids(revision.roster, known, 'Participants')
    }
    let previousEnd = start
    if (item.pauses !== undefined) for (const value of list(item.pauses, 'Archive periods')) {
      const pause = object(value, 'Archive period')
      keys(pause, ['from', 'until'])
      const from = date(pause.from)
      if (from < previousEnd) invalid('Archive periods cannot overlap or precede the activity.')
      const until = pause.until === undefined ? undefined : date(pause.until)
      if (until && until < from) invalid('An activity cannot resume before its archive period.')
      previousEnd = until ?? '9999-12-31'
    }
    return item
  }
  rotation(config.rotation, false)
  if (config.activities !== undefined) {
    const activities = list(config.activities, 'Activities', 1000).map((item) => rotation(item, true))
    if (!activities.length || new Set(activities.map((item) => item.id)).size !== activities.length) invalid('Activities must have unique IDs.')
  }
  if (config.absences !== undefined) {
    const activityIds = new Set(householdActivities(config as unknown as HouseholdConfiguration).map((activity) => activity.id))
    const ranges = list(config.absences, 'Absence ranges').map((value) => {
      const range = object(value, 'Absence range')
      keys(range, ['id', 'personId', 'activityIds', 'start', 'end'])
      id(range.id)
      if (!known.has(id(range.personId))) invalid('An absence references an unknown person.')
      if (date(range.end) < date(range.start)) invalid('An absence ends before it starts.')
      if (!ids(range.activityIds, activityIds, 'Absence activities').length) invalid('An absence needs an activity.')
      return range
    })
    if (new Set(ranges.map((range) => range.id)).size !== ranges.length) invalid('Absence ranges must have unique IDs.')
  }
  return config as unknown as HouseholdConfiguration
}

export function parseBackup(text: string, today: CalendarDate): Backup {
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('This backup is too large. Choose a file smaller than 10 MB.')
  let input: unknown
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('This file is not valid JSON. Choose a TurnTally backup.') }
  const root = object(input, 'Backup')
  if (root.format !== 'turntally-backup') throw new Error('Choose a TurnTally backup file.')
  if (root.version !== 1) throw new Error('This backup version is not supported. Update TurnTally before restoring it.')
  keys(root, ['format', 'version', 'exportedAt', 'configuration', 'events'])
  const exportedAt = string(root.exportedAt, 'Export time', 50)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(exportedAt) || !Number.isFinite(Date.parse(exportedAt))) invalid('Export time is not valid.')
  date(exportedAt.slice(0, 10))
  const configuration = validateConfiguration(root.configuration)
  const activities = householdActivities(configuration)
  if (activities.reduce((total, activity) => total + Math.max(0, differenceInCalendarDays(parseISO(today), parseISO(activity.startDate))) + 1, 0) > 200000) invalid('The scheduling range is too large to restore.')
  const knownPeople = new Set(configuration.people.map((person) => person.id))
  const activityIds = new Set(activities.map((activity) => activity.id))
  const events = list(root.events, 'History', 100000).map((value) => {
    const event = object(value, 'History event')
    id(event.eventId)
    const slot = string(event.slotId, 'Turn ID', 220)
    const match = /^(.*):(\d{4}-\d{2}-\d{2})$/.exec(slot)
    if (!match || !activityIds.has(match[1])) invalid('History references an unknown activity.')
    if (date(match[2]) > today) invalid('History includes future turns. Check the date on this device.')
    if (event.type === 'assignment-recorded') {
      keys(event, ['type', 'eventId', 'slotId', 'personId', 'absentIds'])
      if (event.absentIds !== undefined) ids(event.absentIds, knownPeople, 'Recorded attendance')
      if (event.personId !== null && !knownPeople.has(id(event.personId))) invalid('An assignment references an unknown person.')
    } else if (event.type === 'outcome-recorded') {
      keys(event, ['type', 'eventId', 'slotId', 'outcome', 'covererId', 'absentIds', 'supersedes', 'source'])
      if (event.source !== undefined) {
        oneOf(event.source, ['absence-range'], 'correction source')
        if (event.outcome !== 'absence') invalid('A range correction must report attendance.')
      }
      oneOf(event.outcome, ['as-scheduled', 'trade', 'outside-cover', 'excused', 'no-trip', 'adult-cover', 'absence'], 'outcome')
      if (event.covererId !== undefined && !knownPeople.has(id(event.covererId))) invalid('A correction references an unknown person.')
      if (event.outcome === 'trade' && event.covererId === undefined) invalid('A covered turn needs a person.')
      if (event.absentIds !== undefined) ids(event.absentIds, knownPeople, 'Absences')
      const supersedes = list(event.supersedes, 'Replaced corrections').map(id)
      if (new Set(supersedes).size !== supersedes.length) invalid('A correction lists the same replacement twice.')
    } else invalid('Unsupported history event.')
    return event as unknown as RotationEvent
  })
  if (new Set(events.map((event) => event.eventId)).size !== events.length) invalid('History contains duplicate event IDs.')
  // Replay validates generated turn IDs, eligible coverers, assignment anchors,
  // replacement references, cycles, and unresolved outcome conflicts.
  replayActivities(configuration, events, today)
  return { format: 'turntally-backup', version: 1, exportedAt, configuration, events }
}

export function createBackup(snapshot: HouseholdSnapshot, today: CalendarDate, exportedAt = new Date().toISOString()): string {
  if (!snapshot.configuration) throw new Error('There is no family to back up yet.')
  const text = JSON.stringify({ format: 'turntally-backup', version: 1, exportedAt, ...snapshot }, null, 2)
  parseBackup(text, today)
  return text
}

export function backupCounts(configuration: HouseholdConfiguration | null, events: readonly RotationEvent[]) {
  const activities = configuration ? householdActivities(configuration) : []
  return { people: configuration?.people.length ?? 0, activities: activities.length, archived: activities.filter(isArchived).length, events: events.length, absences: configuration?.absences?.length ?? 0 }
}
