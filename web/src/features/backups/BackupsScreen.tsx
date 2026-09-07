import { useRef, useState } from 'react'
import { backupCounts, MAX_BACKUP_BYTES, type BackupPreview } from '../../domain/backups/backup'
import { householdActivities, isArchived } from '../../domain/rotation/activities'
import { roleLabels } from '../../domain/family/members'

export interface BackupsScreenProps {
  canImport: boolean
  hasFamily: boolean
  onExport: () => Promise<string>
  onPreview: (text: string) => Promise<BackupPreview>
  onImport: (text: string, expectedState: string) => Promise<void>
  onBack: () => void
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Couldn’t read that file. Try choosing it again.'))
    reader.readAsText(file)
  })
}

export function BackupsScreen({ canImport, hasFamily, onExport, onPreview, onImport, onBack }: BackupsScreenProps) {
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [source, setSource] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const sequence = useRef(0)

  async function download() {
    setBusy(true); setError(null); setMessage(null)
    try {
      const text = await onExport()
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'turntally-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
      document.body.appendChild(link)
      link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Backup download started. Keep the file somewhere you can find it again.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Couldn’t download the backup.') }
    finally { setBusy(false) }
  }

  async function choose(file?: File) {
    const request = ++sequence.current
    setPreview(null); setSource(''); setConfirmed(false); setError(null); setMessage(null)
    if (!file) return
    setBusy(true)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Choose a backup smaller than 10 MB.')
      const text = await readFile(file)
      const next = await onPreview(text)
      if (request === sequence.current) { setSource(text); setPreview(next) }
    } catch (error) { if (request === sequence.current) setError(error instanceof Error ? error.message : 'Couldn’t preview this backup.') }
    finally { if (request === sequence.current) setBusy(false) }
  }

  async function restore() {
    if (!preview || !confirmed) return
    setBusy(true); setError(null)
    try { await onImport(source, preview.expectedState) }
    catch (error) { setError(error instanceof Error ? error.message : 'Couldn’t restore this backup. Your previous data is still saved.'); setConfirmed(false) }
    finally { setBusy(false) }
  }

  const incoming = preview ? backupCounts(preview.backup.configuration, preview.backup.events) : null
  return <section aria-labelledby="backups-title">
    <button type="button" disabled={busy} onClick={onBack} className="mb-5 font-semibold text-emerald-800">Back</button>
    <h1 id="backups-title" className="text-3xl font-semibold text-stone-900">Backups</h1>
    <p className="mt-3 text-sm leading-6 text-stone-600">A backup includes family members, roles, activities, absences, archived history, and corrections. It is a plain JSON file containing your family’s data.</p>
    {hasFamily ? <button type="button" disabled={busy} onClick={() => void download()} className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">Download backup</button> : null}
    {canImport ? <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-xl font-semibold text-stone-900">Restore a backup</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">{hasFamily ? 'Restoring replaces this browser’s family, activities, roles, and history. Download your current backup first if you want to keep it.' : 'Restore your family on this browser, then choose a local profile.'}</p>
      <label className="mt-4 block text-sm font-medium text-stone-800">Backup file<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file) }} className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-emerald-900" /></label>
      {preview && incoming ? <div className="mt-5">
        <h3 className="font-semibold text-stone-900">Review before restoring</h3>
        <p className="mt-2 text-sm text-stone-600">Saved {new Date(preview.backup.exportedAt).toLocaleString()}</p>
        <table className="mt-3 w-full text-left text-sm text-stone-700"><thead><tr><th className="py-2">Data</th><th>Current</th><th>Backup</th></tr></thead><tbody>{(['people', 'activities', 'events', 'absences'] as const).map((key) => <tr key={key}><th className="py-2 font-normal">{{ people: 'Family members', activities: 'Activities', events: 'History records', absences: 'Absence ranges' }[key]}</th><td>{preview.current[key]}</td><td>{incoming[key]}</td></tr>)}</tbody></table>
        <p className="mt-2 text-sm text-stone-600">Includes {incoming.archived} archived {incoming.archived === 1 ? 'activity' : 'activities'}.</p>
        <details className="mt-3 text-sm text-stone-600"><summary className="cursor-pointer font-semibold">Members and activities in this backup</summary><ul className="mt-2 list-disc pl-5">{preview.backup.configuration.people.map((person) => <li key={person.id}>{person.name} · {roleLabels[person.role ?? 'viewer']}{person.active === false ? ' · inactive' : ''}</li>)}</ul><ul className="mt-3 list-disc pl-5">{householdActivities(preview.backup.configuration).map((activity) => <li key={activity.id}>{activity.name}{isArchived(activity) ? ' · archived' : ''}</li>)}</ul></details>
        <p className="mt-4 text-sm leading-6 text-stone-600">Unreported turns since the backup count as planned. Archived periods stay skipped. You’ll choose a profile again after restoring.</p>
        <label className="mt-4 flex items-start gap-3 text-sm text-stone-800"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-800" />{hasFamily ? 'Replace the current family and all its history with this backup.' : 'Restore this family and its history on this browser.'}</label>
        <button type="button" disabled={busy || !confirmed} onClick={() => void restore()} className="mt-4 w-full rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Restoring…' : hasFamily ? 'Replace family with backup' : 'Restore backup'}</button>
      </div> : null}
    </div> : <p className="mt-5 text-sm text-stone-600">Only an administrator can restore a backup.</p>}
    {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="mt-4 text-sm text-emerald-800">{message}</p> : null}
  </section>
}
