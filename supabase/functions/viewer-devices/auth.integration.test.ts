import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import { createDeviceHandler, type Json } from './handler.ts'
import { supabaseDevicePorts } from './supabasePorts.ts'

// A real GoTrue/PostgREST check, intentionally restricted to the disposable
// local stack. Assertions never dump Auth results or tokens into test output.
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function errorCode(error: { code?: string; status?: number } | null) {
  const code = error?.code && /^[a-zA-Z0-9_]+$/.test(error.code) ? error.code : 'unknown'
  return `${code}, HTTP ${error?.status ?? 'unknown'}`
}
Deno.test('isolated Auth: signup disabled, no enrollment email, viewer sessions and revocation', async () => {
  const url = Deno.env.get('TT_TEST_SUPABASE_URL') ?? ''
  check(url === 'http://127.0.0.1:54321', 'Start the isolated local Supabase stack first; remote projects are forbidden.')
  const key = Deno.env.get('TT_TEST_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('TT_TEST_ANON_KEY') ?? ''
  check(key && anonKey, 'Local test keys are missing.')
  const options = { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } }
  const admin = createClient(url, key, options)
  const anonymous = createClient(url, anonKey, options)
  const settingsResponse = await fetch(url + '/auth/v1/settings', { headers:{ apikey:anonKey } })
  const settings = await settingsResponse.json()
  check(settings.disable_signup === true && settings.external?.anonymous_users === false, 'Public and anonymous signup must remain disabled.')
  check(settings.external?.email === true, 'Email sign-in must be enabled for provisioned accounts.')
  const mailCount = async () => {
    const response = await fetch('http://127.0.0.1:54324/api/v1/messages')
    check(response.ok, 'Local Mailpit must be running to verify no email was sent.')
    const data = await response.json()
    check(typeof data.total === 'number', 'Unexpected local Mailpit response.')
    return data.total as number
  }
  const beforeMail = await mailCount()
  const publicSignup = await anonymous.auth.signUp({ email:`${crypto.randomUUID()}@test.turntally.invalid`, password:crypto.randomUUID() + 'Aa1!' })
  check(publicSignup.error?.code === 'signup_disabled', 'Email provider enablement must not allow public signup.')
  const password = crypto.randomUUID() + 'Aa1!'
  const parent = await admin.auth.admin.createUser({ email:`${crypto.randomUUID()}@test.turntally.invalid`, password, email_confirm:true })
  check(!parent.error && parent.data.user, 'Could not create the isolated parent fixture.')
  const signed = await anonymous.auth.signInWithPassword({ email:parent.data.user.email!, password })
  check(!signed.error && signed.data.session, `Isolated parent sign-in failed (${errorCode(signed.error)}).`)
  const parentToken = signed.data.session.access_token
  const snapshot = { configuration:{ rolesInitialized:true, startDate:'2026-09-07', rotation:{}, people:[
    { id:'parent', name:'Test parent', role:'administrator', active:true },
    { id:'child', name:'Test child', role:'viewer', active:true },
  ] }, events:[] }
  const family = await admin.from('turntally_households').insert({ owner_user_id:parent.data.user.id, snapshot }).select('id').single()
  check(!family.error && family.data, 'Could not create the isolated household fixture.')
  const membership = await admin.from('turntally_memberships').insert({ user_id:parent.data.user.id, household_id:family.data.id, person_id:'parent' })
  check(!membership.error, 'Could not link the isolated parent.')
  const handler = createDeviceHandler(supabaseDevicePorts(url,key,['http://127.0.0.1:5173']))
  async function invoke(action: string, payload: Json = {}, token?: string) {
    const response = await handler(new Request(url + '/functions/v1/viewer-devices', {
      method:'POST', headers:{ Origin:'http://127.0.0.1:5173', 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) },
      body:JSON.stringify({ ...payload, action }),
    }))
    const result = await response.json()
    check(response.ok, `Device ${action} failed with status ${response.status}.`)
    return result
  }
  const viewers = []
  for (const kind of ['shared','personal']) {
    const request = await invoke('start')
    await invoke('lookup', { code:request.code }, parentToken)
    await invoke('approve', { code:request.code, kind, person_id:'child', name:`Test ${kind}` }, parentToken)
    const issued = await invoke('poll', { id:request.id, proof:request.proof })
    check(issued.state === 'issued' && issued.session, 'Viewer session was not issued.')
    const viewer = createClient(url,anonKey,options)
    const stored = await viewer.auth.setSession(issued.session)
    check(!stored.error && stored.data.user, 'Could not load the issued Auth session.')
    check(stored.data.user.id !== parent.data.user.id && stored.data.user.email?.endsWith('@viewer.turntally.invalid'), 'Viewer identity is not separate from the parent.')
    check((await viewer.rpc('turntally_load')).error, 'A provisional identity had household access before acknowledgement.')
    await invoke('activate', { id:request.id, proof:request.proof }, issued.session.access_token)
    const loaded = await viewer.rpc('turntally_load')
    check(!loaded.error && loaded.data.role === 'viewer' && loaded.data.household_id === family.data.id && loaded.data.revision === 0, 'Enrolled viewer could not load exactly the approved household.')
    check(loaded.data.person_id === (kind === 'shared' ? null : 'child'), 'Incorrect personal/shared linkage.')
    viewers.push({ client:viewer, token:issued.session.access_token, id:stored.data.user.id, kind })
  }
  check(await mailCount() === beforeMail, 'Enrollment sent an email.')
  const viewer = viewers[0]
  const changed = await viewer.client.auth.updateUser({ password:crypto.randomUUID() + 'Aa1!', data:{ role:'administrator', viewer_only:false } })
  check(!changed.error, `Could not exercise viewer password/metadata changes (${errorCode(changed.error)}).`)
  const emailChange = await viewer.client.auth.updateUser({ email:`${crypto.randomUUID()}@changed.turntally.invalid` })
  check(!emailChange.error, `Could not exercise viewer email change (${errorCode(emailChange.error)}).`)
  const refreshed = await viewer.client.auth.refreshSession()
  check(!refreshed.error && refreshed.data.session, 'Viewer refresh did not preserve a session.')
  const loaded = await viewer.client.rpc('turntally_load')
  check(!loaded.error && loaded.data.role === 'viewer', 'Identity changes or refresh removed the viewer cap.')
  const write = await viewer.client.rpc('turntally_save', { expected_revision:0, proposed_snapshot:snapshot })
  check(write.error?.code === '42501', 'Viewer direct write was not rejected.')
  const listed = await invoke('list', {}, parentToken)
  check(listed.devices.length === 2, 'Device list did not contain both enrollments.')
  const shared = listed.devices.find((d: Json) => d.kind === 'shared')
  await invoke('revoke', { id:shared.id }, parentToken)
  check((await viewer.client.rpc('turntally_load')).error?.code === '42501', 'Revocation did not reject the current JWT.')
  await viewer.client.auth.refreshSession()
  check((await viewer.client.rpc('turntally_load')).error?.code === '42501', 'Refresh restored revoked household access.')
  check(!(await viewers[1].client.rpc('turntally_load')).error, 'Revoking one device affected its sibling.')
  const parentClient = createClient(url,anonKey,options)
  await parentClient.auth.setSession(signed.data.session)
  snapshot.configuration.people[1].active = false
  const saved = await parentClient.rpc('turntally_save', { expected_revision:0, proposed_snapshot:snapshot })
  check(!saved.error, 'Parent could not deactivate the personal viewer member.')
  check((await viewers[1].client.rpc('turntally_load')).error?.code === '42501', 'Deactivation left personal viewer access active.')
  snapshot.configuration.people[1].active = true
  check(!(await parentClient.rpc('turntally_save', { expected_revision:1, proposed_snapshot:snapshot })).error, 'Parent could not reactivate the member.')
  check((await viewers[1].client.rpc('turntally_load')).error?.code === '42501', 'Reactivation revived an old enrollment.')
  // Fixtures remain exclusively in the disposable local stack. The CI job
  // removes the stack without a backup; no live household is ever touched.
})
