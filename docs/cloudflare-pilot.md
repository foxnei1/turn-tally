# Cloudflare pilot

Cloudflare was selected on September 7, 2026 for pilot hosting on the free tier. The initial hosted app was deployed the same day, using the live Supabase backend. Owner sign-in, backup import, and manual sync across browser sessions are working. Personal/shared viewer enrollment is now deployed and verified; recovery, offline viewing, and remaining synchronization work are still in progress.

## Startup hotfix — September 8, 2026 UTC

Cloudflare version `6b236c13-8a34-4b97-a855-0c6b015b1307` fixes the signed-in startup error **The family changed. Review the latest data before saving.** PostgreSQL returns snapshot object keys in a different order from the object previously reconstructed during startup. When a new day's assignments needed recording, the string-based expected-state check falsely reported a conflict. Startup now reads one complete snapshot and uses that exact snapshot for the expected-state check. Server revision checks remain unchanged.

The release was built from viewer checkpoint `d5c54fa` in the isolated `turntally-startup-hotfix` worktree, with only `useTurnTally.ts` and its regression test changed. All 173 release web tests, lint, types, and build passed; the main working tree also passed all 185 tests including deferred recovery. Published HTML, JavaScript, and CSS match the tested release; SPA fallback, Auth origin access, disabled signup/anonymous access, and unauthenticated household rejection passed. Recovery remains undeployed. No database migration or direct household mutation was needed. The regression test reproduces database key ordering and verifies new assignments are recorded once across repeated loads. Confirmation in the owner's existing signed-in browser remains pending a page reload.

## Viewer release — September 8, 2026 UTC

Version `c5c94c7f-ce11-4bfb-a9c3-5f6a40159c58` serves the viewer-enabled app. Deployment passed lint, TypeScript, all 172 web tests, the production build, and the hosted configuration guard. Published JavaScript/CSS exactly match the tested build, and SPA navigation fallback passes. The existing bundle-size warning remains.

Supabase's viewer migrations and Edge Function version 1 were deployed first. The owner approved a personal and a shared viewer in two isolated browser sessions. Session persistence, server write rejection, revocation, and disconnect-before-adult-sign-in passed; both test devices are now revoked. The family snapshot and revision were unchanged. See the [viewer release record](viewer-enrollment-release.md) for exact checks and remaining physical-device validation.

## Hosting configuration

`web/wrangler.jsonc` configures `turntally-pilot` in the verified Cloudflare account `752c301d7fbd5e2c737dabd856d618dc`. Workers Static Assets serves Vite's `web/dist` output, with single-page application navigation fallback. The account's new subdomain is `turntally-family.workers.dev`. The live app is [turntally-pilot.turntally-family.workers.dev](https://turntally-pilot.turntally-family.workers.dev). No domain purchase was needed. Version preview URLs are disabled.

Cloudflare documents [free, unlimited static asset requests](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) and [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/). Backend requests, database usage, authentication services, and build services have their own allowances. Selecting this configuration does not change the account's billing plan.

## Validate and deploy

From `web`:

```powershell
npm ci
npm run check
npm run deploy:check
```

The deployment check rebuilds the app and runs Wrangler with `--dry-run`; it does not publish. To preview Cloudflare asset routing locally, run `npm run preview:cloudflare`.

Validated September 7, 2026: lint, TypeScript checks, all 147 web tests, the hosted production build, and the Wrangler 4.129.1 deployment dry run pass. The initial published version is `0bf93c16-6a44-4cc1-9d18-750d6d911e91`, deployed at 23:19 UTC with 100% traffic. Live HTTPS checks confirmed the homepage, JavaScript, and CSS exactly match the tested build, and navigation fallback serves the app. A fresh headless Edge profile rendered the live email/password sign-in form successfully. Supabase Auth accepts the deployed origin, and unauthenticated household reads are rejected. A brief TLS provisioning delay after first deployment resolved before verification completed.

Wrangler was authenticated with `npx wrangler login --device --browser=false`. For subsequent releases, run `npm run deploy`; it checks hosted configuration and runs the full web checks before publishing. Reauthenticate with the device login command if needed. The Cloudflare connector's authenticated session is separate from local Wrangler authentication. Never put credentials in the configuration or a client-side `VITE_*` variable. This is a manual deployment workflow; automatic deployment from GitHub has not been configured in this repository.

The client is publicly reachable, with family data protected by Supabase sign-in and server-enforced household admission. Use the existing owner credentials at the live URL; the family is already stored in Supabase and does not need another import. The owner used the live administrator session for viewer approval; separate physical-device testing remains. The owner disabled public signup, and live Auth settings checks verified that both public signup and anonymous sign-in remain disabled while Email is enabled. Remaining account work and the resolved database-helper permission finding are tracked in the [backend handoff](supabase-backend.md).

## Hosted accounts and sync

Cloudflare hosting and Supabase Auth/PostgreSQL are deployed. Supabase project: `https://trvzxycxwnuodicdkfjp.supabase.co`. The hosted client connects to the existing shared household; see [Supabase backend](supabase-backend.md) for setup and remaining work. The complete milestone must provide:

- Separate authenticated adult accounts and administrator-provisioned, revocable viewer devices without child email addresses.
- Admission limited to the owner's family, with no public signup.
- Server-enforced administrator, editor, and viewer roles and household isolation.
- An explicit preview and confirmation when migrating an existing browser's family data.
- Revision checks that reject stale writes and preserve both reports for conflict resolution.
- Connection status and cached viewing offline, with connected editing as the proposed initial policy.
- Tests for viewer write rejection, household isolation, revocation, migration, and competing edits.

A new hostname has a separate browser storage area and sign-in session. The owner's backup has already been explicitly imported into Supabase, so signing in on Cloudflare loads the same shared family. Other devices see changes after **Refresh**. The local prototype remains available in development using local mode; its profile picker is a role preview, not sign-in.
