import type { SupabaseClient } from '@supabase/supabase-js'

export const RECOVERY_PATH = '/auth/recovery'
export const recoveryClientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'turntally-password-recovery' },
}
type RecoveryTokens = { access_token: string; refresh_token: string }

// Run before creating any Auth client. Recovery credentials never enter the
// normal browser session, family repository, or persistent storage.
export function captureRecoveryLink(location: Location, history: History): { tokens: RecoveryTokens | null } | null {
  const fragment = new URLSearchParams(location.hash.slice(1))
  if (location.pathname !== RECOVERY_PATH && fragment.get('type') !== 'recovery' && !fragment.has('error')) return null
  const access = fragment.get('access_token')
  const refresh = fragment.get('refresh_token')
  const valid = fragment.get('type') === 'recovery' && !fragment.has('error') && !!access && !!refresh
  history.replaceState(null, '', RECOVERY_PATH)
  return { tokens: valid ? { access_token: access!, refresh_token: refresh! } : null }
}

export async function openRecoverySession(client: SupabaseClient, tokens: RecoveryTokens | null): Promise<number> {
  if (!tokens) throw new Error('Invalid recovery link')
  const result = await client.auth.setSession(tokens)
  if (result.error || !result.data.session) throw new Error('Invalid recovery session')
  // Consult Auth, not editable metadata or an existing cached browser session.
  const verified = await client.auth.getUser()
  if (verified.error || !verified.data.user || verified.data.user.app_metadata?.turntally_viewer === true) {
    await client.auth.signOut({ scope: 'local' })
    throw new Error('Parental recovery session required')
  }
  const expires = (result.data.session.expires_at ?? 0) * 1000
  if (expires <= Date.now()) throw new Error('Recovery session expired')
  return expires
}

export function passwordError(error: { code?: string } | null): string {
  if (error?.code === 'same_password') return 'Choose a password different from your current password.'
  if (error?.code === 'weak_password') return 'Choose a stronger password with at least 12 characters. Avoid common or previously exposed passwords.'
  return 'The password could not be changed. Check your connection and try again, or request a new reset link.'
}
