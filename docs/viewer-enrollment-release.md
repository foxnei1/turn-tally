# Viewer enrollment release

Implementation is committed and pushed as of September 8, 2026 UTC. Code commit `5cdab9b` passed all three jobs in [CI run 34175990406](https://github.com/foxnei1/turn-tally/actions/runs/34175990406), including real Supabase Auth in Docker. The live Cloudflare pilot still runs the adult-account release. No production migration or Edge Function has been deployed for viewer pairing.

## What is implemented

- **Use as a viewer** starts a 10-minute code. **Family → Devices** lets a current administrator review and approve a personal or shared device, list enrollments, rename them, and revoke one browser independently.
- Supabase Auth creates a separate viewer identity only after approval. A service-only SQL coordinator handles quotas, leases, current-parent checks, and one-time membership creation. Secrets stay in the Edge runtime. Public and anonymous signup remain disabled.
- Shared devices show **Family viewer** without a fake roster member. Devices retain the viewer cap after person-role changes. Personal-member deactivation permanently revokes existing personal enrollments in the snapshot transaction.
- The viewer checks access every 60 seconds while visible and on focus, visibility return, and reconnect. Failed checks discard the displayed family; refreshing explicitly reloads after connectivity returns. Switching to adult sign-in first revokes viewer membership and clears its session. No durable family cache or editing offline is included.

## Local checks

Run `npm run check` in `web` for lint, types, browser/coordinator tests, PostgreSQL authorization tests, and the build. The PostgreSQL suite applies **every** migration in order to PGlite and exercises authenticated, anonymous, and service roles. It verifies races through state/lease behavior; PGlite does not reproduce concurrent networked PostgreSQL sessions.

Validated locally: 171 automated tests pass, including 19 PostgreSQL authorization tests, along with lint, TypeScript, production build, and frozen-lockfile Edge type checking. Gitleaks and the repository-specific credential scan found no secrets in the 100 candidate repository files. The existing hosted bundle-size warning remains.

The Edge runtime has a pinned Deno lockfile. From the repository root:

```powershell
npx --yes deno@2.9.6 check --frozen --config supabase/functions/viewer-devices/deno.json supabase/functions/viewer-devices/index.ts supabase/functions/viewer-devices/auth.integration.test.ts
```

The native Auth integration check requires Docker and the isolated local stack. This Windows Server workspace has no Docker runtime, so the test ran successfully on GitHub's Ubuntu runner instead. The `viewer-auth` CI job provisions and removes a disposable stack. It verifies that signup is disabled, pairing sends no email through the local Mailpit server, personal/shared sessions are independent, provisional sessions cannot load data, password/email/metadata changes cannot elevate access, refresh cannot restore revoked access, and deactivation does not revive on reactivation.

To run on a machine with Docker, from the repository root:

```powershell
npx --yes supabase@2.117.0 start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
node web/scripts/test-viewer-auth.mjs
```

The test refuses remote URLs and reads local keys directly from CLI status into the test process environment without printing them. Fixtures remain in the isolated `turntally-auth-tests` stack. Do not use this config or test against the live pilot. CI removes its disposable stack after the test.

The local config keeps `auth.enable_signup = false` and anonymous sign-in disabled, while setting `auth.email.enable_signup = true`. Despite its name, the CLI maps the latter flag to the entire email provider's `ExternalEmailEnabled` setting; disabling it also blocks provisioned email sign-in. The integration test checks both the returned Auth settings and an actual rejected public signup request.

## Deployment order

1. Require a passing `viewer-auth` integration job, inspect the migration, and repeat the two-browser flow in a test environment. The generated migration is `20260908000942_viewer_devices.sql`; do not edit the already deployed initial migration.
2. Apply the new migration through the Supabase migration workflow and run database security/performance advisors. The exposed load/access wrappers are invokers calling a narrowly granted private authorization function. `turntally_device_command` is invoker-only and executable only by `service_role`. Private tables have RLS enabled and no direct client privileges. The existing `turntally_save` definer and pre-existing `rls_auto_enable` advisory require the existing review described in [the backend notes](supabase-backend.md).
3. Set the Edge secret `VIEWER_ALLOWED_ORIGINS` to `https://turntally-pilot.turntally-family.workers.dev` (comma-separated exact origins if adding a test origin). The runtime-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` stay server-side. Leave `VIEWER_TRUSTED_IP_HEADER` unset until the gateway's overwrite behavior is verified; the conservative shared start quota works without it.
4. Deploy the `viewer-devices` function with `index.ts`, `handler.ts`, `supabasePorts.ts`, `deno.json`, and `deno.lock`. JWT gateway verification is disabled for this function because start/poll/cancel are intentionally public; every privileged action verifies its supplied token with Auth `getUser`, then checks current database authorization. This is recorded in `supabase/config.toml`. Restrict CORS to the configured origins. Include no integration fixtures in the deployed function bundle.
5. Verify anonymous start/cancel, CORS, sanitized errors, no-store responses, administrator approval, and viewer RPC write rejection. Confirm the live Auth settings still disable public and anonymous signup.
6. Deploy the Cloudflare frontend using the existing `web` deployment workflow. Test one personal and one shared browser, refresh persistence, parent revocation, old-token read denial, member deactivation/reactivation, and disconnect-before-adult-sign-in. Confirm that pairing never changes the household revision or event history.

Do not deploy only the frontend: pairing requires both the migration and Edge Function. Rolling the frontend back does not revoke already enrolled devices; revoke them through access administration if required. Manual code entry is the first version; QR shortcuts are deferred. Real concurrent redemption and cross-device acceptance remain release checks.
