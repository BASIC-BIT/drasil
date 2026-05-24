# Manual QA Cards

These cards are the release smoke test for Drasil moderation and reporting changes. They are intentionally concrete: configure the server, perform the action, record the expected result, and stop on serious surprises.

Severity:

- `P0`: Blocks release or production rollout.
- `P1`: Should fix before relying on the feature broadly.
- `P2`: Nice to verify, useful for polish or confidence.

Evidence to collect:

- Screenshot of the relevant Discord alert, thread, or command response.
- Bot log excerpt for failures.
- Database row IDs only when needed for debugging; do not paste secrets.
- CloudWatch query result for production deploy checks.

## Test Accounts

Do not use a primary personal account for ban/restrict testing.

Minimum accounts:

- Moderator account with access to the admin/observed channel.
- Reporter account for report submission.
- Reported-user sacrificial account for restrict/ban tests.

Minimum guilds:

- One staging guild for local report and moderation flows.
- Two managed staging guilds for high-confidence external report testing: one opted out, one opted in.

Reduced-confidence fallback:

- If only one managed guild is available, run local report cards and defer external trust-boundary sign-off.

## Batch A: Server Preflight

1. **Discord Permission Matrix** (`P0`)

   Config:
   - Dedicated staging guild.
   - Bot role above the restricted role.
   - Admin/observed channel visible to moderators and bot only.
   - Verification channel where the bot can create private threads.

   Do:
   - Confirm the bot has `Manage Roles`, `Ban Members`, `View Channels`, `Send Messages`, `Manage Threads`, and `Create Private Threads`.
   - Confirm privileged intents are enabled in the Discord Developer Portal: Server Members Intent and Message Content Intent.
   - Run the normal setup/config commands for restricted role, admin channel, and verification channel.

   Expect:
   - Bot config commands succeed.
   - Bot can post in the admin/observed channel.
   - No `Missing Access` or `Missing Permissions` error appears in logs.

   Watch for:
   - Channel overrides denying thread creation.
   - Bot role below restricted role.
   - Bot role unable to ban the sacrificial account.

2. **Database And Startup** (`P0`)

   Config:
   - `DISCORD_TOKEN`, `DATABASE_URL`, and `OPENAI_API_KEY` configured for the test environment.
   - Prisma migrations deployed.

   Do:
   - Run `npm run build`.
   - Run `npm test`.
   - Start the bot for the staging environment.

   Expect:
   - Build and unit tests pass.
   - Bot starts and registers commands.
   - No Prisma TLS or migration error appears.

   Watch for:
   - `P1011` or TLS connection errors.
   - Commands missing after startup.
   - Bot connected to the wrong guild or database.

## Batch B: Local Reports

3. **Guild Slash Report** (`P0`)

   Config:
   - Report reasons optional or known.
   - Staging guild has an admin/observed channel.

   Do:
   - From the reporter account, run `/report` against the sacrificial reported-user account.
   - Include a short reason.

   Expect:
   - Reporter receives a successful command response.
   - Moderator channel receives a report-only observed alert.
   - Reported user is not restricted, mentioned, or added to a thread.
   - Alert includes moderator actions: `Open Case`, `Restrict`, `Ban`, `Dismiss...`, and `History` when available.

   Watch for:
   - Any automatic restriction from report-only intake.
   - A verification thread created before moderator action.
   - Missing report reason or wrong reporter/target identity.

4. **Guild User Context Report** (`P1`)

   Config:
   - `Report User` command registered in the staging guild.
   - If report reasons are required, know that the context menu cannot collect options.

   Do:
   - Right-click the sacrificial reported-user account.
   - Choose `Apps` -> `Report User`.

   Expect:
   - If reasons are optional, flow matches `/report`.
   - If reasons are required, Drasil tells the reporter to use `/report`.

   Watch for:
   - Context menu silently failing.
   - Required-reason config producing a confusing success response.

5. **Guild Message Report** (`P0`)

   Config:
   - `DRASIL_USER_INSTALL_REPORTING_ENABLED=true` in the environment that registered commands.
   - `Report Message` command visible in the staging guild.

   Do:
   - Have the sacrificial reported-user account send a harmless test message.
   - From the reporter account, right-click the message.
   - Choose `Apps` -> `Report Message`.
   - Submit the modal reason.

   Expect:
   - Reporter receives success confirmation.
   - Moderator channel receives a report-only observed alert with message context.
   - No restriction or verification thread is created by default.

   Watch for:
   - Modal submission errors.
   - Missing message context.
   - Report incorrectly treated as an external DM/GDM report.

6. **Report Dismiss And Undo** (`P1`)

   Config:
   - A fresh report-only observed alert from cards 3 or 5.

   Do:
   - Click `Dismiss...`.
   - Choose `Dismiss Alert`.
   - Use undo if available.
   - Repeat with `False Positive`.

   Expect:
   - Alert state updates without restricting or banning.
   - Undo restores the previous actionable state.
   - False-positive action is recorded distinctly from a plain dismiss.

   Watch for:
   - Buttons remaining enabled after final dismissal.
   - Dismissal changing the reported user's roles.

## Batch C: Escalation Actions

7. **Open Report Case Workspace** (`P1`)

   Config:
   - A report-only observed alert exists for the sacrificial reported-user account.

   Do:
   - Click `Open Case` from the observed alert.

   Expect:
   - Drasil creates or exposes a moderator-only review workspace.
   - Reported user is not added to that workspace.
   - Reported user is not restricted by `Open Case` alone.

   Watch for:
   - Moderator-only workspace accidentally visible to the reported user.
   - `Open Case` behaving like `Restrict`.

8. **Restrict From Report Alert** (`P0`)

   Config:
   - A report-only observed alert exists.
   - Bot can assign the restricted role and create private verification threads.

   Do:
   - Click `Restrict`.

   Expect:
   - Sacrificial reported-user account receives the restricted role.
   - A user-visible verification thread is created.
   - Moderator alert updates to show the active case.
   - Admin action is recorded.

   Watch for:
   - Restriction without a user-visible verification thread.
   - Thread created in the wrong channel.
   - Thread visible to users other than the target and moderators.

9. **Ban From Report Alert** (`P0`)

   Config:
   - Fresh report-only alert for the sacrificial reported-user account.
   - Sacrificial account is safe to ban from staging.

   Do:
   - Click `Ban`.

   Expect:
   - Sacrificial account is banned from the staging guild.
   - Admin action is recorded.
   - No user-visible verification thread is created just for the ban.

   Watch for:
   - Ban attempted against a non-sacrificial account.
   - Discord role hierarchy failure.
   - Thread creation before ban.

10. **Repeated Reports Coalesce** (`P1`)

    Config:
    - Same reporter and target accounts.
    - Existing report alert or active case.

    Do:
    - Submit two reports against the same target before resolving the first.
    - Resolve or dismiss the case.
    - Submit one more report after resolution.

    Expect:
    - Repeated pending reports update or link to the existing active state.
    - Post-resolution report creates a new review alert rather than reopening automatically.

    Watch for:
    - Notification spam.
    - Lost second report reason.
    - Resolved case silently reopened.

## Batch D: External Reports

11. **External Report Opted Out** (`P0`)

    Config:
    - User-installed `Report Message` enabled in Discord Developer Portal and registered by Drasil.
    - Managed staging guild A has the reported user as a known member.
    - Guild A external report mode is `off`.

    Do:
    - From a DM or group DM, report a message authored by the sacrificial reported-user account.

    Expect:
    - Global report signal is accepted.
    - Guild A receives no visible moderator alert.
    - No restriction, ban, case, or thread is created in Guild A.

    Watch for:
    - Opted-out guild receiving any visible notification.
    - Reporter confirmation claiming a server took action.

12. **External Report Notify Only** (`P0`)

    Config:
    - Managed staging guild B has the reported user as a known member.
    - Guild B external report mode is `notify_only`.

    Do:
    - From a DM or group DM, report a message authored by the sacrificial reported-user account.

    Expect:
    - Guild B receives a moderator-facing observed alert.
    - No automatic restriction, ban, verification event, or user-visible thread is created.
    - Alert clearly indicates the report came from outside the server context.

    Watch for:
    - Alert posted to a non-moderator channel.
    - Cross-server source details exposing more than intended.

13. **External Report Open Case Mode** (`P1`)

    Config:
    - Managed staging guild B external report mode is `open_case`.

    Do:
    - Submit the same DM/GDM report flow.

    Expect:
    - Current behavior matches `notify_only`: observed alert, no automatic case thread.
    - Moderators still choose `Open Case`, `Restrict`, or `Ban` manually.

    Watch for:
    - Admin expectation mismatch. This mode is retained for future UX polish but is currently conservative.

## Batch E: Detection And AI

14. **Observe-Only Suspicious Detection** (`P1`)

    Config:
    - Detection mode set to `notify_only`.
    - Notification window set to a known value, such as 60 minutes.

    Do:
    - Trigger a suspicious automatic detection from a safe test account.

    Expect:
    - No restricted role is assigned.
    - No verification thread is created.
    - Moderator channel receives a `Suspicious Activity Observed` alert.
    - AI analysis, heuristic reasons, confidence, and summary are understandable when present.

    Watch for:
    - AI output posted into a user-visible thread or public channel.
    - Excessive repeated alerts for the same user inside the notification window.

15. **Verification Thread Analysis Is Admin-Only** (`P1`)

    Config:
    - Verification thread analysis enabled.
    - Active restricted case with a user-visible verification thread.

    Do:
    - Have the sacrificial reported-user account reply in their verification thread.

    Expect:
    - AI analysis appears only in the moderator-facing notification area.
    - User-visible thread does not receive AI judgment text.
    - Repeated replies update the same admin-facing analysis area.

    Watch for:
    - AI analysis exposed to the restricted user.
    - Duplicate admin notifications for every reply.

## Batch F: Production Deploy Smoke

16. **Post-Deploy Runtime Check** (`P0`)

    Config:
    - Production deploy completed and ECS service stable.

    Do:
    - Confirm ECS desired/running count is stable.
    - Check CloudWatch logs for recent errors.
    - Run one harmless command that does not moderate a real user.

    Expect:
    - ECS service is stable.
    - No recent `ERROR`, `Exception`, `P1011`, `TlsConnectionError`, `Missing Access`, or `Missing Permissions` signal is present.
    - Commands respond normally.

    Watch for:
    - Deploy appears stable but commands are stale or missing.
    - Any Discord permission error after command registration.

17. **Production Report-Only Pilot** (`P0`)

    Config:
    - Large server remains in review-only/observe-only posture.
    - A sacrificial or clearly controlled target is used.

    Do:
    - Submit one report through the intended production entry point.
    - Do not click disruptive actions until moderators verify the alert.

    Expect:
    - Moderator alert appears in the intended channel.
    - No automatic restriction or ban occurs.
    - Moderator team can explain what happened from the alert alone.

    Watch for:
    - Alert noise in the wrong channel.
    - Confusing action labels.
    - Any real member affected without explicit moderator action.
