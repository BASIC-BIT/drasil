# Web Moderation Workbench Goal Plan

This is the working plan for turning the Drasil website into a full moderation
workbench: parity with the Discord bot's controls, plus a denser and calmer place
to triage large volumes of bots, spammers, reports, and pending review items.

Use this document as the first stop for `/goal`-driven work. It is not a complete
implementation spec. It should give future Codex runs enough context to choose a
slice, read the right deeper files, and avoid re-discovering the product shape.

Related planning artifacts:

- `docs/web-moderation-control-parity.md`: Discord-to-web control inventory,
  route decisions, and first safe web-write sequence.

## Primary Goal

Build the website into the durable moderation surface for Drasil.

The end state should let qualified moderators and server admins:

- See every item that needs review across cases, observed alerts, reports, report
  follow-ups, support-thread replies, and long-pending screening members.
- Review evidence faster than Discord allows, without losing Discord message and
  thread provenance.
- Take every safe moderation action currently available through the bot, using
  the same policy, permission checks, confirmations, audit records, and Discord
  side effects.
- Configure the same server behavior available through Discord commands, with
  clearer diagnostics and explanation.
- Review historical outcomes and false positives so Drasil gets better over time.

## Current State

Verified on 2026-07-08 against local `main` and the live GitHub issue state.

- No open PRs were present during this planning pass.
- GitHub issue #126 remains the open umbrella for active triage.
- Issue #126 still names `docs/active-triage-system.md` as its planned durable
  source from an older unlanded planning draft. If this document lands, update
  #126 or add a short pointer doc so future agents follow this current plan.
- GitHub issue #89 remains the open architecture dependency for a shared service
  layer across Discord commands, agents, MCP, and future web/API actions.
- PR #127 shipped first-class moderation outcomes, Discord case digests, shared
  active-case contracts, and read-only web case queue/detail pages.
- PR #132 shipped the submitted report queue and report closure actions.
- PR #166 shipped scoped source-message deletion policy and web setup controls
  for that policy. A former report open-case placeholder pointed at #131, but
  #131 was completed by PR #166 and is no longer the right tracking reference.

Current website capabilities:

- Discord OAuth admin login and guild selection.
- Setup diagnostics and editing for core server settings.
- Active case queue and case detail pages, including queued web actions for
  verify, close no action, kick, ban, ban by ID, repair thread, create thread,
  sync existing ban, and reopen for eligible resolved in-server cases.
- Resolved case history at `/admin/guild/[guildId]/history`, with read-only
  outcome rows, Discord provenance, client-side search/outcome filters, visible
  export packets, and links back into case detail.
- Member history at `/admin/guild/[guildId]/members/[userId]`, combining
  identity, membership state, cases, reports, detections, outcomes, and Discord
  source links for one server-local user, plus queued Open Case for in-server
  members, queued Open Case from stored source messages, queued Flag User for
  admin escalation, and queued Ignore Detection/Restore Accounting controls for
  detection accounting review.
- Live Discord source/thread message reads on case detail pages when bot token
  access is available.
- Discord case-review digests and observed-alert action menus link their Web
  Queue buttons to the unified inbox when a public web URL is configured.
- Reporter-facing report portal at `/report`, listing configured shared guilds,
  queueing guided private intake thread starts, queueing close requests for
  existing open intake threads, and queueing direct user reports through the
  logged-in bot worker so Discord thread creation, intake state, and report side
  effects stay bot-owned.
- Submitted report queue with close/actioned/dismissed/false-positive actions.
- Submitted report Open Case affordance backed by a shared validation boundary
  and a DB-backed bot handoff so production execution still runs through the
  existing Discord case side effects.
- Moderation inbox observed-alert actions for Open Case, Dismiss, False
  Positive, Kick, and Ban. These enqueue DB-backed bot handoffs so production
  execution still runs through the existing Discord notification, queue cleanup,
  and audit side effects. Observed Ban uses the same member-or-ID fallback as the
  Discord modal path. Observed alert history links to the member profile, where
  dismissed or false-positive observed alerts can queue Undo through the same
  bot handoff path.
- Setup controls for detection response policy, including message/join overrides,
  observed-alert thresholds, staff reason requirements, action availability
  gates, and auto-kick policy, matching `/config detection`.
- Setup controls for full report policy: report reason requirement, external
  response, confirmed-intake response, text/image analysis toggles, open-case
  threshold, image count/size caps, and maximum report-analysis authority.
- Setup controls for role-gate enablement, honeypot/member-access roles, and
  honeypot response mode.
- Setup controls for role-quarantine mode and exempt roles.
- Setup controls for heuristic detection thresholds, timeframe, and
  operator-managed watch terms, matching `/config heuristic`.
- Setup controls for manual intake enablement, trigger role, and grace period,
  with validation for the known role constraints from `/config manual-intake`.
- Setup controls for case-role lockdown allow-list settings. Lockdown audit,
  audit, and apply are split between Setup and Operations: Setup stores the
  allow-list, and Operations queues bot-owned audit/apply handoffs because they
  inspect or mutate channel overwrites. Lockdown disable remains a Discord/setup
  settings workflow.
- Setup control for the live moderation queue channel. Web stores the configured
  queue channel; the Operations page now queues immediate sync/clear through the
  bot worker so `ModerationQueueService` still owns Discord queue mutation.
- The Operations page can dry-run or confirmed-queue resolved case/evidence
  thread cleanup through the bot worker, reusing the existing
  `CaseThreadClosureSweepService` path from `/audit close-resolved-threads`.
- The Operations page can dry-run or confirmed-queue bulk role intake through the
  bot worker, reusing `SecurityActionService.intakeRoleMembers` from
  `/case intake-role`.
- The Operations page lists repo-owned deployment/runtime source files for the
  production deploy workflow, infrastructure checks, AWS runbook, backups, and
  Discord runtime checks.
- Setup controls for case responder roles, responder routing, and private thread
  member caps, matching `/config case-staff`.
- Setup controls for stale case review reminder cadence, matching the
  `/config case-review` reminder thresholds.
- Setup controls for verification reply analysis enablement, reply limit,
  maximum recommendation, and restriction threshold.
- Setup controls for verification prompt template, server context, legitimate
  member context, and expected topics.
- Setup can queue bot-owned core setup completion from the selected case role
  and admin channel, creating the verification channel when none is selected.
  It can also queue report instructions message repair from the selected report
  instructions channel, covering web handoffs for `/setupverification` and
  `/setupreportbutton` without letting the web runtime mutate Discord directly.
- Shared setup, case, and report contracts in `packages/contracts`.

Current Discord-only or mostly Discord-only capabilities:

- Native observed-alert buttons remain in Discord. Web now covers Open Case,
  Dismiss, False Positive, Kick, Ban, History, and Undo through queued bot
  handoff or member-profile read paths, but still uses the current Manage Server
  web auth gate until shared web moderator permissions are added.
- Native report context menus and audit flows not yet represented in the website
  or Operations.
- Remaining `/config` coverage for lockdown disable and advanced/raw fallback
  policy knobs.
- Live moderation queue mirrors and attention items in Discord.

Current implementation footholds:

- `moderation_queue_items` already models the backbone of a unified inbox:
  `case_mirror`, `observed_alert_mirror`, `support_thread_attention`,
  `report_thread_attention`, and `pending_screening_member`.
- `moderation_outcomes` already records first-class outcome history.
- `CaseAction` and `ReportQueueAction` name the current allowed action surface;
  web executes attention acknowledgement, report closure, report Open Case, case
  verify, case close-no-action, repair/create-thread, and sync-existing-ban
  through shared service or bot-worker handoffs.
- Web case pages queue verify, close-no-action, kick, ban, ban-by-ID,
  repair/create-thread, sync-existing-ban, and eligible reopen through
  `moderation_action_requests`. The logged-in bot worker reuses
  `UserModerationService` and `SecurityActionService` so Discord permissions,
  server policy, case role/thread updates, outcomes, and audit behavior remain
  centralized.
- Web member profiles queue Open Case for in-server targets through
  `moderation_action_requests`. The web action repeats the Moderate
  Members/Admin owner gate, self-target guard, target-state check,
  confirmation, and required-reason policy before the logged-in bot worker
  reuses `SecurityActionService.openAdminCase`.
- Web member profiles queue Flag User for in-server targets through
  `moderation_action_requests`. The web action repeats the `/flaguser`
  admin-only policy, self-target guard, target-state check, confirmation, and
  reason capture before the logged-in bot worker reuses
  `SecurityActionService.handleManualFlag`.
- Web observed-alert inbox actions queue Open Case, Dismiss, False Positive,
  Kick, and Ban through `moderation_action_requests`. Member-profile detection
  history exposes Undo for dismissed or false-positive observed alerts through
  the same queue. The logged-in bot worker reuses
  `SecurityActionService.openObservedDetectionCase`,
  `SecurityActionService.dismissObservedDetection`,
  `SecurityActionService.undoObservedDetectionAction`,
  `SecurityActionService.kickObservedDetection`, and
  `SecurityActionService.banObservedDetection`, keeping Discord notification
  updates, queue mirror restore/cleanup, linked report closeout/reopen, admin
  actions, outcomes, and analytics centralized.
- Web member-profile detection rows queue Ignore Detection and Restore
  Accounting through `moderation_action_requests`. The logged-in bot worker
  reuses `SecurityActionService.excludeDetectionFromAccounting` and
  `SecurityActionService.restoreDetectionAccounting`, keeping audit records,
  accounting metadata rollback, observed false-positive notification restore,
  queue mirror restore, and analytics centralized.
- Web reporter actions queue `start_report_intake`, `close_report_intake`, or
  `submit_user_report` `moderation_action_requests` rows from `/report`.
  Guided intake verifies OAuth guild membership and a configured report
  instructions channel before queueing; the bot worker verifies reporter
  membership, avoids duplicate open intakes, creates and activates the private
  thread, persists intake state, and sends the same admin notification affordance
  as the Discord report button. Closing an open intake revalidates that the
  signed-in reporter owns the current open intake and requires confirmation
  before queueing; the bot worker loads the Discord thread, calls
  `ReportIntakeService.closeIntakeForThread`, posts the closeout, and archives
  the thread when the service says to. Direct report submission verifies target
  ID shape, self-report, confirmation, and saved reason policy before queueing;
  the bot worker reuses `ReportSubmissionService.submitUserReport` so
  `USER_REPORT` detections, active-case linkage, observed alerts, and report
  policy remain centralized.
- Web report closures run through `ReportReviewService`; report Open Case now
  also enters through `ReportReviewService.openCaseFromSubmittedReport` before
  queuing a `moderation_action_requests` row for the logged-in bot to execute.
  Future report actions should keep using that shared service boundary instead
  of route-local SQL.
- `docs/web-moderation-control-parity.md` is the current living matrix for the
  first workstream.
- This branch has the read-mostly inbox slice with `ModerationInboxItem`,
  `ModerationInboxDataAdapter`, `/admin/guild/[guildId]/inbox`, fixture data,
  Storybook coverage, Playwright smoke/visual coverage, type/freshness filters,
  saved-view presets, search, sort controls, and a selected-item detail rail.
  Queue attention acknowledgement is the first low-risk web write and shares
  `QueueAttentionService` with the Discord button path; the visible-replies
  batch action loops each item through the same service. The inbox also exposes
  a visible-row review export packet for external review without adding
  moderation side effects. Destructive bulk web actions are still intentionally
  deferred.
- This branch also moves submitted-report actioned/dismissed/false-positive
  closures through `ReportReviewService`, including actor/surface metadata and
  best-effort report-thread attention queue cleanup.
- This branch adds the first submitted-report Open Case web boundary:
  `ReportReviewService.openCaseFromSubmittedReport` validates submitted report
  state, confirmed target, linked detection, and duplicate-case state before
  delegating to an injected opener. Fixture mode exposes an enabled web button;
  production enqueues an idempotent `moderation_action_requests` handoff, and
  the bot worker processes that request through
  `SecurityActionService.openObservedDetectionCase`.
- This branch adds `/admin/guild/[guildId]/reports/[reportId]` as the first
  read-only report detail workbench, with retained evidence, Discord links,
  linked-case routing, and submitted-report closure actions.
- This branch exposes report policy controls on the web setup page, including
  `/config report` reason, external report, intake response, and analysis caps.
- This branch expands detection response controls on the web setup page, covering
  `/config detection` response modes, notification thresholds, reason/action
  gates, and auto-kick policy.
- This branch exposes role-gate controls on the web setup page, covering
  `/config role-gate`.
- This branch exposes role-quarantine controls on the web setup page, covering
  `/config role-quarantine`.
- This branch exposes heuristic detection threshold/timeframe/watch-term controls
  on the web setup page, covering `/config heuristic`.
- This branch exposes manual intake trigger-role and grace-period controls on the
  web setup page, covering `/config manual-intake` while preventing the trigger
  role from reusing the case role.
- This branch exposes lockdown allow-list settings on the web setup page without
  directly mutating Discord channel overwrites.
- This branch exposes lockdown audit/apply controls on the Operations page.
  Audit queues a read-only bot-owned `CaseRoleLockdownService.auditGuild` run;
  confirmed apply queues `CaseRoleLockdownService.applyGuild`, including the
  optional allowed-channel unsync flag.
- This branch exposes bulk role-intake controls on the Operations page. Dry-run
  queues a preview for the selected role; confirmed execution queues an
  `intake_role_members` request that the logged-in bot worker processes through
  `SecurityActionService.intakeRoleMembers`.
- This branch exposes the live moderation queue channel on the web setup page.
  It stores `moderation_queue_channel_id`; immediate sync/clear is exposed on
  the Operations page through a bot-worker handoff because the web runtime does
  not own the live Discord queue service.
- This branch exposes bot-owned setup completion and report instructions button
  repair on the web setup page. Core setup queues a
  `complete_setup_verification` request through `SetupWorkflowService` using the
  selected case role and admin channel, creating a verification channel when none
  is selected. Report button repair queues an `upsert_report_instructions`
  request through `ReportInstructionsManager`, preserving the existing Discord
  message creation/update path.
- This branch exposes resolved-thread sweep controls on the Operations page.
  Dry-run is the default action; confirmed execution queues a
  `close_resolved_case_threads` `moderation_action_requests` row that the
  logged-in bot worker processes through `CaseThreadClosureSweepService`.
- This branch exposes case responder role/routing/member-cap controls on the web
  setup page, covering `/config case-staff`.
- This branch exposes case review reminder enable/stale/repeat/very-stale
  settings on the web setup page, using the same bounds as `/config case-review`.
- This branch exposes verification prompt/context and reply-analysis controls on
  the web setup page, covering `/config verification`.
- This branch adds the first resolved-case history surface. It reuses the case
  summary read model, keeps resolved cases read-only, links to Discord surfaces,
  and routes eligible in-server reopen actions through the bot-owned request
  worker. The history page now supports client-side search, outcome filtering,
  sorting, and visible-row export for bulk review handoff.
- This branch adds the first member-history surface at
  `/admin/guild/[guildId]/members/[userId]`, linked from case detail identity.
  The page composes case summaries, reviewed reports, detection history,
  moderation outcomes, membership status, and Discord source links for one
  server-local user. Stored source-message detections can now queue Open Case
  with source evidence after web-side context revalidation.
- This branch adds destructive single-case web handoffs for kick, ban, and ban
  by ID. The web action requires moderator permission, server policy, live bot
  capability, reason/confirmation inputs, and the bot worker repeats policy and
  bot-permission checks before calling the existing moderation service methods.
- This branch adds the first member-profile case-opening handoff. In-server
  member profiles expose Open Case with confirmation and reason capture. Stored
  source-message detections also expose Open Case from Source, carrying the
  selected channel/message IDs into an idempotent `open_admin_case`
  `moderation_action_requests` row. The bot worker fetches the source message
  when possible and processes both paths through
  `SecurityActionService.openAdminCase`.
- This branch adds the first member-profile manual flag handoff. In-server
  member profiles expose Flag User with confirmation and reason capture;
  production enqueues an idempotent `manual_flag_user`
  `moderation_action_requests` row, and the bot worker processes it through
  `SecurityActionService.handleManualFlag`.
- This branch adds the first Operations page at
  `/admin/guild/[guildId]/operations`. It exposes Administrator-only live queue
  Sync Queue, confirmed Clear Queue, resolved-thread sweep dry-run/execute, and
  case-role lockdown audit/apply, and bulk role-intake dry-run/execute actions;
  production enqueues idempotent `moderation_action_requests` rows, and the bot
  worker processes them through `ModerationQueueService`,
  `CaseThreadClosureSweepService`, `CaseRoleLockdownService`, or
  `SecurityActionService.intakeRoleMembers`. The page also shows recent
  web-requested
  handoff status and operation result summaries so moderators can see whether
  queued work has completed or failed without leaving the dashboard. It now
  includes the first read-only database-backed integrity snapshot for durable
  case, outcome, role-marker, quarantine, and queue-pointer drift; Discord-live
  member, ban, channel, and message fetches remain bot-owned under
  `/audit integrity`. It also lists deployment/runtime workflow and runbook
  sources so operator health checks are reachable from the workbench.

## Product Principles

- Do not make a button-for-button Discord clone. Discord remains the fast in-server
  action surface; web should be better for scanning, filtering, comparing, and
  resolving many items.
- Keep evidence provenance in Discord messages, threads, and stored source records.
  The web workbench can summarize and index, but copied text is convenience
  material, not the source of truth.
- A report is a signal, not proof. Report-only review should stay quiet until a
  moderator or configured policy opens a case or takes a direct action.
- A case means the configured case role plus a normal user-visible case thread,
  unless a specific future workflow deliberately changes that product contract.
- Web write actions must use the same policy checks, role/thread side effects,
  audit records, and idempotency rules as Discord actions.
- Keep user-visible copy deterministic and productized. Avoid over-labeling actions
  or report evidence as AI-driven.
- Do not expose private server, customer, guild, or production-environment names in
  public docs, PRs, issues, persisted metadata, or UI copy.
- Do not hardcode threat indicators, operator names, campaign labels, watched
  terms, or domains in source code. Globally watched indicators belong in
  operator-managed storage.

## Target Information Architecture

The future web surface should be organized around moderator work, not underlying
tables.

- **Inbox**: the default triage home. Unified queue for cases, observed alerts,
  reports, report/support attention, and pending screening.
- **Case Detail**: focused review of one user/server case with evidence, history,
  current state, and action rail.
- **Report Review**: report-intake evidence and target confirmation context,
  linked into the inbox and case detail where applicable.
- **Member Profile**: server-local user history, detections, cases, reports,
  outcomes, role state, and Discord links.
- **Setup**: server configuration, permission diagnostics, role/channel choices,
  policy tuning, and onboarding health.
- **History**: resolved cases, report closures, moderation outcomes, false
  positives, ignored/restored detections, and audit trails.
- **Operations**: integrity audit, queue repair, resolved-thread sweep, deployment
  health, and bot permission drift.

Do not add all of these pages at once. Use the workstreams below to land
incremental, reviewable slices.

## Context Ladder For Future Agents

Every web-moderation `/goal` run should start with:

- `AGENTS.md`
- `AGENTS.local.md` when present
- This document
- `docs/web-dashboard.md`
- `docs/workflow.md`
- `docs/cases.md`
- `docs/report-ux-journeys.md`
- `docs/moderation-flow.md`
- `docs/moderation-permissions.md`

For inbox/read-model work, then read:

- `prisma/schema.prisma`
- `packages/contracts/src/cases.ts`
- `packages/contracts/src/reports.ts`
- `apps/web/lib/activeCaseDataAdapter.ts`
- `apps/web/lib/reportQueueDataAdapter.ts`
- `src/services/ModerationQueueService.ts`
- `src/repositories/ModerationQueueRepository.ts`

For write-action work, then read:

- GitHub issue #89
- `src/services/SecurityActionService.ts`
- `src/services/UserModerationService.ts`
- `src/controllers/InteractionHandler.ts`
- `src/controllers/CommandHandler.ts`
- `src/controllers/CaseCommandHandler.ts`
- `src/services/NotificationPresentationBuilder.ts`
- Unit tests for the action being mirrored

For setup-parity work, then read:

- `src/controllers/commandDefinitions.ts`
- `packages/contracts/src/setup.ts`
- `apps/web/lib/setupDataAdapter.ts`
- `apps/web/lib/setupDashboardService.ts`
- `apps/web/app/admin/guild/[guildId]/setup/page.tsx`
- Settings helpers under `src/utils/*Settings.ts`

For frontend implementation, then read:

- `apps/web/app/globals.css`
- Current `apps/web/components/cases/*`
- Current `apps/web/components/reports/*`
- Existing web Vitest, Playwright, and Storybook/visual patterns

## Workstreams

### 1. Control And Affordance Inventory

Create a living parity matrix before adding many controls.

Capture:

- Discord command or interaction name.
- Current Discord permissions and bot capability requirements.
- Product action category: read, write, destructive, repair, setup, audit, or
  diagnostic.
- Current service/controller entrypoint.
- Required confirmation, reason, or modal fields.
- Existing audit records and outcome records.
- Whether web should support it now, later, or never.
- The target web page or component.

Initial families to inventory:

- Reports: `/report`, report context menus, report button intake,
  `/close-report`, close/actioned/dismissed/false-positive, open case, kick, ban,
  history, and undo.
- Cases: `/case open`, context Open Case, `/flaguser`, verify, close no action,
  kick, ban, ban by ID, sync existing ban, repair/create thread, refresh, reopen,
  and history/member profile.
- Live queue: case mirrors, observed alert mirrors, support-thread attention,
  report-thread attention, pending screening, and acknowledge.
- Setup/config: required channels/roles, detection policy, case staff, case
  review, case queue, role gate, role quarantine, lockdown, manual intake,
  reports, analytics, verification analysis, heuristics, and message deletion.
- Audit/maintenance: integrity audit, close resolved threads, ignore detection,
  restore detection, queue repair, and setup validation.

Done when:

- The matrix is committed in docs or generated from a structured source.
- The matrix identifies the first safe web-write actions and the action families
  that must wait for #89-style service extraction.

### 2. Unified Moderation Inbox

Build the web surface around the existing live queue concept.

The first implementation can be read-only or nearly read-only. It should combine:

- Pending case mirrors.
- Unresolved observed alerts.
- Submitted reports.
- Support-thread attention items.
- Report-thread attention items.
- Long-pending screening members.

Recommended route:

- Add `/admin/guild/[guildId]/inbox` as the primary triage page.
- Keep `/cases` and `/reports` as focused views or redirects once the inbox is
  mature.

Recommended UI shape:

- Dense list or table, not stacked card towers.
- Split pane with queue on the left and selected item detail on the right.
- Filters for item type, stale/fresh, severity/confidence, report/case state,
  member presence, action availability, and source.
- Sorts for stale first, newest, oldest, highest confidence, last reporter reply,
  and member-left cases.
- Compact action rail showing available actions, even if early actions are
  "available in Discord" links.
- Stable links back to Discord source messages, queue messages, case threads,
  report threads, and admin notifications.

Contract/read-model notes:

- Add a `ModerationInboxItem` contract instead of forcing every item into
  `CaseSummary` or `ReportQueueItem`.
- Keep item IDs and source IDs distinct.
- Preserve the source table/item type so actions can route correctly.
- Include enough display identity to avoid extra per-row Discord lookups.
- Model "needs attention" separately from "case pending"; a support-thread reply
  can need attention even when the case is already visible elsewhere.

Done when:

- The inbox shows all five `moderation_queue_item_type` families where data
  exists, plus submitted reports if they are not already represented by queue
  items.
- Empty, loading, error, permission-denied, and fixture states are covered.
- Existing case and report pages still work.
- Unit tests cover parsing/sorting/filtering.
- Playwright covers guild selection into the inbox and at least one detail state.
- Visual snapshots cover the primary desktop and mobile states.

### 3. Shared Web/Bot Action Boundary

Do this before serious web write parity.

The shape should satisfy issue #89: controllers, web server actions, agents, and
future MCP tools should call reusable operations instead of duplicating repository
updates and Discord side effects.

Candidate application services:

- `ModerationActionService`
  - verify case
  - close no action
  - kick from case
  - ban from case
  - ban by ID
  - sync existing ban
  - reopen/repair/create thread
  - open case from observed alert or report
- `ObservedAlertActionService`
  - open case
  - dismiss/close report
  - false positive
  - undo dismissal
  - kick
  - ban
- `ReportReviewService`
  - close submitted report
  - mark actioned
  - false positive
  - link/open case
  - preserve evidence and outcome metadata
- `QueueAttentionService`
  - acknowledge report/support attention
  - refresh/sync mirrors
- `ServerPolicyService`
  - read/update setup sections with common validation
  - return per-action policy and permission decisions

Every write operation should accept explicit actor metadata:

- actor Discord user ID
- guild ID
- source surface: Discord command, Discord interaction, web, agent, MCP, repair,
  migration, or sync
- request ID or idempotency key when useful
- reason and confirmation data
- source item IDs: case, detection, report intake, queue item, source message

Done when:

- At least one existing Discord action and one web action share the same service
  operation. First slice: Discord and web queue-attention acknowledgement share
  `QueueAttentionService`.
- Direct web SQL writes for report closures are moved behind `ReportReviewService`.
- Authorization, policy, audit, outcome, and Discord side effects live below UI
  adapters.
- Unit tests cover idempotency and duplicate-submit behavior.

### 4. First Web Write Actions

Start with low-risk actions that prove the boundary.

Recommended order:

1. Acknowledge support/report attention items.
2. Close submitted report as actioned/dismissed/false-positive through the shared
   service path.
3. Open case from a submitted report or observed report alert. Current queued
   handoff.
4. Dismiss/false-positive observed alert actions and Undo. Current queued
   handoff.
5. Case verify and close no action.
6. Case repair/create thread/reopen.
7. Kick and ban actions. Current queued handoff for single-case kick, ban, and
   ban by ID, plus observed-alert kick and ban.

Do not start with destructive bulk actions. Ban and kick need the full reason,
permission, bot capability, confirmation, and Discord failure behavior proven
first.

Web action UX requirements:

- Show the action only when the actor can currently use it.
- Explain missing actions through diagnostics, not dead buttons.
- Require the same reason fields and thresholds as Discord.
- Confirmation screens must show role-gate cleanup, role quarantine, case role,
  thread, and report side effects before execution.
- Use idempotent server actions so refresh/back/retry does not double-act.
- After execution, refresh the inbox item and linked case/report detail.

Done when:

- Each action has contract tests, service tests, web action tests, and at least one
  Playwright path.
- Discord and web produce equivalent admin actions, moderation outcomes, report
  statuses, queue cleanup, and notification updates for the same scenario.

### 5. Case Detail Workbench

Turn case detail from a read-only stack into the primary review workspace.

Target layout:

- Persistent identity/state rail with user, server presence, case age, stale
  status, confidence, and allowed actions.
- Evidence tabs or sections for source message, report evidence, admin evidence
  thread, user-facing support thread, recent message context, detection history,
  and moderation outcomes.
- Timeline view that merges detections, report evidence, admin actions, outcomes,
  thread events, and queue attention.
- Search within fetched thread messages and retained context.
- Copy buttons for case ID, user ID, detection IDs, report intake IDs, and message
  links.
- Clear freshness states when Discord messages could not be fetched.

Done when:

- Moderators can understand why a case exists without opening Discord first.
- Discord provenance remains one click away for every source.
- The page does not use nested card stacks for list-like evidence.
- It has fixture coverage for member-in-server, member-left, already-banned,
  report-linked, no-thread, and fetch-failure states.

### 6. Report Review Workbench

Make reports manageable from web without weakening the report/case boundary.

Target behavior:

- Submitted reports appear in the unified inbox.
- Report details show reporter, target, status, evidence, target confirmation
  history, linked detection, linked case, thread/source links, and closure history.
- If no case exists and a confirmed target exists, "Open Case" creates a normal
  case: case role applied, user-facing thread opened, admin notification updated.
- Closing, dismissing, and false-positive actions update report intake status,
  observed alert state, admin actions, moderation outcomes when appropriate, and
  queue items consistently.
- The old report open-case placeholder points at the workbench/service-boundary
  plan instead of the completed #131 message-deletion issue.

Done when:

- A moderator can finish the normal submitted-report path from the website.
- The implementation still prevents report-only review from silently applying a
  case role or notifying the reported user.

### 7. Setup Parity

Move from "core setup form" to full server policy control.

Group the web setup surface by operator intent:

- Required surfaces: case role, admin channel, verification channel, report
  channel, observed alert channel, queue channel, notification role.
- Detection policy: default/message/join/honeypot response, thresholds,
  notification windows, moderator exemption, auto-kick/kick/ban affordances, and
  reason requirements.
- Case staffing: responder roles, routing mode, member cap, evidence-thread
  behavior, and case review reminders.
- Role policy: lockdown, role gate, honeypot/member-access roles, role quarantine,
  exemptions, and manual intake trigger roles.
- Report policy: reason requirement, external reports, report-intake response,
  AI text/image analysis, max action, image caps, and target confirmation.
- Verification policy: prompt, server context, expected topics, thread analysis,
  limits, and max recommendation.
- Message deletion: source-message deletion, watchlist matching, default entries,
  custom terms, and permission diagnostics.
- Analytics/privacy: consent level and data-sharing explanation.
- Audit/repair: validation, integrity audit, queue sync, close resolved threads,
  ignore/restore detection.

Done when:

- The web setup surface can express every stable `/config` setting.
- Risky or rarely used settings are still understandable and recoverable.
- The same validation powers Discord setup and web setup.
- The setup UI exposes diagnostics before admins save broken combinations.

### 8. Bulk Triage And Saved Views

Only add bulk actions after single-item write paths are proven.

Useful bulk capabilities:

- Saved views such as "stale cases", "reports awaiting target", "member left",
  "high confidence alerts", "support replies", and "screening pending". Current
  first slice covers all, stale cases, reports, observed alerts, replies, and
  screening as local inbox presets.
- Multi-select for non-destructive or reversible actions.
- Batch close/dismiss false positive with an explicit reason.
- Batch acknowledge attention items. Current first slice acknowledges visible
  reply-attention items by looping through the same `QueueAttentionService` as
  single-item acknowledge.
- Export/copy selected IDs and links for external review.
  Current first slice exports visible filtered rows as a tab-separated review
  packet.

Avoid:

- Bulk ban or kick until the product has a separate safety design.
- Bulk hidden side effects.
- Any action that bypasses per-item policy checks.

Done when:

- Batch actions run per item through the same service boundary and report partial
  success/failure clearly.

### 9. History, Analytics, And Learning Loop

Use the web surface to make outcomes useful, not just stored.

Target capabilities:

- Resolved case and report history.
- Member profile/history for one server-local user. Current first slice covers
  cases, reports, detections, outcomes, membership status, and Discord links.
- Outcome breakdowns by source: Drasil, native Discord, external bot, unknown,
  migration/sync.
- False-positive and dismissed-alert review.
- Trends over time by detection type, confidence bucket, report source, and action
  result.
- Links from history rows back to case/report detail and Discord provenance.
- Future support for issue #20-style model/evaluation work without exposing
  private cross-server evidence.

Done when:

- Moderators and maintainers can answer "what happened, why, and how often" from
  the website.
- Outcome views do not leak private server evidence across guilds.

### 10. Quality, QA, And Deployment

Every meaningful web slice should update tests and manual QA at the same level of
risk as the change.

Expected verification options:

- Contract tests for new schemas and action policy decisions.
- Adapter tests for Postgres row parsing and fixture mode.
- Service tests for side effects, idempotency, permission denial, and Discord
  failure handling.
- Component/story coverage for empty, loading, error, denied, stale, destructive,
  and mobile states.
- Playwright smoke and visual tests for primary flows.
- Manual QA updates in `docs/manual-qa.md` when Discord plus web behavior changes.
- `npm run check:ci` before PR when dependencies and local DB state allow it.

Deployment guardrails:

- Keep production web deploys under the existing GitHub Actions/Vercel authority.
- Call out manual, exploratory, migration, provider, or production-impact checks
  in PRs. Do not repeat routine required checks in PR descriptions.
- Resolve AI and human review threads before merge.

## Suggested Execution Order

This order is designed for `/goal` sessions that can continue across context
compaction and handoff.

1. **Inventory and IA**
   - Add the parity matrix.
   - Decide route names and navigation shape.
   - Retire or update stale TODO references.

2. **Read-only unified inbox**
   - Add `ModerationInboxItem` contracts.
   - Add a Postgres adapter over `moderation_queue_items`, active cases,
     observed alerts, and submitted reports.
   - Add `/admin/guild/[guildId]/inbox`.
   - Keep existing `/cases` and `/reports` intact.

3. **Inbox detail and filtering**
   - Add split-pane detail previews for each inbox item type.
   - Add filters/sorts/search and fixture coverage.

4. **Shared action boundary**
   - Extract the smallest useful service operation shared by Discord and web.
   - Move report closure or queue attention behind it.

5. **First web writes**
   - Acknowledge attention.
   - Close/dismiss/false-positive report through shared services.
   - Open case from report or observed alert.
   - Dismiss/false-positive observed alerts through queued bot handoff.
   - Kick/ban observed alerts through queued bot handoff with confirmation,
     reason capture, server policy, actor permission, and bot capability gates.

6. **Case action parity**
   - Verify and close no action first. Current queued handoff.
   - Repair/create thread. Current queued handoff.
   - Sync existing ban. Current queued handoff.
   - Refresh stored admin notifications. Current queued handoff.
   - Reopen eligible resolved in-server cases. Current queued handoff.
   - Kick/ban last. Current queued handoff with confirmation and reason capture.

7. **Report review workbench**
   - Build report detail and evidence workflow.
   - Make the report-to-case path first-class.

8. **Setup parity**
   - Add policy sections one family at a time.
   - Prefer shared validation and typed contracts over one-off form updates.

9. **Bulk triage**
   - Saved inbox views and visible-reply batch acknowledge are started; add
     other safe batch actions later.

10. **History and analytics**
    - Add outcome/review dashboards and learning-loop exports.

## Suggested `/goal` Prompts

Use prompts like these to start bounded future runs:

```text
/goal Use docs/web-moderation-workbench-goal.md. Implement workstream 1:
create the Discord-to-web control parity matrix and update stale TODO references.
Do not implement web actions yet.
```

```text
/goal Use docs/web-moderation-workbench-goal.md. Implement the first read-only
unified inbox slice for case mirrors, observed alert mirrors, and submitted
reports. Keep existing case/report routes working.
```

```text
/goal Use docs/web-moderation-workbench-goal.md and issue #89. Extract the
smallest shared service boundary needed for web and Discord report closure
actions, then move the existing web report closure SQL path behind it.
```

```text
/goal Use docs/web-moderation-workbench-goal.md. Continue case action parity by
moving case reopen behind a resolved-case web surface and shared service operation,
preserving Discord thread, role, audit, and outcome side effects.
```

## Non-Goals Until Explicitly Reopened

- No AI-only auto-ban path.
- No broad raw-evidence retention expansion without a separate privacy and
  retention decision.
- No cross-server evidence views for ordinary guild admins.
- No Convex migration just to build the moderation workbench.
- No package manager migration.
- No direct web writes that intentionally bypass shared policy, audit, and Discord
  side effects.
- No bulk destructive actions before single-item paths are proven.
- No hardcoded threat-intel indicators or private server/operator names in source,
  public prose, persisted metadata, or UI labels.

## Open Decisions

- The current route decision is `/admin/guild/[guildId]/inbox`; revisit only if
  implementation discovers a better product fit.
- Should "Open Case" be relabeled in report contexts to make the case role/thread
  side effect clearer?
- Should submitted reports become `moderation_queue_items`, or should the inbox
  adapter merge reports as a parallel source?
- What extra role-gate cleanup or role-quarantine preview should be shown before
  web destructive case actions execute?
- Which additional member-profile active controls belong there after Open Case,
  observed Undo, and detection accounting prove out the single-item model?
- Should role-gate cleanup and role-quarantine previews be rendered from a shared
  dry-run service before any web verify/close action ships?
- How much of audit/repair belongs under Setup versus Operations?

## Maintenance Rule

After each PR in this area, update this document only if the plan itself changed.
Prefer adding small "done/current state" notes over rewriting the whole plan. If a
workstream becomes large, split it into a dedicated design doc and link it here.
