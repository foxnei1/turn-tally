import { addDays, format, parseISO } from 'date-fns'
import { useMemo, useState } from 'react'

import { PageShell } from '../components/PageShell'
import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import type { TurnTallyRepository } from '../data/RotationRepository'
import type { RotationRecord } from '../domain/rotation/engine'
import type { TurnCorrection } from '../domain/rotation/events'
import type { CalendarDate } from '../domain/rotation/types'
import { RotationHistory } from '../features/history/RotationHistory'
import { TodaySeatCard } from '../features/seating/TodaySeatCard'
import { FamilySetup } from '../features/setup/FamilySetup'
import { ActivityForm } from '../features/activities/ActivityForm'
import { nextTurnDate } from '../domain/rotation/schedule'
import { useTurnTally } from './useTurnTally'
import { AccessSetup } from '../features/family/AccessSetup'
import { FamilyScreen } from '../features/family/FamilyScreen'
import { roleLabels } from '../domain/family/members'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null)
  const [familyOpen, setFamilyOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
          <h1 className="text-2xl font-semibold text-stone-900">TurnTally could not load</h1>
          <p role="alert" className="mt-3 text-stone-600">{app.error}</p>
          <button type="button" onClick={() => void app.reload()} className="mt-6 rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white">Try again</button>
        </main>
      </PageShell>
    )
  }

  const { people } = app.configuration
  if (!app.configuration.rolesInitialized || !app.actor) {
    return <PageShell><AccessSetup key={app.configuration.rolesInitialized ? 'profile' : 'administrator'} people={people} needsAdministrator={!app.configuration.rolesInitialized} onAdministrator={app.setupAdministrator} onProfile={app.selectProfile} /></PageShell>
  }
  const selected = app.activities.find((view) => view.activity.id === selectedId)
  const todayRecord = selected?.records.at(-1)
  const currentRotation = todayRecord?.rotation ?? selected?.activity
  const nextDate = todayRecord && currentRotation ? nextTurnDate(todayRecord.date, currentRotation) : null
  const dateLabel = todayRecord && currentRotation?.cadence === 'weekly'
    ? format(parseISO(todayRecord.date), 'MMM d') + ' – ' + format(addDays(parseISO(nextDate!), -1), 'MMM d, yyyy')
    : format(parseISO(today), 'EEEE, MMMM d')

  async function saveCorrection(record: RotationRecord, correction: TurnCorrection) {
    await app.recordOutcome(record.slotId, correction)
  }

  async function resetFamily() {
    if (window.confirm('Clear all activities and their local history?')) {
      try {
        await app.reset()
        setSelectedId(null)
        setEditing(null)
        setFamilyOpen(false)
      } catch (error) { setActionError(error instanceof Error ? error.message : 'Couldn’t reset this family.') }
    }
  }

  return (
    <PageShell>
      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:px-8">
        <div className="mb-6 border-b border-stone-300 pb-5">
          <div className="flex items-end justify-between gap-3">
            <label className="min-w-0 flex-1 text-sm text-stone-600">Local profile
              <select value={app.actor.id} onChange={async (event) => {
                setActionError(null)
                try {
                  await app.selectProfile(event.target.value)
                  setEditing(null)
                  setFamilyOpen(false)
                } catch (error) { setActionError(error instanceof Error ? error.message : 'Couldn’t switch profiles.') }
              }} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white p-2 text-stone-900">
                {people.filter((person) => person.active !== false).map((person) => <option key={person.id} value={person.id}>{person.name} · {roleLabels[person.role ?? 'viewer']}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => { setFamilyOpen(!familyOpen); setEditing(null) }} className="px-3 py-2 font-semibold text-emerald-800">{familyOpen ? 'Activities' : 'Family'}</button>
          </div>
          <details className="mt-2 text-xs leading-5 text-stone-500"><summary className="cursor-pointer">Local prototype · no sign-in yet</summary>Anyone using this browser can switch profiles. These controls preview roles; secure accounts will come with hosting and sync.</details>
          {actionError ? <p role="alert" className="mt-2 text-sm text-red-700">{actionError}</p> : null}
        </div>
        {familyOpen ? <FamilyScreen key={app.actor.id} people={people} activities={app.activities} canAdminister={app.canAdminister} onSave={app.saveMember} /> : editing && app.canEdit ? (
          <ActivityForm
            key={editing === 'edit' ? selectedId : 'new'}
            people={people.filter((person) => person.active !== false)}
            today={today}
            activityView={editing === 'edit' ? selected : undefined}
            onCancel={() => setEditing(null)}
            onSave={async (draft) => {
              const id = await app.saveActivity(draft, editing === 'edit' ? selectedId! : undefined)
              setSelectedId(id)
              setEditing(null)
            }}
          />
        ) : selected ? (
          <>
            <div className="mb-5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setSelectedId(null)} className="font-semibold text-emerald-800">All activities</button>
              {app.canEdit ? <button type="button" onClick={() => setEditing('edit')} className="text-sm font-semibold text-stone-600">Edit activity</button> : null}
            </div>
            {todayRecord ? <>
              <TodaySeatCard
                key={todayRecord.slotId + app.actor.id}
                record={todayRecord}
                people={people.filter((person) => currentRotation!.roster.includes(person.id))}
                rotationName={selected.activity.name}
                dateLabel={dateLabel}
                onCorrect={(correction) => saveCorrection(todayRecord, correction)}
                canEdit={app.canEdit}
              />
              {selected.activity.revisions?.some((revision) => revision.effectiveDate > today) ? (
                <p className="mt-4 text-sm text-stone-600">Updated schedule and people take effect {format(parseISO(selected.activity.revisions.at(-1)!.effectiveDate), 'MMMM d')}.{app.canEdit ? ' View them in Edit activity.' : ''}</p>
              ) : null}
              <RotationHistory key={selected.activity.id + app.actor.id} records={selected.records} people={people} onCorrect={saveCorrection} canEdit={app.canEdit} />
            </> : <section className="rounded-3xl border border-stone-200 bg-white p-6">
              <h1 className="text-2xl font-semibold text-stone-900">{selected.activity.name}</h1>
              <p className="mt-3 text-stone-600">Starts {format(parseISO(selected.activity.startDate), 'MMMM d, yyyy')}. {people.find((person) => person.id === selected.activity.roster[0])?.name} takes the first turn.</p>
            </section>}
          </>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between gap-4">
              <div><h1 className="text-3xl font-semibold text-stone-900">Your turns</h1><p className="mt-2 text-sm text-stone-600">{format(parseISO(today), 'EEEE, MMMM d')}</p></div>
              {app.canEdit ? <button type="button" onClick={() => setEditing('new')} className="rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white">Add activity</button> : null}
            </div>
            <div className="space-y-3">
              {app.activities.map((view) => {
                const record = view.records.at(-1)
                const rotation = record?.rotation ?? view.activity
                const person = people.find((person) => person.id === record?.servedById)
                const label = record ? person?.name ?? (record.assigneeId === null ? 'Needs participants' : 'Turn skipped') : 'Starts ' + format(parseISO(view.activity.startDate), 'MMM d')
                return <button key={view.activity.id} type="button" onClick={() => setSelectedId(view.activity.id)} aria-label={'View ' + view.activity.name} className="flex w-full items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5 text-left hover:border-emerald-700">
                  <span className="min-w-0"><span className="block break-words font-semibold text-stone-900">{view.activity.name}</span><span className="mt-1 block text-sm text-stone-500">{rotation.cadence === 'weekly' && record ? format(parseISO(record.date), 'MMM d') + ' – ' + format(addDays(parseISO(record.date), 6), 'MMM d') : rotation.cadence === 'weekly' ? 'Weekly' : 'Daily'}</span></span>
                  <span className="max-w-[45%] break-words text-right text-lg font-semibold text-emerald-800">{label}</span>
                </button>
              })}
            </div>
            {app.canEdit && app.activities.length === 1 ? <p className="mt-5 text-sm leading-6 text-stone-600">Add kitchen duty, cleaning, or another family routine. Each activity keeps its own turns.</p> : null}
          </>
        )}

        {app.canAdminister ? <div className="mt-8 border-t border-stone-300 pt-6 text-center">
          <button type="button" onClick={() => void resetFamily()} className="text-sm font-medium text-stone-500 hover:text-stone-900">
            Set up a different family
          </button>
        </div> : null}
      </main>
    </PageShell>
  )
}

export default App
