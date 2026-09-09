import { act, fireEvent, render, screen } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewerPairing } from './ViewerPairing'

const id = '00000000-0000-0000-0000-000000000001'
function fixture() {
  const invoke = vi.fn(async (_name: string, options: { body: { action: string } }) => {
    if (options.body.action === 'start') return { data: { id, code:'ABCD-EFGH', proof:'a'.repeat(64), expires_at: new Date(Date.now() + 600000).toISOString() }, error:null }
    return { data: { state:'pending' }, error:null }
  })
  const setSession = vi.fn().mockResolvedValue({ error:null })
  const client = { functions: { invoke }, auth: { setSession } } as unknown as SupabaseClient
  const onBack = vi.fn()
  return { client, invoke, setSession, onBack }
}
describe('viewer pairing screen', () => {
  beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); sessionStorage.clear() })
  it('waits for approval, activates with its own token, and only then stores its Auth session', async () => {
    const f = fixture(); render(<ViewerPairing client={f.client} onBack={f.onBack} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name:'Get a pairing code' })))
    expect(screen.getByLabelText('Pairing code')).toHaveTextContent('ABCD-EFGH')
    expect(f.setSession).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(f.invoke).toHaveBeenLastCalledWith('viewer-devices', { body: { action:'poll', id, proof:'a'.repeat(64) } })
    const session = { access_token:'only-viewer', refresh_token:'only-viewer-refresh' }
    f.invoke.mockResolvedValueOnce({ data:{ state:'issued', session }, error:null } as never)
    f.invoke.mockResolvedValueOnce({ data:{ state:'claimed' }, error:null } as never)
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(f.invoke).toHaveBeenLastCalledWith('viewer-devices', { body: { action:'activate', id, proof:'a'.repeat(64) }, headers: { Authorization:'Bearer only-viewer' } })
    expect(f.setSession).toHaveBeenCalledExactlyOnceWith(session)
    expect(sessionStorage.length).toBe(0)
  })
  it('retains a delivered session to retry an interrupted activation without minting another', async () => {
    const f = fixture(); const view = render(<ViewerPairing client={f.client} onBack={f.onBack} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name:'Get a pairing code' })))
    const session = { access_token:'viewer-access', refresh_token:'viewer-refresh' }
    f.invoke.mockResolvedValueOnce({ data:{ state:'issued', session }, error:null } as never)
    f.invoke.mockRejectedValueOnce(new Error('Network interrupted'))
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(f.setSession).not.toHaveBeenCalled()
    view.unmount()
    f.invoke.mockResolvedValueOnce({ data:{ state:'claimed' }, error:null } as never)
    render(<ViewerPairing client={f.client} onBack={f.onBack} />)
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(f.invoke).toHaveBeenLastCalledWith('viewer-devices', expect.objectContaining({ body: { action:'activate', id, proof:'a'.repeat(64) } }))
    expect(f.setSession).toHaveBeenCalledWith(session)
  })
  it('expires pending codes and cancels before returning to parental sign-in', async () => {
    const f = fixture(); render(<ViewerPairing client={f.client} onBack={f.onBack} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name:'Get a pairing code' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name:'Cancel pairing' })))
    expect(f.invoke).toHaveBeenLastCalledWith('viewer-devices', { body: { action:'cancel', id, proof:'a'.repeat(64) } })
    expect(f.onBack).toHaveBeenCalledOnce()
    expect(sessionStorage.length).toBe(0)
    await act(async () => fireEvent.click(screen.getByRole('button', { name:'Get a pairing code' })))
    await act(async () => vi.advanceTimersByTimeAsync(600000))
    expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('expired')
    expect(f.setSession).not.toHaveBeenCalled()
  })
})
