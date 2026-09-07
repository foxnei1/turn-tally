import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import type { HouseholdConfiguration } from '../domain/rotation/types'
import { chooseLocalProfile } from '../test/profiles'
import App from './App'

const legacy: HouseholdConfiguration = {
  people: [{ id: 'adult', name: 'Alex' }, { id: 'child', name: 'Sam' }],
  startDate: '2026-09-07',
  rotation: { id: 'middle-seat', name: 'Middle seat', type: 'burden', cadence: 'daily', roster: ['adult', 'child'], desirability: 1, maxConsecutive: 2, order: 0, restricted: false },
}

describe('family management interface', () => {
  beforeEach(() => localStorage.clear())

  it('upgrades without assuming an administrator, adds an editor, and shows a read-only child view', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(legacy)
    render(<App repository={repository} today="2026-09-07" />)
    expect(await screen.findByRole('heading', { name: 'Choose your family administrator' })).toBeInTheDocument()
    expect(screen.getByLabelText('Administrator')).toHaveValue('')
    await user.selectOptions(screen.getByLabelText('Administrator'), 'new-parent')
    await user.type(screen.getByLabelText('Parent name'), 'Morgan')
    await user.click(screen.getByRole('button', { name: 'Set administrator' }))
    expect(await screen.findByRole('button', { name: 'View Middle seat' })).toHaveTextContent('Alex')
    const configured = (await repository.loadConfiguration())!
    const parentId = configured.people.find((person) => person.name === 'Morgan')!.id
    expect(configured.rotation.roster).toEqual(['adult', 'child'])
    await user.click(screen.getByRole('button', { name: 'Family' }))
    await user.click(screen.getByRole('button', { name: 'Add member' }))
    expect(screen.getByLabelText('Role')).toHaveValue('viewer')
    await user.type(screen.getByLabelText('Member name'), 'Casey')
    await user.selectOptions(screen.getByLabelText('Role'), 'editor')
    await user.click(screen.getByRole('button', { name: 'Save member' }))
    await screen.findByRole('button', { name: 'Edit Casey' })
    const editorId = (await repository.loadConfiguration())!.people.find((person) => person.name === 'Casey')!.id
    await user.selectOptions(screen.getByLabelText('Local profile'), editorId)
    expect(await screen.findByRole('button', { name: 'Add activity' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up a different family' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Family' }))
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Morgan' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Local profile'), 'child')
    await user.click(await screen.findByRole('button', { name: 'View Middle seat' }))
    expect(screen.queryByRole('button', { name: 'Edit activity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change who took it' })).not.toBeInTheDocument()
    expect(screen.getByText('Why Alex?', { selector: 'summary' })).toBeInTheDocument()
    await user.click(screen.getByText('History', { selector: 'summary' }))
    expect(screen.queryByRole('button', { name: /Change turn for/ })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Local profile'), parentId)
    await user.click(screen.getByRole('button', { name: 'Family' }))
    await user.click(screen.getByRole('button', { name: 'Edit Morgan' }))
    await user.selectOptions(screen.getByLabelText('Role'), 'editor')
    await user.click(screen.getByRole('button', { name: 'Save member' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep at least one active administrator')
  })

  it('persists rename and deactivation, preserves today, and handles a rotation needing participants', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration({ ...legacy, rolesInitialized: true, people: [
      { id: 'parent', name: 'Morgan', role: 'administrator' },
      { id: 'adult', name: 'Alex', role: 'editor' },
      { id: 'child', name: 'Sam', role: 'viewer' },
    ] })
    let view = render(<App repository={repository} today="2026-09-07" />)
    await chooseLocalProfile(user, 'parent')
    await user.click(screen.getByRole('button', { name: 'Family' }))
    await user.click(screen.getByRole('button', { name: 'Edit Alex' }))
    await user.clear(screen.getByLabelText('Member name'))
    await user.type(screen.getByLabelText('Member name'), 'Alexandra')
    await user.click(screen.getByRole('checkbox', { name: 'Active member' }))
    expect(screen.getByText('Middle seat: Sep 8, 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save member' }))
    expect(await screen.findByText('Alexandra · inactive')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Alexandra/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activities' }))
    expect(screen.getByRole('button', { name: 'View Middle seat' })).toHaveTextContent('Alexandra')
    view.unmount()
    view = render(<App repository={repository} today="2026-09-08" />)
    await chooseLocalProfile(user, 'parent')
    expect(screen.getByRole('button', { name: 'View Middle seat' })).toHaveTextContent('Needs participants')
    await user.click(screen.getByRole('button', { name: 'View Middle seat' }))
    expect(screen.getByRole('region', { name: 'Today’s middle seat' })).toHaveTextContent('Needs participants')
    await user.click(screen.getByText('History', { selector: 'summary' }))
    expect(screen.getByText('Alexandra')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit activity' }))
    expect(screen.queryByRole('checkbox', { name: 'Alexandra' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Morgan' }))
    await user.click(screen.getByRole('button', { name: 'Save activity' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Today’s middle seat' })).toHaveTextContent('Needs participants'))
    view.unmount()
    render(<App repository={repository} today="2026-09-09" />)
    await chooseLocalProfile(user, 'parent')
    expect(screen.getByRole('button', { name: 'View Middle seat' })).not.toHaveTextContent('Needs participants')
  })
})
