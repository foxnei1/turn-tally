import type { SupabaseClient } from '@supabase/supabase-js'
import type { Person } from '../../domain/rotation/types'

export interface AdultAccount { user_id: string; person_id: string; person_name?: string; email: string; role: string; revoked_at: string | null; protected: boolean }
export interface AdultAccounts { accounts: AdultAccount[]; people: Person[] }
export interface AdultRequest { id: string; code: string; expires_at: string; state: string }
export class AdultAccessError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export async function adultCommand<T>(client: SupabaseClient, operation: string, payload: Record<string, unknown> = {}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { data, error } = await Promise.race([
      client.rpc('turntally_adult_command', { operation, payload }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new AdultAccessError('Access request timed out. Check your connection and retry.', 503)), 15000) }),
    ])
    if (error) throw new AdultAccessError(error.code === '42501' ? 'Your current sign-in cannot perform this action. Sign in again or ask a parent.' : 'Could not reach account access. Check your connection and retry.', error.code === '42501' ? 403 : 503)
    if (data?.error) throw new AdultAccessError(data.error, data.code ?? 400)
    if (!data) throw new AdultAccessError('Account access returned no response. Try again.', 503)
    return data as T
  } finally { clearTimeout(timer) }
}
