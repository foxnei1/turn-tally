import { useState } from 'react'

import type { RotationRecord } from '../../domain/rotation/engine'
import type { Person, PersonId } from '../../domain/rotation/types'
import { CorrectionChoices } from './CorrectionChoices'

interface TodaySeatCardProps {
  record: RotationRecord
  people: readonly Person[]
  rotationName: string
  dateLabel: string
  onConfirm: () => Promise<void>
  onCorrect: (covererId: PersonId | null) => Promise<void>
}

export function TodaySeatCard({
  record,
  people,
  rotationName,
  dateLabel,
  onConfirm,
  onCorrect,
}: TodaySeatCardProps) {
  const [correcting, setCorrecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const assignee = people.find((person) => person.id === record.assigneeId)!
  const servedBy = people.find((person) => person.id === record.servedById)
  const pending = record.outcome === 'assumed'

  async function confirm() {
    setSaving(true)
    try {
      await onConfirm()
    } finally {
      setSaving(false)
    }
  }

  async function saveCorrection(covererId: PersonId | null) {
    setSaving(true)
    try {
      await onCorrect(covererId)
      setCorrecting(false)
    } finally {
      setSaving(false)
    }
  }

  let status = 'Turn confirmed.'
  if (record.outcome === 'trade') {
    status = `${servedBy?.name ?? 'Another person'} took it instead.`
  } else if (record.outcome === 'outside-cover') {
    status = 'An adult covered this turn.'
  }

  return (
    <section aria-labelledby="seat-card-title" className="rounded-3xl border border-stone-200 bg-white p-6 shadow-[0_20px_60px_rgba(41,51,45,0.10)] sm:p-8">
      <p className="text-sm font-medium text-stone-500">{dateLabel}</p>
      <h2 id="seat-card-title" className="mt-2 text-2xl font-medium text-stone-700">{rotationName}</h2>
      <p className="mt-6 text-5xl font-semibold tracking-tight text-emerald-800">{assignee.name}</p>

      {!correcting && pending ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void confirm()}
            className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white transition hover:bg-emerald-900 disabled:opacity-60"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setCorrecting(true)}
            className="rounded-xl border border-stone-300 px-4 py-3 font-semibold text-stone-700 transition hover:bg-stone-50"
          >
            Wasn't me
          </button>
        </div>
      ) : null}

      {!correcting && !pending ? (
        <div className="mt-8 flex items-center justify-between gap-4 rounded-xl bg-stone-100 px-4 py-3">
          <p role="status" className="text-sm text-stone-700">{status}</p>
          <button type="button" onClick={() => setCorrecting(true)} className="shrink-0 text-sm font-semibold text-emerald-800 hover:text-emerald-950">
            Change
          </button>
        </div>
      ) : null}

      {correcting ? (
        <fieldset disabled={saving}>
          <CorrectionChoices
            assigneeId={record.assigneeId}
            people={people}
            includeAssignee={!pending}
            onChoose={(covererId) => void saveCorrection(covererId)}
            onCancel={() => setCorrecting(false)}
          />
        </fieldset>
      ) : null}
    </section>
  )
}
