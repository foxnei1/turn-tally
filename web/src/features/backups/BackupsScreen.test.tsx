import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackupsScreen } from './BackupsScreen'

describe('backup download', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('downloads the exported JSON as a file and releases the temporary URL', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn().mockReturnValue('blob:backup')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    })
    let filename = ''
    let href = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; href = this.href })
    const onExport = vi.fn().mockResolvedValue('{"format":"turntally-backup","version":1}')
    render(<BackupsScreen hasFamily canImport onExport={onExport} onPreview={vi.fn()} onImport={vi.fn()} onBack={vi.fn()} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download backup' })) })
    expect(onExport).toHaveBeenCalledOnce()
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(createObjectURL.mock.calls[0][0].type).toBe('application/json')
    expect(filename).toMatch(/^turntally-backup-.*\.json$/)
    expect(href).toBe('blob:backup')
    expect(screen.getByRole('status')).toHaveTextContent('download started')
    vi.runOnlyPendingTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup')
  })
})
