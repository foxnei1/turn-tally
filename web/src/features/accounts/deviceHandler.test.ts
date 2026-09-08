// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createDeviceHandler, digest, type DevicePorts } from '../../../../supabase/functions/viewer-devices/handler'

const id = '00000000-0000-0000-0000-000000000001'
const proof = 'a'.repeat(64)
function fixture() {
  const ports: DevicePorts = {
    allowedOrigins: ['https://family.example'],
    command: vi.fn(async (operation) => operation === 'cleanup' ? { users: [] } : { state: 'pending', id }),
    user: vi.fn(async () => id),
    provision: vi.fn(async () => ({ access_token: 'viewer-access', refresh_token: 'viewer-refresh' })),
    removeUser: vi.fn(async () => {}),
  }
  const handler = createDeviceHandler(ports)
  const call = (body: unknown, token?: string, origin = 'https://family.example') => handler(new Request('https://backend.example/functions/v1/viewer-devices', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  }))
  return { ports, call, handler }
}
describe('viewer Edge coordinator', () => {
  it('returns separate random code/proof while storing only hashes and no pre-approval account', async () => {
    const { ports, call } = fixture()
    const response = await call({ action: 'start', actor_id: 'forged', ip_hash: 'forged' })
    const result = await response.json()
    expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(result.proof).toMatch(/^[a-f0-9]{64}$/)
    expect(ports.command).toHaveBeenCalledWith('start', null, { code_hash: await digest(result.code.replace('-','')), proof_hash: await digest(result.proof), ip_hash: await digest('unknown') })
    expect(ports.provision).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(JSON.stringify(vi.mocked(ports.command).mock.calls)).not.toContain(result.proof)
  })
  it('requires verified Auth for every privileged action and ignores forged identity fields', async () => {
    const { ports, call } = fixture()
    for (const action of ['lookup','approve','deny','list','rename','revoke','activate','disconnect']) expect((await call({ action })).status).toBe(401)
    expect(ports.command).not.toHaveBeenCalled()
    await call({ action: 'approve', code:'abcd-efgh', name:'Tablet', kind:'shared', actor_id:'attacker', household_id:'other', role:'administrator', person_id:'parent' }, 'parent-token')
    expect(ports.user).toHaveBeenCalledWith('parent-token')
    expect(ports.command).toHaveBeenCalledWith('approve', id, { code_hash: await digest('ABCDEFGH'), name:'Tablet', kind:'shared', person_id:null })
  })
  it('issues only a viewer session after the lease and successful SQL confirmation', async () => {
    const { ports, call } = fixture()
    vi.mocked(ports.command).mockImplementation(async action => action === 'cleanup' ? { users: [] } : action === 'poll' ? { state:'provision', user_id:id } : { state:'issued' })
    const response = await call({ action:'poll', id, proof })
    expect(await response.json()).toEqual({ state:'issued', session:{ access_token:'viewer-access', refresh_token:'viewer-refresh' } })
    expect(ports.provision).toHaveBeenCalledExactlyOnceWith(id)
    expect(ports.command).toHaveBeenCalledWith('issued', null, { id, proof_hash:await digest(proof) })
  })
  it.each(['Auth failure','canceled while provisioning'])('cancels and cleans up on %s without returning secrets', async reason => {
    const { ports, call } = fixture()
    vi.mocked(ports.command).mockImplementation(async action => action === 'cleanup' ? { users: [] } : action === 'poll' ? { state:'provision', user_id:id } : { state:'canceled' })
    if (reason === 'Auth failure') vi.mocked(ports.provision).mockRejectedValue(new Error('secret-internal-link'))
    const response = await call({ action:'poll', id, proof })
    expect(response.status).toBe(410)
    expect(await response.text()).not.toMatch(/secret-internal-link|viewer-access|viewer-refresh/)
    expect(ports.command).toHaveBeenCalledWith('cancel', null, { id, proof_hash:await digest(proof) })
    expect(ports.removeUser).toHaveBeenCalledWith(id)
  })
  it('denies unsupported origins, oversized bodies, and malformed proofs before provisioning', async () => {
    const { ports, call } = fixture()
    expect((await call({ action:'start' }, undefined, 'https://attacker.example')).status).toBe(403)
    expect((await call({ action:'start', padding:'x'.repeat(5000) })).status).toBe(413)
    expect((await call({ action:'poll', id, proof:'guessed' })).status).toBe(400)
    expect(ports.command).not.toHaveBeenCalled()
  })
  it('passes through shared throttling and hides unexpected server errors', async () => {
    const { ports, call } = fixture()
    vi.mocked(ports.command).mockResolvedValue({ error:'Wait before trying again.', code:429 })
    expect((await call({ action:'start' })).status).toBe(429)
    vi.mocked(ports.command).mockRejectedValue({ code:'42501', message:'private SQL details' })
    const denied = await call({ action:'list' }, 'token')
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain('private SQL')
    vi.mocked(ports.command).mockRejectedValue(new Error('service-role-secret'))
    const failed = await call({ action:'start' })
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain('service-role-secret')
  })
})
