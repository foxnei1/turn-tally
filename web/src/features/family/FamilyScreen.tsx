import { format, parseISO } from 'date-fns'
import { useState, type FormEvent } from 'react'
import { roleLabels } from '../../domain/family/members'
import type { ActivityView } from '../../domain/rotation/activities'
import { nextTurnDate } from '../../domain/rotation/schedule'
import type { FamilyRole, MemberDraft, Person } from '../../domain/rotation/types'

export function FamilyScreen({ people, activities, canAdminister, onSave }: {
  people: readonly Person[]
  activities: readonly ActivityView[]
  canAdminister: boolean
  onSave: (draft: MemberDraft, id?: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState<FamilyRole>('viewer')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function edit(person?: Person) {
    setEditing(person?.id ?? 'new')
    setName(person?.name ?? '')
    setRole(person?.role ?? 'viewer')
    setActive(person?.active !== false)
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({ name, role, active }, editing === 'new' ? undefined : editing!)
      setEditing(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Couldn’t save this member.') }
    finally { setSaving(false) }
  }

  return <section aria-labelledby="family-title">
    <div className="mb-5 flex items-center justify-between gap-3"><h1 id="family-title" className="text-3xl font-semibold text-stone-900">Family</h1>{canAdminister && !editing ? <button type="button" onClick={() => edit()} className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white">Add member</button> : null}</div>
    <p className="mb-5 text-sm leading-6 text-stone-600">Parents administer the family, adult children edit activities, and minor children view only. Choose who shares each activity in its settings.</p>
    {editing && canAdminister ? <form onSubmit={submit} className="mb-6 rounded-2xl bg-white p-5">
      <fieldset disabled={saving} className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">{editing === 'new' ? 'New family member' : 'Edit family member'}</h2>
        <label className="block font-medium text-stone-800">Member name<input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-300 p-3" /></label>
        <label className="block font-medium text-stone-800">Role<select value={role} onChange={(event) => setRole(event.target.value as FamilyRole)} className="mt-2 w-full rounded-xl border border-stone-300 p-3">{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {editing !== 'new' ? <label className="flex items-center gap-3 text-stone-800"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="h-5 w-5 accent-emerald-800" />Active member</label> : null}
        {!active ? <div className="text-sm leading-6 text-stone-600"><p>Past records and current turns stay intact. This profile becomes unavailable. Future participation ends at each activity’s next turn:</p><ul className="mt-2 list-disc pl-5">{activities.filter((view) => (view.activity.revisions?.at(-1)?.roster ?? view.activity.roster).includes(editing!)).map((view) => {
          const current = view.records.at(-1)
          const date = current ? nextTurnDate(current.date, current.rotation ?? view.activity) : view.activity.startDate
          return <li key={view.activity.id}>{view.activity.name}: {format(parseISO(date), 'MMM d, yyyy')}</li>
        })}</ul><p className="mt-2">Activities with too few participants will wait until people are added.</p></div> : <p className="text-sm leading-6 text-stone-600">New or reactivated members are not automatically added to activities.</p>}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <div className="flex gap-3"><button type="submit" className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white">{saving ? 'Saving…' : 'Save member'}</button><button type="button" onClick={() => setEditing(null)} className="px-4 py-3 font-semibold text-stone-600">Cancel</button></div>
      </fieldset>
    </form> : null}
    <div className="space-y-3">{people.map((person) => <article key={person.id} className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-5"><div className="min-w-0"><p className="break-words font-semibold text-stone-900">{person.name}{person.active === false ? ' · inactive' : ''}</p><p className="mt-1 text-sm text-stone-500">{roleLabels[person.role ?? 'viewer']}</p></div>{canAdminister ? <button type="button" disabled={saving} aria-label={'Edit ' + person.name} onClick={() => edit(person)} className="px-3 py-2 font-semibold text-emerald-800">Edit</button> : null}</article>)}</div>
  </section>
}
