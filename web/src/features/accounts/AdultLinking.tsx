import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adultCommand, AdultAccessError, type AdultRequest } from './adultApi'

const button = 'rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50'
export function AdultLinking({ client, onLinked }: { client: SupabaseClient; onLinked: () => void }) {
  const [request, setRequest] = useState<AdultRequest | null>(null)
  const [state, setState] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(600)
  useEffect(() => {
    if (!request || state !== 'pending') return
    let active = true; let checking = false
    const tick = () => setRemaining(Math.max(0, Math.ceil((Date.parse(request.expires_at) - Date.now()) / 1000)))
    tick()
    const countdown = window.setInterval(tick, 1000)
    const poll = window.setInterval(async () => {
      if (checking) return
      checking = true
      try {
        const next = await adultCommand<{ state: string }>(client, 'status', { id:request.id })
        if (!active) return
        setError(null)
        if (next.state === 'approved') { setState('approved'); onLinked() }
        else if (next.state !== 'pending') setState(next.state)
      } catch (error) {
        if (active && !(error instanceof AdultAccessError && error.status === 429)) {
          setError(error instanceof Error ? error.message : 'Could not check this code.')
          if (error instanceof AdultAccessError && [403,410].includes(error.status)) setState('unavailable')
        }
      } finally { checking = false }
    }, 5000)
    return () => { active = false; clearInterval(poll); clearInterval(countdown) }
  }, [client, request, state, onLinked])
  return <main className="mx-auto w-full max-w-md space-y-5 px-5 py-10">
    <h1 className="text-3xl font-semibold">Link your adult account</h1>
    <p>Show a linking code to a parent. They will choose your family profile and approve your access.</p>
    {request && state === 'pending' ? <>
      <p aria-label="Adult linking code" className="rounded-xl bg-white p-5 text-center font-mono text-3xl font-semibold">{request.code}</p>
      <p role="status">Waiting for parent approval · {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2,'0')} remaining</p>
      <button className={button} disabled={busy} onClick={async () => {
        setBusy(true); setError(null)
        try {
          const next = await adultCommand<{ state: string }>(client,'cancel',{ id:request.id })
          setState(next.state)
          if (next.state === 'approved') onLinked()
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not cancel.') }
        finally { setBusy(false) }
      }}>Cancel linking</button>
    </> : <>
      {state !== 'idle' && state !== 'approved' ? <p role="status">This linking request has ended. Get a new code to try again.</p> : null}
      <button className={button} disabled={busy || state === 'approved'} onClick={async () => {
        setBusy(true); setError(null)
        try { const next = await adultCommand<AdultRequest>(client,'start'); setRequest(next); setState('pending') }
        catch (error) { setError(error instanceof Error ? error.message : 'Could not create a code.') }
        finally { setBusy(false) }
      }}>{busy ? 'Getting code…' : 'Get a linking code'}</button>
    </>}
    {error ? <p role="alert" className="text-red-700">{error}</p> : null}
  </main>
}
