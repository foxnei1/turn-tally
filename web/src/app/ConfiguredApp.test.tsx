import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const { createClient, auth, rpc } = vi.hoisted(() => ({
  createClient: vi.fn(), rpc: vi.fn(), auth: { setSession: vi.fn(), getUser: vi.fn(), getSession: vi.fn() },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient }))
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); window.history.replaceState(null, '', '/') })

it('keeps deferred recovery links isolated without creating an Auth client', async () => {
  vi.stubEnv('VITE_TURNTALLY_MODE','hosted')
  vi.stubEnv('VITE_TURNTALLY_RECOVERY_ENABLED','false')
  window.history.replaceState(null,'','/auth/recovery#type=recovery&access_token=test-access&refresh_token=test-refresh')
  const { default: ConfiguredApp } = await import('./ConfiguredApp')
  render(<ConfiguredApp />)
  expect(screen.getByRole('heading',{ name:'Password recovery is not available yet' })).toBeInTheDocument()
  expect(createClient).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('')
}, 15000)

it('boots recovery in isolation before the normal Auth client can consume the email link', async () => {
  vi.stubEnv('VITE_TURNTALLY_RECOVERY_ENABLED', 'true')
  vi.stubEnv('VITE_TURNTALLY_MODE', 'hosted')
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-public-key')
  localStorage.setItem('existing-viewer-session', 'untouched')
  window.history.replaceState(null, '', '/auth/recovery#type=recovery&access_token=test-access&refresh_token=test-refresh')
  auth.setSession.mockResolvedValue({ data: { session: { expires_at: Date.now() / 1000 + 600 } }, error: null })
  auth.getUser.mockResolvedValue({ data: { user: { id: 'adult', app_metadata: {} } }, error: null })
  createClient.mockReturnValue({ auth, rpc })
  const { default: ConfiguredApp } = await import('./ConfiguredApp')
  render(<StrictMode><ConfiguredApp /></StrictMode>)
  expect(await screen.findByLabelText('New password')).toBeInTheDocument()
  expect(createClient).toHaveBeenCalledTimes(1)
  expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'turntally-password-recovery' },
  })
  expect(auth.setSession).toHaveBeenCalledTimes(1)
  expect(auth.getSession).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('')
  expect(localStorage.getItem('existing-viewer-session')).toBe('untouched')
})
