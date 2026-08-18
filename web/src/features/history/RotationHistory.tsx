import { format, parseISO } from 'date-fns'
import { useState } from 'react'

import type { RotationRecord } from '../../domain/rotation/engine'
import type { Person, PersonId } from '../../domain/rotation/types'
import { CorrectionChoices } from '../seating/CorrectionChoices'

interface RotationHistoryProps {
  records: readonly RotationRecord[]
  people: readonly Person[]
  onCorrect: (record: RotationRecord, covererId: PersonId | null) => Promise<void>
}

function personName(people: readonly Person[], personId: PersonId | null): string {
  return people.find((person) => person.id === personId)?.name ?? 'Unknown'
}

function outcomeLabel(record: RotationRecord, people: readonly Person[]): string {
  if (record.outcome === 'trade') {
    return `${personName(people, record.servedById)} covered`
  }
  if (record.outcome === 'outside-cover') {
    return 'Adult covered'
  }
  if (record.outcome === 'excused') {
    return 'Excused'
  }
  if (record.outcome === 'as-scheduled') {
    return 'Confirmed'
  }
  return 'Assigned; no change reported'
}

export function RotationHistory({ records, people, onCorrect }: RotationHistoryProps) {
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const recentRecords = [...records].reverse().slice(0, 14)

  async function correct(record: RotationRecord, covererId: PersonId | null) {
    setSaving(true)
    try {
      await onCorrect(record, covererId)
      setEditingSlotId(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="history-title" className="mt-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-wide text-emerald-800 uppercase">Recent days</p>
          <h2 id="history-title" className="mt-1 text-2xl font-semibold text-stone-900">What was recorded</h2>
        </div>
        <span className="text-xs text-stone-500">Latest 14</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white">
        {recentRecords.map((record, index) => (
          <article key={record.slotId} className={index === 0 ? '' : 'border-t border-stone-200'}>
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm text-stone-500">{format(parseISO(record.date), 'EEE, MMM d')}</p>
                <p className="truncate font-semibold text-stone-900">{personName(people, record.assigneeId)}</p>
                <p className="text-sm text-stone-600">{outcomeLabel(record, people)}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSlotId((current) => current === record.slotId ? null : record.slotId)}
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
              >
                {record.outcome === 'assumed' ? 'Correct' : 'Change'}
              </button>
            </div>
            {editingSlotId === record.slotId ? (
              <fieldset disabled={saving} className="border-t border-stone-200 px-5 pb-5">
                <CorrectionChoices
                  assigneeId={record.assigneeId}
                  people={people}
                  includeAssignee
                  onChoose={(covererId) => void correct(record, covererId)}
                  onCancel={() => setEditingSlotId(null)}
                />
              </fieldset>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
