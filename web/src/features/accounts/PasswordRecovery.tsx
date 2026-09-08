import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PageShell } from '../../components/PageShell'
import { passwordError, RECOVERY_PATH } from './recoverySession'

const buttonClass = 'rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50'
const inputClass = 'mt-1 block w-full rounded-xl border border-stone-300 bg-white p-3'

export function RequestPasswordReset({ client, initialEmail, onBack }: { client: SupabaseClient; initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(false), 60000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  return <PageShell><main className="mx-auto w-full max-w-md px-5 py-12">
    <h1 className="text-3xl font-semibold">Reset your password</h1>
    <p className="mt-3 text-stone-600">Enter the email for your adult account. Viewer devices can be paired again by a parent.</p>
    <form className="mt-6 space-y-4" onSubmit={async event => {
      event.preventDefault()
      if (busy || cooldown) return
      setBusy(true); setError(null); setSent(false)
      try {
        const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + RECOVERY_PATH })
        // Never show account-existence or provider-specific details.
        if (result.error && !['user_not_found', 'email_address_not_authorized'].includes(result.error.code ?? '')) throw result.error
        setSent(true); setCooldown(true)
      } catch {
        setError('Unable to request a reset right now. Check your connection, wait a minute, and try again. If it continues, contact the pilot owner.')
        setCooldown(true)
      } finally { setBusy(false) }
    }}>
      <label className="block">Email<input className={inputClass} type="email" autoComplete="username" required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
      {sent ? <p role="status">If this address has an adult account, you’ll receive a reset link. Check your inbox and spam folder. If nothing arrives, contact the pilot owner.</p> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      <button className={buttonClass} disabled={busy || cooldown}>{busy ? 'Requesting…' : cooldown ? 'Wait a minute before retrying' : 'Send reset link'}</button>
    </form>
    <button type="button" disabled={busy} className="mt-6 font-semibold text-emerald-800" onClick={onBack}>Back to sign in</button>
  </main></PageShell>
}

export function PasswordRecovery({ client, ready }: { client: SupabaseClient; ready: Promise<number> }) {
  const [phase, setPhase] = useState<'checking' | 'invalid' | 'editing' | 'saved' | 'done'>('checking')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    let timer: number | undefined
    void ready.then(expires => {
      if (!active) return
      setPhase('editing')
      timer = window.setTimeout(() => {
        setPhase(current => current === 'editing' ? 'invalid' : current)
        setPassword(''); setConfirmation('')
      }, Math.max(0, expires - Date.now()))
    }).catch(() => { if (active) setPhase('invalid') })
    return () => { active = false; window.clearTimeout(timer) }
  }, [ready])

  async function finish() {
    const result = await client.auth.signOut({ scope: 'global' })
    if (result.error) throw result.error
    setPhase('done')
  }
  return <PageShell><main className="mx-auto w-full max-w-md px-5 py-12">
    <h1 className="text-3xl font-semibold">{phase === 'done' ? 'Password updated' : 'Reset your password'}</h1>
    {phase === 'checking' ? <p role="status" className="mt-4">Checking your reset link…</p> : null}
    {phase === 'invalid' ? <p role="alert" className="mt-4">This reset link is missing, expired, or already used. Return to sign in and request a new link. Keep this tab open while choosing your password.</p> : null}
    {phase === 'editing' ? <form className="mt-6 space-y-4" onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      setError(null)
      if (password.length < 12) { setError('Use at least 12 characters.'); return }
      if (password !== confirmation) { setError('The passwords do not match.'); return }
      setBusy(true)
      try {
        const result = await client.auth.updateUser({ password })
        if (result.error) { setError(passwordError(result.error)); return }
        setPassword(''); setConfirmation(''); setPhase('saved')
        try { await finish() } catch { setError('Your password was updated, but sign-out could not finish. Reconnect and choose Finish recovery.') }
      } catch { setError(passwordError(null)) }
      finally { setBusy(false) }
    }}>
      <p className="text-stone-600">Choose a unique password with at least 12 characters.</p>
      <label className="block">New password<input className={inputClass} type="password" autoComplete="new-password" minLength={12} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label className="block">Confirm new password<input className={inputClass} type="password" autoComplete="new-password" minLength={12} required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      <button className={buttonClass} disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
    </form> : null}
    {error ? <p role="alert" className="mt-4 text-red-700">{error}</p> : null}
    {phase === 'saved' ? <button type="button" className={buttonClass + ' mt-4'} disabled={busy} onClick={async () => {
      setBusy(true); setError(null)
      try { await finish() } catch { setError('Your password is updated. Reconnect and retry finishing sign-out.') }
      finally { setBusy(false) }
    }}>Finish recovery</button> : null}
    {phase === 'done' ? <p role="status" className="mt-4">Use your new password the next time you sign in. Your family data and access permissions are unchanged.</p> : null}
    {phase !== 'checking' && phase !== 'saved' ? <a className="mt-6 inline-block font-semibold text-emerald-800" href="/">{phase === 'done' ? 'Back to TurnTally' : 'Return to sign in'}</a> : null}
  </main></PageShell>
}
