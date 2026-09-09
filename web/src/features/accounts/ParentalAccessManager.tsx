import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parentalCommand, type ParentalAccounts, type ParentalAccount } from './parentalApi'

const button = 'rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50'
const input = 'mt-2 block w-full rounded-xl border border-stone-300 bg-white p-3'
export function ParentalAccessManager({ client, onBack }: { client: SupabaseClient; onBack: () => void }) {
  const [data, setData] = useState<ParentalAccounts | null>(null)
  const [generation, setGeneration] = useState(0)
  const [code, setCode] = useState('')
  const [review, setReview] = useState<{ code: string; email: string } | null>(null)
  const [personId, setPersonId] = useState('')
  const [additional, setAdditional] = useState(false)
  const [revoking, setRevoking] = useState<ParentalAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setData(null)
    void parentalCommand<ParentalAccounts>(client,'list').then(next => { if (active) setData(next) }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [client, generation])
  const person = data?.people.find(p => p.id === personId)
  const duplicates = data?.accounts.some(a => a.person_id === personId && !a.revoked_at)
  async function command(operation: string, payload: Record<string, unknown>, success: string) {
    setBusy(true); setError(null); setMessage(null)
    try {
      await parentalCommand(client,operation,payload)
      setReview(null); setRevoking(null); setCode(''); setMessage(success); setGeneration(n => n + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update access.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto w-full max-w-xl space-y-5 px-5 py-8">
    <button onClick={onBack} disabled={busy} className="font-semibold text-emerald-800">Back to family</button>
    <h1 className="text-3xl font-semibold">Parental access</h1>
    <p>Link a parental sign-in to an existing family member. The account uses that person's current permissions.</p>
    {message ? <p role="status">{message}</p> : null}
    {error ? <div role="alert" className="space-y-3 text-red-700"><p>{error}</p><button className="underline" disabled={busy} onClick={() => { setError(null); setReview(null); setRevoking(null); setGeneration(n => n + 1) }}>Reload access list</button></div> : null}
    {!data && !error ? <p role="status">Loading parental access…</p> : null}
    {data ? <>
      <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">Link parental account</h2>
        {!review ? <form onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError(null); setMessage(null)
          try {
            const next = await parentalCommand<{ email: string }>(client,'lookup',{ code })
            const latest = await parentalCommand<ParentalAccounts>(client,'list')
            setData(latest); setPersonId(''); setAdditional(false); setReview({ code, email:next.email }); setRevoking(null)
          } catch (error) { setError(error instanceof Error ? error.message : 'Could not look up this code.') }
          finally { setBusy(false) }
        }} className="space-y-4">
          <label className="block">Linking code<input className={input} required maxLength={20} autoComplete="off" value={code} onChange={e => setCode(e.target.value)} /></label>
          <button className={button} disabled={busy || !code.trim()}>Review account</button>
        </form> : <div className="space-y-4">
          <p>Sign-in address: <strong className="break-all">{review.email}</strong></p>
          <p>Compare code <strong>{review.code}</strong> with the parental account holder's screen before approving.</p>
          <label className="block">Family member<select className={input} value={personId} disabled={busy} onChange={e => { setPersonId(e.target.value); setAdditional(false) }}><option value="">Choose a family member</option>{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {person ? <p>Permissions: <strong>{person.role === 'administrator' ? 'Administrator — manages family and access' : 'Editor — edits activities and outcomes'}</strong></p> : null}
          {duplicates ? <label className="flex gap-3"><input type="checkbox" checked={additional} onChange={e => setAdditional(e.target.checked)} disabled={busy} />This person already has a login. Add another login for them.</label> : null}
          <button className={button} disabled={busy || !person || (!!duplicates && !additional)} onClick={() => void command('approve',{ code:review.code,person_id:personId,confirm_additional:additional },'Parental access approved.')}>Approve access</button>
          <button className="px-4 py-3 font-semibold" disabled={busy} onClick={() => { setReview(null); setCode('') }}>Cancel review</button>
          <button className="block text-red-700 underline" disabled={busy} onClick={() => void command('deny',{ code:review.code },'Linking request denied.')}>Deny request</button>
        </div>}
      </section>
      <h2 className="text-xl font-semibold">Linked accounts</h2>
      {data.accounts.map(account => <article key={account.user_id} className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5">
        <p className="break-all font-semibold">{account.email}</p>
        <p>{account.person_name ?? data.people.find(p => p.id === account.person_id)?.name ?? 'Family member'} · {account.role} · {account.revoked_at ? 'Revoked' : 'Active'}</p>
        {!account.revoked_at && !account.protected ? <button className="font-semibold text-red-700" disabled={busy} onClick={() => { setRevoking(account); setReview(null); setMessage(null) }}>Revoke access for {account.email}</button> : null}
        {account.protected ? <p className="text-sm text-stone-600">Your current login and the family owner's login are protected here.</p> : null}
        {revoking?.user_id === account.user_id ? <div className="space-y-3">
          <p>Revoke <strong>{account.email}</strong> on all its devices? The family member and history stay. Restoring access requires a fresh sign-in and parent approval.</p>
          <button className={button} disabled={busy} onClick={() => void command('revoke',{ user_id:account.user_id },'Parental access revoked.')}>Confirm revocation</button>
          <button className="px-4 py-3 font-semibold" disabled={busy} onClick={() => setRevoking(null)}>Cancel revocation</button>
        </div> : null}
      </article>)}
    </> : null}
  </main>
}
