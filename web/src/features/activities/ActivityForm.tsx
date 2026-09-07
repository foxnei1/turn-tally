import { format, parseISO } from 'date-fns'
import { useState, type FormEvent } from 'react'

import type { ActivityView } from '../../domain/rotation/activities'
import { nextTurnDate } from '../../domain/rotation/schedule'
import type { ActivityDraft, CalendarDate, Cadence, Person } from '../../domain/rotation/types'

interface ActivityFormProps {
  people: readonly Person[]
  today: CalendarDate
  activityView?: ActivityView
  onSave: (draft: ActivityDraft) => Promise<void>
  onCancel: () => void
}

const templates = ['Kitchen duty', 'Bathroom cleaning', 'Living room cleaning', 'Dining room cleaning']
const inputClass = 'mt-2 w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-stone-900'

export function ActivityForm({ people, today, activityView, onSave, onCancel }: ActivityFormProps) {
  const activity = activityView?.activity
  const latest = activity?.revisions?.at(-1) ?? activity
  const current = activityView?.records.at(-1)
  const [name, setName] = useState(activity?.name ?? '')
  const [cadence, setCadence] = useState<Cadence>(latest?.cadence ?? 'weekly')
  const [roster, setRoster] = useState([...(latest?.roster ?? people.map((person) => person.id))])
  const [firstPerson, setFirstPerson] = useState(latest?.roster[0] ?? people[0].id)
  const [startDate, setStartDate] = useState(activity?.startDate ?? today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const effectiveDate = current ? nextTurnDate(current.date, current.rotation ?? activity!) : startDate

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const ordered = !current && roster.includes(firstPerson) ? [firstPerson, ...roster.filter((id) => id !== firstPerson)] : roster
      await onSave({ name, cadence, roster: ordered, startDate })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Couldn’t save this activity. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="activity-form-title" className="rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
      <h1 id="activity-form-title" className="text-2xl font-semibold text-stone-900">{activity ? 'Edit activity' : 'Add an activity'}</h1>
      <p className="mt-2 text-sm leading-6 text-stone-600">Each activity takes turns separately.</p>
      <form onSubmit={submit} className="mt-5">
        <fieldset disabled={saving} className="space-y-5">
          {!activity ? <div className="flex flex-wrap gap-2" aria-label="Suggested chores">
            {templates.map((template) => <button key={template} type="button" className="rounded-full bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900" onClick={() => { setName(template); setCadence(template === 'Kitchen duty' ? 'daily' : 'weekly') }}>{template}</button>)}
          </div> : null}
          <label className="block text-sm font-medium text-stone-800">Activity name
            <input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Kitchen duty" className={inputClass} />
          </label>
          <label className="block text-sm font-medium text-stone-800">Switch turns
            <select value={cadence} onChange={(event) => setCadence(event.target.value as Cadence)} className={inputClass}>
              <option value="daily">Every day</option>{activity?.kind !== 'seating' ? <option value="weekly">Every week</option> : null}
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-medium text-stone-800">Who shares this activity?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {people.map((person) => <label key={person.id} className="flex items-center gap-3 rounded-xl border border-stone-200 px-4 py-3 text-stone-800">
                <input type="checkbox" checked={roster.includes(person.id)} onChange={(event) => setRoster((currentRoster) => event.target.checked ? [...currentRoster, person.id] : currentRoster.filter((id) => id !== person.id))} className="h-5 w-5 accent-emerald-800" />{person.name}
              </label>)}
            </div>
          </fieldset>
          {!current ? <>
            <label className="block text-sm font-medium text-stone-800">First turn
              <select value={roster.includes(firstPerson) ? firstPerson : roster[0] ?? ''} onChange={(event) => setFirstPerson(event.target.value)} className={inputClass}>
                {roster.map((id) => <option key={id} value={id}>{people.find((person) => person.id === id)?.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-stone-800">Start date
              <input type="date" required min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />
            </label>
            <p className="text-sm leading-6 text-stone-600">{cadence === 'weekly' ? 'Each person keeps the duty for seven days, starting on the date above.' : 'A new person is assigned each day.'}</p>
          </> : <p className="text-sm leading-6 text-stone-600">Schedule and people changes start {format(parseISO(effectiveDate), 'MMMM d, yyyy')}. The current turn and history stay as recorded. Name changes appear immediately.</p>}
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          <div className="flex gap-3">
            <button type="submit" className="flex-1 rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save activity'}</button>
            <button type="button" onClick={onCancel} className="rounded-xl px-4 py-3 font-semibold text-stone-600">Cancel</button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
