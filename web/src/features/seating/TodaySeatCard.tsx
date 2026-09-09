import { useState } from 'react'

import type { RotationRecord } from '../../domain/rotation/engine'
import type { TurnCorrection } from '../../domain/rotation/events'
import type { Person } from '../../domain/rotation/types'
import { CorrectionChoices } from './CorrectionChoices'

interface TodaySeatCardProps {
  record: RotationRecord
  people: readonly Person[]
  rotationName: string
  dateLabel: string
  onCorrect: (correction: TurnCorrection) => Promise<void>
  canEdit?: boolean
}

export function TodaySeatCard({ record, people, rotationName, dateLabel, onCorrect, canEdit = true }: TodaySeatCardProps) {
  const [correcting, setCorrecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const person = people.find((person) => person.id === record.servedById)
  const assignee = people.find((person) => person.id === record.assigneeId)!
  const assumed = record.outcome === 'assumed' || record.outcome === 'absence'
  const chore = record.rotation?.kind === 'chore'
  const weekly = record.rotation?.cadence === 'weekly'

  async function saveCorrection(correction: TurnCorrection) {
    setSaving(true)
    setError(null)
    try {
      await onCorrect(correction)
      setCorrecting(false)
    } catch {
      setError('Couldn’t save this change. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  let title = person?.name ?? 'Turn skipped'
  let status = person ? person.name + '’s turn is recorded.' : 'Nobody gets credit or owes an extra turn.'
  if (assumed && person) status = canEdit ? 'We’ll count this as ' + person.name + '’s turn unless you change it.' : 'Counted as ' + person.name + '’s turn. An editor can record changes.'
  if (record.outcome === 'trade') status = person?.name + (chore ? ' handled the chore' : ' took the seat') + (assignee ? ' instead of ' + assignee.name : '') + '.'
  if (record.assigneeId === null && !person && assumed) { title = record.absentIds.length ? 'Not enough people here' : 'Needs participants'; status = 'No turn is counted until enough people share this activity.' }
  if (record.outcome === 'no-trip') title = 'No trip this day'
  if (record.outcome === 'adult-cover') title = chore ? 'Covered by someone else' : 'Parental coverage'
  if (record.outcome === 'excused' && chore) title = 'Not needed this turn'
  if (record.outcome === 'outside-cover') {
    title = 'Parental coverage'
    status = 'An older rule made the assigned person due sooner. See the turn details.'
  }

  return (
    <section aria-labelledby="seat-card-title" className="rounded-3xl border border-stone-200 bg-white p-6 shadow-[0_20px_60px_rgba(41,51,45,0.10)] sm:p-8">
      <p className="text-sm font-medium text-stone-500">{dateLabel}</p>
      <h1 id="seat-card-title" className="mt-2 text-xl font-medium text-stone-700">{chore ? rotationName : 'Today’s ' + rotationName.toLowerCase()}</h1>
      {weekly ? <p className="mt-2 text-sm text-stone-500">One person is responsible for the whole week.</p> : null}
      <p className="mt-5 break-words text-4xl font-semibold tracking-tight text-emerald-800 sm:text-5xl">{title}</p>
      <p role="status" className="mt-4 text-base leading-7 text-stone-600">{status}</p>
      {record.absentIds.length > 0 ? (
        <p className="mt-2 text-sm text-stone-600">Away: {people.filter((person) => record.absentIds.includes(person.id)).map((person) => person.name).join(', ')}</p>
      ) : null}
      {canEdit && (!correcting ? (
        <button type="button" onClick={() => setCorrecting(true)} className="mt-6 w-full rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white hover:bg-emerald-900">
          {chore ? 'Change who did it' : 'Change who took it'}
        </button>
      ) : (
        <fieldset disabled={saving} aria-busy={saving}>
          <CorrectionChoices record={record} people={people} onChoose={(correction) => void saveCorrection(correction)} onCancel={() => setCorrecting(false)} />
        </fieldset>
      ))}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      <details className="mt-5 border-t border-stone-200 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-emerald-800">{person && assumed ? 'Why ' + person.name + '?' : 'Turn details'}</summary>
        <p className="mt-3 text-sm leading-6 text-stone-600">{record.explanation}</p>
      </details>
    </section>
  )
}
