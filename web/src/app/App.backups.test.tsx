import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageRotationRepository } from '../data/localStorageRepository'
import { createBackup } from '../domain/backups/backup'
import type { HouseholdConfiguration } from '../domain/rotation/types'
import { chooseLocalProfile } from '../test/profiles'
import App from './App'

const configuration: HouseholdConfiguration = {
  rolesInitialized: true,
  people: [{ id: 'parent', name: 'Parent', role: 'administrator' }, { id: 'a', name: 'Alex', role: 'editor' }, { id: 'b', name: 'Sam', role: 'viewer' }],
  startDate: '2026-09-07', rotation: { id: 'seat', name: 'Middle seat', type: 'burden', cadence: 'daily', desirability: 1, maxConsecutive: 2, order: 0, restricted: false, roster: ['a', 'b'] },
}
const incoming = { ...configuration, people: configuration.people.map((person) => person.id === 'parent' ? { ...person, name: 'Backup Parent' } : person) }
const file = () => new File([createBackup({ configuration: incoming, events: [] }, '2026-09-07')], 'family.json', { type: 'application/json' })

describe('archive and backup flows', () => {
  beforeEach(() => localStorage.clear())

  it('archives, persists the archive, and restores through the activity list', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    const view = render(<App repository={repository} today="2026-09-07" />)
    await chooseLocalProfile(user, 'a')
    await user.click(screen.getByRole('button', { name: 'View Middle seat' }))
    await user.click(screen.getByText('Archive this activity', { selector: 'summary' }))
    await user.click(screen.getByRole('button', { name: 'Archive activity' }))
    expect(await screen.findByRole('button', { name: 'Restore activity' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All activities' }))
    expect(screen.queryByRole('button', { name: 'View Middle seat' })).not.toBeInTheDocument()
    await user.click(screen.getByText('Archived activities (1)', { selector: 'summary' }))
    await user.click(screen.getByRole('button', { name: 'View archived Middle seat' }))
    await user.click(screen.getByText('History', { selector: 'summary' }))
    expect(screen.getByText('Alex')).toBeInTheDocument()
    view.unmount()
    render(<App repository={repository} today="2026-09-20" />)
    await chooseLocalProfile(user, 'a')
    await user.click(screen.getByText('Archived activities (1)', { selector: 'summary' }))
    await user.click(screen.getByRole('button', { name: 'View archived Middle seat' }))
    await user.click(screen.getByRole('button', { name: 'Restore activity' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sam’s turn'))
    await user.click(screen.getByRole('button', { name: 'All activities' }))
    expect(screen.getByRole('button', { name: 'View Middle seat' })).toHaveTextContent('Sam')
  })

  it('previews without writing and replaces only after explicit confirmation', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    const view = render(<App repository={repository} today="2026-09-07" />)
    await chooseLocalProfile(user, 'parent')
    await user.click(screen.getByRole('button', { name: 'Backups' }))
    const before = await repository.readSnapshot()
    await user.upload(screen.getByLabelText('Backup file'), file())
    await screen.findByRole('heading', { name: 'Review before restoring' })
    expect(screen.getByRole('button', { name: 'Replace family with backup' })).toBeDisabled()
    expect(await repository.readSnapshot()).toEqual(before)
    await user.click(screen.getByRole('checkbox', { name: 'Replace the current family and all its history with this backup.' }))
    await user.click(screen.getByRole('button', { name: 'Replace family with backup' }))
    expect(await screen.findByRole('heading', { name: 'Choose a local profile' })).toBeInTheDocument()
    await chooseLocalProfile(user, 'parent')
    expect(screen.getByRole('option', { name: /Backup Parent/ })).toBeInTheDocument()
    expect((await repository.loadConfiguration())?.people[0].name).toBe('Backup Parent')
    view.unmount()
    render(<App repository={repository} today="2026-09-07" />)
    await chooseLocalProfile(user, 'parent')
    expect(screen.getByRole('option', { name: /Backup Parent/ })).toBeInTheDocument()
  })

  it('rejects bad files without changing data and allows recovery on an empty browser', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    render(<App repository={repository} today="2026-09-07" />)
    await user.click(await screen.findByRole('button', { name: 'Restore a backup' }))
    await user.upload(screen.getByLabelText('Backup file'), new File(['{'], 'bad.json', { type: 'application/json' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON')
    expect(await repository.loadConfiguration()).toBeNull()
    await user.upload(screen.getByLabelText('Backup file'), file())
    await screen.findByRole('heading', { name: 'Review before restoring' })
    await user.click(screen.getByRole('checkbox', { name: 'Restore this family and its history on this browser.' }))
    await user.click(screen.getByRole('button', { name: 'Restore backup' }))
    await chooseLocalProfile(user, 'parent')
    expect(screen.getByRole('button', { name: 'View Middle seat' })).toBeInTheDocument()
  })

  it('gives editors export only and hides backup actions from viewers', async () => {
    const user = userEvent.setup()
    const repository = new LocalStorageRotationRepository(localStorage)
    await repository.saveConfiguration(configuration)
    render(<App repository={repository} today="2026-09-07" />)
    await chooseLocalProfile(user, 'a')
    await user.click(screen.getByRole('button', { name: 'Backups' }))
    expect(screen.getByRole('button', { name: 'Download backup' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Backup file')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Local profile'), 'b')
    await screen.findByRole('button', { name: 'View Middle seat' })
    expect(screen.queryByRole('button', { name: 'Backups' })).not.toBeInTheDocument()
  })
})
