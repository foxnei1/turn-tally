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
async function signIn(user = ids.owner, role = 'authenticated', session = user) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub:user, session_id:session || null })])
  await db.exec(`set role ${role}`)
}
async function save(snapshot = hostedFixture(), revision = 0, operation = 'edit', administratorId: string | null = null) {
  return db.query('select public.turntally_save($1, $2::jsonb, $3, $4) result', [revision, JSON.stringify(snapshot), operation, administratorId])
}
async function parental(operation: string, payload: Record<string, unknown> = {}) {
  const result = await db.query<{ result: { state?: string; id: string; code: string | number; error?: string; accounts: { user_id: string }[]; email?: string } }>('select public.turntally_adult_command($1,$2::jsonb) result', [operation, JSON.stringify(payload)])
  return result.rows[0].result
}
async function unlinkedParentalAccount() {
  await db.exec('reset role')
  await db.query('delete from public.turntally_memberships where user_id = $1', [ids.editor])
  await signIn(ids.editor)
  return parental('start')
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
      create schema auth; create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
      create table auth.sessions (id uuid primary key, user_id uuid references auth.users(id), created_at timestamptz default clock_timestamp());
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      create function public.rls_auto_enable() returns event_trigger language plpgsql security definer as $$ begin return; end $$;
      grant execute on function public.rls_auto_enable() to anon, authenticated, service_role;
    `)
    const migrations = new URL('../../../supabase/migrations/', import.meta.url)
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(name, migrations), 'utf8'))
    for (const id of [ids.owner, ids.editor, ids.viewer, ids.outsider]) {
      await db.query('insert into auth.users(id,email) values ($1,$2)', [id, id + '@example.com'])
      await db.query('insert into auth.sessions(id,user_id) values ($1,$1)', [id])
    }
  }, 30000)
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('reset role; delete from turntally_private.adult_requests; delete from turntally_private.viewer_devices; delete from turntally_private.pairing_requests; delete from turntally_private.pairing_limits; delete from public.turntally_memberships; delete from public.turntally_households;')
    await db.exec("update auth.sessions set created_at = now() - interval '1 day'")
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
  it('links an authenticated parental account without changing the household snapshot or revision', async () => {
    const request = await unlinkedParentalAccount()
    expect(request.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect((await parental('eligibility')).state).toBe('eligible')
    await expect(db.query('select public.turntally_load()')).rejects.toThrow(/access is not available/)
    await expect(parental('list')).rejects.toMatchObject({ code:'42501' })
    await signIn()
    expect((await parental('lookup', { code:request.code })).email).toBe(ids.editor + '@example.com')
    expect((await parental('approve', { code:request.code, person_id:'adult', role:'administrator', household_id:ids.otherFamily })).state).toBe('approved')
    expect((await parental('approve', { code:request.code, person_id:'adult' })).state).toBe('approved')
    await signIn(ids.editor)
    expect((await parental('status', { id:request.id })).state).toBe('approved')
    const loaded = await db.query<{ result: { role: string; revision: number; snapshot: unknown } }>('select public.turntally_load() result')
    expect(loaded.rows[0].result).toMatchObject({ role:'editor', revision:0, snapshot:hostedFixture() })
    await expect(parental('list')).rejects.toMatchObject({ code:'42501' })
    await expect(save()).resolves.toBeDefined()
  })
  it('keeps old sessions denied after revocation and reapproval, including viewer administration', async () => {
    const request = await unlinkedParentalAccount()
    await signIn()
    await parental('approve', { code:request.code, person_id:'adult' })
    expect((await parental('revoke', { user_id:ids.editor })).state).toBe('revoked')
    expect((await parental('approve', { code:request.code, person_id:'adult' })).code).toBe(410)
    await signIn(ids.editor)
    expect((await parental('eligibility')).state).toBe('signin_required')
    await expect(parental('start')).rejects.toMatchObject({ code:'42501' })
    await expect(db.query('select public.turntally_load()')).rejects.toMatchObject({ code:'42501' })
    await db.exec('reset role')
    const fresh = '00000000-0000-0000-0000-000000000888'
    await db.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,clock_timestamp() + interval '1 second') on conflict(id) do update set created_at = excluded.created_at", [fresh,ids.editor])
    await signIn(ids.editor,'authenticated',fresh)
    const replacement = await parental('start')
    await signIn()
    // Reapprove as another parent to exercise every privileged entry point.
    await parental('approve', { code:replacement.code, person_id:'parent', confirm_additional:true })
    await signIn(ids.editor)
    for (const rpc of ['turntally_load','turntally_access']) await expect(db.query(`select public.${rpc}()`)).rejects.toMatchObject({ code:'42501' })
    await expect(save()).rejects.toMatchObject({ code:'42501' })
    await expect(parental('list')).rejects.toMatchObject({ code:'42501' })
    await expect(command('list', { actor_session_id:ids.editor },ids.editor)).rejects.toMatchObject({ code:'42501' })
    await signIn(ids.editor,'authenticated',fresh)
    expect((await parental('list')).accounts).toHaveLength(3)
    await expect(db.query('select public.turntally_load()')).resolves.toBeDefined()
    expect((await command('list', { actor_session_id:fresh },ids.editor)).devices).toEqual([])
  })
  it('rejects cross-household remapping, viewer profiles, and unconfirmed additional logins', async () => {
    await signIn(ids.editor)
    expect((await parental('start')).code).toBe(409)
    const request = await unlinkedParentalAccount()
    await signIn()
    expect((await parental('approve', { code:request.code, person_id:'child' })).code).toBe(400)
    expect((await parental('approve', { code:request.code, person_id:'parent' })).code).toBe(409)
    expect((await parental('approve', { code:request.code, person_id:'adult' })).state).toBe('approved')
    await signIn(ids.outsider)
    expect((await parental('approve', { code:request.code, person_id:'parent', confirm_additional:true })).code).toBe(410)
    await signIn()
    await parental('revoke', { user_id:ids.editor })
    await db.exec('reset role')
    await db.query("update auth.sessions set created_at = clock_timestamp() + interval '1 second' where id = $1", [ids.editor])
    await signIn(ids.editor)
    const retry = await parental('start')
    await signIn(ids.outsider)
    expect((await parental('lookup', { code:retry.code })).code).toBe(410)
  })
  it('binds status and cancellation to the requester session and expires or cancels codes', async () => {
    const request = await unlinkedParentalAccount()
    await signIn(ids.outsider)
    expect((await parental('status', { id:request.id })).code).toBe(410)
    await signIn(ids.editor)
    expect((await parental('cancel', { id:request.id })).state).toBe('canceled')
    await signIn()
    expect((await parental('approve', { code:request.code, person_id:'adult' })).code).toBe(410)
    await signIn(ids.editor)
    const expired = await parental('start')
    await db.exec('reset role')
    await db.query("update turntally_private.adult_requests set expires_at = now() - interval '1 second' where id = $1", [expired.id])
    await signIn()
    expect((await parental('lookup', { code:expired.code })).code).toBe(410)
    await signIn(ids.editor)
    expect((await parental('status', { id:expired.id })).state).toBe('expired')
  })
  it('revokes deactivated parental memberships without reviving them on roster reactivation', async () => {
    const inactive = hostedFixture(); inactive.configuration!.people[1].active = false
    await save(inactive)
    await signIn(ids.editor)
    await expect(db.query('select public.turntally_load()')).rejects.toMatchObject({ code:'42501' })
    await signIn()
    await save(hostedFixture(),1)
    await signIn(ids.editor)
    expect((await parental('eligibility')).state).toBe('signin_required')
    await expect(db.query('select public.turntally_load()')).rejects.toMatchObject({ code:'42501' })
  })
  it('protects the owner and current login, and commits rate limits on failed guesses', async () => {
    expect((await parental('revoke', { user_id:ids.owner })).code).toBe(409)
    for (let i = 0; i < 10; i++) expect((await parental('lookup', { code:'BAD-CODE' })).code).toBe(410)
    expect((await parental('lookup', { code:'BAD-CODE' })).code).toBe(429)
    await expect(db.query('select * from turntally_private.adult_requests')).rejects.toThrow(/permission denied/)
  })
  it('rejects mismatched sessions and viewer identities before issuing parental codes', async () => {
    await signIn(ids.editor,'authenticated',ids.owner)
    await expect(parental('start')).rejects.toMatchObject({ code:'42501' })
    await db.exec('reset role')
    await db.query("update auth.users set raw_app_meta_data = '{\"turntally_viewer\":true}' where id = $1",[ids.editor])
    await signIn(ids.editor)
    await expect(parental('start')).rejects.toMatchObject({ code:'42501' })
    await db.exec('reset role')
    await db.query("update auth.users set raw_app_meta_data = '{}' where id = $1",[ids.editor])
    await signIn('', 'anon')
    await expect(parental('start')).rejects.toThrow(/permission denied/)
  })
  it('restricts the hosted RLS event helper without removing operator access', async () => {
    const result = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`select
      has_function_privilege('anon','public.rls_auto_enable()','execute') as anon,
      has_function_privilege('authenticated','public.rls_auto_enable()','execute') as authenticated,
      has_function_privilege('service_role','public.rls_auto_enable()','execute') as service`)
    expect(result.rows[0]).toEqual({ anon:false, authenticated:false, service:true })
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

  it('pairs both device types without changing household data or impersonating a parental account holder', async () => {
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
