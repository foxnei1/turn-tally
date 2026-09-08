import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import type { DevicePorts } from './handler.ts'

export function supabaseDevicePorts(url: string, key: string, allowedOrigins: string[], trustedIpHeader?: string): DevicePorts {
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  const admin = createClient(url, key, options)

  return {
    allowedOrigins,
    trustedIpHeader,
    async command(operation, actor_id, payload) {
      const { data, error } = await admin.rpc('turntally_device_command', { operation, actor_id, payload })
      if (error) throw error
      return data
    },
    async user(token) {
      const { data, error } = await admin.auth.getUser(token)
      return error ? null : data.user?.id ?? null
    },
    async provision(id) {
      const email = `${id}@viewer.turntally.invalid`
      const created = await admin.auth.admin.createUser({ id, email, email_confirm: true, app_metadata: { turntally_viewer: true } })
      if (created.error || created.data.user?.id !== id) throw new Error('Identity creation failed')
      const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
      if (link.error || !link.data.properties?.hashed_token) throw new Error('Token creation failed')
      // Never put a viewer session on the shared service client.
      const auth = createClient(url, key, options)
      const verified = await auth.auth.verifyOtp({ type: 'email', token_hash: link.data.properties.hashed_token })
      if (verified.error || verified.data.user?.id !== id || !verified.data.session) throw new Error('Token verification failed')
      return { access_token: verified.data.session.access_token, refresh_token: verified.data.session.refresh_token }
    },
    async removeUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error && error.status !== 404) throw error
    },
  }
}
