import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import App from '../../app/App'
import { PageShell } from '../../components/PageShell'
import { LocalStorageRotationRepository } from '../../data/localStorageRepository'
import { SupabaseRotationRepository } from '../../data/supabaseRepository'
import { backupCounts, createBackup, MAX_BACKUP_BYTES, parseBackup, type Backup } from '../../domain/backups/backup'
import { ViewerPairing } from './ViewerPairing'
import { DeviceManager } from './DeviceManager'
import { deviceCommand } from './deviceApi'
import type { Person } from '../../domain/rotation/types'
import { RequestPasswordReset } from './PasswordRecovery'

const buttonClass = 'rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50'
const inputClass = 'mt-1 block w-full rounded-xl border border-stone-300 bg-white p-3'

export function HostedApp({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pairing, setPairing] = useState(false)
  const [recovering, setRecovering] = useState(false)
  useEffect(() => {
    let active = true
    let authChanged = false
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      authChanged = true
      if (active) { setSession(next); setLoading(false) }
    })
    void client.auth.getSession().then(({ data, error }) => {
      if (active && !authChanged) { setSession(data.session); setError(error?.message ?? null); setLoading(false) }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [client])

  async function signOut() {
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw error
    setSession(null)
    setPairing(false)
  }

  if (loading) return <PageShell><p className="m-8">Checking sign-in…</p></PageShell>
  if (session) return <FamilySession key={session.user.id} client={client} viewerHint={session.user.app_metadata?.turntally_viewer === true} onSignOut={signOut} />
  if (recovering) return <RequestPasswordReset client={client} initialEmail={email} onBack={() => setRecovering(false)} />
  if (pairing) return <PageShell><main className="mx-auto w-full max-w-md px-5 py-12"><h1 className="text-3xl font-semibold">TurnTally</h1><ViewerPairing client={client} onBack={() => setPairing(false)} /></main></PageShell>
  return <PageShell><main className="mx-auto w-full max-w-md px-5 py-12">
    <h1 className="text-3xl font-semibold">Sign in to TurnTally</h1>
    <p className="mt-3 text-stone-600">Use the adult account set up for your family. This pilot has no public signup.</p>
    <form className="mt-6 space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(null)
      try {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        setPassword('')
      } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in failed. Try again.') }
      finally { setBusy(false) }
    }}>
      <label className="block">Email<input className={inputClass} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="block">Password<input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      <button className={buttonClass} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <button type="button" disabled={busy} className="mt-6 block font-semibold text-emerald-800" onClick={() => { setPassword(''); setError(null); setRecovering(true) }}>Forgot password?</button>
    <button type="button" disabled={busy} className="mt-8 font-semibold text-emerald-800" onClick={() => { setPassword(''); setError(null); setPairing(true) }}>Use as a viewer</button>
  </main></PageShell>
}

function FamilySession({ client, onSignOut, viewerHint }: { client: SupabaseClient; onSignOut: () => Promise<void>; viewerHint: boolean }) {
  const [, render] = useState(0)
  const repository = useMemo(() => new SupabaseRotationRepository(client, () => render((value) => value + 1)), [client])
  const [status, setStatus] = useState<'loading' | 'migration' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [people, setPeople] = useState<readonly Person[]>([])
  const [disconnecting, setDisconnecting] = useState(false)
  // Remember device mode after revoked access clears the repository identity.
  const [viewerDevice, setViewerDevice] = useState(viewerHint)
  useEffect(() => {
    let active = true
    void repository.refresh().then(async () => {
      const snapshot = await repository.readSnapshot()
      if (active) {
        setStatus(snapshot.configuration ? 'ready' : 'migration')
        setPeople(snapshot.configuration?.people ?? [])
        if (repository.identity.device) setViewerDevice(true)
      }
    }).catch((error: Error) => { if (active) { setError(error.message); setStatus('error') } })
    return () => { active = false }
  }, [repository, generation])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (!viewerDevice || status !== 'ready') return
    let active = true
    let checking = false
    const check = async () => {
      if (!active || checking || document.visibilityState === 'hidden') return
      checking = true
      try { await repository.checkAccess() }
      catch (error) {
        if (active) {
          repository.forget(); setPeople([]); setDevicesOpen(false); setStatus('error')
          setError(error instanceof Error ? error.message : 'Reconnect to check viewer access.')
        }
      } finally { checking = false }
    }
    const resume = () => { void check() }
    const timer = window.setInterval(resume, 60000)
    window.addEventListener('focus', resume); window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      active = false; window.clearInterval(timer)
      window.removeEventListener('focus', resume); window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [repository, viewerDevice, status])
  async function leaveViewer() {
    if (!window.confirm('Disconnect this viewer device and open adult sign-in? You will need to pair it again to return to viewer mode.')) return
    setDisconnecting(true); setError(null)
    try {
      await deviceCommand(client, 'disconnect')
      repository.forget(); setPeople([]); setDevicesOpen(false); setStatus('error')
      await onSignOut()
    } catch (error) { setError(error instanceof Error ? error.message : 'Disconnection failed. Reconnect and retry.') }
    finally { setDisconnecting(false) }
  }
  function refresh() {
    if (repository.conflict && !window.confirm('Refresh to the latest saved family? Download your attempted version first if you want to keep it.')) return
    repository.conflict = null; setDevicesOpen(false); setStatus('loading'); setError(null); setGeneration((value) => value + 1)
  }
  return <>
    <div className="border-b border-stone-200 bg-white px-5 py-3 text-sm">
      <div className="mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3">
        <p role="status">{viewerDevice && status === 'ready' && online ? 'Connected · View only · ' : ''}{online ? 'Shared family · refresh to see other devices’ changes' : 'Offline · reconnect to load or save changes'}</p>
        <button type="button" disabled={!online || status === 'loading'} onClick={refresh} className="font-semibold text-emerald-800 disabled:opacity-50">Refresh</button>
        {viewerDevice ? <button type="button" disabled={!online || disconnecting} onClick={() => void leaveViewer()} className="font-semibold text-emerald-800 disabled:opacity-50">Sign in as an adult</button>
          : <button type="button" onClick={() => void onSignOut().catch((error: Error) => setError(error.message))} className="font-semibold text-emerald-800">Sign out</button>}
      </div>
      {repository.conflict ? <div role="alert" className="mx-auto mt-3 max-w-xl text-red-700"><p>{repository.conflict.message}</p><button type="button" className="mt-2 underline" onClick={() => {
        const text = createBackup(repository.conflict!.proposed, format(new Date(), 'yyyy-MM-dd'))
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
        const link = document.createElement('a'); link.href = url; link.download = 'turntally-unsaved-change.json'; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>Download attempted version</button></div> : null}
      {error ? <p role="alert" className="mx-auto mt-3 max-w-xl text-red-700">{error}</p> : null}
    </div>
    {status === 'loading' ? <PageShell><p className="m-8">Loading your family…</p></PageShell>
      : status === 'ready' ? devicesOpen && repository.identity.role === 'administrator'
        ? <PageShell><DeviceManager client={client} people={people} onBack={() => setDevicesOpen(false)} /></PageShell>
        : <App key={generation} repository={repository} onManageDevices={() => {
          void repository.readSnapshot().then(snapshot => { setPeople(snapshot.configuration?.people ?? []); setDevicesOpen(true) })
        }} />
      : status === 'migration' ? <Migration repository={repository} onComplete={refresh} />
      : <PageShell><p className="m-8">Family access could not be loaded. Check your connection or ask the family owner to link your account, then refresh.</p></PageShell>}
  </>
}

function Migration({ repository, onComplete }: { repository: SupabaseRotationRepository; onComplete: () => void }) {
  const [backup, setBackup] = useState<Backup | null>(null)
  const [administratorId, setAdministratorId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = format(new Date(), 'yyyy-MM-dd')
  function preview(text: string) {
    const next = parseBackup(text, today)
    if (!next.configuration.rolesInitialized) throw new Error('Set up family roles in the local prototype, then export a new backup.')
    setBackup(next); setAdministratorId(''); setConfirmed(false)
  }
  async function prepare(action: () => Promise<string>) {
    setBusy(true); setError(null); setBackup(null); setConfirmed(false)
    try { preview(await action()) } catch (error) { setError(error instanceof Error ? error.message : 'Could not read this family.') }
    finally { setBusy(false) }
  }
  const counts = backup ? backupCounts(backup.configuration, backup.events) : null
  return <PageShell><main className="mx-auto w-full max-w-xl px-5 py-12">
    <h1 className="text-3xl font-semibold">Bring your family to TurnTally</h1>
    <p className="mt-3 text-stone-600">Preview a backup or this browser’s existing family, then choose the administrator linked to your sign-in. Your local data stays in this browser.</p>
    <button type="button" disabled={busy} onClick={() => void prepare(async () => createBackup(await new LocalStorageRotationRepository(localStorage).readSnapshot(), today))} className={buttonClass + ' mt-6'}>Preview this browser’s family</button>
    <label className="mt-5 block">Choose a family backup<input type="file" accept=".json,application/json" disabled={busy} className="mt-2 block w-full" onChange={(event) => {
      const file = event.target.files?.[0]
      if (!file) return
      void prepare(async () => {
        if (file.size > MAX_BACKUP_BYTES) throw new Error('Choose a backup smaller than 10 MB.')
        return file.text()
      })
    }} /></label>
    {backup && counts ? <section className="mt-6 space-y-4 rounded-2xl border border-stone-300 bg-white p-5">
      <h2 className="text-xl font-semibold">Family preview</h2>
      <p>{counts.people} people · {counts.activities} activities · {counts.events} history events</p>
      <p>{backup.configuration.people.map((person) => person.name).join(', ')}</p>
      <label className="block">Your administrator profile<select className={inputClass} value={administratorId} onChange={(event) => setAdministratorId(event.target.value)}><option value="">Choose your profile</option>{backup.configuration.people.filter((person) => person.role === 'administrator' && person.active !== false).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <label className="flex gap-3"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Use this family as the shared pilot data and link my sign-in to the selected administrator.</label>
      <button type="button" className={buttonClass} disabled={busy || !confirmed || !administratorId} onClick={async () => {
        setBusy(true); setError(null)
        try { await repository.initialize(JSON.stringify(backup), administratorId); onComplete() }
        catch (error) { setError(error instanceof Error ? error.message : 'Migration failed. Try again.') }
        finally { setBusy(false) }
      }}>{busy ? 'Saving…' : 'Start shared family'}</button>
    </section> : null}
    {error ? <p role="alert" className="mt-4 text-red-700">{error}</p> : null}
  </main></PageShell>
}
