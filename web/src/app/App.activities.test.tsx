import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import type { HouseholdConfiguration } from '../domain/rotation/types'
import App from './App'
import { chooseLocalProfile } from '../test/profiles'

const configuration: HouseholdConfiguration = {
  rolesInitialized: true,
  people: [{ id: 'a', name: 'Elena', role: 'administrator' }, { id: 'b', name: 'Priya' }, { id: 'c', name: 'Sam' }],
  startDate: '2026-09-06',
  rotation: { id: 'middle-seat', name: 'Middle seat', type: 'burden', cadence: 'daily', roster: ['a', 'b', 'c'], desirability: 1, maxConsecutive: 2, order: 0, restricted: false },
}

describe('activity configuration', () => {
  beforeEach(() => localStorage.clear())

  it('creates, corrects, edits, and restores an independent weekly chore', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    let view = render(<App repository={repository} today="2026-09-06" />)
    await chooseLocalProfile(user, 'a')
    expect(await screen.findByRole('button', { name: 'View Middle seat' })).toHaveTextContent('Elena')
    await user.click(screen.getByRole('button', { name: 'Add activity' }))
    await user.click(screen.getByRole('button', { name: 'Bathroom cleaning' }))
    expect(screen.getByLabelText('Switch turns')).toHaveValue('weekly')
    await user.click(screen.getByRole('checkbox', { name: 'Sam' }))
    await user.selectOptions(screen.getByLabelText('First turn'), 'b')
    await user.click(screen.getByRole('button', { name: 'Save activity' }))
    expect(await screen.findByRole('heading', { name: 'Bathroom cleaning' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Priya’s turn')
    expect(screen.getByText('Sep 6 – Sep 12, 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change who did it' }))
    expect(screen.queryByRole('button', { name: 'No trip this day' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sam' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Elena' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Elena handled the chore instead of Priya.'))
    await user.click(screen.getByRole('button', { name: 'All activities' }))
    expect(screen.getByRole('button', { name: 'View Middle seat' })).toHaveTextContent('Elena')
    expect(screen.getByRole('button', { name: 'View Bathroom cleaning' })).toHaveTextContent('Elena')
    await user.click(screen.getByRole('button', { name: 'View Bathroom cleaning' }))
    await user.click(screen.getByRole('button', { name: 'Edit activity' }))
    await user.selectOptions(screen.getByLabelText('Switch turns'), 'daily')
    await user.click(screen.getByRole('checkbox', { name: 'Priya' }))
    await user.click(screen.getByRole('checkbox', { name: 'Sam' }))
    expect(screen.getByText(/Schedule and people changes start September 13/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save activity' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Elena handled the chore')
    expect(screen.getByText(/Updated schedule and people take effect September 13/)).toBeInTheDocument()

    view.unmount()
    view = render(<App repository={repository} today="2026-09-06" />)
    await chooseLocalProfile(user, 'a')
    expect(await screen.findByRole('button', { name: 'View Bathroom cleaning' })).toHaveTextContent('Elena')
    view.unmount()
    render(<App repository={repository} today="2026-09-13" />)
    await chooseLocalProfile(user, 'a')
    await user.click(await screen.findByRole('button', { name: 'View Bathroom cleaning' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sam’s turn')
    await user.click(screen.getByRole('button', { name: 'Change who did it' }))
    expect(screen.queryByRole('button', { name: 'Priya' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByText('History', { selector: 'summary' }))
    await user.click(screen.getByRole('button', { name: 'Change turn for September 6' }))
    const editor = screen.getByRole('button', { name: 'Change turn for September 6' }).closest('article')!
    expect(within(editor).getByRole('button', { name: 'Priya' })).toBeInTheDocument()
    expect(within(editor).queryByRole('button', { name: 'Sam' })).not.toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: 'Priya' }))
    await waitFor(() => expect(within(editor).getByText('Recorded')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Sam’s turn')
  })

  it('validates participants and duplicate names without losing the form', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    render(<App repository={repository} today="2026-09-06" />)
    await chooseLocalProfile(user, 'a')
    await user.click(await screen.findByRole('button', { name: 'Add activity' }))
    await user.click(screen.getByRole('button', { name: 'Kitchen duty' }))
    expect(screen.getByLabelText('Switch turns')).toHaveValue('daily')
    for (const name of ['Elena', 'Priya', 'Sam']) await user.click(screen.getByRole('checkbox', { name }))
    await user.click(screen.getByRole('button', { name: 'Save activity' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one family member')
    await user.click(screen.getByRole('checkbox', { name: 'Elena' }))
    await user.clear(screen.getByLabelText('Activity name'))
    await user.type(screen.getByLabelText('Activity name'), 'Middle seat')
    await user.click(screen.getByRole('button', { name: 'Save activity' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect((await repository.loadConfiguration())?.activities).toBeUndefined()
  })
})
