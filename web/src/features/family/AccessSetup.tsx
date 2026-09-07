import { useState, type FormEvent } from 'react'
import type { Person } from '../../domain/rotation/types'
import { roleLabels } from '../../domain/family/members'

export function AccessSetup({ people, needsAdministrator, onAdministrator, onProfile }: {
  people: readonly Person[]
  needsAdministrator: boolean
  onAdministrator: (choice: { personId: string } | { name: string }) => Promise<void>
  onProfile: (id: string) => Promise<void>
}) {
  const [choice, setChoice] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (needsAdministrator) await onAdministrator(choice === 'new-parent' ? { name } : { personId: choice })
      else await onProfile(choice)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Couldn’t select this profile.')
    } finally { setSaving(false) }
  }

  return <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:px-8">
    <h1 className="text-3xl font-semibold text-stone-900">{needsAdministrator ? 'Choose your family administrator' : 'Choose a local profile'}</h1>
    <p className="mt-3 leading-7 text-stone-600">{needsAdministrator ? 'Choose a parent from the list or add one. Your activities and history stay intact. Other members start with view-only access; you can change their roles in Family.' : 'Choose whose view to use on this browser.'}</p>
    <p className="mt-3 text-sm leading-6 text-stone-500">Local prototype: profiles are not authenticated. Anyone using this browser can switch profiles. Secure sign-in will come with hosting and sync.</p>
    <form onSubmit={submit} className="mt-6 rounded-2xl bg-white p-6">
      <fieldset disabled={saving} className="space-y-4">
        <label className="block font-medium text-stone-800">{needsAdministrator ? 'Administrator' : 'Local profile'}
          <select required value={choice} onChange={(event) => setChoice(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-300 p-3">
            <option value="">Choose a person</option>
            {people.filter((person) => person.active !== false).map((person) => <option key={person.id} value={person.id}>{person.name}{!needsAdministrator && person.role ? ' · ' + roleLabels[person.role] : ''}</option>)}
            {needsAdministrator ? <option value="new-parent">Add a parent</option> : null}
          </select>
        </label>
        {choice === 'new-parent' ? <div><label className="block font-medium text-stone-800">Parent name<input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} aria-describedby="parent-participation" className="mt-2 w-full rounded-xl border border-stone-300 p-3" /></label><p id="parent-participation" className="mt-2 text-sm text-stone-500">Adding a parent does not add them to any activity.</p></div> : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <button type="submit" className="w-full rounded-xl bg-emerald-800 p-3 font-semibold text-white">{saving ? 'Saving…' : needsAdministrator ? 'Set administrator' : 'Use profile'}</button>
      </fieldset>
    </form>
  </main>
}
