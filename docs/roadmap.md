# TurnTally roadmap

*Agreed feature sequence · September 7, 2026. Role defaults and initial release audience are settled. Infrastructure choices below remain proposals.*

## Agreed direction

- Keep the daily experience concise, with independent seating and chore rotations.
- Parents and adult children can edit; minor children can view only.
- Adult children default to editor access, with family and access administration reserved for administrators.
- Release to the owner's family first. A limited invite list may follow if explicitly chosen; public self-service signup is out of scope.
- Add hosting and shared data across devices.
- Target iOS and Android app stores, replacing the historical web-only distribution constraint.

## Agreed permission defaults

| Role | View assignments and history | Edit activities and outcomes | Manage members, roles, access, and destructive household actions |
|---|---|---|---|
| Parent / administrator | Yes | Yes | Yes |
| Adult child / editor | Yes | Yes | No |
| Minor child / viewer | Yes | No | No |

Administrator is an authority level, not a requirement to participate in chores. A person can belong to the family without joining any rotation. Keep family identity separate from sign-in credentials.

Parents assign roles explicitly; do not infer edit access from a name, self-selected profile, or birthday. Adult children default to editors and cannot promote themselves. Viewer mode includes history and explanations but no corrections, confirmations, absence reports, configuration edits, imports, or resets. An administrator can later promote a viewer to editor. Preserve at least one administrator.

Recommended account approach: separate adult sign-ins and parent-provisioned, revocable viewer access on children's devices without requiring child email addresses. The precise viewer enrollment mechanism remains to be designed with authentication. Switching to an adult profile on a shared device must require authentication.

## Feature sequence

1. **Family management and role model — implemented locally.** Add and rename members, deactivate/reactivate members without losing history, assign parent/editor/viewer roles, and select activity participation separately. Membership changes apply prospectively. Permission checks cover application actions as well as the interface. Local checks remain a prototype guardrail until server authentication and authorization arrive in item 4.
2. **Activity lifecycle and backups.** Archive and restore activities, preserve history, export a versioned backup, and preview/validate an import before replacing data. Keep imports and household deletion administrator-only under the agreed permissions.
3. **Absence ranges.** Mark a person away across selected activities for a date range. Define partial-week behavior before implementation; the current weekly correction covers the entire turn.
4. **Hosted accounts and device sync.** Select hosting, add adult sign-in and child viewer enrollment, enforce household isolation and roles on the server, migrate local data explicitly, synchronize changes, show connection state, and resolve conflicting edits without silently discarding either report. Admission starts with the owner's family only, with no public signup. Design for a later optional, limited invite list. Test write rejection for viewers and isolation between families before expanding access. Recommended first release: cached viewing offline, editing while connected; offline edit queues can follow.
5. **Installable web beta.** Add home-screen installation, test phones and shared devices, test recovery and revocation, and run the parent-and-child usability walkthrough against real family use.
6. **iOS and Android releases.** Package the web app, test native authentication/storage/navigation, prepare store listings and screenshots, privacy disclosures, account/data deletion, child-audience declarations, beta distribution, signing, and release builds. Verify store rules again at submission.

## Hosting and distribution proposal

Hosting delivers the app; a shared backend stores and authorizes family data. Hosting the existing local-storage app alone does not synchronize devices.

Supabase is the proposed backend for authentication, database storage, and server-enforced household roles. Its [row-level security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) describes database access policies integrated with authentication. Choose a managed static web host separately. Provider selection and operating budget are not yet final.

Retain React and evaluate [Capacitor](https://capacitorjs.com/docs) for iOS and Android packaging. Store distribution still needs native testing and review; packaging is not an approval guarantee. iOS builds require the [Xcode toolchain](https://capacitorjs.com/docs/getting-started/environment-setup), using a Mac or an appropriate hosted macOS build environment.

Current planning costs: [Apple Developer Program](https://developer.apple.com/programs/enroll/) membership is USD 99 per year, and [Google Play registration](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en) is USD 25 once. New personal Google Play accounts are subject to [closed-testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB), currently at least 12 opted-in testers for 14 continuous days before applying for production access. Hosting and build services are separate costs. These facts were checked September 7, 2026.

## Decisions to settle next

- Before item 4: choose viewer device enrollment, hosting budget, and the initial offline policy.
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
