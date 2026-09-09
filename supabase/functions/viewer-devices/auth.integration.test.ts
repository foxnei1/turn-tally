import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import { createDeviceHandler, type Json } from './handler.ts'
import { supabaseDevicePorts } from './supabasePorts.ts'

Deno.test('isolated Auth: adult linking, concurrent admission and old-session denial after reapproval', async () => {
  const url = Deno.env.get('TT_TEST_SUPABASE_URL') ?? ''
  check(url === 'http://127.0.0.1:54321', 'Adult access tests forbid remote projects.')
  const key = Deno.env.get('TT_TEST_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('TT_TEST_ANON_KEY') ?? ''
  check(key && anonKey, 'Local test keys are missing.')
  const options = { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } }
  const admin = createClient(url,key,options)
  const mailCount = async () => {
    const response = await fetch('http://127.0.0.1:54324/api/v1/messages')
    check(response.ok,'Mailpit is required for the no-email assertion.')
    return (await response.json()).total
  }
  const beforeMail = await mailCount()
  async function account() {
    const email = `${crypto.randomUUID()}@adult.turntally.invalid`; const password = crypto.randomUUID() + 'Aa1!'
    const created = await admin.auth.admin.createUser({ email,password,email_confirm:true })
    check(!created.error && created.data.user,'Could not provision a disposable adult.')
    const client = createClient(url,anonKey,options)
    const login = await client.auth.signInWithPassword({ email,password })
    check(!login.error && login.data.session,'Could not sign in the disposable adult.')
    return { client,email,password,id:created.data.user.id,session:login.data.session }
  }
  const parent = await account(); const target = await account(); const outsider = await account(); const racer = await account()
  const snapshot = { configuration:{ rolesInitialized:true,startDate:'2026-09-07',rotation:{},people:[
    { id:'parent',name:'Parent',role:'administrator',active:true },{ id:'adult',name:'Adult',role:'editor',active:true },
  ] },events:[] }
  async function household(owner: typeof parent) {
    const family = await admin.from('turntally_households').insert({ owner_user_id:owner.id,snapshot }).select('id').single()
    check(!family.error && family.data,'Could not create the test household.')
    check(!(await admin.from('turntally_memberships').insert({ user_id:owner.id,household_id:family.data.id,person_id:'parent' })).error,'Could not link its owner.')
    return family.data.id
  }
  const family = await household(parent); await household(outsider)
  async function command(client: typeof parent.client, operation: string, payload: Json = {}) {
    const result = await client.rpc('turntally_adult_command',{ operation,payload })
    check(!result.error,`Adult ${operation} RPC failed (${errorCode(result.error)}).`)
    return result.data
  }
  const request = await command(target.client,'start')
  check((await target.client.rpc('turntally_load')).error?.code === '42501','Unlinked adult could read family data.')
  const approvals = await Promise.all([command(parent.client,'approve',{ code:request.code,person_id:'adult' }),command(parent.client,'approve',{ code:request.code,person_id:'adult' })])
  check(approvals.every(result => result.state === 'approved'),'Identical concurrent approvals were not idempotent.')
  const loaded = await target.client.rpc('turntally_load')
  check(!loaded.error && loaded.data.role === 'editor' && loaded.data.household_id === family && loaded.data.revision === 0,'Adult approval changed role, household or revision unexpectedly.')
  check((await target.client.rpc('turntally_adult_command',{ operation:'list' })).error?.code === '42501','Editor could manage access.')
  check((await command(parent.client,'revoke',{ user_id:target.id })).state === 'revoked','Adult revoke failed.')
  check((await command(target.client,'eligibility')).state === 'signin_required','Revoked session can request reapproval.')
  check((await command(parent.client,'approve',{ code:request.code,person_id:'adult' })).code === 410,'Stale approval restored access.')
  const fresh = createClient(url,anonKey,options)
  const login = await fresh.auth.signInWithPassword({ email:target.email,password:target.password })
  check(!login.error && login.data.session,'Fresh sign-in failed.')
  const replacement = await command(fresh,'start')
  check((await command(parent.client,'approve',{ code:replacement.code,person_id:'parent',confirm_additional:true })).state === 'approved','Fresh reapproval failed.')
  const refreshed = await target.client.auth.refreshSession()
  check(!refreshed.error && refreshed.data.session,'Old session refresh could not exercise cutoff protection.')
  for (const name of ['turntally_load','turntally_access']) check((await target.client.rpc(name)).error?.code === '42501','Old refreshed session regained read access.')
  check((await target.client.rpc('turntally_save',{ expected_revision:0,proposed_snapshot:snapshot })).error?.code === '42501','Old refreshed session regained writes.')
  check((await target.client.rpc('turntally_adult_command',{ operation:'list' })).error?.code === '42501','Old refreshed session regained adult administration.')
  const handler = createDeviceHandler(supabaseDevicePorts(url,key,['http://127.0.0.1:5173']))
  async function devices(token: string) {
    const response = await handler(new Request(url + '/functions/v1/viewer-devices',{ method:'POST',headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${token}` },body:JSON.stringify({ action:'list',actor_session_id:login.data.session!.access_token }) }))
    await response.body?.cancel()
    return response.status
  }
  check(await devices(refreshed.data.session.access_token) === 403,'Forged body session restored old viewer administration.')
  check(await devices(login.data.session.access_token) === 200,'Newly approved session cannot manage viewer devices.')
  check(!(await fresh.rpc('turntally_load')).error,'Fresh reapproved session cannot load.')
  const raceRequest = await command(racer.client,'start')
  const raced = await Promise.all([command(parent.client,'approve',{ code:raceRequest.code,person_id:'adult' }),command(outsider.client,'approve',{ code:raceRequest.code,person_id:'adult' })])
  check(raced.filter(result => result.state === 'approved').length === 1 && raced.filter(result => result.code === 410).length === 1,'Cross-household admission did not produce exactly one winner.')
  const snapshotAfter = await admin.from('turntally_households').select('snapshot,revision').eq('id',family).single()
  check(!snapshotAfter.error && snapshotAfter.data.revision === 0 && snapshotAfter.data.snapshot.events.length === 0,'Access operations changed family history.')
  check(await mailCount() === beforeMail,'Adult linking unexpectedly sent email.')
})

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

Deno.test('isolated Auth: adult recovery email, one-time link, password change and session revocation', async () => {
  const url = Deno.env.get('TT_TEST_SUPABASE_URL') ?? ''
  check(url === 'http://127.0.0.1:54321', 'Recovery tests forbid remote Supabase projects.')
  const key = Deno.env.get('TT_TEST_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('TT_TEST_ANON_KEY') ?? ''
  check(key && anonKey, 'Local test keys are missing.')
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  const admin = createClient(url, key, options)
  const requester = createClient(url, anonKey, options)
  const recovery = createClient(url, anonKey, options)
  const email = `${crypto.randomUUID()}@recovery.turntally.invalid`
  const oldPassword = crypto.randomUUID() + 'Aa1!'
  const newPassword = crypto.randomUUID() + 'Bb2!'
  const created = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true })
  check(!created.error && created.data.user, 'Could not create the isolated recovery fixture.')
  const original = await requester.auth.signInWithPassword({ email, password: oldPassword })
  check(!original.error && original.data.session, 'Recovery fixture could not sign in.')
  const redirectTo = 'http://127.0.0.1:5173/auth/recovery'
  const requested = await requester.auth.resetPasswordForEmail(email, { redirectTo })
  check(!requested.error, `Recovery request failed (${errorCode(requested.error)}).`)

  let messageId: string | undefined
  for (let attempt = 0; attempt < 20 && !messageId; attempt++) {
    const response = await fetch('http://127.0.0.1:54324/api/v1/messages')
    check(response.ok, 'Mailpit messages unavailable.')
    const messages = await response.json()
    messageId = messages.messages?.find((m: { To?: { Address: string }[] }) => m.To?.some(to => to.Address === email))?.ID
    if (!messageId) await new Promise(resolve => setTimeout(resolve, 250))
  }
  check(messageId, 'No recovery email reached isolated Mailpit.')
  const messageResponse = await fetch('http://127.0.0.1:54324/api/v1/message/' + encodeURIComponent(messageId))
  check(messageResponse.ok, 'Could not read the isolated recovery email.')
  const message = await messageResponse.json()
  const links = Array.from(String(message.HTML).matchAll(/href="([^"]+)"/g), match => match[1].replaceAll('&amp;', '&'))
  const link = links.find(value => {
    const candidate = new URL(value)
    return candidate.origin === url && candidate.pathname === '/auth/v1/verify' && candidate.searchParams.get('type') === 'recovery'
  })
  check(link, 'The default recovery template did not contain a local verification link.')
  // Never follow email redirects automatically or print token-bearing URLs.
  const verified = await fetch(link, { redirect: 'manual' })
  await verified.body?.cancel()
  check(verified.status === 303 || verified.status === 302, 'Recovery verification did not redirect.')
  const destination = new URL(verified.headers.get('location') ?? '')
  check(destination.origin + destination.pathname === redirectTo, 'Recovery escaped the allowlisted callback.')
  const fragment = new URLSearchParams(destination.hash.slice(1))
  check(fragment.get('type') === 'recovery' && fragment.has('access_token') && fragment.has('refresh_token'), 'Missing recovery session fragment.')
  const set = await recovery.auth.setSession({ access_token: fragment.get('access_token')!, refresh_token: fragment.get('refresh_token')! })
  check(!set.error, 'The recovery session was rejected.')
  const user = await recovery.auth.getUser()
  check(!user.error && user.data.user?.id === created.data.user.id, 'Recovery used the wrong identity.')
  check((await recovery.rpc('turntally_load')).error?.code === '42501', 'Recovery granted family admission to an unprovisioned account.')
  const update = await recovery.auth.updateUser({ password: newPassword })
  check(!update.error, `Recovery password update failed (${errorCode(update.error)}).`)
  check(!(await recovery.auth.signOut({ scope: 'global' })).error, 'Recovery sign-out failed.')
  const oldRefresh = await requester.auth.refreshSession({ refresh_token: original.data.session.refresh_token })
  check(!!oldRefresh.error, 'Recovery failed to revoke the old refresh session.')
  const login = createClient(url, anonKey, options)
  check(!!(await login.auth.signInWithPassword({ email, password: oldPassword })).error, 'The old password still worked.')
  const updated = await login.auth.signInWithPassword({ email, password: newPassword })
  check(!updated.error && updated.data.user?.id === created.data.user.id, 'The new password did not recover the same account.')
  check((await login.rpc('turntally_load')).error?.code === '42501', 'Password recovery bypassed household admission.')
  const reused = await fetch(link, { redirect: 'manual' })
  await reused.body?.cancel()
  const reusedLocation = reused.headers.get('location')
  check(reusedLocation && new URLSearchParams(new URL(reusedLocation).hash.slice(1)).has('error'), 'A used recovery link was not rejected.')
  const settingsResponse = await fetch(url + '/auth/v1/settings', { headers: { apikey: anonKey } })
  const settings = await settingsResponse.json()
  check(settings.disable_signup === true && settings.external?.anonymous_users === false, 'Recovery changed signup settings.')
})
