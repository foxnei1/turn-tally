import { format, parseISO } from 'date-fns'
import { useState } from 'react'
import { householdActivities, isArchived } from '../../domain/rotation/activities'
import type { AbsenceDraft, AbsenceRange, CalendarDate, HouseholdConfiguration } from '../../domain/rotation/types'

interface Props {
  configuration: HouseholdConfiguration
  today: CalendarDate
  canEdit: boolean
  onChange: (draftOrId: AbsenceDraft | string) => Promise<void>
  onBack: () => void
}

const inputClass = 'mt-1 block w-full rounded-xl border border-stone-300 bg-white p-3 text-stone-900'
const dateLabel = (date: string) => format(parseISO(date), 'MMM d, yyyy')

export function AbsencesScreen({ configuration, today, canEdit, onChange, onBack }: Props) {
  const activities = householdActivities(configuration)
  const active = activities.filter((activity) => !isArchived(activity))
  const [adding, setAdding] = useState(false)
  const [personId, setPersonId] = useState('')
  const [activityIds, setActivityIds] = useState<string[]>([])
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [ending, setEnding] = useState<string | null>(null)
  const ranges = [...(configuration.absences ?? [])].sort((a, b) => a.start.localeCompare(b.start))
  const upcoming = ranges.filter((range) => range.end >= today)
  const past = ranges.filter((range) => range.end < today)

  async function save(value: AbsenceDraft | string) {
    setBusy(true); setError(null); setMessage(null)
    try {
      await onChange(value)
      setAdding(false); setEnding(null)
      setMessage(typeof value === 'string' ? 'Absence updated. Turns already started are kept.' : 'Absence saved. Reported outcomes are kept; you can change an individual turn in its activity.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this absence.') }
    finally { setBusy(false) }
  }

  function rangeCard(range: AbsenceRange) {
    const future = range.start > today
    return <li key={range.id} className="rounded-2xl border border-stone-200 bg-white p-5">
      <p className="font-semibold text-stone-900">{configuration.people.find((person) => person.id === range.personId)?.name}</p>
      <p className="mt-1 text-sm text-stone-600">{dateLabel(range.start)} – {dateLabel(range.end)}{range.start <= today && today <= range.end ? ' · Away now' : ''}</p>
      <p className="mt-2 text-sm text-stone-600">{range.activityIds.map((id) => activities.find((activity) => activity.id === id)?.name).join(', ')}</p>
      {canEdit && range.end > today ? ending === range.id ? <div className="mt-3 text-sm text-stone-700">
        <p>{future ? 'Cancel this planned absence?' : 'Make this the last day away? They can take turns starting tomorrow. A weekly turn already started stays as recorded.'} Other overlapping absences still apply.</p>
        <div className="mt-3 flex gap-4"><button type="button" disabled={busy} onClick={() => void save(range.id)} className="font-semibold text-emerald-800">{future ? 'Confirm cancellation' : 'Confirm end today'}</button><button type="button" disabled={busy} onClick={() => setEnding(null)}>Keep absence</button></div>
      </div> : <button type="button" disabled={busy} onClick={() => { setEnding(range.id); setError(null); setMessage(null) }} className="mt-3 text-sm font-semibold text-emerald-800">{future ? 'Cancel absence' : 'End after today'}</button> : null}
    </li>
  }

  return <section aria-labelledby="absences-title">
    <button type="button" disabled={busy} onClick={onBack} className="mb-5 font-semibold text-emerald-800">All activities</button>
    <div className="flex items-center justify-between gap-3"><h1 id="absences-title" className="text-3xl font-semibold text-stone-900">Absences</h1>{canEdit && !adding ? <button type="button" onClick={() => { setAdding(true); setEnding(null); setPersonId(''); setActivityIds([]); setStart(today); setEnd(today); setError(null); setMessage(null) }} className="rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white">Plan absence</button> : null}</div>
    <p className="mt-3 text-sm leading-6 text-stone-600">Choose who is away, when, and which activities to skip. Away members get no credit or extra turns owed.</p>
    <details className="mt-3 text-sm leading-6 text-stone-600"><summary className="cursor-pointer font-semibold">How dates affect turns</summary><p className="mt-2">Both dates are included. A weekly chore checks who is away on its first day. Leaving or returning midweek keeps that week’s turn unchanged. Use the activity’s correction controls if that week needs different coverage.</p><p className="mt-2">New ranges can affect turns starting today. Previously reported outcomes and earlier turns stay as recorded. Overlapping ranges count a person away once. A range applies whenever the person participates in a selected activity.</p></details>
    {adding && canEdit ? <form onSubmit={(event) => { event.preventDefault(); void save({ personId, activityIds, start, end }) }} className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
      <fieldset disabled={busy} className="space-y-4">
        <legend className="mb-4 text-lg font-semibold text-stone-900">Plan an absence</legend>
        <label className="block text-sm font-medium text-stone-700">Who is away?<select required value={personId} onChange={(event) => setPersonId(event.target.value)} className={inputClass}><option value="">Choose a person</option>{configuration.people.filter((person) => person.active !== false).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium text-stone-700">First day away<input required type="date" min={today} value={start} onChange={(event) => { setStart(event.target.value); if (end < event.target.value) setEnd(event.target.value) }} className={inputClass} /></label><label className="block text-sm font-medium text-stone-700">Last day away<input required type="date" min={start || today} value={end} onChange={(event) => setEnd(event.target.value)} className={inputClass} /></label></div>
        <fieldset><legend className="text-sm font-medium text-stone-700">Activities to skip</legend><div className="mt-2 space-y-2">{active.map((activity) => <label key={activity.id} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 text-sm text-stone-800"><input type="checkbox" checked={activityIds.includes(activity.id)} onChange={(event) => setActivityIds((current) => event.target.checked ? [...current, activity.id] : current.filter((id) => id !== activity.id))} className="h-5 w-5 accent-emerald-800" />{activity.name}</label>)}</div>{!active.length ? <p className="mt-2 text-sm text-stone-600">Restore or add an activity first.</p> : null}</fieldset>
        <p className="text-sm leading-6 text-stone-600">Weekly chores skip turns that start within these dates. Midweek departures do not change a turn already underway.</p>
        <div className="flex gap-4"><button type="submit" disabled={!activityIds.length || !personId} className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">Save absence</button><button type="button" onClick={() => { setAdding(false); setError(null) }} className="font-semibold text-stone-600">Cancel</button></div>
      </fieldset>
    </form> : null}
    {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="mt-4 text-sm text-emerald-800">{message}</p> : null}
    <h2 className="mt-6 text-lg font-semibold text-stone-900">Current and upcoming</h2>
    {upcoming.length ? <ul className="mt-3 space-y-3">{upcoming.map(rangeCard)}</ul> : <p className="mt-3 text-sm text-stone-600">No absences planned.</p>}
    {past.length ? <details className="mt-6"><summary className="cursor-pointer text-sm font-semibold text-emerald-800">Past absences ({past.length})</summary><ul className="mt-3 space-y-3">{past.reverse().map(rangeCard)}</ul></details> : null}
  </section>
}
