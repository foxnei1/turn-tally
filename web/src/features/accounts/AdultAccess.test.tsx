import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdultAccessManager } from './AdultAccessManager'
import { AdultLinking } from './AdultLinking'
import { adultCommand } from './adultApi'

vi.mock('./adultApi', async original => ({ ...await original<typeof import('./adultApi')>(), adultCommand:vi.fn() }))
const client = {} as SupabaseClient
const data = {
  people:[{ id:'parent',name:'Parent',role:'administrator' },{ id:'adult',name:'Alex',role:'editor' }],
  accounts:[{ user_id:'owner',person_id:'parent',email:'parent@example.com',role:'administrator',revoked_at:null,protected:true },{ user_id:'adult-user',person_id:'adult',email:'adult@example.com',role:'editor',revoked_at:null,protected:false }],
}
beforeEach(() => vi.mocked(adultCommand).mockReset())
afterEach(() => vi.useRealTimers())

it('requires profile selection and explicit acknowledgement for an additional login', async () => {
  vi.mocked(adultCommand).mockImplementation(async (_client, operation) => operation === 'list' ? structuredClone(data) : operation === 'lookup' ? { email:'new@example.com' } : { state:'approved' })
  render(<AdultAccessManager client={client} onBack={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Linking code'),'ABCD-EFGH')
  await user.click(screen.getByRole('button',{ name:'Review account' }))
  expect(await screen.findByText('new@example.com')).toBeInTheDocument()
  expect(screen.getByRole('button',{ name:'Approve access' })).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('Family member'),'adult')
  expect(screen.getByText(/Editor — edits/)).toBeInTheDocument()
  expect(screen.getByRole('button',{ name:'Approve access' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button',{ name:'Approve access' }))
  expect(await screen.findByText('Adult access approved.')).toBeInTheDocument()
  expect(adultCommand).toHaveBeenCalledWith(client,'approve',{ code:'ABCD-EFGH',person_id:'adult',confirm_additional:true })
})

it('requires named revocation confirmation and keeps the review after a failed request', async () => {
  vi.mocked(adultCommand).mockImplementation(async (_client, operation) => {
    if (operation === 'revoke') throw new Error('Connection lost. Retry.')
    return structuredClone(data)
  })
  render(<AdultAccessManager client={client} onBack={vi.fn()} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button',{ name:'Revoke access for adult@example.com' }))
  expect(adultCommand).not.toHaveBeenCalledWith(client,'revoke',expect.anything())
  expect(screen.queryByRole('button',{ name:'Revoke access for parent@example.com' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button',{ name:'Confirm revocation' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
  expect(screen.getByRole('button',{ name:'Confirm revocation' })).toBeInTheDocument()
})

it('polls only its signed-in request and loads the family after approval', async () => {
  vi.useFakeTimers()
  vi.mocked(adultCommand).mockImplementation(async (_client, operation) => operation === 'start'
    ? { id:'request',code:'ABCD-EFGH',expires_at:new Date(Date.now()+600000).toISOString(),state:'pending' } : { state:'approved' })
  const linked = vi.fn()
  render(<AdultLinking client={client} onLinked={linked} />)
  await act(async () => { fireEvent.click(screen.getByRole('button',{ name:'Get a linking code' })) })
  expect(screen.getByLabelText('Adult linking code')).toHaveTextContent('ABCD-EFGH')
  expect(linked).not.toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(adultCommand).toHaveBeenCalledWith(client,'status',{ id:'request' })
  expect(linked).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(linked).toHaveBeenCalledTimes(1)
})

it('cancels pending linking without granting access', async () => {
  vi.mocked(adultCommand).mockImplementation(async (_client, operation) => operation === 'start'
    ? { id:'request',code:'ABCD-EFGH',expires_at:new Date(Date.now()+600000).toISOString(),state:'pending' } : { state:'canceled' })
  const linked = vi.fn()
  render(<AdultLinking client={client} onLinked={linked} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button',{ name:'Get a linking code' }))
  await user.click(await screen.findByRole('button',{ name:'Cancel linking' }))
  expect(await screen.findByText(/request has ended/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Adult linking code')).not.toBeInTheDocument()
  expect(linked).not.toHaveBeenCalled()
})
