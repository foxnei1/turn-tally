import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RotationRecord } from '../../domain/rotation/engine'
import { TodaySeatCard } from './TodaySeatCard'

const people = [
  { id: 'a', name: 'Elena' },
  { id: 'b', name: 'Priya' },
]

const pendingRecord: RotationRecord = {
  slotId: 'middle-seat:2026-08-17',
  date: '2026-08-17',
  assigneeId: 'a',
  servedById: 'a',
  outcome: 'assumed',
  assignmentSource: 'recorded',
  deltas: { a: -0.5, b: 0.5 },
  balances: { a: -0.5, b: 0.5 },
}

describe('TodaySeatCard', () => {
  it('confirms the displayed assignment', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <TodaySeatCard
        record={pendingRecord}
        people={people}
        rotationName="Middle seat"
        dateLabel="Today"
        onConfirm={onConfirm}
        onCorrect={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('records who covered after starting a correction', async () => {
    const user = userEvent.setup()
    const onCorrect = vi.fn().mockResolvedValue(undefined)
    render(
      <TodaySeatCard
        record={pendingRecord}
        people={people}
        rotationName="Middle seat"
        dateLabel="Today"
        onConfirm={vi.fn()}
        onCorrect={onCorrect}
      />,
    )

    await user.click(screen.getByRole('button', { name: "Wasn't me" }))
    await user.click(screen.getByRole('button', { name: 'Priya' }))

    expect(onCorrect).toHaveBeenCalledWith('b')
  })
})
