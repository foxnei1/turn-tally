// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { hostedFixture } from '../test/hostedFixture'

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
    await db.exec(readFileSync(new URL('../../../supabase/migrations/20260907225429_household_sync.sql', import.meta.url), 'utf8'))
    for (const id of [ids.owner, ids.editor, ids.viewer, ids.outsider]) await db.query('insert into auth.users values ($1)', [id])
  }, 30000)
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('reset role; delete from public.turntally_memberships; delete from public.turntally_households;')
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
})
