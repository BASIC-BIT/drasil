# AGENTS

## Project Overview

- Discord anti-spam bot that combines heuristics and GPT analysis.
- Supabase Postgres as the backing database, accessed through Prisma.
- Direct orchestration (no internal EventBus).

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

## Environment & Local Dev

- `.env` uses:
  - `DISCORD_TOKEN`, `OPENAI_API_KEY`
  - `DATABASE_URL` (Prisma)
  - `PRISMA_DB_PASSWORD`, `POSTGRES_DB_URL` (local Supabase reset tooling)
- Local DB: `npx supabase start`.
- If the user says "Reset the database", run: `npx supabase db reset`.

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

## Agent Rules (Cursor)

Clean code:

- Prefer constants over magic numbers; meaningful names; single responsibility; DRY.
- Comments explain why, not what.
- Encapsulate logic; keep structure tidy.

TypeScript:

- Prefer interfaces for object shapes; avoid `any`; explicit return types for public APIs.
- Use async/await; handle nulls carefully; avoid unnecessary type assertions.

Jest:

- Use AAA (Arrange/Act/Assert), `jest.fn()` mocks, and clear test names.
- Test success and failure cases; keep tests isolated.

Code quality rules:

- Verify information; do not assume or speculate.
- File-by-file changes; preserve unrelated code and structure.
- No apologies; no "understanding" feedback.
- No whitespace-only suggestions.
- No summaries in responses.
- No inventions beyond the request.
- No unnecessary confirmations or implementation checks.
- Single-chunk edits per file.
- Provide real file links when referencing files.
- Avoid discussing current implementation unless explicitly requested.

Memory bank:

- If asked to update or use the Memory Bank, read all core files in `memory-bank/`.
