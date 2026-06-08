# Web Dashboard Architecture

This document tracks the first Drasil web dashboard slice and the persistence boundary for a future Convex migration.

## First Slice

The dashboard lives in `apps/web` and uses Next.js server routes/components.

Initial capabilities:

- Discord OAuth admin login with `identify` and `guilds` scopes.
- Guild selection for Discord owners or users with Manage Server.
- Live setup diagnostics using the bot token where available.
- Core setup editing for restricted role, admin/verification/report channels, detection response policy, report policy, analytics consent, and report AI authority.
- Read-only active case queue and case detail views for pending verification events.
- Shared setup and active case contracts in `packages/contracts`.

The bot runtime remains in the repository root for this slice. Do not move bot files into `apps/bot` until the web package is stable and the deploy impact is separated.

## Persistence Direction

Drasil remains Supabase/Postgres-backed for production today.

The web app does not import Prisma or bot DI directly. Setup talks through `SetupDataAdapter`:

- `PostgresSetupDataAdapter` is the active adapter and reads/writes the existing `servers` table.
- `ConvexSetupDataAdapter` is the future adapter boundary and expects schema-compatible HTTP routes if `DRASIL_WEB_DATA_PROVIDER=convex` is selected.

Active cases talk through `ActiveCaseDataAdapter`:

- `PostgresActiveCaseDataAdapter` reads pending `verification_events`, recent `detection_events`, recent `admin_actions`, persisted `moderation_outcomes`, retained report evidence, and recent `message_contexts` previews.
- Case detail pages also fetch source-message and thread messages live from the Discord API with the bot token when Discord surfaces are available.
- Case pages are read-only for this slice. Moderator actions still route through Discord surfaces so evidence and provenance stay in Discord threads/messages.

This keeps the first dashboard useful now while preserving the option to migrate new web-facing workflows to Convex later.

## Why Not Migrate Immediately

Convex is a good future fit for realtime case views, intake state machines, scheduled jobs, and shared web/bot functions. It should not block the first dashboard because the current Supabase/Postgres model already has production deploy wiring, migrations, integration tests, and bot behavior.

The likely migration order is:

1. Keep setup dashboard on Postgres through the adapter.
2. Add Convex for a new bounded workflow, such as screenshot-first intake state.
3. Mirror or import historical case/detection data only after the Convex shape proves stable.
4. Cut over the bot behind repository/service adapters, not UI-specific routes.

## Production Environment

Required web runtime variables:

- `NEXT_PUBLIC_APP_URL`: deployed web origin.
- `DISCORD_CLIENT_ID`: Discord OAuth app client ID.
- `DISCORD_CLIENT_SECRET`: Discord OAuth app client secret.
- `DRASIL_SESSION_SECRET`: high-entropy cookie signing secret.
- `DRASIL_OAUTH_ENCRYPTION_KEY`: high-entropy OAuth token encryption secret. This must be set separately from `DRASIL_SESSION_SECRET`.
- `DATABASE_URL` or `DRASIL_WEB_DATABASE_URL`: Supabase/Postgres connection string.
- `DRASIL_WEB_BOT_TOKEN` or `DISCORD_TOKEN`: bot token for live role/channel diagnostics and active-case Discord message reads.

Optional variables:

- `DRASIL_WEB_PUBLIC_URL`: deployed web origin for bot-side Discord links. If unset, the bot also accepts `NEXT_PUBLIC_APP_URL`.
- `DRASIL_WEB_DATA_PROVIDER`: `postgres` by default; `convex` selects the future adapter.
- `DRASIL_CONVEX_HTTP_URL`: Convex HTTP URL when using the Convex adapter.
- `DRASIL_CONVEX_WEB_API_KEY`: API key for Convex web routes.
- `DRASIL_WEB_PG_POOL_MAX`: Postgres pool size for the web runtime.
- `DRASIL_WEB_ENABLE_ADMINISTRATOR_INVITE`: when `true`, shows the experimental Administrator bot invite. The standard least-privilege invite remains the default path.
- `DRASIL_WEB_E2E_FIXTURE_MODE`: non-production Playwright fixture mode for web route tests.

GitHub Actions production deploy variables/secrets:

- `VERCEL_TOKEN` secret.
- `VERCEL_ORG_ID` variable.
- `VERCEL_PROJECT_ID` variable.
- GitHub environment `Deploy - web-prod` should require approval before production web deploys.

In Vercel, set the project root to `apps/web`. The checked-in `apps/web/vercel.json` disables Git-triggered deploys so GitHub Actions remains the production authority.

## Day-One Quality Gates

The web package starts with the same style of quality gates that proved useful in Perkcord and Chronote:

- Unit tests: `npm run web:test` and coverage via `npm run web:test:coverage`.
- Contract tests: `npm run contracts:test` and coverage via `npm run contracts:test:coverage`.
- Linting: `npm run web:lint`, `npm run contracts:lint`, and the existing root lint gate.
- TypeScript builds/typechecks: root `npm run build`, `npm run web:typecheck`, and `npm run contracts:typecheck`.
- Next production build: `npm run web:build`.
- Playwright smoke E2E: `npm run web:e2e`.
- Playwright visual snapshots: `npm run web:e2e:visual`; update baselines intentionally with `npm run web:e2e:visual:update`.
- Code size/complexity visibility: GitHub Actions installs `scc` and `lizard`, then runs `scripts/check-metrics.sh` against `apps/web` and `packages/contracts`.
- PR screenshot preview: when Playwright snapshot PNGs change, CI uploads a `pr-snapshot-preview` artifact and posts/updates a PR comment embedding the changed screenshots.

Snapshot locations:

- Playwright baselines: `apps/web/e2e/*.spec.ts-snapshots/`.
- Playwright failure artifacts: `apps/web/test-results/` and `apps/web/playwright-report/`.

UI-affecting changes should include either a Playwright assertion, a visual snapshot update, or both. If a snapshot changes, call out why in the PR body.

## Security Notes

- Discord OAuth access tokens are encrypted in an HTTP-only cookie and are not stored in the database.
- Admin sessions are HMAC-signed, HTTP-only, and short lived.
- Guild authorization is rechecked before every setup read/write.
- Report AI settings retain the current product rule: report AI can never auto-ban.
- Cross-server intelligence and privileged evidence are not exposed in this dashboard slice.
- Active case pages require the same Discord Manage Server authorization recheck as setup pages.
