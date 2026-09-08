import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { DeviceManager } from './DeviceManager'
import { hostedFixture } from '../../test/hostedFixture'

describe('parent device management', () => {
  it('requires review and an explicit personal/shared approval without treating lookup as authorization', async () => {
    const invoke = vi.fn().mockImplementation(async (_name, options) => ({ data: options.body.action === 'list' ? { devices:[] } : { state: options.body.action === 'approve' ? 'approved' : 'pending' }, error:null }))
    render(<DeviceManager client={{ functions: { invoke } } as unknown as SupabaseClient} people={hostedFixture().configuration!.people} onBack={vi.fn()} />)
    const user = userEvent.setup()
    await screen.findByText('No viewer devices enrolled yet.')
    await user.click(screen.getByRole('button', { name:'Add viewer device' }))
    await user.type(screen.getByLabelText('Pairing code'), 'ABCD-EFGH')
    await user.click(screen.getByRole('button', { name:'Review code' }))
    await screen.findByRole('heading', { name:'Review viewer access' })
    expect(invoke.mock.calls.some(([,options]) => options.body.action === 'approve')).toBe(false)
    await user.selectOptions(screen.getByLabelText('Device purpose'), 'shared')
    await user.type(screen.getByLabelText('Device name'), 'Kitchen tablet')
    expect(screen.queryByLabelText('Family member')).not.toBeInTheDocument()
    expect(screen.getByText(/It cannot change turns or manage access/)).toHaveTextContent('Family viewer')
    await user.click(screen.getByRole('button', { name:'Approve device' }))
    expect(invoke).toHaveBeenLastCalledWith('viewer-devices', { body: { action:'approve', code:'ABCD-EFGH', name:'Kitchen tablet', kind:'shared', person_id:'' } })
    expect(await screen.findByRole('status')).toHaveTextContent('Approved')
  })
})
