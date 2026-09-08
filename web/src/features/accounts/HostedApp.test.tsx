import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { HostedApp } from './HostedApp'
import { LocalStorageRotationRepository } from '../../data/localStorageRepository'
import type { HouseholdSnapshot } from '../../data/RotationRepository'
import { hostedFixture } from '../../test/hostedFixture'

describe('hosted sign-in', () => {
  it('opens adult password recovery from sign-in without loading a family', async () => {
    const auth = {
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    }
    const rpc = vi.fn()
    render(<HostedApp client={{ auth, rpc } as unknown as SupabaseClient} />)
    await userEvent.type(await screen.findByLabelText('Email'), 'parent@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('parent@example.com')
    expect(rpc).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
  it('previews local data and requires an explicit administrator choice and confirmation before migration', async () => {
    localStorage.clear()
    const local = new LocalStorageRotationRepository(localStorage)
    const snapshot = hostedFixture()
    await local.replaceSnapshot(snapshot)
    let shared: HouseholdSnapshot | null = null
    let revision = 0
    const client = {
      auth: {
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'owner' } } }, error: null }),
      },
      rpc: vi.fn().mockImplementation(async (name: string, args?: { proposed_snapshot: HouseholdSnapshot }) => {
        if (name === 'turntally_save') { shared = args!.proposed_snapshot; return { data: { revision: ++revision }, error: null } }
        return { data: { household_id: 'family', snapshot: shared, revision, person_id: shared ? 'parent' : null, role: shared ? 'administrator' : null }, error: null }
      }),
    }
    render(<HostedApp client={client as unknown as SupabaseClient} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Preview this browser’s family' }))
    expect(await screen.findByRole('heading', { name: 'Family preview' })).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Start shared family' })
    expect(submit).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Your administrator profile'), 'parent')
    expect(submit).toBeDisabled()
    expect(client.rpc.mock.calls.filter(([name]) => name === 'turntally_save')).toHaveLength(0)
    await user.click(screen.getByRole('checkbox'))
    await user.click(submit)
    expect(await screen.findByRole('heading', { name: 'Your turns' })).toBeInTheDocument()
    expect(client.rpc).toHaveBeenCalledWith('turntally_save', expect.objectContaining({ operation: 'initialize', administrator_id: 'parent', expected_revision: 0 }))
    expect(await local.readSnapshot()).toEqual(snapshot)
  })
  it('signs in with supplied credentials without creating an account', async () => {
    const auth = {
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn(),
    }
    render(<HostedApp client={{ auth } as unknown as SupabaseClient} />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password'), 'example-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'parent@example.com', password: 'example-password' })
    expect(auth.signUp).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
  it('does not expose local family setup to an authenticated but unprovisioned account', async () => {
    const client = {
      auth: {
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'unprovisioned' } } }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'Family access is not available' } }),
    }
    render(<HostedApp client={client as unknown as SupabaseClient} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Family access is not available')
    expect(screen.queryByRole('button', { name: 'Start the rotation' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Local profile')).not.toBeInTheDocument()
  })
  it('renders a shared viewer without impersonation and clears the family when focus detects revocation', async () => {
    const client = {
      auth: {
        onAuthStateChange:vi.fn().mockReturnValue({ data:{ subscription:{ unsubscribe:vi.fn() } } }),
        getSession:vi.fn().mockResolvedValue({ data:{ session:{ user:{ id:'device', app_metadata:{ turntally_viewer:true } } } }, error:null }),
      },
      rpc:vi.fn().mockResolvedValue({ data:{ household_id:'family', snapshot:hostedFixture(), revision:1, person_id:null, role:'viewer', device:{ id:'tablet', name:'Kitchen tablet', kind:'shared' } }, error:null }),
    }
    render(<HostedApp client={client as unknown as SupabaseClient} />)
    expect(await screen.findByRole('heading', { name:'Your turns' })).toBeInTheDocument()
    expect(screen.getByText('Family viewer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name:'Add activity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name:'Backups' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Local profile')).not.toBeInTheDocument()
    expect(client.rpc.mock.calls.every(([name]) => name === 'turntally_load')).toBe(true)
    client.rpc.mockResolvedValue({ data:null, error:{ code:'42501', message:'Device revoked' } })
    await act(async () => fireEvent.focus(window))
    expect(await screen.findByRole('alert')).toHaveTextContent('Device revoked')
    expect(screen.queryByRole('heading', { name:'Your turns' })).not.toBeInTheDocument()
    expect(screen.queryByText('Family viewer')).not.toBeInTheDocument()
    expect(client.rpc).toHaveBeenLastCalledWith('turntally_access')
  })
  it('requires server disconnection before adult sign-in and keeps viewer mode if it fails', async () => {
    const confirm = vi.spyOn(window,'confirm').mockReturnValue(true)
    const client = {
      auth: {
        onAuthStateChange:vi.fn().mockReturnValue({ data:{ subscription:{ unsubscribe:vi.fn() } } }),
        getSession:vi.fn().mockResolvedValue({ data:{ session:{ user:{ id:'device', app_metadata:{ turntally_viewer:true } } } }, error:null }),
        signOut:vi.fn().mockResolvedValue({ error:null }),
      },
      functions:{ invoke:vi.fn().mockRejectedValueOnce(new Error('Reconnect to disconnect')).mockResolvedValue({ data:{ state:'disconnected' }, error:null }) },
      rpc:vi.fn().mockResolvedValue({ data:{ household_id:'family', snapshot:hostedFixture(), revision:1, person_id:null, role:'viewer', device:{ id:'tablet', name:'Kitchen tablet', kind:'shared' } }, error:null }),
    }
    render(<HostedApp client={client as unknown as SupabaseClient} />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name:'Your turns' })
    await user.click(screen.getByRole('button', { name:'Sign in as an adult' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect to disconnect')
    expect(client.auth.signOut).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name:'Your turns' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name:'Sign in as an adult' }))
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope:'local' })
    expect(client.functions.invoke).toHaveBeenLastCalledWith('viewer-devices', { body:{ action:'disconnect' } })
    confirm.mockRestore()
  })
})
