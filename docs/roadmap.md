# TurnTally roadmap

*Agreed feature sequence · September 7, 2026; viewer deployment updated September 8 UTC. Role defaults, initial release audience, Cloudflare hosting, and the Supabase backend are settled. Viewer enrollment is live; recovery, offline behavior, and remaining sync work follow.*

## Agreed direction

- Keep the daily experience concise, with independent seating and chore rotations.
- Parents and adult children can edit; minor children can view only.
- Adult children default to editor access, with family and access administration reserved for administrators.
- Release to the owner's family first. A limited invite list may follow if explicitly chosen; public self-service signup is out of scope.
- Add hosting and shared data across devices.
- Use Cloudflare's free tier for pilot hosting.
- Use Supabase Auth and PostgreSQL for the backend.
- Target iOS and Android app stores, replacing the historical web-only distribution constraint.

## Agreed permission defaults

| Role | View assignments and history | Edit activities and outcomes | Manage members, roles, access, and destructive household actions |
|---|---|---|---|
| Parent / administrator | Yes | Yes | Yes |
| Adult child / editor | Yes | Yes | No |
| Minor child / viewer | Yes | No | No |

Administrator is an authority level, not a requirement to participate in chores. A person can belong to the family without joining any rotation. Keep family identity separate from sign-in credentials.

Parents assign roles explicitly; do not infer edit access from a name, self-selected profile, or birthday. Adult children default to editors and cannot promote themselves. Viewer mode includes history and explanations but no corrections, confirmations, absence reports, configuration edits, imports, or resets. An administrator can later promote a viewer to editor. Preserve at least one administrator.

Recommended account approach: separate adult sign-ins and parent-provisioned, revocable viewer access on children's devices without requiring child email addresses. The approved [viewer enrollment design](viewer-enrollment.md) uses device-displayed pairing codes approved by a signed-in parent, supports personal and shared devices, and has no scheduled reapproval. It is deployed with passing native Auth CI and hosted personal/shared browser acceptance. Switching to an adult profile on a shared device requires disconnection and authentication.

## Feature sequence

1. **Family management and role model — implemented locally.** Add and rename members, deactivate/reactivate members without losing history, assign parent/editor/viewer roles, and select activity participation separately. Membership changes apply prospectively. Permission checks cover application actions as well as the interface. Local checks remain a prototype guardrail until server authentication and authorization arrive in item 4.
2. **Activity lifecycle and backups — implemented locally.** Archive and restore activities while preserving history, download a versioned JSON backup, and validate/preview a restore before replacing data. Editors and administrators can archive, restore activities, and export. Replacing an existing family requires its current administrator; an empty browser can recover from a backup during setup.
3. **Absence ranges — implemented locally.** Mark a person away across selected activities with inclusive first/last dates. Weekly chores check attendance on the turn's start date; midweek departures or returns do not split a turn. Editors and administrators can plan absences, cancel future plans, and end ongoing absences after today. Viewers can read them. Recorded history and explicit outcomes are preserved.
4. **Hosted accounts and device sync.** Select hosting, add adult sign-in and child viewer enrollment, enforce household isolation and roles on the server, migrate local data explicitly, synchronize changes, show connection state, and resolve conflicting edits without silently discarding either report. Admission starts with the owner's family only, with no public signup. Design for a later optional, limited invite list. Test write rejection for viewers and isolation between families before expanding access. Recommended first release: cached viewing offline, editing while connected; offline edit queues can follow.
5. **Installable web beta.** Add home-screen installation, test phones and shared devices, test recovery and revocation, and run the parent-and-child usability walkthrough against real family use.
6. **iOS and Android releases.** Package the web app, test native authentication/storage/navigation, prepare store listings and screenshots, privacy disclosures, account/data deletion, child-audience declarations, beta distribution, signing, and release builds. Verify store rules again at submission.
7. **History calendar.** Browse past turns in a calendar, filter by activity, and open a day to see assignments, who actually took the turn, absences, and corrections. Make weekly chore spans clear without counting each day as a separate turn. All roles can view history; editors and administrators retain the existing correction permissions. Choose the initial calendar layout before implementation.

## Hosting decision and distribution proposal

Hosting delivers the app; a shared backend stores and authorizes family data. Hosting the existing local-storage app alone does not synchronize devices.

Cloudflare is the selected hosting vendor for the pilot, using its free tier. The deployment configuration uses Workers Static Assets to serve the existing Vite build. Static asset requests are [free and unlimited](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/); dynamic backend services have separate limits. See the [Cloudflare pilot setup](cloudflare-pilot.md) for configuration, validation, and rollout details.

Supabase is the selected backend for authentication, database storage, and server-enforced household roles. The project is `trvzxycxwnuodicdkfjp`. The [backend setup](supabase-backend.md) covers the initial implementation, provisioning, and remaining milestone work. Its [row-level security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) describes database access policies integrated with authentication.

Retain React and evaluate [Capacitor](https://capacitorjs.com/docs) for iOS and Android packaging. Store distribution still needs native testing and review; packaging is not an approval guarantee. iOS builds require the [Xcode toolchain](https://capacitorjs.com/docs/getting-started/environment-setup), using a Mac or an appropriate hosted macOS build environment.

Current planning costs: [Apple Developer Program](https://developer.apple.com/programs/enroll/) membership is USD 99 per year, and [Google Play registration](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en) is USD 25 once. New personal Google Play accounts are subject to [closed-testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB), currently at least 12 opted-in testers for 14 continuous days before applying for production access. Hosting and build services are separate costs. These facts were checked September 7, 2026.

## Hosted setup checkpoint — September 7, 2026

Historical initial setup; the viewer checkpoint below supersedes its pending deployment and helper-permission notes.

Cloudflare deployment is live at [turntally-pilot.turntally-family.workers.dev](https://turntally-pilot.turntally-family.workers.dev). HTTPS assets, navigation fallback, Supabase cross-origin Auth access, and rejection of unauthenticated household reads passed verification. The owner should now sign in at this URL using the existing account, without another import. Public signup and anonymous sign-in are both verified disabled; Email is enabled. See the [deployment record](cloudflare-pilot.md).

Supabase MCP access is verified and initial migration `20260907225429` is applied. The local hosted client is configured and builds successfully. All 147 tests pass, with live database privilege and unprovisioned-access checks also passing. The owner completed sign-in and JSON backup import; database verification confirmed revision 1 with 6 people, 5 activities, 6 history events, and an active administrator linkage. The owner's database load function returns the saved family successfully. The owner also confirmed that a second browser session loaded the existing family and received another session's edit after **Refresh**. Parent-managed viewer enrollment/revocation is now implemented locally; see the [viewer release checklist](viewer-enrollment-release.md) for the passing native Auth integration result and remaining deployment checks. Live competing-edit tests, separate physical-device testing, Auth settings, and the pre-existing `rls_auto_enable` helper's permissions still need verification. See the [backend handoff](supabase-backend.md#current-handoff--september-7-2026) for details and remaining feature 4 work.

## Viewer enrollment checkpoint — September 8 UTC

Milestone 4 step 1 is approved and step 2 is deployed: expiring pairing codes, personal/shared device identities, parent device management, transactional revocation, viewer access checks, and disconnect-before-adult-sign-in. All 172 local web tests and Edge type checking pass. Native Supabase Auth passed in [CI run 34175990406](https://github.com/foxnei1/turn-tally/actions/runs/34175990406), along with web and Python checks. The owner approved live personal/shared browser pairing; session persistence, server write denial, revocation, and adult-switch disconnection passed. Both test enrollments are revoked, with family data unchanged. The automatic-RLS helper's unnecessary client privileges are removed and its trigger still works. See the [deployment record](viewer-enrollment-release.md).

Adult password recovery is implemented with an isolated reset session and automated tests. The owner deferred email setup and recovery deployment on September 8, 2026; SMTP sender selection and live-email acceptance remain pending. See [account recovery setup](account-recovery.md). Remaining admission controls are next, then durable offline viewing and sync/conflict improvements. Separate physical-device validation, concurrent network redemption, and full server domain validation remain before broader distribution; milestone 4 as a whole is still in progress.

## Decisions to settle next

- [Adult account access](adult-access.md) is deployed with passing web, Python, and native Auth CI: authenticated linking codes, parent approval, account revocation, and fresh-sign-in requirements for reapproval. Supabase migration and viewer service updates are live, followed by Cloudflare version `aa50266b-7474-4b7f-b442-bed568182e9f`. Initial adult account creation remains operator-managed while email setup is deferred. Hosted acceptance with another provisioned adult is the next manual check.
- For item 4: finish offline behavior, synchronization, and remaining validation. Email setup and recovery are deferred at the owner's request and disabled in the deployed app. Cloudflare hosting, Supabase backend, viewer enrollment, and adult access management are deployed for the family pilot.
- Before item 6: confirm store account ownership and access to iOS build/test infrastructure.

## Feature 1 acceptance criteria

Implemented September 7, 2026. The web checks pass with 73 tests, including direct action permission tests and the family-management interface. This completes the local scope; authenticated access remains item 4.

- A Family screen lets an administrator add, rename, and deactivate members without resetting activity history.
- Parent, adult-child, and minor-child defaults map to administrator, editor, and viewer permissions respectively. An existing household must explicitly identify its administrator; roster position must not silently grant that authority.
- Editors can manage activities and report outcomes but cannot manage family membership, change permissions, or reset the household.
- Viewers can read all family assignments, history, and explanations. They cannot mutate data through interface controls or application actions.
- Family membership and activity participation remain separate. Deactivation preserves old records and changes future participation prospectively; access revocation takes effect immediately once authenticated access exists.
- The last active administrator cannot be removed or demoted without a replacement.
- Existing seating and chore data survives the upgrade, and tests cover role restrictions and historical preservation.
- Prototype profile controls are identified as local controls. Authenticated sessions and server-enforced authorization belong to item 4 and are required before distributing restricted access to other devices.

Rewards, allowance, groceries, meal planning, reminders, carpooling, and packing lists remain deferred.

## Feature 1 behavior and limits

- Existing households explicitly choose an administrator from the roster or add a parent outside all activities. Other existing members start as viewers until the administrator assigns their roles. No member receives administration from roster position.
- The Family screen supports adding, renaming, role changes, deactivation, and reactivation. New and reactivated people are not automatically enrolled in activities.
- Deactivation immediately removes a person from the local profile picker. Participation ends at each activity's next turn boundary, preserving current turns and prior corrections. Pending schedule edits survive. Activities with too few participants record no assignment and show “Needs participants.”
- Every user edit action checks the stored role, so a stale editor view cannot save after the role is revoked. Automatic assignment recording is still a system operation when loading the app; it does not allow viewers to choose or correct outcomes.
- The local profile picker is deliberately unauthenticated, is labeled as a prototype, and requires a selection after refresh. Anyone with access to the browser can select another profile or alter local storage. It is not suitable for distributing restricted child access until authenticated sessions and server authorization are built.

## Feature 2 behavior and limits

- Archive an activity from its detail screen. It moves to the collapsed Archived activities list and retains its recorded turns, balances, and corrections. Editors may still correct archived history, but settings edits require restoring the activity first.
- The current daily or weekly turn is preserved. No subsequent turns are generated during the archive period. Restoring while that original turn is still underway keeps it; restoring after the gap resumes with a turn on the restore date. A resumed weekly rotation uses that date as its new seven-day boundary.
- Backups contain the complete configuration and event history, including roles, inactive members, archived activities, and future configuration revisions. The format is identified as `turntally-backup`, version 1. Files are plain JSON, limited to 10 MB; no encryption or cloud backup is included.
- Import validates types, supported schema version, dates, IDs, roles, participants, archive periods, and replay consistency. It rejects unsupported event types, invalid references, duplicate IDs, and conflicting corrections. Large scheduling ranges are rejected to keep validation bounded.
- The preview compares current and incoming counts and lists incoming members and activities. An explicit checkbox and replacement action are required. Restoring replaces the entire local household rather than merging files. Unreported active turns after an older backup are counted as planned.
- Permission checks use the current household, not roles asserted by the uploaded file. A fresh browser with no household may bootstrap from a backup. After restoration the local profile selection is cleared.
- Configuration and events now share one atomic local-storage snapshot. Legacy keys are read and migrated on the next successful write. A failed storage write leaves the previous data intact; a changed household invalidates a stale restore preview.
- Device sync and authenticated authorization remain feature 4.

## Feature 3 behavior and limits

Implemented September 7, 2026. All 127 web tests, lint, type checking, and the production build pass.

- Open **Absences** to plan time away for an active family member across selected active activities. Both dates are included. Ranges start today or later; older turns are corrected through the activity's History.
- Weekly attendance uses the turn's start date. An absence beginning midweek does not change that week's responsibility. An absence that includes the start date skips that entire turn even if the person returns midweek. Whole-turn corrections remain available for exceptions; partial-week splitting is out of scope.
- New plans apply to turns starting today and future turns. Today's automatically counted turn can receive a saved replacement while retaining its original assignment. Explicitly reported outcomes, including manual attendance corrections, take precedence over plans for that turn. The range resumes at the next applicable turn.
- Away participants are excluded from the activity's balance changes. Overlapping ranges count them away once. If too few people are available, no turn is counted. Nonparticipants are unaffected; the range applies if they join a selected activity during its dates. Roster revisions and archive periods still govern which turns exist.
- **Cancel absence** removes a plan that has not begun. **End after today** shortens an ongoing plan through today. Both ask for confirmation. Turns already started remain intact, including the rest of a weekly turn. Other overlapping ranges still apply. To change today's attendance, correct that activity's turn; to extend an absence, add another range.
- Recorded assignments store attendance so later changes to plans cannot rewrite history. Plan changes and any current-turn correction commit in one local-storage snapshot with a stale-state check. Failed writes preserve the original configuration and events.
- Backups include plans and recorded attendance, with validation of dates, people, activities, and unique range IDs. Older backups without ranges still load.
- Editors and administrators can manage absences. Viewers can read current, upcoming, and past ranges, with mutation restrictions also enforced in application actions. These remain local prototype role checks until feature 4.
- Feature 4, hosted accounts and device sync, is next. History calendar has been added as feature 7.
