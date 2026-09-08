# Supabase backend

Selected September 7, 2026 alongside Cloudflare hosting for the free-tier family pilot.

- Project URL: `https://trvzxycxwnuodicdkfjp.supabase.co`
- Project reference: `trvzxycxwnuodicdkfjp`
- GitHub connection: reported connected by the owner; remote settings have not been inspected from this session.

## Implementation

`supabase/migrations/20260907225429_household_sync.sql` creates household snapshots, explicit account-to-person memberships, and two authenticated RPCs. No public household creation or membership mutation endpoint exists. Tables have row-level security enabled and direct client privileges revoked. The narrowly granted security-definer RPCs use an empty search path and derive identity from `auth.uid()`. Foreign-key indexes cover owner and household lookups.

`turntally_load` returns only the caller's provisioned household. Membership revocation, inactive people, and current roles are checked from stored data. `viewer_only` caps a provisioned identity at viewer access even if the person's role is later promoted. The deployed viewer-device migration uses that cap for personal and shared browser enrollments.

`turntally_save` locks the household, rechecks membership, verifies the expected revision, and writes configuration and history atomically. Viewers cannot write. Editors cannot change family identities or roles, replace the household, or remove/modify existing history events. Administrators can restore validated backups, but must preserve linked person IDs and an active administrator with a linked sign-in. Clearing a hosted family is disabled.

The client uses the existing bounded backup and rotation replay validator. Database validation covers snapshot shape, size, people, roles, unique event IDs, and allowed event types; full rotation/replay semantics are currently validated in the client, not reproduced in SQL. Complete server-side domain validation remains rollout work.

Hosted mode provides email/password sign-in for provisioned adult accounts and removes the local profile selector. The owner's first sign-in previews a backup or existing data from the same browser origin, then explicitly links the chosen administrator and initializes the shared household. Local storage is not cleared. Existing backup restores use a separate administrator-only operation.

Reads within an edit use a consistent cached revision. Other devices' changes are loaded with **Refresh**; this remounts the family view, so finish or cancel an open edit first. A stale write is rejected without an automatic retry. Its attempted snapshot remains in memory and can be downloaded before refreshing. The download is a full attempted family backup, not an automatic merge; review and reapply the intended change against the latest family. Closing the tab or signing out discards the in-memory attempt.

This implementation requires connectivity for loading and saving. An open page can continue displaying already loaded data while offline, but there is no durable offline cache or offline edit queue. Viewer devices additionally discard displayed data on a failed access heartbeat. Account recovery, physical-device validation, automatic sync notifications, and complete server domain validation remain milestone 4 work.

The approved [viewer enrollment design](viewer-enrollment.md) is deployed in migration `20260908040813_viewer_devices.sql`, the `viewer-devices` Edge Function, and the hosted parent/viewer screens. The [release instructions](viewer-enrollment-release.md) record passing native Auth integration and hosted personal/shared browser acceptance. `turntally_access` checks current authorization without advancing the client's open snapshot revision; shared viewer identities remain separate from roster members.

## Viewer deployment — September 8, 2026 UTC

- Applied viewer migration `20260908040813` and helper-permission migration `20260908040814`; repository filenames match the remote migration history. Edge Function `viewer-devices` version 1 is active. Cloudflare version `c5c94c7f-ce11-4bfb-a9c3-5f6a40159c58` serves the corresponding frontend.
- The Edge Function bundles the exact public pilot origin as its default allowlist. `VIEWER_ALLOWED_ORIGINS` can override it; managed Supabase runtime credentials remain server-side. `VIEWER_TRUSTED_IP_HEADER` is unset. Public and anonymous signup remain disabled.
- Owner-approved personal/shared browser pairing, persisted sessions after refresh, direct viewer write/management denial, old-token read denial after revocation, displayed-data clearing, and disconnect-before-adult-sign-in passed. Both temporary enrollments are revoked and their browser sessions cleared. The household snapshot and revision 5 were unchanged; owner membership remains active.
- The pre-existing `public.rls_auto_enable()` event-trigger helper no longer grants execution to public, anonymous, or authenticated clients. Its owner/service privileges and `ensure_rls` trigger remain intact. A rolled-back live table-creation probe verified automatic RLS still works; the anonymous definer advisory is resolved.
- The remaining [authenticated definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) applies to the intentionally guarded `turntally_save`. RPC-only tables intentionally have [RLS without client policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Performance advisors report only [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Auth advisors also report [leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); that existing setting was not changed.
- Local release validation passed 172 web tests, including 20 PostgreSQL authorization tests, lint, types, build, and frozen Edge type checking. Native Auth CI covers personal deactivation/reactivation and refresh behavior without changing the live roster. Account recovery, durable offline viewing, sync notifications, full server domain validation, separate physical-device testing, and concurrent network redemption remain outstanding.

## Connect development access

Supabase's [official MCP server](https://supabase.com/docs/guides/ai-tools/mcp) supports browser authentication and project scoping. For this project:

```powershell
codex mcp add supabase --url "https://mcp.supabase.com/mcp?project_ref=trvzxycxwnuodicdkfjp"
codex mcp login supabase
```

The same URL can be entered as an HTTP server in Codex MCP settings. GitHub integration, MCP developer access, and the app's publishable key are separate connections. MCP access was verified September 7, 2026 against the expected project. The initial migration was applied successfully; its local filename matches the remote migration version `20260907225429`.

## Current handoff — September 7, 2026

Historical initial setup record; the September 8 deployment above supersedes its viewer and helper-permission status.

- The database was empty before setup. Both TurnTally tables now exist with RLS enabled and no direct `anon` or `authenticated` table privileges. The load/save RPCs deny anonymous execution. Live transaction-scoped checks confirmed unprovisioned authenticated reads and writes are rejected, without leaving test data.
- `web/.env.local` configures hosted mode using the project's active publishable key and is ignored by Git. The tested build is deployed at [turntally-pilot.turntally-family.workers.dev](https://turntally-pilot.turntally-family.workers.dev), version `0bf93c16-6a44-4cc1-9d18-750d6d911e91`. Live HTTPS assets and navigation fallback passed verification. Supabase Auth accepts the deployed origin and unauthenticated household reads are rejected. The build reports a bundle-size warning for the hosted client.
- The owner completed sign-in and JSON backup import. Live database verification found revision 1 with 6 people, 5 activities, and 6 history events; the later sync edit advanced it to revision 2. The account is linked to an active administrator profile with active membership and no viewer-only restriction. A transaction-scoped `turntally_load` call using the owner's identity and the `authenticated` database role returned the saved snapshot and administrator role. After the owner disabled public signup, the live Auth settings endpoint independently confirmed signup and anonymous sign-in are disabled, with Email enabled. Do not put the account password in these notes or chat.
- The owner confirmed the second-browser-session test passed: sign-in loaded the existing family without another import, and an edit in one session appeared after **Refresh** in the other. Initial sign-in/import and manual synchronization across two browser sessions are now owner-verified, with database persistence independently verified. Live competing-edit tests and testing on separate physical devices remain outstanding. Parent-managed viewer enrollment/revocation now has a local implementation; its native Auth integration check passed in Docker-backed CI, with deployment still pending.
- Security advisors flag the project's pre-existing `public.rls_auto_enable()` helper as executable by anonymous and authenticated roles. Review its purpose and revoke unnecessary client execution before rollout; this session did not change that helper. See [anonymous definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
- The TurnTally RPCs also trigger the [authenticated definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable): their privileged execution is intentional and guarded by stored membership, roles, revision checks, and an empty search path. [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is intentional for these RPC-only tables. Performance advisors report only [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) on the new empty tables.
- Viewer integration/deployment validation, account recovery, durable offline viewing, sync notifications, and complete server domain validation remain feature 4 work.

## Configure and provision

1. Inspect existing migrations and tables in the connected project before applying migrations. The initial migration is already applied to this project; do not reapply it. The repository migration has also been tested in embedded PostgreSQL, using test versions of Supabase's auth schema and roles; this is not an end-to-end test of hosted Supabase Auth or PostgREST.
2. Disable public user signup and anonymous sign-in in Supabase Auth. Provision the owner's adult email/password account through Supabase administration. No invitations or emails are sent by these setup files. Password recovery remains unimplemented; viewer enrollment must pass the release checks before distributing the pilot.
3. With the migration applied, use an authenticated administrative SQL session to create the pilot household and owner membership, replacing the placeholder with the actual Auth user UUID:

```sql
begin;
with family as (
  insert into public.turntally_households (owner_user_id)
  values ('OWNER_AUTH_USER_UUID'::uuid)
  returning id, owner_user_id
)
insert into public.turntally_memberships (user_id, household_id)
select owner_user_id, id from family;
commit;
```

4. Copy `web/.env.example` to `web/.env.local`. Set `VITE_SUPABASE_PUBLISHABLE_KEY` to the project's **publishable** key (`sb_publishable_...`). The URL is already filled in. Never use a secret or service-role key in the browser. Keep local prototype mode by leaving these settings absent or explicitly setting `VITE_TURNTALLY_MODE=local`.
5. Start the app, sign in as the owner, preview the family backup, choose the matching administrator, and confirm migration. This initializes only the provisioned empty household and rejects a second initialization.
6. Provision other adult Auth accounts and link each to the same household and its existing person ID through an administrative SQL session. Do not infer roles from emails or roster position. Adult account linkage remains operator-managed. The hosted Devices screen manages viewer enrollments only.

```sql
insert into public.turntally_memberships (user_id, household_id, person_id)
values ('ADULT_AUTH_USER_UUID'::uuid, 'PILOT_HOUSEHOLD_UUID'::uuid, 'EXISTING_PERSON_ID');
```

An administrator can deactivate a family member through the app; subsequent server reads and writes will reject that identity. To revoke a specific provisioned login through administration:

```sql
update public.turntally_memberships set revoked_at = now()
where user_id = 'AUTH_USER_UUID_TO_REVOKE'::uuid;
```

## Validation and release status

The viewer implementation adds browser-flow, Edge coordinator, and database tests plus a pinned Deno type check. The native Auth test runs only against the disposable local stack in `viewer-auth` CI; Docker is not installed in this Windows Server workspace, but that integration passed on GitHub's Ubuntu runner in [CI run 34175990406](https://github.com/foxnei1/turn-tally/actions/runs/34175990406). See [viewer release instructions](viewer-enrollment-release.md) before deployment.

Validated locally September 7, 2026: all 147 tests pass, along with lint, TypeScript checking, and the production build. After adding foreign-key indexes and matching the migration filename to the deployed version, all 10 database tests pass again. The hosted production build and deployment configuration guard pass with the project's actual publishable key; this verifies bundling and configuration, not live authentication.

Run `npm run check` in `web`. The suite includes real PostgreSQL execution through PGlite for household isolation, anonymous/unprovisioned denial, viewer write rejection, editor escalation rejection, revoked access, revision conflicts, history preservation, and owner-only initialization. Client tests cover conflict retention, failed saves, role-bound rendering, and sign-in without signup.

`npm run deploy` refuses to publish unless hosted mode, the intended project URL, and a publishable key are configured. `npm run deploy:check` remains an offline packaging dry run and does not prove Supabase credentials, migration deployment, Auth settings, or family admission. Remote integration tests and the remaining account/device workflows must be completed before sharing the family pilot.

References: [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions).
