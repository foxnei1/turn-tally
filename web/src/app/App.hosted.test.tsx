import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { TurnTallyRepository } from '../data/RotationRepository'
import { hostedFixture } from '../test/hostedFixture'
import App from './App'
import { SupabaseRotationRepository } from '../data/supabaseRepository'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('hosted family sessions', () => {
  it('pins assignments once under React strict mode', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { household_id: 'family', snapshot: hostedFixture(), revision: 0, person_id: 'parent', role: 'administrator' }, error: null })
    rpc.mockImplementation(async (name: string) => name === 'turntally_save'
      ? { data: { revision: 1 }, error: null }
      : { data: { household_id: 'family', snapshot: hostedFixture(), revision: 0, person_id: 'parent', role: 'administrator' }, error: null })
    const repository = new SupabaseRotationRepository({ rpc } as unknown as SupabaseClient)
    render(<StrictMode><App repository={repository} today="2026-09-07" /></StrictMode>)
    expect(await screen.findByRole('heading', { name: 'Your turns' })).toBeInTheDocument()
    expect(rpc.mock.calls.filter(([name]) => name === 'turntally_save')).toHaveLength(1)
  })
  it('binds the authenticated viewer and loads assignments without issuing writes', async () => {
    const snapshot = hostedFixture()
    const repository: TurnTallyRepository = {
      hosted: true, readOnly: true, identity: { personId: 'child', role: 'viewer' },
      refresh: vi.fn().mockResolvedValue(undefined),
      readSnapshot: vi.fn().mockResolvedValue(snapshot),
      loadConfiguration: vi.fn().mockResolvedValue(snapshot.configuration),
      listEvents: vi.fn().mockResolvedValue(snapshot.events),
      saveConfiguration: vi.fn(), appendEvent: vi.fn(), clear: vi.fn(), replaceSnapshot: vi.fn(),
    }
    render(<App repository={repository} today="2026-09-07" />)
    expect(await screen.findByRole('heading', { name: 'Your turns' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Local profile')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add activity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up a different family' })).not.toBeInTheDocument()
    expect(repository.appendEvent).not.toHaveBeenCalled()
    expect(repository.replaceSnapshot).not.toHaveBeenCalled()
  })
})
