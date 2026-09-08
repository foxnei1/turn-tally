import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Person } from '../../domain/rotation/types'
import { deviceCommand, type ViewerDevice } from './deviceApi'

const buttonClass = 'rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50'
const inputClass = 'mt-1 block w-full rounded-xl border border-stone-300 bg-white p-3'
export function DeviceManager({ client, people, onBack }: { client: SupabaseClient; people: readonly Person[]; onBack: () => void }) {
  const [devices, setDevices] = useState<ViewerDevice[]>([])
  const [adding, setAdding] = useState(false)
  const [review, setReview] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'personal' | 'shared'>('personal')
  const [personId, setPersonId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    let active = true
    setBusy(true)
    void deviceCommand<{ devices: ViewerDevice[] }>(client, 'list').then(result => {
      if (active) setDevices(result.devices)
    }).catch((error: Error) => { if (active) setMessage(error.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [client, generation])
  async function perform(action: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update devices.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto w-full max-w-xl space-y-5 px-5 py-10">
    <button className="font-semibold text-emerald-800" onClick={onBack}>Back to family</button>
    <h1 className="text-3xl font-semibold">Viewer devices</h1>
    <p>Each browser has its own view-only access. Revoking a device leaves the family’s turns and other devices intact.</p>
    <div className="flex flex-wrap gap-4"><button className={buttonClass} disabled={busy} onClick={() => { setAdding(true); setReview(false); setCode(''); setName(''); setPersonId(''); setMessage('') }}>Add viewer device</button>
      <button className="font-semibold text-emerald-800" disabled={busy} onClick={() => setGeneration(value => value + 1)}>Refresh devices</button></div>
    {adding ? <form className="space-y-4 rounded-2xl border border-stone-300 bg-white p-5" onSubmit={event => {
      event.preventDefault()
      void perform(async () => {
        if (!review) {
          await deviceCommand(client, 'lookup', { code }); setReview(true)
        } else {
          const result = await deviceCommand<{ state: string }>(client, 'approve', { code, name, kind, person_id: personId })
          if (result.state !== 'approved') throw new Error('Code unavailable. Start with a new code.')
          setAdding(false); setMessage('Approved. Keep the viewer device open to finish connecting, then refresh this list.')
        }
      })
    }}>
      <h2 className="text-xl font-semibold">{review ? 'Review viewer access' : 'Enter the viewer’s code'}</h2>
      <label className="block">Pairing code<input className={inputClass} required maxLength={16} autoComplete="off" spellCheck={false} value={code} disabled={review || busy} onChange={event => setCode(event.target.value.toUpperCase())} /></label>
      {review ? <>
        <p>Compare <strong>{code}</strong> with the code on the device you want to connect to your signed-in family.</p>
        <label className="block">Device purpose<select className={inputClass} value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="personal">Personal device</option><option value="shared">Shared family device</option></select></label>
        {kind === 'personal' ? <label className="block">Family member<select className={inputClass} required value={personId} onChange={event => setPersonId(event.target.value)}><option value="">Choose a person</option>{people.filter(person => person.active !== false).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label> : null}
        <label className="block">Device name<input className={inputClass} required maxLength={80} placeholder="Kitchen tablet" value={name} onChange={event => setName(event.target.value)} /></label>
        <p className="rounded-xl bg-emerald-50 p-3"><strong>View only:</strong> {name.trim() || 'This device'} will view your family’s assignments and history as {kind === 'shared' ? 'Family viewer' : people.find(person => person.id === personId)?.name ?? 'the selected person'}. It cannot change turns or manage access.</p>
      </> : null}
      <button className={buttonClass} disabled={busy}>{review ? 'Approve device' : 'Review code'}</button>
      <button type="button" className="ml-4 text-emerald-800" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
      {review ? <button type="button" className="block text-red-700" disabled={busy} onClick={() => void perform(async () => { await deviceCommand(client, 'deny', { code }); setAdding(false); setMessage('Request declined.') })}>Decline request</button> : null}
    </form> : null}
    {message ? <p role="status">{message}</p> : null}
    {devices.length === 0 && !busy ? <p>No viewer devices enrolled yet.</p> : null}
    <ul className="space-y-4">{devices.map(device => <li key={device.id} className="space-y-2 rounded-2xl border border-stone-300 bg-white p-5">
      <h2 className="text-lg font-semibold">{device.name}</h2>
      <p>{device.kind === 'shared' ? 'Shared family device' : `Personal · ${people.find(person => person.id === device.person_id)?.name ?? 'Inactive member'}`} · {device.revoked_at ? 'Revoked' : 'Active · View only'}</p>
      <p className="text-sm text-stone-600">Enrolled {new Date(device.enrolled_at).toLocaleString()}<br />Last contact {new Date(device.last_seen_at).toLocaleString()}</p>
      <form className="flex items-end gap-2" onSubmit={event => {
        event.preventDefault()
        const name = new FormData(event.currentTarget).get('name')
        void perform(async () => { await deviceCommand(client, 'rename', { id: device.id, name }); setGeneration(value => value + 1) })
      }}><label className="flex-1 text-sm">Rename {device.name}<input key={device.name} name="name" className={inputClass} defaultValue={device.name} required maxLength={80} /></label><button className={buttonClass} disabled={busy}>Save name</button></form>
      {!device.revoked_at ? <button className="font-semibold text-red-700" disabled={busy} onClick={() => {
        if (window.confirm(`Revoke ${device.name}? It will need a new pairing to see your family again.`)) void perform(async () => { await deviceCommand(client, 'revoke', { id: device.id }); setGeneration(value => value + 1) })
      }}>Revoke {device.name}</button> : null}
    </li>)}</ul>
  </main>
}
