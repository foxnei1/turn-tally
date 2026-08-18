import { useState } from 'react'

interface TodaySeatCardProps {
  assignee: string
  dateLabel: string
  onConfirm?: () => void
  onCorrection?: () => void
}

type ConfirmationState = 'pending' | 'confirmed' | 'correction'

export function TodaySeatCard({
  assignee,
  dateLabel,
  onConfirm,
  onCorrection,
}: TodaySeatCardProps) {
  const [state, setState] = useState<ConfirmationState>('pending')

  function confirm() {
    setState('confirmed')
    onConfirm?.()
  }

  function correct() {
    setState('correction')
    onCorrection?.()
  }

  return (
    <section
      aria-labelledby="seat-card-title"
      className="rounded-3xl border border-stone-200 bg-white p-6 shadow-[0_20px_60px_rgba(41,51,45,0.10)] sm:p-8"
    >
      <p className="text-sm font-medium text-stone-500">{dateLabel}</p>
      <h2 id="seat-card-title" className="mt-2 text-2xl font-medium text-stone-700">
        Middle seat
      </h2>
      <p className="mt-6 text-5xl font-semibold tracking-tight text-emerald-800">{assignee}</p>

      {state === 'pending' ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={confirm}
            className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={correct}
            className="rounded-xl border border-stone-300 px-4 py-3 font-semibold text-stone-700 transition hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700"
          >
            Wasn't me
          </button>
        </div>
      ) : (
        <p role="status" className="mt-8 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
          {state === 'confirmed' ? 'Turn confirmed.' : 'Correction started.'}
        </p>
      )}
    </section>
  )
}
