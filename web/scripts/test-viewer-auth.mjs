import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const windows = process.platform === 'win32'
const executable = windows ? 'npx.cmd' : 'npx'
// All command arguments are constants; local keys are passed only via env.
const local = JSON.parse(execFileSync(executable, ['--yes', 'supabase@2.117.0', 'status', '--output', 'json'], { cwd:root, encoding:'utf8', shell:windows, stdio:['ignore','pipe','inherit'] }))
if (local.API_URL !== 'http://127.0.0.1:54321' || !local.SERVICE_ROLE_KEY || !local.ANON_KEY) throw new Error('Only the isolated local Supabase stack is allowed.')
const result = spawnSync(executable, ['--yes','deno@2.9.6','test','--frozen','--config','supabase/functions/viewer-devices/deno.json',
  '--allow-net=127.0.0.1:54321,127.0.0.1:54324','--allow-env=TT_TEST_SUPABASE_URL,TT_TEST_SERVICE_ROLE_KEY,TT_TEST_ANON_KEY',
  'supabase/functions/viewer-devices/auth.integration.test.ts'], {
  cwd:root, shell:windows, stdio:'inherit', env:{ ...process.env, TT_TEST_SUPABASE_URL:local.API_URL, TT_TEST_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY, TT_TEST_ANON_KEY:local.ANON_KEY },
})
process.exitCode = result.status ?? 1
