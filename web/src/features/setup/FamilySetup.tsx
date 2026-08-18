import { useState, type FormEvent } from 'react'

interface FamilySetupProps {
  onSubmit: (names: readonly string[]) => Promise<void>
}

export function FamilySetup({ onSubmit }: FamilySetupProps) {
  const [names, setNames] = useState(['', '', ''])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function updateName(index: number, value: string) {
    setNames((current) => current.map((name, itemIndex) => (itemIndex === index ? value : name)))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const cleaned = names.map((name) => name.trim()).filter(Boolean)
    if (cleaned.length < 2) {
      setError('Add at least two people to start a rotation.')
      return
    }
    if (new Set(cleaned.map((name) => name.toLocaleLowerCase())).size !== cleaned.length) {
      setError('Each person needs a different name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(cleaned)
    } catch {
      setError('The family could not be saved. Please try again.')
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:px-8">
      <p className="text-sm font-semibold tracking-wide text-emerald-800 uppercase">Quick setup</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-stone-900">
        Who shares the middle seat?
      </h1>
      <p className="mt-3 leading-7 text-stone-600">
        Add first names in the order your family normally uses. Everything stays in this browser.
      </p>

      <form onSubmit={submit} className="mt-8 rounded-3xl border border-stone-200 bg-white p-6 shadow-[0_20px_60px_rgba(41,51,45,0.10)] sm:p-8">
        <div className="space-y-4">
          {names.map((name, index) => (
            <div key={index}>
              <label htmlFor={`member-${index}`} className="mb-1.5 block text-sm font-medium text-stone-700">
                Person {index + 1}
              </label>
              <div className="flex gap-2">
                <input
                  id={`member-${index}`}
                  value={name}
                  onChange={(event) => updateName(index, event.target.value)}
                  placeholder={index === 0 ? 'Elena' : 'First name'}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                />
                {names.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => setNames((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="rounded-xl px-3 text-sm font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                    aria-label={`Remove person ${index + 1}`}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setNames((current) => [...current, ''])}
          className="mt-4 text-sm font-semibold text-emerald-800 hover:text-emerald-950"
        >
          + Add another person
        </button>

        {error ? <p role="alert" className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}

        <button
          type="submit"
          disabled={saving}
          className="mt-7 w-full rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? 'Starting…' : 'Start the rotation'}
        </button>
      </form>
    </main>
  )
}
