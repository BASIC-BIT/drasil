# Web Dashboard Architecture

This document tracks the first Drasil web dashboard slice and the persistence boundary for a future Convex migration.

## First Slice

The dashboard lives in `apps/web` and uses Next.js server routes/components.

Initial capabilities:

- Discord OAuth admin login with `identify` and `guilds` scopes.
- Guild selection for Discord owners or users with Manage Server.
- Live setup diagnostics using the bot token where available.
- Core setup editing for case role, admin/verification/report/live-queue
  channels, detection response modes, observed-alert thresholds, staff action
  gates, auto-kick policy, heuristic detection thresholds and watch terms,
  report policy, role-gate, role-quarantine, manual intake, lockdown
  allow-lists, case responder staff routing, case review reminder cadence,
  verification prompt/context and reply analysis policy, analytics consent, and
  report evidence analysis authority.
  Setup can also queue bot-owned core setup completion and report instructions
  button repair.
  Full analytics sharing keeps the Discord command's server-owner gate.
- Moderation inbox that combines active cases, submitted reports, observed alert
  mirrors, queue attention, and pending screening items with filters, search,
  sort controls, saved-view presets, selected-item detail, low-risk single and
  visible-batch attention acknowledge actions, visible-row review export, and
  queued observed-alert Open Case, Dismiss, False Positive, Kick, Ban, and Undo
  actions, plus member-history links.
- Discord case-review digests and observed-alert action menus use the configured
  public web URL to link Web Queue buttons to the unified inbox.
- Reporter-facing report portal at `/report`, listing configured shared guilds,
  queueing guided private intake thread starts, queueing close requests for
  existing open intake threads, and queueing direct user reports through
  bot-owned paths.
- Report detail pages for submitted reports, retained intake evidence, Discord
  evidence links, linked cases, submitted-report closure actions, and the first
  guarded Open Case affordance.
- Active case queue and case detail views for pending verification events,
  including queued verify, close-no-action, kick, ban, ban-by-ID, repair-thread,
  and create-thread controls, plus sync-existing-ban for already-banned users
  and reopen for eligible resolved in-server cases.
- Resolved case history at `/admin/guild/[guildId]/history`, with read-only
  outcome rows, Discord provenance, client-side search/outcome sorting, visible
  export packets, and links back into case detail.
- Member history at `/admin/guild/[guildId]/members/[userId]`, with cases,
  reports, detections, outcomes, membership status, and Discord source links for
  one server-local user, including queued Open Case for in-server members,
  queued Open Case from stored source messages, queued Flag User for admin
  escalation, observed alert Undo for dismissed or false-positive detection rows,
  and queued Ignore Detection/Restore Accounting controls for future suspicion
  accounting.
- Shared setup and active case contracts in `packages/contracts`.

The bot runtime remains in the repository root for this slice. Do not move bot files into `apps/bot` until the web package is stable and the deploy impact is separated.

## Persistence Direction

Drasil remains Supabase/Postgres-backed for production today.

The web app does not import Prisma or bot DI directly. Setup talks through `SetupDataAdapter`:

- `PostgresSetupDataAdapter` is the active adapter and reads/writes the existing `servers` table.
- `ConvexSetupDataAdapter` is the future adapter boundary and expects schema-compatible HTTP routes if `DRASIL_WEB_DATA_PROVIDER=convex` is selected.

Active cases talk through `ActiveCaseDataAdapter`:

- `PostgresActiveCaseDataAdapter` reads pending `verification_events`, recent `detection_events`, recent `admin_actions`, persisted `moderation_outcomes`, retained report evidence, and recent `message_contexts` previews.
- The same adapter exposes a bounded resolved-case history view ordered by
  resolution or update time. Resolved rows expose only history/detail affordances,
  and the web view adds client-side search, outcome filtering, sorting, and
  visible-row export for review handoff.
- Case detail pages also fetch source-message and thread messages live from the Discord API with the bot token when Discord surfaces are available.
- Member history uses `MemberProfileDataAdapter`, composing active/resolved case
  summaries with member-scoped detections, reviewed reports, moderation outcomes,
  and server membership state.
- Case verify, close-no-action, kick, ban, ban-by-ID, repair-thread,
  create-thread, refresh-notification, sync-existing-ban, and eligible reopen controls enqueue
  idempotent `moderation_action_requests` rows. The logged-in bot worker
  executes the existing `UserModerationService` and `SecurityActionService`
  paths so Discord threads, roles, outcomes, and audit records remain the source
  of side effects. Destructive web case actions require moderator permission,
  server policy, bot capability, confirmation, and reason capture before queueing.
- The Operations page shows a read-only database-backed integrity snapshot, queues
  live moderation queue sync, clear, resolved-thread sweep, and case-role
  lockdown audit/apply, and bulk role-intake requests through
  `moderation_action_requests`, shows recent web-requested handoff status, and
  lists repo-owned deployment/runtime source files for operator checks.
  The logged-in bot worker executes `ModerationQueueService.syncServerQueue` or
  `clearServerQueue`, uses `CaseThreadClosureSweepService` for dry-run or
  confirmed resolved-thread closure, uses `CaseRoleLockdownService` for lockdown
  audit/apply, and uses `SecurityActionService.intakeRoleMembers` for role
  intake dry-run/execute. Discord queue messages, persisted mirror cleanup,
  thread mutation, channel overwrite mutation, and bulk case creation remain in
  bot-owned services. Discord-live integrity fetches still run through the
  bot-owned `/audit integrity` path.

The moderation inbox talks through `ModerationInboxDataAdapter`:

- `PostgresModerationInboxDataAdapter` composes active cases, submitted reports,
  and `moderation_queue_items` into the shared `ModerationInboxItem` contract.
- The inbox route keeps broader bulk destructive action execution for the later
  shared-service workstream.
- The inbox UI supports type/freshness filters, text search, sort controls, and a
  saved-view preset row with a selected-item detail rail and visible-row export
  for faster triage.
- Queue attention acknowledgement, including the visible-replies batch action,
  is the first shared Discord/web write path and runs each queue item through
  `QueueAttentionService`.
- Observed-alert Open Case, Dismiss, False Positive, Kick, Ban, and Undo enqueue
  idempotent `moderation_action_requests` rows. The logged-in bot worker
  executes the existing `SecurityActionService` paths so Discord notification
  updates, queue mirror cleanup or restore, linked report closeout or reopen,
  admin actions, outcomes, and analytics remain centralized. Observed Kick/Ban
  require confirmation, reason capture, server policy, actor permission, and bot
  capability gates before queueing. Observed Undo is exposed from member-history
  detection rows that are currently dismissed or false-positive.
- Detection accounting Ignore and Restore actions enqueue idempotent
  `moderation_action_requests` rows from member-history detection rows. The
  logged-in bot worker executes the existing audit service paths so accounting
  metadata, audit records, notification restoration, queue mirror restore, and
  analytics stay centralized.
- Reporter actions from `/report` enqueue idempotent `start_report_intake`,
  `close_report_intake`, or `submit_user_report` rows for configured shared
  guilds. Guided intake requires a configured report instructions channel; the
  logged-in bot worker verifies reporter membership, avoids duplicate open
  intakes, creates and activates the private report thread, persists intake
  state, and notifies admins. Closing an open intake requires confirmation and
  reporter ownership before queueing; the logged-in bot worker closes and
  archives the Discord thread through `ReportIntakeService.closeIntakeForThread`.
  Direct report submission checks self-report, confirmation, and saved reason
  policy before queueing; the logged-in bot worker calls
  `ReportSubmissionService.submitUserReport` so the same `USER_REPORT` detection
  and observed-alert behavior is preserved.
- Member-profile Open Case actions enqueue idempotent `open_admin_case`
  `moderation_action_requests` rows after web-side actor permission,
  target-state, confirmation, and required-reason checks. Source-message actions
  revalidate the selected detection's channel/message IDs before queueing them
  as evidence context. The logged-in bot worker executes
  `SecurityActionService.openAdminCase` so case role, thread, notification,
  audit, source-evidence metadata, and outcome behavior stay centralized.
- Member-profile Flag User actions enqueue idempotent `manual_flag_user`
  `moderation_action_requests` rows after web-side administrator policy,
  target-state, confirmation, and reason capture. The logged-in bot worker
  executes `SecurityActionService.handleManualFlag` so admin-flag detection,
  case role, thread, notification, audit, and outcome behavior stay centralized.
- Submitted-report closure actions run through `ReportReviewService`, which
  captures actor/surface metadata and clears report-thread attention queue items
  as a best-effort follow-up.
- Submitted-report Open Case uses the same `ReportReviewService` boundary for
  validation and delegation. Production enqueues an idempotent
  `moderation_action_requests` row, then the logged-in bot worker executes the
  existing Discord role/thread/notification side effects through
  `SecurityActionService`.
- Submitted-report details use `ReportDetailDataAdapter` to read report intake
  evidence without moving report-only review across the case boundary.
- Fixture mode uses deterministic inbox data for Playwright and Storybook.

This keeps the first dashboard useful now while preserving the option to migrate new web-facing workflows to Convex later.

## Moderation Workbench Plan

The long-running plan for web moderation parity and bulk triage lives in
`docs/web-moderation-workbench-goal.md`. Use that document for `/goal` work that
expands the website beyond the first setup, case queue, case detail, and report
queue slices documented here.

The current Discord-to-web control inventory lives in
`docs/web-moderation-control-parity.md`.

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
- `DRASIL_ACTION_REQUEST_POLL_MS`: bot-side poll cadence for web-requested
  moderation actions; defaults to 5000 ms.
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
