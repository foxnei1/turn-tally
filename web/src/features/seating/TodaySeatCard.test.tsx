import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TodaySeatCard } from './TodaySeatCard'

describe('TodaySeatCard', () => {
  it('confirms the displayed assignment', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<TodaySeatCard assignee="Elena" dateLabel="Today" onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Turn confirmed.')
  })

  it('starts a correction without choosing a coverer yet', async () => {
    const user = userEvent.setup()
    const onCorrection = vi.fn()
    render(<TodaySeatCard assignee="Elena" dateLabel="Today" onCorrection={onCorrection} />)

    await user.click(screen.getByRole('button', { name: "Wasn't me" }))

    expect(onCorrection).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Correction started.')
  })
})
