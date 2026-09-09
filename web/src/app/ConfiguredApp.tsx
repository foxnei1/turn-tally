import { createClient } from '@supabase/supabase-js'
import App from './App'
import { HostedApp } from '../features/accounts/HostedApp'
import { PasswordRecovery } from '../features/accounts/PasswordRecovery'
import { captureRecoveryLink, openRecoverySession, recoveryClientOptions } from '../features/accounts/recoverySession'

const mode = import.meta.env.VITE_TURNTALLY_MODE ?? 'local'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const recoveryEnabled = import.meta.env.VITE_TURNTALLY_RECOVERY_ENABLED === 'true'
const recovery = mode === 'hosted' ? captureRecoveryLink(window.location, window.history) : null
function configuredClient() {
  if (mode !== 'hosted' || !url || !key || (recovery && !recoveryEnabled)) return null
  try { return createClient(url, key, recovery ? recoveryClientOptions : undefined) } catch { return null }
}
const client = configuredClient()
const recoveryReady = recovery && client ? openRecoverySession(client, recovery.tokens) : null
// React may mount after Auth finishes. Attach a rejection handler immediately;
// the recovery screen still observes the original rejection.
void recoveryReady?.catch(() => {})
if (recovery) recovery.tokens = null

export default function ConfiguredApp() {
  if (recovery && !recoveryEnabled) return <main className="m-8"><h1 className="text-2xl font-semibold">Password recovery is not available yet</h1><p className="mt-3">Contact the family owner for help with your account.</p><a className="mt-4 block underline" href="/">Back to sign in</a></main>
  if (mode === 'local') return <App />
  if (mode !== 'hosted' || !client) return <main className="m-8"><h1 className="text-2xl font-semibold">TurnTally setup is incomplete</h1><p role="alert" className="mt-3">The hosted app is not configured yet. Contact the pilot owner.</p></main>
  if (recoveryReady) return <PasswordRecovery client={client} ready={recoveryReady} />
  return <HostedApp client={client} recoveryEnabled={recoveryEnabled} />
}
