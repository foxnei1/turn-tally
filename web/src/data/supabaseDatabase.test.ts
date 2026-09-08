// @vitest-environment node
/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { hostedFixture } from '../test/hostedFixture'
import { randomBytes } from 'node:crypto'

const ids = {
  owner: '00000000-0000-0000-0000-000000000001',
  editor: '00000000-0000-0000-0000-000000000002',
  viewer: '00000000-0000-0000-0000-000000000003',
  outsider: '00000000-0000-0000-0000-000000000004',
  family: '00000000-0000-0000-0000-000000000010',
  otherFamily: '00000000-0000-0000-0000-000000000011',
}
let db: PGlite
async function signIn(user = ids.owner, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.exec(`set role ${role}`)
}
async function save(snapshot = hostedFixture(), revision = 0, operation = 'edit', administratorId: string | null = null) {
  return db.query('select public.turntally_save($1, $2::jsonb, $3, $4) result', [revision, JSON.stringify(snapshot), operation, administratorId])
}
type CommandResult = { state?: string; id: string; user_id: string; error?: string; code?: number; devices: { id: string; revoked_at: string | null }[]; users: string[] }
async function command(operation: string, payload: Record<string, unknown> = {}, actor: string | null = ids.owner) {
  await signIn('', 'service_role')
  const result = await db.query<{ result: CommandResult }>('select public.turntally_device_command($1,$2,$3::jsonb) result', [operation, actor, JSON.stringify(payload)])
  return result.rows[0].result
}
async function pairing(kind: 'shared' | 'personal' = 'shared', personId = 'child') {
  const proof_hash = randomBytes(32).toString('hex'); const code_hash = randomBytes(32).toString('hex')
  const request = await command('start', { code_hash, proof_hash, ip_hash: 'test' }, null)
  await command('approve', { code_hash, name: 'Test tablet', kind, person_id: personId })
  return { id: request.id, proof_hash, code_hash }
}
async function enroll(kind: 'shared' | 'personal' = 'shared', personId = 'child') {
  const request = await pairing(kind, personId)
  const lease = await command('poll', request, null)
  await db.exec('reset role')
  await db.query('insert into auth.users(id) values($1)', [lease.user_id])
  expect((await command('issued', request, null)).state).toBe('issued')
  expect((await command('activate', request, lease.user_id)).state).toBe('claimed')
  return { request, userId: lease.user_id }
}

describe('Supabase database authorization and concurrency', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
    `)
    const migrations = new URL('../../../supabase/migrations/', import.meta.url)
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(name, migrations), 'utf8'))
    for (const id of [ids.owner, ids.editor, ids.viewer, ids.outsider]) await db.query('insert into auth.users values ($1)', [id])
  }, 30000)
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('reset role; delete from turntally_private.viewer_devices; delete from turntally_private.pairing_requests; delete from turntally_private.pairing_limits; delete from public.turntally_memberships; delete from public.turntally_households;')
    await db.query('insert into public.turntally_households (id, owner_user_id, snapshot) values ($1, $2, $3::jsonb), ($4, $5, $3::jsonb)', [ids.family, ids.owner, JSON.stringify(hostedFixture()), ids.otherFamily, ids.outsider])
    for (const [user, person, family] of [[ids.owner, 'parent', ids.family], [ids.editor, 'adult', ids.family], [ids.viewer, 'child', ids.family], [ids.outsider, 'parent', ids.otherFamily]]) {
      await db.query('insert into public.turntally_memberships (user_id, household_id, person_id) values ($1, $2, $3)', [user, family, person])
    }
    await signIn()
  })

  it('isolates households and denies direct table access even to signed-in owners', async () => {
    await signIn(ids.outsider)
    const result = await db.query<{ result: { household_id: string } }>('select public.turntally_load() result')
    expect(result.rows[0].result.household_id).toBe(ids.otherFamily)
    await expect(db.query('select * from public.turntally_households')).rejects.toThrow(/permission denied/)
    await expect(db.query('update public.turntally_memberships set person_id = $1', ['parent'])).rejects.toThrow(/permission denied/)
  })
  it('rejects anonymous and unprovisioned access', async () => {
    await signIn('', 'anon')
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/permission denied/)
    await signIn('00000000-0000-0000-0000-000000000099')
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/access is not available/)
  })
  it('lets viewers read but rejects their writes including forged administrator roles', async () => {
    await signIn(ids.viewer)
    await expect(db.query('select public.turntally_load()')).resolves.toBeDefined()
    const forged = hostedFixture(); forged.configuration!.people[2].role = 'administrator'
    await expect(save(forged)).rejects.toThrow(/cannot make changes/)
    await expect(save(forged, 0, 'restore')).rejects.toThrow(/cannot make changes/)
  })
  it('lets editors change activities but not membership, history deletion, or replacement', async () => {
    await signIn(ids.editor)
    const next = hostedFixture(); next.configuration!.rotation.name = 'Car seat'
    await expect(save(next)).resolves.toBeDefined()
    next.configuration!.people[1].role = 'administrator'
    await expect(save(next, 1)).rejects.toThrow(/manage family membership/)
    await expect(save(hostedFixture(), 1, 'restore')).rejects.toThrow(/replace family data/)
  })
  it('rejects the second stale writer without overwriting the first report', async () => {
    const first = hostedFixture(); first.configuration!.rotation.name = 'First edit'
    await save(first)
    await signIn(ids.editor)
    const second = hostedFixture(); second.configuration!.rotation.name = 'Second edit'
    await expect(save(second)).rejects.toMatchObject({ code: '40001' })
    const result = await db.query<{ result: { revision: number; snapshot: unknown } }>('select public.turntally_load() result')
    expect(result.rows[0].result.revision).toBe(1)
    expect(result.rows[0].result.snapshot).toEqual(first)
  })
  it('checks current permissions after a role change and immediately rejects revoked access', async () => {
    const next = hostedFixture(); next.configuration!.people[1].role = 'viewer'
    await save(next)
    await signIn(ids.editor)
    await expect(save(next, 1)).rejects.toThrow(/cannot make changes/)
    await db.exec('reset role')
    await db.query('update public.turntally_memberships set revoked_at = now() where user_id = $1', [ids.editor])
    await signIn(ids.editor)
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/access is not available/)
  })
  it('requires a linked active administrator and preserves login identities on restore', async () => {
    const next = hostedFixture(); next.configuration!.people[0].active = false
    next.configuration!.people[2].role = 'administrator'
    await db.exec('reset role')
    await db.query('update public.turntally_memberships set viewer_only = true where user_id = $1', [ids.viewer])
    await signIn()
    await expect(save(next)).rejects.toThrow(/linked sign-in/)
    const restored = hostedFixture(); restored.configuration!.people = restored.configuration!.people.filter((person) => person.id !== 'adult')
    await expect(save(restored, 0, 'restore')).rejects.toThrow(/Preserve linked family identities/)
  })
  it('prevents rewriting recorded events while allowing explicit administrator restores', async () => {
    const next = hostedFixture(); next.events = [{ type: 'assignment-recorded', eventId: 'assignment:1', slotId: 'middle-seat:2026-09-07', personId: 'adult' }]
    await save(next)
    await expect(save(hostedFixture(), 1)).rejects.toThrow(/history must be preserved/)
    await expect(save(hostedFixture(), 1, 'restore')).resolves.toBeDefined()
  })
  it('allows only the provisioned owner to initialize once and binds the chosen administrator', async () => {
    await db.exec('reset role')
    await db.query('update public.turntally_households set snapshot = null where id = $1', [ids.family])
    await db.query('update public.turntally_memberships set person_id = null where user_id = $1', [ids.owner])
    await signIn(ids.editor)
    await expect(save(hostedFixture(), 0, 'initialize', 'parent')).rejects.toThrow(/provisioned owner/)
    await signIn()
    await expect(save(hostedFixture(), 0, 'initialize', 'child')).rejects.toThrow(/active administrator/)
    await save(hostedFixture(), 0, 'initialize', 'parent')
    const result = await db.query<{ result: { person_id: string } }>('select public.turntally_load() result')
    expect(result.rows[0].result.person_id).toBe('parent')
    await expect(save(hostedFixture(), 1, 'initialize', 'parent')).rejects.toThrow(/replace family data/)
  })
  it('rejects malformed roles and null revisions without changing data', async () => {
    const next = hostedFixture(); delete next.configuration!.people[0].role
    await expect(save(next)).rejects.toThrow(/Invalid family member/)
    await expect(db.query('select public.turntally_save(null, $1::jsonb)', [JSON.stringify(hostedFixture())])).rejects.toMatchObject({ code: '40001' })
  })

  it('pairs both device types without changing household data or impersonating an adult', async () => {
    for (const kind of ['shared','personal'] as const) {
      const device = await enroll(kind, 'parent')
      await signIn(device.userId)
      const result = await db.query<{ result: { revision: number; snapshot: unknown; person_id: string | null; role: string; device: { kind: string } } }>('select public.turntally_load() result')
      expect(result.rows[0].result).toMatchObject({ revision: 0, snapshot: hostedFixture(), person_id: kind === 'shared' ? null : 'parent', role: 'viewer', device: { kind } })
      for (const operation of ['edit','restore','initialize']) await expect(save(hostedFixture(), 0, operation, 'parent')).rejects.toThrow(/cannot make changes/)
      await expect(command('list', {}, device.userId)).rejects.toThrow(/current family administrator/)
    }
  })
  it('keeps pairing records and service operations inaccessible to client roles', async () => {
    for (const role of ['anon','authenticated']) {
      await signIn(ids.owner, role)
      await expect(db.query("select public.turntally_device_command('start')")).rejects.toThrow(/permission denied/)
      await expect(db.query('select * from turntally_private.pairing_requests')).rejects.toThrow(/permission denied/)
      await expect(db.query('select turntally_private.adult_load()')).rejects.toThrow(/permission denied/)
    }
  })
  it('requires current administrator authority and isolates device management by household', async () => {
    const device = await enroll()
    for (const user of [ids.editor,ids.viewer,'00000000-0000-0000-0000-000000000099']) {
      await expect(command('list', {}, user)).rejects.toThrow(/current family administrator/)
      await expect(command('approve', { code_hash: device.request.code_hash }, user)).rejects.toThrow(/current family administrator/)
    }
    const listed = await command('list')
    expect((await command('list', {}, ids.outsider)).devices).toEqual([])
    expect((await command('revoke', { id: listed.devices[0].id }, ids.outsider)).code).toBe(404)
    await db.exec('reset role')
    await db.query('update public.turntally_memberships set revoked_at = now() where user_id = $1', [ids.owner])
    await expect(command('list')).rejects.toThrow(/current family administrator/)
  })
  it('rejects guessed proof, expired/canceled codes, reuse, and a second redemption', async () => {
    const request = await pairing()
    expect((await command('poll', { ...request, proof_hash: 'b'.repeat(64) }, null)).code).toBe(410)
    expect((await command('approve', { ...request, kind:'shared', name:'Hijack' })).code).toBe(410)
    const lease = await command('poll', request, null)
    expect(lease.state).toBe('provision')
    expect((await command('poll', request, null)).code).toBe(429)
    await db.exec('reset role')
    await db.query("update turntally_private.pairing_requests set polled_at = now() - interval '6 seconds' where id = $1", [request.id])
    expect((await command('poll', request, null)).state).toBe('provisioning')
    expect((await command('activate', request, ids.viewer)).code).toBe(410)
    expect((await command('cancel', request, null)).state).toBe('canceled')
    expect((await command('issued', request, null)).state).toBe('canceled')
    const expired = await pairing()
    await db.exec('reset role')
    await db.query("update turntally_private.pairing_requests set expires_at = now() - interval '1 second' where id = $1", [expired.id])
    expect((await command('poll', expired, null)).state).toBe('expired')
    expect((await command('lookup', expired)).code).toBe(410)
  })
  it('rechecks the approving parent and personal linkage before issuing or activating', async () => {
    const request = await pairing('personal')
    const lease = await command('poll', request, null)
    await db.exec('reset role')
    await db.query('insert into auth.users(id) values($1)', [lease.user_id])
    await command('issued', request, null)
    await db.exec('reset role')
    await db.query("update public.turntally_households set snapshot = jsonb_set(snapshot,'{configuration,people,0,role}','\"viewer\"') where id=$1", [ids.family])
    await expect(command('activate', request, lease.user_id)).rejects.toThrow(/current family administrator/)
    await signIn(lease.user_id)
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/access is not available/)
  })
  it('does not grant access before session acknowledgement and cleans abandoned provisioning', async () => {
    const request = await pairing()
    const lease = await command('poll', request, null)
    await db.exec('reset role')
    await db.query('insert into auth.users(id) values($1)', [lease.user_id])
    await command('issued', request, null)
    await signIn(lease.user_id)
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/access is not available/)
    await db.exec('reset role')
    await db.query("update turntally_private.pairing_requests set lease_until = now() - interval '1 second' where id = $1", [request.id])
    expect((await command('cleanup', {}, null)).users).toContain(lease.user_id)
    expect((await command('activate', request, lease.user_id)).state).toBe('expired')
    await signIn(lease.user_id)
    await expect(db.query('select public.turntally_access()')).rejects.toThrow(/access is not available/)
  })
  it('permanently revokes only personal enrollments when their member is deactivated', async () => {
    const personal = await enroll('personal')
    const shared = await enroll()
    const next = hostedFixture(); next.configuration!.people[2].active = false
    await signIn(); await save(next)
    await signIn(personal.userId)
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/no longer has family access/)
    await signIn(shared.userId)
    await expect(db.query('select public.turntally_load()')).resolves.toBeDefined()
    await signIn(); await save(hostedFixture(), 1)
    await signIn(personal.userId)
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/no longer has family access/)
  })
  it('revokes one device without affecting siblings and makes activation retries idempotent', async () => {
    const first = await enroll(); const second = await enroll()
    expect((await command('activate', first.request, first.userId)).state).toBe('claimed')
    expect((await command('activate', first.request, second.userId)).code).toBe(403)
    await command('disconnect', {}, first.userId)
    await signIn(first.userId)
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/no longer has family access/)
    await command('activate', first.request, first.userId)
    await signIn(first.userId)
    await expect(db.query('select public.turntally_access()')).rejects.toThrow(/no longer has family access/)
    await signIn(second.userId)
    await expect(db.query('select public.turntally_access()')).resolves.toBeDefined()
    await signIn(); await expect(save()).resolves.toBeDefined()
  })
  it('persists failed code attempts and caps unauthenticated requests across instances', async () => {
    for (let n = 0; n < 10; n++) expect((await command('lookup', { code_hash: '0'.repeat(64) })).code).toBe(410)
    expect((await command('lookup', { code_hash: '0'.repeat(64) })).code).toBe(429)
    for (let n = 0; n < 10; n++) expect((await command('start', { code_hash: randomBytes(32).toString('hex'), proof_hash: '1'.repeat(64), ip_hash: 'same' }, null)).state).toBe('pending')
    expect((await command('start', { code_hash: randomBytes(32).toString('hex'), proof_hash: '1'.repeat(64), ip_hash: 'same' }, null)).code).toBe(429)
  })
})
