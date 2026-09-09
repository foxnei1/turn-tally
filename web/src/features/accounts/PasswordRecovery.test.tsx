import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PasswordRecovery, RequestPasswordReset } from './PasswordRecovery'
import { captureRecoveryLink, openRecoverySession, recoveryClientOptions } from './recoverySession'

const cast = (auth: object) => ({ auth }) as unknown as SupabaseClient
const ready = () => Promise.resolve(Date.now() + 600000)
afterEach(() => { window.history.replaceState(null, '', '/'); vi.useRealTimers() })

describe('parental password recovery', () => {
  it('requests the exact same-origin callback and gives a neutral response with a cooldown', async () => {
    const auth = { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }) }
    render(<RequestPasswordReset client={cast(auth)} initialEmail="parent@example.com" onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('parent@example.com', { redirectTo: window.location.origin + '/auth/recovery' })
    expect(screen.getByRole('status')).toHaveTextContent('If this address has a parental account')
    expect(screen.getByRole('button', { name: 'Wait a minute before retrying' })).toBeDisabled()
  })
  it('never renders provider errors containing account details', async () => {
    const auth = { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: { code: 'email_address_not_authorized', message: 'private address detail' } }) }
    render(<RequestPasswordReset client={cast(auth)} initialEmail="unknown@example.com" onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(screen.getByRole('status')).toHaveTextContent('If this address has a parental account')
    expect(screen.queryByText(/private address detail/)).not.toBeInTheDocument()
  })
  it('handles network failures without claiming a reset was requested', async () => {
    render(<RequestPasswordReset client={cast({ resetPasswordForEmail: vi.fn().mockRejectedValue(new Error('network detail')) })} initialEmail="parent@example.com" onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to request a reset')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('removes credentials and redirect parameters before initializing Auth, including fallback to the site root', () => {
    window.history.replaceState(null, '', '/?next=https://untrusted.example#type=recovery&access_token=test-access&refresh_token=test-refresh')
    expect(captureRecoveryLink(window.location, window.history)).toEqual({ tokens: { access_token: 'test-access', refresh_token: 'test-refresh' } })
    expect(window.location.pathname).toBe('/auth/recovery')
    expect(window.location.hash + window.location.search).toBe('')
    expect(recoveryClientOptions.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false })
  })
  it('does not treat a normal session or an expired-link error as recovery credentials', async () => {
    window.history.replaceState(null, '', '/auth/recovery#error=access_denied&error_description=private&access_token=test-access&refresh_token=test-refresh')
    expect(captureRecoveryLink(window.location, window.history)).toEqual({ tokens: null })
    expect(window.location.hash).toBe('')
    const auth = { setSession: vi.fn(), getSession: vi.fn() }
    await expect(openRecoverySession(cast(auth), null)).rejects.toThrow()
    expect(auth.setSession).not.toHaveBeenCalled()
    expect(auth.getSession).not.toHaveBeenCalled()
  })
  it('verifies recovery with Auth and refuses a viewer identity', async () => {
    const auth = {
      setSession: vi.fn().mockResolvedValue({ data: { session: { expires_at: Date.now() / 1000 + 600 } }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { app_metadata: { turntally_viewer: true } } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    }
    await expect(openRecoverySession(cast(auth), { access_token: 'test-access', refresh_token: 'test-refresh' })).rejects.toThrow('Parental recovery session required')
    expect(auth.getUser).toHaveBeenCalled()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('validates matching passwords and ends recovery after updating the password', async () => {
    const auth = { updateUser: vi.fn().mockResolvedValue({ error: null }), signOut: vi.fn().mockResolvedValue({ error: null }) }
    render(<PasswordRecovery client={cast(auth)} ready={ready()} />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('New password'), 'new-example-password')
    await user.type(screen.getByLabelText('Confirm new password'), 'different-password')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('do not match')
    expect(auth.updateUser).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Confirm new password'))
    await user.type(screen.getByLabelText('Confirm new password'), 'new-example-password')
    await user.click(screen.getByRole('button', { name: 'Update password' }))
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'new-example-password' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' })
    expect(screen.getByRole('heading', { name: 'Password updated' })).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })
  it('retries sign-out without changing the password twice when cleanup fails', async () => {
    const auth = { updateUser: vi.fn().mockResolvedValue({ error: null }), signOut: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ error: null }) }
    render(<PasswordRecovery client={cast(auth)} ready={ready()} />)
    const input = await screen.findByLabelText('New password')
    fireEvent.change(input, { target: { value: 'new-example-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-example-password' } })
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(screen.getByRole('alert')).toHaveTextContent('password was updated')
    await userEvent.click(screen.getByRole('button', { name: 'Finish recovery' }))
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Password updated' })).toBeInTheDocument()
  })
  it('shows expired/reused links without a password form', async () => {
    const rejected = Promise.reject(new Error('secret error detail'))
    render(<PasswordRecovery client={cast({})} ready={rejected} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('missing, expired, or already used')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })
  it('discards an unfinished password when the recovery session expires', async () => {
    vi.useFakeTimers()
    render(<PasswordRecovery client={cast({})} ready={Promise.resolve(Date.now() + 1000)} />)
    await act(async () => {})
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'unfinished-password' } })
    await act(async () => { vi.advanceTimersByTime(1001) })
    expect(screen.getByRole('alert')).toHaveTextContent('expired')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })
})
