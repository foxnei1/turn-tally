import { format, parseISO } from 'date-fns'
import { useState } from 'react'

import type { RotationRecord } from '../../domain/rotation/engine'
import type { TurnCorrection } from '../../domain/rotation/events'
import type { Person } from '../../domain/rotation/types'
import { CorrectionChoices } from '../seating/CorrectionChoices'

interface RotationHistoryProps {
  records: readonly RotationRecord[]
  people: readonly Person[]
  onCorrect: (record: RotationRecord, correction: TurnCorrection) => Promise<void>
  canEdit?: boolean
}

function outcomeLabel(record: RotationRecord): string {
  const chore = record.rotation?.kind === 'chore'
  if (record.outcome === 'trade') return chore ? 'Handled the chore instead' : 'Took the seat instead'
  if (record.outcome === 'outside-cover') return 'Parental coverage · previous penalty rule'
  if (record.outcome === 'adult-cover') return chore ? 'Outside coverage · turn skipped' : 'Parental coverage · turn skipped'
  if (record.outcome === 'no-trip') return 'No trip · turn skipped'
  if (record.outcome === 'excused' || !record.servedById) return 'Turn skipped'
  if (record.outcome === 'as-scheduled') return 'Recorded'
  return 'As planned · no change reported'
}

export function RotationHistory({ records, people, onCorrect, canEdit = true }: RotationHistoryProps) {
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recentRecords = [...records].reverse().slice(0, 14)

  async function correct(record: RotationRecord, correction: TurnCorrection) {
    setSaving(true)
    setError(null)
    try {
      await onCorrect(record, correction)
      setEditingSlotId(null)
    } catch {
      setError('Couldn’t save this change. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="mt-6 rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <summary className="cursor-pointer font-semibold text-emerald-800">History</summary>
      <p className="mt-3 text-sm text-stone-500">Last 14 turns. Unchanged turns count as planned.</p>
      <div className="mt-3 divide-y divide-stone-200">
        {recentRecords.map((record) => (
          <article key={record.slotId}>
            <div className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="text-sm text-stone-500">{record.rotation?.cadence === 'weekly' ? 'Week of ' : ''}{format(parseISO(record.date), 'EEE, MMM d')}</p>
                <p className="break-words font-semibold text-stone-900">{people.find((person) => person.id === record.servedById)?.name ?? 'No family turn'}</p>
                <p className="text-sm text-stone-600">{outcomeLabel(record)}</p>
                {record.absentIds.length > 0 ? <p className="text-sm text-stone-500">Away: {people.filter((person) => record.absentIds.includes(person.id)).map((person) => person.name).join(', ')}</p> : null}
              </div>
              {canEdit ? <button
                type="button"
                disabled={saving}
                aria-label={'Change turn for ' + format(parseISO(record.date), 'MMMM d')}
                onClick={() => { setEditingSlotId((current) => current === record.slotId ? null : record.slotId); setError(null) }}
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
              >
                Change
              </button> : null}
            </div>
            {canEdit && editingSlotId === record.slotId ? (
              <fieldset disabled={saving} aria-busy={saving} className="pb-5">
                <p className="text-sm leading-6 text-stone-600">{record.explanation}</p>
                <CorrectionChoices record={record} people={people.filter((person) => !record.rotation || record.rotation.roster.includes(person.id))} onChoose={(correction) => void correct(record, correction)} onCancel={() => setEditingSlotId(null)} />
                {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
              </fieldset>
            ) : null}
          </article>
        ))}
      </div>
    </details>
  )
}
