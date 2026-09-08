import type { SupabaseClient } from '@supabase/supabase-js'

export interface ViewerDeviceIdentity { id: string; name: string; kind: 'personal' | 'shared' }
export interface ViewerDevice extends ViewerDeviceIdentity {
  person_id: string | null
  enrolled_at: string
  last_seen_at: string
  revoked_at: string | null
}
export class DeviceError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export async function deviceCommand<T>(client: SupabaseClient, action: string, payload: Record<string, unknown> = {}, token?: string): Promise<T> {
  const { data, error } = await client.functions.invoke('viewer-devices', {
    body: { ...payload, action }, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  })
  if (error) {
    const response = error.context instanceof Response ? error.context : null
    const body = response ? await response.json().catch(() => null) as { error?: string } | null : null
    throw new DeviceError(body?.error ?? 'Could not reach the device service. Check your connection and retry.', response?.status ?? 503)
  }
  return data as T
}
