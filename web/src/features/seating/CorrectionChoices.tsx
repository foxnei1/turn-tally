import type { Person, PersonId } from '../../domain/rotation/types'

interface CorrectionChoicesProps {
  assigneeId: PersonId
  people: readonly Person[]
  includeAssignee?: boolean
  onChoose: (covererId: PersonId | null) => void
  onCancel: () => void
}

export function CorrectionChoices({
  assigneeId,
  people,
  includeAssignee = false,
  onChoose,
  onCancel,
}: CorrectionChoicesProps) {
  return (
    <div className="mt-6 rounded-2xl bg-stone-100 p-4">
      <p className="font-semibold text-stone-800">Who actually took the middle seat?</p>
      <div className="mt-3 grid gap-2">
        {people
          .filter((person) => includeAssignee || person.id !== assigneeId)
          .map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => onChoose(person.id)}
              className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-left font-medium text-stone-800 hover:border-emerald-700"
            >
              {person.id === assigneeId ? `${person.name} did after all` : person.name}
            </button>
          ))}
        <button
          type="button"
          onClick={() => onChoose(null)}
          className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-left font-medium text-stone-800 hover:border-emerald-700"
        >
          An adult covered it
        </button>
      </div>
      <button type="button" onClick={onCancel} className="mt-3 text-sm font-semibold text-stone-600 hover:text-stone-900">
        Cancel
      </button>
    </div>
  )
}
