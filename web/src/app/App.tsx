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
import { isArchived } from '../domain/rotation/activities'
import { BackupsScreen } from '../features/backups/BackupsScreen'
import { AbsencesScreen } from '../features/absences/AbsencesScreen'

interface AppProps {
  repository?: TurnTallyRepository
  today?: CalendarDate
  onManageDevices?: () => void
}

function localToday(): CalendarDate {
  return format(new Date(), 'yyyy-MM-dd')
}

function App({ repository: suppliedRepository, today = localToday(), onManageDevices }: AppProps) {
  const repository = useMemo<TurnTallyRepository>(
    () => suppliedRepository ?? new LocalStorageRotationRepository(window.localStorage),
    [suppliedRepository],
  )
  const app = useTurnTally(repository, today)
  const device = repository.identity?.device
  // Presentation only: shared devices never become roster members or actors.
  const displayIdentity = app.actor ?? (device?.kind === 'shared' ? { id: device.id, name: 'Family viewer', role: 'viewer' as const } : undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null)
  const [familyOpen, setFamilyOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [backupsOpen, setBackupsOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [absencesOpen, setAbsencesOpen] = useState(false)

  const backups = <BackupsScreen key={displayIdentity?.id ?? 'empty'} canImport={!app.configuration || app.canAdminister} hasFamily={!!app.configuration} onExport={app.exportBackup} onPreview={app.previewBackup} onImport={async (text, expectedState) => {
    await app.importBackup(text, expectedState)
    setBackupsOpen(false); setSelectedId(null); setEditing(null); setFamilyOpen(false)
    setAbsencesOpen(false)
  }} onBack={() => setBackupsOpen(false)} />

  if (app.phase === 'loading') {
    return <PageShell><main className="mx-auto w-full max-w-xl flex-1 px-5 py-16 text-stone-600">Loading your rotation…</main></PageShell>
  }

  if (app.phase === 'setup') {
    return <PageShell>{backupsOpen ? <main className="mx-auto w-full max-w-xl px-5 py-10">{backups}</main> : <><FamilySetup onSubmit={app.createHousehold} /><div className="mb-8 text-center"><button type="button" onClick={() => setBackupsOpen(true)} className="font-semibold text-emerald-800">Restore a backup</button></div></>}</PageShell>
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
  if (!app.configuration.rolesInitialized || !displayIdentity) {
    if (repository.hosted) return <PageShell><p role="alert" className="m-8">Your account is no longer linked to an active family member. Sign out and contact the family administrator.</p></PageShell>
    return <PageShell><AccessSetup key={app.configuration.rolesInitialized ? 'profile' : 'administrator'} people={people} needsAdministrator={!app.configuration.rolesInitialized} onAdministrator={app.setupAdministrator} onProfile={app.selectProfile} /></PageShell>
  }
  const selected = app.activities.find((view) => view.activity.id === selectedId)
  const archived = selected ? isArchived(selected.activity) : false
  const activeActivities = app.activities.filter((view) => !isArchived(view.activity))
  const archivedActivities = app.activities.filter((view) => isArchived(view.activity))
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
        setBackupsOpen(false)
        setAbsencesOpen(false)
      } catch (error) { setActionError(error instanceof Error ? error.message : 'Couldn’t reset this family.') }
    }
  }

  async function changeArchive() {
    if (!selected) return
    setArchiving(true); setActionError(null)
    try { await app.setActivityArchived(selected.activity.id, !archived) }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Couldn’t change this activity.') }
    finally { setArchiving(false) }
  }

  return (
    <PageShell>
      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10 sm:px-8">
        <div className="mb-6 border-b border-stone-300 pb-5">
          <div className="flex items-end justify-between gap-3">
            {repository.hosted ? <div className="min-w-0 flex-1 text-sm text-stone-600"><p className="font-semibold text-stone-900">{displayIdentity.name}</p><p>{roleLabels[displayIdentity.role ?? 'viewer']}{device ? ` · ${device.name}` : ''}</p></div> : <label className="min-w-0 flex-1 text-sm text-stone-600">Local profile
              <select value={displayIdentity.id} onChange={async (event) => {
                setActionError(null)
                try {
                  await app.selectProfile(event.target.value)
                  setEditing(null)
                  setFamilyOpen(false)
                  setBackupsOpen(false)
                  setAbsencesOpen(false)
                } catch (error) { setActionError(error instanceof Error ? error.message : 'Couldn’t switch profiles.') }
              }} className="mt-1 block w-full rounded-xl border border-stone-300 bg-white p-2 text-stone-900">
                {people.filter((person) => person.active !== false).map((person) => <option key={person.id} value={person.id}>{person.name} · {roleLabels[person.role ?? 'viewer']}</option>)}
              </select>
            </label>}
            <button type="button" onClick={() => { setFamilyOpen(!familyOpen); setEditing(null); setBackupsOpen(false); setAbsencesOpen(false) }} className="px-3 py-2 font-semibold text-emerald-800">{familyOpen ? 'Activities' : 'Family'}</button>
          </div>
          {!repository.hosted ? <details className="mt-2 text-xs leading-5 text-stone-500"><summary className="cursor-pointer">Local prototype · no sign-in yet</summary>Anyone using this browser can switch profiles. These controls preview roles; secure accounts will come with hosting and sync.</details> : null}
          {actionError ? <p role="alert" className="mt-2 text-sm text-red-700">{actionError}</p> : null}
        </div>
        {familyOpen && app.canAdminister && onManageDevices ? <button className="mb-5 rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white" onClick={onManageDevices}>Devices</button> : null}
        {backupsOpen && app.canEdit ? backups : absencesOpen ? <AbsencesScreen key={displayIdentity.id} configuration={app.configuration} today={today} canEdit={app.canEdit} onChange={app.changeAbsence} onBack={() => { setAbsencesOpen(false); setSelectedId(null) }} /> : familyOpen ? <FamilyScreen key={displayIdentity.id} people={people} activities={app.activities} canAdminister={app.canAdminister} onSave={app.saveMember} /> : editing && app.canEdit && !archived ? (
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
              {app.canEdit && !archived ? <button type="button" onClick={() => setEditing('edit')} className="text-sm font-semibold text-stone-600">Edit activity</button> : null}
            </div>
            {archived ? <>
              <section className="rounded-3xl border border-stone-200 bg-white p-6"><p className="text-sm font-medium text-stone-500">Archived</p><h1 className="mt-2 text-2xl font-semibold text-stone-900">{selected.activity.name}</h1><p className="mt-3 text-sm leading-6 text-stone-600">No new turns will be counted. Recorded turns and corrections are kept below.</p>{app.canEdit ? <><p className="mt-3 text-sm leading-6 text-stone-600">Restoring resumes turns without counting the archived gap. If the original turn is still underway, it stays assigned.</p><button type="button" disabled={archiving} onClick={() => void changeArchive()} className="mt-4 rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">Restore activity</button></> : null}</section>
              {selected.records.length ? <RotationHistory key={selected.activity.id + displayIdentity.id} records={selected.records} people={people} onCorrect={saveCorrection} canEdit={app.canEdit} /> : <p className="mt-4 text-sm text-stone-500">No turns were recorded before archiving.</p>}
            </> : todayRecord ? <>
              <TodaySeatCard
                key={todayRecord.slotId + displayIdentity.id}
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
              <RotationHistory key={selected.activity.id + displayIdentity.id} records={selected.records} people={people} onCorrect={saveCorrection} canEdit={app.canEdit} />
            </> : <section className="rounded-3xl border border-stone-200 bg-white p-6">
              <h1 className="text-2xl font-semibold text-stone-900">{selected.activity.name}</h1>
              <p className="mt-3 text-stone-600">Starts {format(parseISO(selected.activity.startDate), 'MMMM d, yyyy')}. The first turn is chosen from the people available that day.</p>
            </section>}
            {!archived && app.canEdit ? <details className="mt-6 text-sm text-stone-600"><summary className="cursor-pointer font-semibold">Archive this activity</summary><p className="mt-3 leading-6">Hide it from the main list and stop counting new turns. The current turn and all history are kept. You can restore it later.</p><button type="button" disabled={archiving} onClick={() => void changeArchive()} className="mt-3 rounded-xl border border-stone-300 bg-white px-4 py-3 font-semibold text-stone-800 disabled:opacity-50">Archive activity</button></details> : null}
          </>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between gap-4">
              <div><h1 className="text-3xl font-semibold text-stone-900">Your turns</h1><p className="mt-2 text-sm text-stone-600">{format(parseISO(today), 'EEEE, MMMM d')}</p></div>
              {app.canEdit ? <button type="button" onClick={() => setEditing('new')} className="rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white">Add activity</button> : null}
            </div>
            <div className="space-y-3">
              {activeActivities.map((view) => {
                const record = view.records.at(-1)
                const rotation = record?.rotation ?? view.activity
                const person = people.find((person) => person.id === record?.servedById)
                const label = record ? person?.name ?? (record.assigneeId === null ? record.absentIds.length ? 'Not enough people here' : 'Needs participants' : 'Turn skipped') : 'Starts ' + format(parseISO(view.activity.startDate), 'MMM d')
                return <button key={view.activity.id} type="button" onClick={() => setSelectedId(view.activity.id)} aria-label={'View ' + view.activity.name} className="flex w-full items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5 text-left hover:border-emerald-700">
                  <span className="min-w-0"><span className="block break-words font-semibold text-stone-900">{view.activity.name}</span><span className="mt-1 block text-sm text-stone-500">{rotation.cadence === 'weekly' && record ? format(parseISO(record.date), 'MMM d') + ' – ' + format(addDays(parseISO(record.date), 6), 'MMM d') : rotation.cadence === 'weekly' ? 'Weekly' : 'Daily'}</span></span>
                  <span className="max-w-[45%] break-words text-right text-lg font-semibold text-emerald-800">{label}</span>
                </button>
              })}
            </div>
            {!activeActivities.length ? <p className="mt-5 text-sm text-stone-600">No active activities. Archived activities and their history are available below.</p> : null}
            {archivedActivities.length ? <details className="mt-6 rounded-2xl border border-stone-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-emerald-800">Archived activities ({archivedActivities.length})</summary><div className="mt-3 space-y-2">{archivedActivities.map((view) => <button type="button" key={view.activity.id} onClick={() => setSelectedId(view.activity.id)} aria-label={'View archived ' + view.activity.name} className="block w-full rounded-xl px-3 py-3 text-left font-medium text-stone-800 hover:bg-stone-50">{view.activity.name}</button>)}</div></details> : null}
            {app.canEdit && activeActivities.length === 1 ? <p className="mt-5 text-sm leading-6 text-stone-600">Add kitchen duty, cleaning, or another family routine. Each activity keeps its own turns.</p> : null}
          </>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-5 border-t border-stone-300 pt-6 text-center">
          {!absencesOpen ? <button type="button" onClick={() => { setAbsencesOpen(true); setBackupsOpen(false); setFamilyOpen(false); setEditing(null) }} className="text-sm font-semibold text-emerald-800">Absences</button> : null}
          {app.canEdit && !backupsOpen ? <button type="button" onClick={() => { setBackupsOpen(true); setEditing(null); setAbsencesOpen(false) }} className="text-sm font-semibold text-emerald-800">Backups</button> : null}
          {app.canAdminister && !repository.hosted ? <button type="button" onClick={() => void resetFamily()} className="text-sm font-medium text-stone-500 hover:text-stone-900">
            Set up a different family
          </button> : null}
        </div>
      </main>
    </PageShell>
  )
}

export default App
