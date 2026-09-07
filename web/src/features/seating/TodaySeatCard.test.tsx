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
  absentIds: [],
  explanation: 'Elena comes first in your family’s starting order.',
}

describe('TodaySeatCard', () => {
  it('counts the assignment without requiring a daily confirmation', () => {
    const onCorrect = vi.fn()
    render(
      <TodaySeatCard
        record={pendingRecord}
        people={people}
        rotationName="Middle seat"
        dateLabel="Today"
        onCorrect={onCorrect}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('We’ll count this as Elena’s turn unless you change it.')
    expect(onCorrect).not.toHaveBeenCalled()
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
        onCorrect={onCorrect}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Change who took it' }))
    await user.click(screen.getByRole('button', { name: 'Priya' }))

    expect(onCorrect).toHaveBeenCalledWith({ outcome: 'trade', covererId: 'b', absentIds: [] })
  })

  it('keeps a failed correction open for retry', async () => {
    const user = userEvent.setup()
    const onCorrect = vi.fn().mockRejectedValueOnce(new Error('Storage full')).mockResolvedValue(undefined)
    render(<TodaySeatCard record={pendingRecord} people={people} rotationName="Middle seat" dateLabel="Today" onCorrect={onCorrect} />)
    await user.click(screen.getByRole('button', { name: 'Change who took it' }))
    await user.click(screen.getByRole('button', { name: 'No trip this day' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save')
    await user.click(screen.getByRole('button', { name: 'No trip this day' }))
    expect(await screen.findByRole('button', { name: 'Change who took it' })).toBeInTheDocument()
    expect(onCorrect).toHaveBeenCalledTimes(2)
  })

  it('keeps a no-trip report when attendance is corrected', async () => {
    const user = userEvent.setup()
    const onCorrect = vi.fn().mockResolvedValue(undefined)
    render(<TodaySeatCard record={{ ...pendingRecord, outcome: 'no-trip', servedById: null }} people={people} rotationName="Middle seat" dateLabel="Today" onCorrect={onCorrect} />)
    await user.click(screen.getByRole('button', { name: 'Change who took it' }))
    await user.click(screen.getByRole('button', { name: 'Someone is away' }))
    await user.click(screen.getByRole('checkbox', { name: 'Elena' }))
    await user.click(screen.getByRole('button', { name: 'Save who’s away' }))
    expect(onCorrect).toHaveBeenCalledWith({ outcome: 'no-trip', absentIds: ['a'] })
  })
})
