---
name: release-checklist
description: Validate Drasil on staging using the release readiness checklist.
compatibility: opencode
---

Use this before deploying/rolling out Drasil to real servers.

## Primary doc

- `docs/release-checklist.md`

## Quick path

- Confirm Discord privileged intents are enabled (Message Content, Server Members).
- Confirm bot permissions (Manage Roles, Ban Members, Manage Threads).
- Confirm DB migrations are deployed (`prisma migrate deploy`).
- Run the end-to-end smoke tests described in `docs/test-cases.md`.

## Output

- Record what passed/failed and any follow-up issues/PRs.
