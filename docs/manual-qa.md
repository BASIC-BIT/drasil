# Manual QA Flow

Practical checklist for validating Drasil on a real Discord server before shipping behavior changes.

Use this when a PR changes moderation flow, thread behavior, notifications, GPT prompts, or Discord permissions.

Related docs:

- `docs/release-checklist.md`
- `docs/test-cases.md`
- `docs/workflow.md`

## Test setup

Use a dedicated staging server and test accounts:

- moderator account
- suspicious-user test account
- reporter test account

Recommended server setup:

- one restricted role with visibly reduced permissions
- one admin/mod channel for notifications
- one verification channel where private threads are created
- one general channel where test messages can be sent safely

Recommended app/env setup:

- `DISCORD_TOKEN`, `OPENAI_API_KEY`, and `DATABASE_URL` configured
- Prisma migrations applied
- bot role has `Manage Roles`, `Ban Members`, `View Channels`, `Send Messages`, `Manage Threads`, and private-thread creation permissions
- bot role is above the restricted role in the role hierarchy

## How to run the bot

Typical local run:

```bash
npm run build
npm test
npm run dev
```

Keep the bot logs visible while testing.

## Core QA flows

Prefer deterministic flows first. Use `/flaguser` instead of hoping heuristics trigger naturally.

### 1. Verification setup sanity check

- Run `/setupverification` if the staging server is not configured yet.
- Confirm the restricted role, admin channel, and verification channel are configured.
- Expected result:
  - commands succeed without permission errors
  - the bot can post in the admin channel
  - the bot can create private verification threads

### 2. Manual flag happy path

- Use `/flaguser` against the suspicious-user test account.
- Expected result:
  - user gets the restricted role
  - one verification event is created
  - one private verification thread is created for that user
  - one admin notification appears in the admin channel
  - the notification includes action buttons and the triggering context

### 3. Repeat flag while pending

- Run `/flaguser` again for the same user while the case is still pending.
- Expected result:
  - no second verification thread is created
  - no second pending verification event is created
  - the existing admin notification is updated instead of duplicated

### 4. Verify flow

- Click the verify action from the admin notification.
- Expected result:
  - restricted role is removed
  - verification status becomes `VERIFIED`
  - thread is archived/locked or otherwise resolved
  - admin notification reflects the resolved state
  - admin action is recorded

### 5. Ban flow

- Start from a fresh pending verification case.
- Click the ban action from the admin notification.
- Expected result:
  - user is banned from the staging server
  - verification status becomes `BANNED`
  - thread is resolved
  - admin notification reflects the ban
  - admin action is recorded

### 6. Reopen flow

- Start from a previously verified case.
- Click the reopen action.
- Expected result:
  - verification status returns to `PENDING`
  - user is restricted again
  - thread is reopened or reactivated
  - admin notification reflects the reopened state
  - reopen admin action is recorded

### 7. User report flow

- Run `/setupreportbutton` if needed.
- Submit a report against the suspicious-user test account from the reporter test account.
- Expected result:
  - detection event is created with `USER_REPORT`
  - the same verification flow starts
  - report details appear in the admin-facing context

### 8. GPT verification-thread analysis flow

- Enable thread analysis with `/config verification analysis-enable` if it is disabled.
- Optionally confirm the setting with `/config verification analysis-view`.
- Start a fresh pending verification case.
- Send 1-2 replies from the flagged user inside their verification thread.
- Expected result:
  - analysis is not posted publicly in the user-visible thread
  - admin notification gains or updates an `AI Thread Analysis` section
  - result is admin-facing only
  - repeated replies update the same analysis area rather than creating a second notification

### 9. Server-context prompt flow

- Set `server-about`, `verification-context`, and `expected-topics` in `/config verification context-set`.
- Preview them with `/config verification context-view`.
- Trigger either manual flagging or thread analysis.
- Expected result:
  - context commands succeed and stay under Discord message limits
  - bot replies do not ping roles/users unexpectedly
  - GPT-backed flows still work with configured context present

## What to record during QA

For each flow, capture enough evidence to debug failures later:

- whether the Discord behavior matched expectations
- any console errors from the bot process
- whether the database state looked reasonable
- screenshots of the admin notification and thread state when helpful

Good minimum evidence:

- one screenshot of the admin notification before action
- one screenshot after verify/ban/reopen
- any error output from the bot logs

## Go / no-go rule

Call the build good for staging only if all of these are true:

- manual flag creates exactly one pending case and one notification
- verify, ban, and reopen each work end-to-end
- user report path works end-to-end
- GPT thread analysis stays admin-only and updates the existing notification
- no permission, role-hierarchy, or thread-creation failures appear in logs

If any of those fail, log the failing step and keep the server state/screenshots for follow-up.
