import { format, parseISO } from 'date-fns'
import { useMemo } from 'react'

import { PageShell } from '../components/PageShell'
import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import type { TurnTallyRepository } from '../data/RotationRepository'
import type { RotationRecord } from '../domain/rotation/engine'
import type { CalendarDate, PersonId } from '../domain/rotation/types'
import { BalanceSummary } from '../features/history/BalanceSummary'
import { RotationHistory } from '../features/history/RotationHistory'
import { TodaySeatCard } from '../features/seating/TodaySeatCard'
import { FamilySetup } from '../features/setup/FamilySetup'
import { useTurnTally } from './useTurnTally'

interface AppProps {
  repository?: TurnTallyRepository
  today?: CalendarDate
}

function localToday(): CalendarDate {
  return format(new Date(), 'yyyy-MM-dd')
}

function App({ repository: suppliedRepository, today = localToday() }: AppProps) {
  const repository = useMemo(
    () => suppliedRepository ?? new LocalStorageRotationRepository(window.localStorage),
    [suppliedRepository],
  )
  const app = useTurnTally(repository, today)

  if (app.phase === 'loading') {
    return <PageShell><main className="mx-auto w-full max-w-xl flex-1 px-5 py-16 text-stone-600">Loading your rotation…</main></PageShell>
  }

  if (app.phase === 'setup') {
    return <PageShell><FamilySetup onSubmit={app.createHousehold} /></PageShell>
  }

  if (app.phase === 'error' || !app.configuration) {
    return (
      <PageShell>
        <main className="mx-auto w-full max-w-xl flex-1 px-5 py-16">
          <h1 className="text-2xl font-semibold text-stone-900">TurnTally needs a reset</h1>
          <p role="alert" className="mt-3 text-stone-600">{app.error}</p>
          <button type="button" onClick={() => void app.reset()} className="mt-6 rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white">Start over</button>
        </main>
      </PageShell>
    )
  }

  const { people, rotation } = app.configuration
  const todayRecord = app.records.at(-1)!

  async function saveCorrection(record: RotationRecord, covererId: PersonId | null) {
    if (covererId === record.assigneeId) {
      await app.recordOutcome(record.slotId, 'as-scheduled')
    } else if (covererId === null) {
      await app.recordOutcome(record.slotId, 'outside-cover')
    } else {
      await app.recordOutcome(record.slotId, 'trade', covererId)
    }
  }

  function resetFamily() {
    if (window.confirm('Clear this rotation and its local history?')) {
      void app.reset()
    }
  }

  return (
    <PageShell>
      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:px-8">
        <div className="mb-8">
          <p className="mb-2 text-sm font-semibold tracking-wide text-emerald-800 uppercase">Seating rotation</p>
          <h1 className="text-4xl font-semibold tracking-tight text-stone-900">Whose turn is it?</h1>
          <p className="mt-3 max-w-md text-base leading-7 text-stone-600">
            Confirm the assignment or tell TurnTally who took the seat instead.
          </p>
        </div>

        <TodaySeatCard
          record={todayRecord}
          people={people}
          rotationName={rotation.name}
          dateLabel={format(parseISO(today), 'EEEE, MMMM d')}
          onConfirm={() => app.recordOutcome(todayRecord.slotId, 'as-scheduled')}
          onCorrect={(covererId) => saveCorrection(todayRecord, covererId)}
        />

        <BalanceSummary balances={app.balances} people={people} />
        <RotationHistory records={app.records} people={people} onCorrect={saveCorrection} />

        <div className="mt-8 border-t border-stone-300 pt-6 text-center">
          <button type="button" onClick={resetFamily} className="text-sm font-medium text-stone-500 hover:text-stone-900">
            Set up a different family
          </button>
        </div>
      </main>
    </PageShell>
  )
}

export default App
