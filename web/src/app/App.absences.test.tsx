import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import type { HouseholdConfiguration } from '../domain/rotation/types'
import { chooseLocalProfile } from '../test/profiles'
import App from './App'

const configuration: HouseholdConfiguration = {
  rolesInitialized: true,
  people: [{ id: 'parent', name: 'Parent', role: 'administrator' }, { id: 'a', name: 'Alex', role: 'editor' }, { id: 'b', name: 'Sam', role: 'viewer' }],
  startDate: '2026-09-07', rotation: { id: 'seat', name: 'Middle seat', type: 'burden', cadence: 'daily', desirability: 1, maxConsecutive: 2, order: 0, restricted: false, roster: ['parent', 'a', 'b'] },
}

describe('absence management', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('lets an editor plan an absence, persists it across refresh, and ends it without rewriting today', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    const view = render(<App repository={repository} today="2026-09-07" />)
    await chooseLocalProfile(user, 'a')
    await user.click(screen.getByRole('button', { name: 'Absences' }))
    await user.click(screen.getByRole('button', { name: 'Plan absence' }))
    await user.selectOptions(screen.getByLabelText('Who is away?'), 'parent')
    fireEvent.change(screen.getByLabelText('Last day away'), { target: { value: '2026-09-10' } })
    await user.click(screen.getByRole('checkbox', { name: 'Middle seat' }))
    await user.click(screen.getByRole('button', { name: 'Save absence' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Absence saved')
    expect((await repository.loadConfiguration())?.absences).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'All activities' }))
    expect(screen.getByRole('button', { name: 'View Middle seat' })).toHaveTextContent('Alex')
    view.unmount()
    render(<App repository={repository} today="2026-09-08" />)
    await chooseLocalProfile(user, 'a')
    expect(screen.getByRole('button', { name: 'View Middle seat' })).toHaveTextContent('Sam')
    await user.click(screen.getByRole('button', { name: 'Absences' }))
    await user.click(screen.getByRole('button', { name: 'End after today' }))
    const before = await repository.readSnapshot()
    expect(before.configuration?.absences?.[0].end).toBe('2026-09-10')
    await user.click(screen.getByRole('button', { name: 'Confirm end today' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Absence updated'))
    const after = await repository.readSnapshot()
    expect(after.configuration?.absences?.[0].end).toBe('2026-09-08')
    expect(after.events).toEqual(before.events)
  })

  it('shows absences to viewers without mutation controls and requires confirmation to cancel a future range', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration({ ...configuration, absences: [{ id: 'away', personId: 'a', activityIds: ['seat'], start: '2026-09-10', end: '2026-09-11' }] })
    render(<App repository={repository} today="2026-09-07" />)
    await chooseLocalProfile(user, 'b')
    await user.click(screen.getByRole('button', { name: 'Absences' }))
    expect(screen.getByText('Alex')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan absence' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel absence' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Local profile'), 'a')
    await user.click(await screen.findByRole('button', { name: 'Absences' }))
    await user.click(screen.getByRole('button', { name: 'Cancel absence' }))
    expect((await repository.loadConfiguration())?.absences).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
    expect(await screen.findByText('No absences planned.')).toBeInTheDocument()
    expect((await repository.loadConfiguration())?.absences).toEqual([])
  })

  it('keeps the original snapshot when saving a range fails', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    render(<App repository={repository} today="2026-09-07" />)
    await chooseLocalProfile(user, 'a')
    await user.click(screen.getByRole('button', { name: 'Absences' }))
    await user.click(screen.getByRole('button', { name: 'Plan absence' }))
    await user.selectOptions(screen.getByLabelText('Who is away?'), 'parent')
    await user.click(screen.getByRole('checkbox', { name: 'Middle seat' }))
    const before = await repository.readSnapshot()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage is full') })
    await user.click(screen.getByRole('button', { name: 'Save absence' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage is full')
    expect(await repository.readSnapshot()).toEqual(before)
  })
})
