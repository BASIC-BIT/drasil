# Drasil (Discord Anti-Spam Bot)

Discord anti-spam bot that combines heuristics and GPT analysis to proactively detect and mitigate scammers/spammers in Discord servers.

Persistence uses Postgres (often Supabase) via Prisma. Orchestration is direct (controllers call services; no internal EventBus).

## Optional local context

- `AGENTS.local.md` is gitignored and can capture machine-specific paths and personal preferences.
- Template: `AGENTS.local.md.example`.
- If `AGENTS.local.md` exists, read it first and follow it for this machine.

## Stack

- TypeScript + Node.js
- discord.js (Discord integration)
- OpenAI SDK (GPT analysis)
- Prisma ORM + Supabase Postgres
- InversifyJS (dependency injection)
- Jest + ts-jest (tests)
- ESLint + Prettier (lint/format)

## Architecture & Flow

- Orchestration is direct: controllers call services; services coordinate side effects.
- DMs are ignored.
- Failure handling is fail-fast; no retries/compensation yet.
- Thread creation is automatic on suspicion; Create Thread button is only for missing threads.
- Manual flag and user report both create detection events and follow the same flow.

Primary flow (see `docs/workflow.md`):

1. `EventHandler` -> `DetectionOrchestrator` -> `SecurityActionService`.
2. `SecurityActionService` ensures entities, ensures detection event, creates verification if
   needed, restricts the user, creates a thread, and upserts admin notification.
3. `InteractionHandler`/`CommandHandler` call `UserModerationService` for verify/ban.
4. `UserModerationService` updates verification status, roles, thread state, notifications,
   and admin actions.

## Data Model

- Tables: `servers`, `users`, `server_members`, `detection_events`,
  `verification_events`, `admin_actions`.
- Enums: `detection_type` (includes `user_report`), `verification_status`,
  `admin_action_type`.
- Source of truth: `prisma/schema.prisma`.

## Key Files

- Entry/bootstrap: `src/index.ts`, `src/di/container.ts`, `src/di/symbols.ts`.
- Controllers: `src/controllers/EventHandler.ts`, `src/controllers/InteractionHandler.ts`,
  `src/controllers/CommandHandler.ts`.
- Services: `src/services/SecurityActionService.ts`, `src/services/UserModerationService.ts`,
  `src/services/DetectionOrchestrator.ts`.
- Docs: `docs/workflow.md`, `docs/test-cases.md`, `docs/future-features.md`.
- Context (product/spec): `docs/context/`
- Archives (historical): `docs/legacy/`

## Environment & Local Dev

- `.env` uses:
  - `DISCORD_TOKEN`, `OPENAI_API_KEY`
  - `DATABASE_URL` (Prisma)
  - `PRISMA_DB_PASSWORD`, `POSTGRES_DB_URL` (local Supabase tooling + integration tests)
- Local DB: `npx supabase start`
- Canonical local reset + seed: `npm run db:reset:local`

If the user says "Reset the database", run `npm run db:reset:local`.

## Testing

- Unit tests use in-memory repositories in `src/__tests__/fakes`.
- Unit tests live in `src/__tests__/unit` and do not require a database.
- Integration tests live in `src/__tests__/integration` and use a real Postgres DB via Prisma.
- Integration tests are enabled by `JEST_INTEGRATION=1`.
- Test setup runs `prisma migrate deploy` and truncates tables between tests.
- Env for integration tests:
  - `TEST_DATABASE_URL` (preferred)
  - `DATABASE_URL` (fallback)
  - `POSTGRES_DB_URL` (for extension creation)
- Manual regression list and test ideas: `docs/test-cases.md`.
- Full-stack smoke testing is optional and uses a staging Discord server.

## CI

- Workflow: `.github/workflows/ci.yml`
- Gates: build, format check, lint, tests against Postgres service.

## Contribution workflow

- Track work with GitHub issues.
- Land changes via PRs (avoid direct pushes to `main`).
- For parallel work, prefer `git worktree`. See `docs/dev/worktrees.md`.
- PRs should link the issue(s), include a test plan, and pass CI (`npm run check:ci`).
- Prefer AI-assisted reviews (Copilot + Greptile) and recycle loops; keep critical context in the PR.

## Scripts

- `npm run dev` start bot (hot reload)
- `npm run build` compile TypeScript
- `npm test` run unit tests (in-memory repositories)
- `npm run test:coverage` run unit tests with coverage
- `npm run test:integration` run integration tests (real Postgres)
- `npm run lint` lint (no fix)
- `npm run lint:fix` lint with fixes
- `npm run format:check` check formatting
- `npm run check` local quality gate (lint:fix, build, tests)
- `npm run check:full` full gate (format:check, check, integration tests)
- `npm run check:ci` CI gate (format:check, lint, build, tests, integration tests)

## Engineering Guidelines

Operating principles:

- Prefer boring, reliable changes over clever ones.
- Keep diffs tight; preserve unrelated behavior.
- Verify claims with code or repo files; avoid guessing.
- Never add secrets/credentials to git.

Clean code:

- Prefer constants over magic numbers; meaningful names; single responsibility; DRY.
- Comments explain why, not what.
- Encapsulate logic; keep structure tidy.

TypeScript:

- Prefer interfaces for object shapes; avoid `any`; explicit return types for public APIs.
- Use async/await; handle `null` carefully (Prisma maps SQL `NULL` -> JS `null`).

Jest:

- Use AAA (Arrange/Act/Assert), `jest.fn()` mocks, and clear test names.
- Test success and failure cases; keep tests isolated.

## Skills (progressive disclosure)

This repo keeps always-on guidance in `AGENTS.md`.

Use Skills for deeper workflows/playbooks. Skills live under `.opencode/skills/<name>/SKILL.md`.

Common skills in this repo:

- `db-reset-local`
- `prisma-workflow`
- `testing-integration`
- `git-worktrees`
- `pr-workflow`
- `release-checklist`
- `opencode-external-directory`
