import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DeviceError, deviceCommand } from './deviceApi'

interface PendingPairing { id: string; code: string; proof: string; expires_at: string; session?: { access_token: string; refresh_token: string } }
interface PairingResult { state: string; session?: { access_token: string; refresh_token: string } }
const storageKey = 'turntally:pending-viewer'
const buttonClass = 'rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50'
function savedRequest(): PendingPairing | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as PendingPairing | null
    if (value && typeof value.id === 'string' && typeof value.code === 'string' && /^[a-f0-9]{64}$/.test(value.proof) && Date.parse(value.expires_at) > Date.now()) return value
    sessionStorage.removeItem(storageKey)
  } catch { /* Storage may be disabled; pairing still works in memory. */ }
  return null
}
function storeRequest(request: PendingPairing | null) {
  try {
    if (request) sessionStorage.setItem(storageKey, JSON.stringify(request))
    else sessionStorage.removeItem(storageKey)
  } catch { /* The current tab retains the private proof in memory. */ }
}

export function ViewerPairing({ client, onBack }: { client: SupabaseClient; onBack: () => void }) {
  const [pending, setPending] = useState<PendingPairing | null>(savedRequest)
  const deliveredSession = useRef(pending?.session)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!pending) return
    let active = true
    let delay = 5000
    let issuedSession = pending.session
    let timer: ReturnType<typeof setTimeout>
    const finish = (message: string) => {
      if (!active) return
      storeRequest(null); setPending(null); setMessage(message)
    }
    const poll = async () => {
      if (!active) return
      if (Date.parse(pending.expires_at) <= Date.now()) { finish('This code expired. Get a new code.'); return }
      setBusy(true)
      try {
        const result = issuedSession ? { state: 'issued', session: issuedSession } : await deviceCommand<PairingResult>(client, 'poll', { id: pending.id, proof: pending.proof })
        if (!active) return
        if (result.state === 'issued' && result.session) {
          // Retain the delivered session across a lost activation response or
          // reload. It has no family membership until activation succeeds.
          issuedSession = result.session
          deliveredSession.current = issuedSession
          storeRequest({ ...pending, session: issuedSession })
          const claimed = await deviceCommand<PairingResult>(client, 'activate', { id: pending.id, proof: pending.proof }, result.session.access_token)
          if (claimed.state !== 'claimed') { finish('Pairing ended. Get a new code.'); return }
          const { error } = await client.auth.setSession(result.session)
          if (error) {
            await deviceCommand(client, 'disconnect', {}, result.session.access_token)
            throw new Error('Could not store this device session. Get a new code.')
          }
          storeRequest(null)
          return
        }
        if (['expired','denied','canceled','claimed','issued'].includes(result.state)) {
          // Issued without tokens means a prior response was lost/reloaded.
          await deviceCommand(client, 'cancel', { id: pending.id, proof: pending.proof })
          finish(result.state === 'denied' ? 'A parent declined this request. Get a new code to try again.' : 'This pairing ended. Get a new code.')
          return
        }
        setMessage('Waiting for a parent to approve this code.')
        delay = 5000
      } catch (error) {
        if (!active) return
        if (error instanceof DeviceError && [400,401,403,410].includes(error.status)) { finish(error.message); return }
        setMessage(error instanceof Error ? error.message : 'Connection interrupted. Retrying…')
        delay = Math.min(delay * 2, 30000)
      } finally { if (active) setBusy(false) }
      if (active) timer = setTimeout(() => void poll(), delay)
    }
    timer = setTimeout(() => void poll(), delay)
    return () => { active = false; clearTimeout(timer) }
  }, [client, pending])
  const remaining = pending ? Math.max(0, Math.ceil((Date.parse(pending.expires_at) - now) / 1000)) : 0
  return <section className="mt-6 space-y-5">
    <h2 className="text-2xl font-semibold">Connect a viewer device</h2>
    <p>View family turns without an email or password. Ask a parent to approve this browser from their own signed-in device.</p>
    {pending ? <>
      <p className="text-sm">On the parent’s device, open <strong>Family → Devices → Add viewer device</strong> and enter:</p>
      <p aria-label="Pairing code" className="rounded-2xl bg-white p-5 text-center font-mono text-4xl font-bold tracking-wider">{pending.code}</p>
      <p>Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}. Compare this code before approving.</p>
    </> : <button className={buttonClass} disabled={busy} onClick={async () => {
      setBusy(true); setMessage('')
      try {
        const request = await deviceCommand<PendingPairing>(client, 'start')
        deliveredSession.current = undefined
        storeRequest(request); setPending(request); setMessage('Waiting for a parent to approve this code.')
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not get a code.') }
      finally { setBusy(false) }
    }}>Get a pairing code</button>}
    {message ? <p role="status">{message}</p> : null}
    <button className="block font-semibold text-emerald-800 disabled:opacity-50" disabled={busy} onClick={async () => {
      setBusy(true)
      try {
        if (pending) {
          const canceled = await deviceCommand<PairingResult>(client, 'cancel', { id: pending.id, proof: pending.proof })
          if (canceled.state === 'claimed') {
            if (!deliveredSession.current) throw new Error('This request already connected. Reload to check the device session.')
            await deviceCommand(client, 'disconnect', {}, deliveredSession.current.access_token)
          }
        }
        storeRequest(null); setPending(null); onBack()
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not cancel. Reconnect and retry.') }
      finally { setBusy(false) }
    }}>{pending ? 'Cancel pairing' : 'Back to parental sign-in'}</button>
  </section>
}
