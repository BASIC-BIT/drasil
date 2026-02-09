# Release Readiness Checklist

High-signal checklist for validating Drasil on a staging Discord server.

This is intended to be concise and actionable. For flow details see:

- `docs/workflow.md`
- `docs/test-cases.md`

## Pre-flight

- CI is green on `main`.
- You have a staging Discord server where you can safely test bans/restrictions.
- You have a staging Postgres database (or local Supabase) for persistence.

## Discord application setup

Bot token + intents:

- Create a Discord application + bot.
- Copy the bot token into `DISCORD_TOKEN`.
- Enable privileged intents (required by current code in `src/di/container.ts`):
  - Server Members Intent
  - Message Content Intent

Bot permissions (minimum practical set):

- Manage Roles (assign/remove restricted role)
- Ban Members (ban flow)
- View Channels / Send Messages (admin + verification channels)
- Manage Threads + Create Private Threads (verification threads)

Role hierarchy:

- Bot role must be above the configured restricted role.
- Bot role must be high enough to ban the members you want to ban.

## Database setup

- `DATABASE_URL` points at your Postgres instance.
- `OPENAI_API_KEY` is set (required for GPT-based analysis).
- Run Prisma migrations for the environment (typical):

```bash
npx prisma migrate deploy
```

## Server setup (staging)

Create:

- Restricted role (limited permissions).
- Admin channel (mods only).
- Verification channel (where the bot creates verification threads).

Configure the bot (current UX is via `/config`):

- `restricted_role_id`
- `admin_channel_id`
- `verification_channel_id`

## Smoke tests (end-to-end)

Use `docs/test-cases.md` as the authoritative list. Minimum set:

- Suspicious message:
  - user restricted
  - verification thread created
  - admin notification sent
- Verify:
  - restricted role removed
  - thread archived/locked
  - admin action recorded
- Ban:
  - user banned
  - thread archived/locked
  - admin action recorded
- Reopen:
  - verification returns to pending
  - thread reopened
  - user restricted again

Privacy check:

- Verify the restricted user can only see their own verification thread.

## Common failure modes

No message content / missing events:

- Verify privileged intents are enabled on the Discord application.

Role assignment fails:

- Check bot has Manage Roles permission.
- Check role hierarchy (bot role above restricted role).

Thread creation fails:

- Check bot has Manage Threads / Create Private Threads.
- Check the verification channel allows thread creation.

Ban fails:

- Check bot has Ban Members permission.
- Check role hierarchy (bot cannot ban users above its highest role).

Database errors:

- Confirm `DATABASE_URL` is reachable.
- Confirm migrations are deployed.
