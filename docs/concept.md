# TurnTally

*Current product direction · September 2026*

TurnTally remembers whose turn it is and adjusts when someone else takes a turn.

Families open the app to see who has each activity today. They only need to make a change when the day goes differently. Seating and chores use the same simple pattern, with separate turns for each activity.

## Everyday use

The overview lists activities and their current person. Opening one shows the dates, activity, and person's name:

> Today’s middle seat: Elena
>
> We’ll count this as Elena’s turn unless you change it.
>
> Change who took it

There is no daily confirmation requirement. One seating turn covers the whole day. Days without a report count as planned, including days when the app was not opened.

The correction menu offers family members, “No trip this day,” “An adult took the seat,” and “Someone is away.” Changes can also be made from history.

Chores use “Change who did it,” “Not needed this turn,” and “Someone outside this activity covered.” A weekly correction describes the entire week's responsibility. Partial-week sharing is not supported yet.

## Configure activities

Add kitchen duty, bathroom cleaning, living room cleaning, dining room cleaning, or a custom chore. Choose the participants, daily or weekly turns, the first person, and a start date of today or later. Kitchen duty defaults to daily, and the cleaning suggestions default to weekly. Weekly turns last seven days from the selected start date rather than automatically starting on Monday.

Names can be edited immediately. Schedule and participant changes take effect when the next turn begins. The current turn and old records keep their original roster and schedule, and past corrections use the participants eligible at that time. Chores can have one participant; seating needs at least two and remains daily.

## Rules a family can explain

- **A sibling takes the seat:** that sibling gets the credit. The original person remains due, unless they were away.
- **No trip:** skip the day. Nobody gets credit or owes extra turns.
- **An adult takes the seat:** skip the family turn, with no credit or penalty.
- **Someone is away:** leave them out of this activity for the entire turn: one day or one week. Their existing balance stays unchanged. Choose from the people present. Seating needs two people present; a chore needs one. Planned absence ranges apply automatically to subsequent turns.
- **A tie:** choose the person who has waited longest, then use the family's starting order.
- **Repeated turns:** normally give someone a break after two turns in a row. If everyone present hits that limit, choose from those present.

A skipped day does not erase a run of consecutive turns. An absence does not add catch-up debt, but it does not erase a turn already owed before leaving.

Once a turn has been shown, a correction to an earlier day does not silently change it. Marking the assigned person away is an explicit request to choose a replacement. That replacement is saved too.

## Explain the assignment

“Why Elena?” opens a short reason based on the state before today's turn. For example, Elena may have waited longest among people equally due, or the starting order may have broken a tie. If an older correction means the assignment would now be different, explain that the displayed assignment was kept.

Corrections show who actually took the seat. History distinguishes turns counted as planned from explicitly recorded outcomes. Decimal balances are implementation details, not part of the daily screen.

## Each activity stands on its own

Activities keep independent turn histories and balances. Taking the middle seat does not change who does dishes or cleans the bathroom. There is no exchange rate between activities.

The web app implements seating and daily or weekly chores. Each internal balance tracks the share of that activity each present person has taken. These calculations remain separate.

Families choose the starting person for each activity, so they can spread initial assignments out. The app does not automatically distribute total workload across different activities. Cross-activity workload balancing requires a separate product decision and user validation.

## Scope

The [agreed roadmap](roadmap.md) now includes local family roles: parents default to administrators, adult children to editors, and minor children to viewers. Initial hosted access will be limited to the owner's family; a limited invite list can be added later if chosen. Public signup is out of scope. iOS and Android store distribution is a later milestone.

The current iteration includes setup, an activity overview, activity configuration, daily and weekly turns, corrections, absences per activity and turn, explanations, and recent history. Data stays in one browser. Setting up a different family clears all that browser's activities and prototype history after confirmation.

Family management supports adding, renaming, role changes, deactivation, and reactivation. Deactivation removes future participation at each activity's next turn while retaining current turns and history. Activities without enough people wait until participants are added. New and reactivated members are not automatically enrolled in activities. The last active administrator cannot be demoted or deactivated.

On upgrade, choose an administrator explicitly or add a parent without joining them to activities. Other existing members initially become viewers. Administrators can then assign roles in Family. Editors can change activities and outcomes, but cannot manage members, roles, or household resets. Viewers can read assignments, explanations, and history.

In local prototype mode, profile switching is unauthenticated. Application actions check the selected profile's stored role, but anyone using the browser can switch profiles. The hosted pilot uses provisioned Supabase sign-ins linked to family members, with server-enforced household and role checks. Parent-managed viewer device enrollment remains to be implemented.

Editors and administrators can archive activities, restore them, and download a backup. Archived activities stay out of the main list while retaining history. The original current turn is kept, and no subsequent turns count during the archive period. Restoring resumes the current original turn if it is still underway, or starts a new turn on the restore date after a gap.

Backups contain family members, roles, activities, archives, and history in a versioned JSON file. Replacing an existing household requires its current administrator and a validated preview with explicit confirmation. An empty browser can restore a backup during setup. Imports replace rather than merge data and require choosing a local profile again. Backups are plain files, not encrypted or automatically synchronized.

Absence ranges let editors and administrators select a person, activities, and inclusive dates starting today or later. Weekly attendance is decided on the first day of each turn; midweek departures and returns do not split it. New ranges can update today's automatically counted turns but keep explicit reports and earlier history. Overlaps count a person away once. Upcoming plans can be canceled; ongoing plans can end after today while preserving turns already started. Viewers can read plans, and backups include them.

The hosted pilot stores shared family data in Supabase. Other sessions load changes with **Refresh**, and revision checks reject conflicting saves. Automatic sync notifications, offline viewing, and the remaining account/device workflows are still planned, followed by web beta and app-store releases. A history calendar is planned as feature 7. Rewards, allowance, groceries, meal planning, reminders, carpooling, and packing lists are deferred. They are not part of the first-version promise.

## Existing data and reference code

Existing browser assignments and corrections remain readable. Historical `outside-cover` events retain the old penalty so upgrading does not rewrite past records. The UI labels that old rule; changing the record to “An adult took the seat” explicitly replaces it with the neutral policy. New corrections never create an `outside-cover` event.

The Python engines and their tests are historical validation of the [v4.2 shared-balance design](concept-v4.2.md). The TypeScript reducer and web tests define the current seating behavior. Porting additional Python behavior requires checking it against these revised rules.

## Next usability check

Show a parent and child three scenarios: a normal day, a sibling covering, and someone away. Ask who they think should go next and why. Also ask them to record a day without a trip. Check whether they can complete each change without learning the internal balance formula.
