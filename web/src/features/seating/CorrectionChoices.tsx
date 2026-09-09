import { useState } from 'react'

import type { RotationRecord } from '../../domain/rotation/engine'
import type { TurnCorrection } from '../../domain/rotation/events'
import type { Person } from '../../domain/rotation/types'

interface CorrectionChoicesProps {
  record: RotationRecord
  people: readonly Person[]
  onChoose: (correction: TurnCorrection) => void
  onCancel: () => void
}

const choiceClass = 'rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-left font-medium text-stone-800 hover:border-emerald-700'

export function CorrectionChoices({ record, people, onChoose, onCancel }: CorrectionChoicesProps) {
  const [editingAttendance, setEditingAttendance] = useState(false)
  const [absentIds, setAbsentIds] = useState([...record.absentIds])
  const chore = record.rotation?.kind === 'chore'
  const weekly = record.rotation?.cadence === 'weekly'
  const minimum = chore ? 1 : 2
  const present = people.filter((person) => !absentIds.includes(person.id))

  function saveAttendance() {
    // Editing attendance must not undo an already reported skipped day or cover.
    if (record.outcome === 'no-trip' || record.outcome === 'adult-cover' || record.outcome === 'excused') {
      onChoose({ outcome: record.outcome, absentIds })
    } else if (record.outcome === 'trade' && record.servedById && !absentIds.includes(record.servedById) && present.length >= minimum) {
      onChoose({ outcome: 'trade', covererId: record.servedById, absentIds })
    } else {
      onChoose({ outcome: 'absence', absentIds })
    }
  }

  return (
    <div className="mt-6 rounded-2xl bg-stone-100 p-4">
      {editingAttendance ? (
        <>
          <p className="font-semibold text-stone-800">Who is away for this {weekly ? 'week' : 'day'}?</p>
          <p className="mt-2 text-sm leading-6 text-stone-600">They won’t owe extra turns for this activity. We’ll choose from the people here. This changes only this turn; planned absence ranges still apply to later turns.</p>
          <div className="mt-3 grid gap-2">
            {people.map((person) => (
              <label key={person.id} className={choiceClass + ' flex items-center gap-3'}>
                <input
                  type="checkbox"
                  checked={absentIds.includes(person.id)}
                  onChange={(event) => setAbsentIds((current) => event.target.checked
                    ? [...current, person.id] : current.filter((id) => id !== person.id))}
                  className="h-5 w-5 accent-emerald-800"
                />
                {person.name}
              </label>
            ))}
            <button type="button" className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white" onClick={saveAttendance}>
              Save who’s away
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-semibold text-stone-800">{chore ? 'Who handled this chore?' : 'Who took the middle seat?'}</p>
          <div className="mt-3 grid gap-2">
            {(present.length >= minimum ? present : []).map((person) => (
              <button
                key={person.id}
                type="button"
                className={choiceClass}
                onClick={() => onChoose({
                  outcome: person.id === record.assigneeId ? 'as-scheduled' : 'trade',
                  ...(person.id !== record.assigneeId ? { covererId: person.id } : {}),
                  absentIds,
                })}
              >
                {person.name}
              </button>
            ))}
            <button type="button" className={choiceClass} onClick={() => onChoose({ outcome: chore ? 'excused' : 'no-trip', absentIds })}>{chore ? 'Not needed this turn' : 'No trip this day'}</button>
            <button type="button" className={choiceClass} onClick={() => onChoose({ outcome: 'adult-cover', absentIds })}>{chore ? 'Someone outside this activity covered' : 'Parental coverage'}</button>
          </div>
          <p className="mt-2 text-sm leading-6 text-stone-600">{chore ? 'Not needed or outside coverage skips this turn, with no credit or penalty.' : 'No trip or parental coverage skips the turn, with no credit or penalty.'}</p>
          <button type="button" className="mt-4 font-semibold text-emerald-800" onClick={() => setEditingAttendance(true)}>
            {absentIds.length > 0 ? 'Change who’s away' : 'Someone is away'}
          </button>
        </>
      )}
      <button type="button" onClick={onCancel} className="mt-4 block text-sm font-semibold text-stone-600 hover:text-stone-900">Cancel</button>
    </div>
  )
}
