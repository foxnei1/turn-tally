// Runtime-independent coordinator: tested with injected database/Auth ports.
// Never log request bodies, internal links, proofs, or Auth responses here.
export type Json = Record<string, unknown>
export interface DevicePorts {
  command(operation: string, actor: string | null, payload: Json): Promise<Json>
  user(token: string): Promise<string | null>
  provision(id: string): Promise<{ access_token: string; refresh_token: string }>
  removeUser(id: string): Promise<void>
  allowedOrigins: string[]
  // Leave unset unless the gateway is verified to overwrite this header.
  trustedIpHeader?: string
}

const publicActions = new Set(['start', 'poll', 'cancel'])
const actions = new Set([...publicActions, 'lookup', 'approve', 'deny', 'list', 'rename', 'revoke', 'activate', 'disconnect'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 symbols, unbiased bytes.
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
function random(length: number, symbols: string) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), byte => symbols[byte % symbols.length]).join('')
}

export function createDeviceHandler(ports: DevicePorts) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin')
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' }
    if (origin && ports.allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info'
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    }
    const reply = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !ports.allowedOrigins.includes(origin)) return reply({ error: 'Origin not allowed.' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
    let cleanup: Promise<void> | undefined
    try {
      // Bound the body while reading, including requests without Content-Length.
      const reader = request.body?.getReader()
      if (!reader) return reply({ error: 'Missing request.' }, 400)
      let text = ''; let size = 0
      const decoder = new TextDecoder()
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 4096) { await reader.cancel(); return reply({ error: 'Request too large.' }, 413) }
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
      let body: Json
      try { body = JSON.parse(text) as Json } catch { return reply({ error: 'Invalid request.' }, 400) }
      if (!body || Array.isArray(body) || typeof body !== 'object' || typeof body.action !== 'string' || !actions.has(body.action)) return reply({ error: 'Unknown action.' }, 400)
      const action = body.action
      let actor: string | null = null
      if (!publicActions.has(action)) {
        const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
        actor = token ? await ports.user(token) : null
        if (!actor) return reply({ error: 'Sign in again to continue.' }, 401)
      }
      const payload: Json = {}
      if (['lookup','approve','deny'].includes(action)) {
        const code = typeof body.code === 'string' ? body.code.toUpperCase().replace(/[\s-]/g, '') : ''
        // Invalid-looking guesses still reach the shared account quota.
        payload.code_hash = await digest(code)
      }
      if (['approve','rename'].includes(action)) {
        if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 80) return reply({ error: 'Enter a device name up to 80 characters.' }, 400)
        payload.name = body.name.trim()
      }
      if (action === 'approve') {
        if (!['personal','shared'].includes(String(body.kind)) || (body.kind === 'personal' && (typeof body.person_id !== 'string' || body.person_id.length > 200))) return reply({ error: 'Choose the device purpose and person.' }, 400)
        payload.kind = body.kind
        payload.person_id = body.kind === 'personal' ? body.person_id : null
      }
      if (['rename','revoke','poll','cancel','activate'].includes(action)) {
        if (typeof body.id !== 'string' || !uuid.test(body.id)) return reply({ error: 'Invalid device request.' }, 400)
        payload.id = body.id
      }
      if (['poll','cancel','activate'].includes(action)) {
        if (typeof body.proof !== 'string' || !/^[a-f0-9]{64}$/.test(body.proof)) return reply({ error: 'Pairing proof is missing. Get a new code.' }, 400)
        payload.proof_hash = await digest(body.proof)
      }
      cleanup = (async () => {
        try {
          const old = await ports.command('cleanup', null, {})
          for (const id of (old.users as string[] | undefined) ?? []) {
            try {
              await ports.removeUser(id)
              await ports.command('cleanup_done', null, { user_id: id })
            } catch { /* Retained tombstones retry later. */ }
          }
        } catch { /* Cleanup failure cannot grant access. */ }
      })()
      if (action === 'start') {
        const code = random(8, alphabet)
        const proof = random(64, '0123456789abcdef')
        const ip = ports.trustedIpHeader ? request.headers.get(ports.trustedIpHeader) ?? 'unknown' : 'unknown'
        const result = await ports.command('start', null, { code_hash: await digest(code), proof_hash: await digest(proof), ip_hash: await digest(ip) })
        if (result.error) return reply(result, Number(result.code) || 400)
        return reply({ ...result, code: code.slice(0,4) + '-' + code.slice(4), proof })
      }
      const result = await ports.command(action, actor, payload)
      if (result.error) return reply(result, Number(result.code) || 400)
      if (action !== 'poll' || result.state !== 'provision') return reply(result)
      const userId = String(result.user_id)
      try {
        const session = await ports.provision(userId)
        const issued = await ports.command('issued', null, payload)
        if (issued.state !== 'issued') throw new Error('Pairing ended')
        return reply({ state: 'issued', session })
      } catch {
        // Deny in SQL first. Auth deletion is cleanup, never the access boundary.
        try { await ports.command('cancel', null, payload) } catch { /* Lease denies abandoned grants. */ }
        try { await ports.removeUser(userId) } catch { /* Cleanup retries by the reserved UUID. */ }
        return reply({ error: 'Pairing could not finish. Get a new code.', code: 410 }, 410)
      }
    } catch (error) {
      // Database messages are intentionally sanitized; never echo Auth errors.
      const forbidden = typeof error === 'object' && error !== null && 'code' in error && error.code === '42501'
      return reply({ error: forbidden ? 'Your current account cannot authorize this device.' : 'Device service unavailable. Try again.' }, forbidden ? 403 : 503)
    } finally { await cleanup }
  }
}
