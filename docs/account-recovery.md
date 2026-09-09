# Parental account recovery

**Deferred September 8, 2026 at the owner's request:** pause email/domain setup and recovery deployment while continuing the feature roadmap. The implemented recovery flow and tests remain available for a later release.

The parental-access release adds `VITE_TURNTALLY_RECOVERY_ENABLED`, defaulting to false. It hides the request entry point and stops recovery callbacks before creating an Auth client, while still removing credentials from the URL. Set it to true only when preparing the configured recovery release and its live-email acceptance.

Implemented September 8, 2026 UTC. **Not deployed:** the owner confirmed there is no sending domain or custom SMTP service yet. The live pilot remains on the verified viewer release. No live recovery email, password change, Auth configuration change, or household mutation was performed for this implementation.

Follow-up [free-service research](free-email-research.md) identified personal Gmail SMTP as a possible no-domain pilot alternative. A purchased domain is required for the proposed Resend route, not inherently for Supabase SMTP. Sender selection and live delivery verification remain pending.

## Flow

1. Choose **Forgot password?** on parental sign-in and enter the parental account's email.
2. TurnTally requests a Supabase recovery email with a fixed same-origin `/auth/recovery` callback. The response does not disclose whether an account exists, and the screen imposes a 60-second retry cooldown. Supabase's server rate limits remain authoritative.
3. Open the email link in a browser. The static app removes its token fragment from the URL before creating an Auth client, verifies the supplied session with Auth, and displays the new-password form. The default Supabase confirmation-link template is supported; no template customization is required.
4. Enter and confirm a unique password of at least 12 characters. Auth enforces its configured password rules too. The recovery screen does not load family data or provide admission, roster, or role changes.
5. After a successful update, the app requests global sign-out for the recovered account. If that fails, **Finish recovery** retries sign-out without submitting the password again. Already-issued access tokens may remain valid until expiry; this is not immediate removal of other browsers' displayed family data.

Recovery uses an independent, memory-only Auth client. It neither overwrites nor disconnects a viewer or other account already stored in the browser. Returning to TurnTally may therefore resume that existing session. A refresh of the reset page intentionally discards the recovery session and requires another link. Missing, expired, used, or non-recovery links do not borrow an existing login to enable password changes. Viewer identities are directed back to parent pairing; their server-enforced viewer cap remains unchanged even if Auth credentials are modified directly.

## Configure email delivery before release

The owner has not selected a domain or email service. No purchase, subscription, DNS change, or SMTP credential is included in this commit.

1. Choose an SMTP sender. For Resend or another domain-based service, choose a sending domain and verify the provider's required DNS records. For the personal Gmail pilot alternative, follow the account requirements in [free-service research](free-email-research.md). The app can remain at its existing `workers.dev` address.
2. In Supabase **Authentication → Email → SMTP settings**, enable custom SMTP and enter the provider's host, port, username, and password there. Set a verified sender address and a recognizable sender name such as **TurnTally**. Keep credentials out of this repository, chat, and all `VITE_*` variables. Disable provider link tracking for authentication emails.
3. In [the project's Auth URL configuration](https://supabase.com/dashboard/project/trvzxycxwnuodicdkfjp/auth/url-configuration), set Site URL to `https://turntally-pilot.turntally-family.workers.dev` and allow this exact redirect:

   ```text
   https://turntally-pilot.turntally-family.workers.dev/auth/recovery
   ```

   Preserve any other intentionally configured URLs; do not add broad production wildcards. The checked-in `supabase/config.toml` configures only the disposable local stack, not the live project.
4. Keep public signup and anonymous sign-in disabled and the Email provider enabled. Review the project's password policy and rate limits. Recovery does not create memberships or restore revoked family access. Supabase MCP in this workspace does not expose Auth configuration management; use the Dashboard for these settings.
5. Require passing web and native Auth CI checks, then deploy with `npm run deploy` from `web`. Verify `/auth/recovery` is served by Cloudflare's SPA fallback and that a bare URL shows the invalid-link screen.
6. With an explicitly approved test parental account, request one live reset email. Confirm delivery, callback origin, password update, rejection of the old password, sign-in with the new password, and rejection of a reused link. Confirm the account still has its existing family permissions and the household revision/history did not change. Never copy a recovery URL or token into logs, chat, or a bug report.

Supabase's default SMTP is limited to project team addresses, currently two messages per hour, and is not intended for production. Do not add family members to the Supabase project team just to enable their recovery emails. Custom SMTP is needed for ordinary family accounts. See [SMTP configuration](https://supabase.com/docs/guides/auth/auth-smtp), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), and [resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## Validation

`npm run check` in `web` covers reset requests, neutral responses, failures and cooldown, bootstrap isolation under React Strict Mode, URL credential removal, no existing-session fallback, viewer rejection, matching passwords, cleanup retries, and expiry. The native test in `supabase/functions/viewer-devices/auth.integration.test.ts` runs alongside viewer tests in the existing Docker-backed `viewer-auth` CI job. It reads an actual recovery email from local Mailpit, follows the local verification link without logging tokens, changes the password, checks old-password/refresh rejection and link reuse, and verifies recovery cannot grant household admission. It refuses remote Supabase URLs.

The Windows Server workspace has no Docker runtime; native integration runs on GitHub's disposable Ubuntu stack. SMTP setup and the final live-email acceptance remain release requirements.
