# Release Readiness Checklist

High-signal checklist for validating Drasil on a staging Discord server.

This is intended to be concise and actionable. For flow details see:

- `docs/workflow.md`
- `docs/test-cases.md`
- `docs/manual-qa.md`

## Pre-flight

- CI is green on `main`.
- You have a staging Discord server where you can safely test case-role, kick, and ban flows.
- You have a staging Postgres database (or local Supabase) for persistence.

## Discord application setup

Bot token + intents:

- Create a Discord application + bot.
- Copy the bot token into `DISCORD_TOKEN`.
- Enable privileged intents (required by current code in `src/di/container.ts`):
  - Server Members Intent
  - Message Content Intent

Bot permissions (minimum practical set):

- Manage Roles (assign/remove case role)
- Ban Members (ban flow)
- View Channels / Send Messages / Read Message History (admin + verification channels)
- Manage Threads + Create Private Threads (verification threads)

Role hierarchy:

- Bot role must be above the configured case role.
- Bot role must be high enough to ban the members you want to ban.

## Database setup

- `DATABASE_URL` points at your Postgres instance.
- `OPENAI_API_KEY` is set (required for GPT-based analysis).
- Run Prisma migrations for the environment (typical):

```bash
npx prisma migrate deploy
```

## Server setup (staging)

Create or choose:

- Case role (active-case access control).
- Admin channel (mods only).
- Verification channel (where the bot creates verification threads), or let setup create/reuse `verification`.

Configure and validate the bot:

- Run `/config setup admin-channel:<channel>`.
- Pass `restricted-role:<role>` only when choosing a specific existing role; otherwise Drasil reuses a configured/default `Drasil Restricted` role or creates it if missing.
- Pass `verification-channel:<channel>` only when reusing an existing channel; otherwise Drasil creates/reuses `verification`.
- If multiple `#verification` channels exist, pass `verification-channel:<channel>` explicitly.
- Optionally pass `report-channel:<channel>` to create/update report instructions.
- Run `/config validate` and fix all errors before smoke tests.

## Smoke tests (end-to-end)

Use `docs/test-cases.md` as the authoritative list. Minimum set:

- If you want a step-by-step runbook instead of a short checklist, use `docs/manual-qa.md`.

- Suspicious message:
  - case role applied
  - verification thread created
  - admin notification sent
- Verify:
  - case role removed
  - thread archived/locked
  - admin action recorded
- Ban:
  - user banned
  - thread archived/locked
  - admin action recorded
- Reopen:
  - verification returns to pending
  - thread reopened
  - case role reapplied

Privacy check:

- Verify the user with the active case can only see their own verification thread.

## Common failure modes

No message content / missing events:

- Verify privileged intents are enabled on the Discord application.

Role assignment fails:

- Check bot has Manage Roles permission.
- Check role hierarchy (bot role above case role).

Thread creation fails:

- Check bot has Manage Threads / Create Private Threads.
- Check the verification channel allows thread creation.

Ban fails:

- Check bot has Ban Members permission.
- Check role hierarchy (bot cannot ban users above its highest role).

Database errors:

- Confirm `DATABASE_URL` is reachable.
- Confirm migrations are deployed.
