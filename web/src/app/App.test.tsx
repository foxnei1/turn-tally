import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import App from './App'

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

    expect(await screen.findByRole('heading', { name: 'Whose turn is it?' })).toBeInTheDocument()
    expect(screen.getAllByText('Elena')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: "Wasn't me" }))
    await user.click(screen.getByRole('button', { name: 'Priya' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Priya took it instead.')

    view.unmount()
    render(<App repository={repository} today="2026-08-17" />)

    expect(await screen.findByRole('status')).toHaveTextContent('Priya took it instead.')
    await waitFor(async () => expect(await repository.listEvents()).toHaveLength(2))
  })
})
