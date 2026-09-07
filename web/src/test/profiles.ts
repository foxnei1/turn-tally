import { screen } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

export async function chooseLocalProfile(user: ReturnType<typeof userEvent.setup>, id: string) {
  await screen.findByRole('button', { name: 'Use profile' })
  await user.selectOptions(screen.getByLabelText('Local profile'), id)
  await user.click(screen.getByRole('button', { name: 'Use profile' }))
}

export async function chooseAdministrator(user: ReturnType<typeof userEvent.setup>, id: string) {
  await screen.findByRole('button', { name: 'Set administrator' })
  await user.selectOptions(screen.getByLabelText('Administrator'), id)
  await user.click(screen.getByRole('button', { name: 'Set administrator' }))
}
