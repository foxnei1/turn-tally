import { createClient } from '@supabase/supabase-js'
import App from './App'
import { HostedApp } from '../features/accounts/HostedApp'

const mode = import.meta.env.VITE_TURNTALLY_MODE ?? 'local'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
function configuredClient() {
  if (mode !== 'hosted' || !url || !key) return null
  try { return createClient(url, key) } catch { return null }
}
const client = configuredClient()

export default function ConfiguredApp() {
  if (mode === 'local') return <App />
  if (mode !== 'hosted' || !client) return <main className="m-8"><h1 className="text-2xl font-semibold">TurnTally setup is incomplete</h1><p role="alert" className="mt-3">The hosted app is not configured yet. Contact the pilot owner.</p></main>
  return <HostedApp client={client} />
}
