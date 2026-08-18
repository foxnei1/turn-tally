import { PageShell } from '../components/PageShell'
import { TodaySeatCard } from '../features/seating/TodaySeatCard'

function App() {
  return (
    <PageShell>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-10 sm:px-8">
        <div className="mb-8">
          <p className="mb-2 text-sm font-semibold tracking-wide text-emerald-800 uppercase">
            Seating rotation
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-stone-900">
            Whose turn is it?
          </h1>
          <p className="mt-3 max-w-md text-base leading-7 text-stone-600">
            TurnTally keeps track of what everyone has done so the next turn has a clear reason behind it.
          </p>
        </div>

        <TodaySeatCard assignee="Elena" dateLabel="Today" />
      </main>
    </PageShell>
  )
}

export default App
