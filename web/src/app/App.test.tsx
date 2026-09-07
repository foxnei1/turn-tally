import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import App from './App'
import { chooseAdministrator, chooseLocalProfile } from '../test/profiles'

describe('TurnTally prototype', () => {
  beforeEach(() => localStorage.clear())

  it('sets up a family, records a correction, and restores it from browser storage', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage, 'test.events', 'test.config')
    const view = render(<App repository={repository} today="2026-08-17" />)

    expect(await screen.findByRole('heading', { name: 'Who shares the middle seat?' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Person 1'), 'Elena')
    await user.type(screen.getByLabelText('Person 2'), 'Priya')
    await user.click(screen.getByRole('button', { name: 'Start the rotation' }))
    await chooseAdministrator(user, 'member-1')
    await user.click(await screen.findByRole('button', { name: 'View Middle seat' }))

    expect(await screen.findByRole('heading', { name: 'Today’s middle seat' })).toBeInTheDocument()
    expect(screen.getAllByText('Elena')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Change who took it' }))
    await user.click(screen.getByRole('button', { name: 'Priya' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Priya took the seat instead of Elena.')

    view.unmount()
    render(<App repository={repository} today="2026-08-17" />)
    await chooseLocalProfile(user, 'member-1')

    await user.click(await screen.findByRole('button', { name: 'View Middle seat' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Priya took the seat instead of Elena.')
    await waitFor(async () => expect(await repository.listEvents()).toHaveLength(2))
  })

  it('records absence, restores it, and allows history corrections without changing a displayed turn', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    let view = render(<App repository={repository} today="2026-08-17" />)
    await screen.findByLabelText('Person 1')
    await user.type(screen.getByLabelText('Person 1'), 'Elena')
    await user.type(screen.getByLabelText('Person 2'), 'Priya')
    await user.type(screen.getByLabelText('Person 3'), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Start the rotation' }))
    await chooseAdministrator(user, 'member-1')
    await user.click(await screen.findByRole('button', { name: 'View Middle seat' }))
    await user.click(await screen.findByRole('button', { name: 'Change who took it' }))
    await user.click(screen.getByRole('button', { name: 'Someone is away' }))
    await user.click(screen.getByRole('checkbox', { name: 'Elena' }))
    await user.click(screen.getByRole('button', { name: 'Save who’s away' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Priya’s turn'))

    view.unmount()
    view = render(<App repository={repository} today="2026-08-17" />)
    await chooseLocalProfile(user, 'member-1')
    await user.click(await screen.findByRole('button', { name: 'View Middle seat' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Priya’s turn')
    await user.click(screen.getByRole('button', { name: 'Change who took it' }))
    expect(screen.queryByRole('button', { name: 'Elena' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sam' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sam took the seat'))
    await user.click(screen.getByRole('button', { name: 'Change who took it' }))
    await user.click(screen.getByRole('button', { name: 'No trip this day' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nobody gets credit'))
    expect(screen.getByRole('region', { name: 'Today’s middle seat' })).toHaveTextContent('No trip this day')

    view.unmount()
    view = render(<App repository={repository} today="2026-08-18" />)
    await chooseLocalProfile(user, 'member-1')
    await user.click(await screen.findByRole('button', { name: 'View Middle seat' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Elena’s turn')
    await user.click(screen.getByText('History', { selector: 'summary' }))
    await user.click(screen.getByRole('button', { name: 'Change turn for August 17' }))
    const editor = screen.getByRole('button', { name: 'Change who’s away' }).closest('fieldset')!
    await user.click(within(editor).getByRole('button', { name: 'An adult took the seat' }))
    await waitFor(() => expect(screen.getByText('Adult took the seat · turn skipped')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Elena’s turn')
    view.unmount()
    render(<App repository={repository} today="2026-08-18" />)
    await chooseLocalProfile(user, 'member-1')
    await user.click(await screen.findByRole('button', { name: 'View Middle seat' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Elena’s turn')
    const outcomes = (await repository.listEvents()).filter((event) => event.type === 'outcome-recorded')
    expect(outcomes.at(-1)).toMatchObject({ outcome: 'adult-cover', absentIds: ['member-1'] })
  })
})
