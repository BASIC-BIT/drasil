# Shared action boundary for Drasil

## Outcome and delivery

Make every existing externally initiated action reusable from Discord, web, and a future MCP adapter. One application operation owns each action's permissions, server policy, state checks, and orchestration. Existing domain services continue owning their state transitions, Discord effects, and recovery mechanisms.

The entire initial migration lands in **one pull request**. Action families are implementation and review checkpoints within that PR. They are not separate PRs or reasons to defer existing actions. The PR is complete only when the action inventory below is covered and superseded caller paths are removed.

Preserve current direct and queued execution. Do not make every mutation a durable job. This effort prepares reusable operations but does not implement an MCP endpoint.

## Confirmed requirements

- Cover all current action families, including operations outside the moderation request queue.
- Migrate Discord callers, web callers, and queued workers together for each family.
- Keep direct interactions responsive and keep existing durable jobs durable.
- Enforce action permissions and mutable policy at execution, including queued execution.
- Preserve existing access restrictions, confirmation requirements, audit provenance, evidence retention, request deduplication, and recovery outcomes.
- Remove replaced internal entry paths in the same PR. Retain shipped database and Discord payload compatibility where required.
- Use one PR and one integration branch for this initial effort.

## Current implementation

Research baseline: commit `8a7655d`.

The schema contains 40 `moderation_action_request_type` values. `ModerationActionRequestService` combines worker lifecycle with action-specific orchestration. Discord controllers often call `UserModerationService`, `SecurityActionService`, and configuration services directly. Web server actions perform authorization, policy, reason, and confirmation checks before using action queues or direct adapters.

Reusable operations already exist in `ReportReviewService` and `QueueAttentionService`, but their callers still own authorization. The web imports these services through relative paths into the root `src` directory. Actor-source types differ between services, and some web data adapters hardcode the source as `web`.

Enqueue behavior is implemented twice: Prisma SQL in `src/repositories/ModerationActionRequestRepository.ts` and pg SQL in `apps/web/lib/moderationActionRequestQueue.ts`. Both encode sensitive report-ban retry eligibility. They are not interchangeable today; the migration must characterize the existing differences before consolidating them.

The root bot compiles CommonJS. The Next.js app uses ES module imports. The shared package must work in both builds and in the deployed bot container.

## Caller experience

A direct caller provides an authenticated actor context and action-specific input, then receives the operation's typed result. For example, a case verification takes a guild, actor, and case ID. It does not require the controller to fetch the member, check case policy, resolve the moderator, call verification, and assemble audit information independently.

A remote caller submits the same action-specific command through the existing queue when that operation already requires bot-owned execution. Submission returns a request receipt. The worker decodes the persisted command and invokes the same family operation used by direct callers.

Web actions that currently execute directly, such as attention acknowledgement and configuration persistence, retain direct execution through shared operations with web-compatible dependencies.

## Ownership

| Component                    | Owns                                                                                                                               | Must not own                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Discord adapter              | Authenticate the interaction, parse command or modal data, collect confirmation, render replies                                    | Independent moderation policy or state transitions                  |
| Web adapter                  | Authenticate the session, parse form data, retain dashboard access restrictions, render or redirect                                | Independent moderation policy, retry rules, or action orchestration |
| Application family operation | Required authority, server policy, bound target and current-state checks, confirmation requirements, orchestration, typed outcomes | Framework sessions, Discord interaction objects, SQL row formats    |
| Queue submission adapter     | Encode a validated action command, submit through shared request persistence, return a receipt                                     | Decide moderation eligibility independently                         |
| Worker                       | Claiming, leases, heartbeats, decoding, dispatch, execution-status persistence                                                     | Copies of family-specific business workflows                        |
| Domain workflow services     | Existing Discord effects, state transitions, evidence, audit, and recovery mechanisms                                              | Trust an arbitrary caller-supplied actor ID as authorization        |
| Persistence adapters         | Parameterized queries, atomic claims, storage mappings                                                                             | UI behavior or new policy definitions                               |

An operation must own real rules or coordination. Do not add forwarding-only wrappers around every existing method.

## Shared package and runtime composition

Create `packages/application` as `@drasil/application`. Organize it by action family, with shared context, policy facts, results, and persistence utilities where more than one family needs them.

Proposed module map:

```text
packages/application/src/
  context.ts
  results.ts
  cases/
  reports/
  detections/
  containment/
  messageCleanup/
  operations/
  setup/
  requests/
  postgres/
src/application/
  createBotApplication.ts
  adapters/
  requestDispatch.ts
apps/web/lib/application/
  createWebApplication.ts
  adapters/
```

Each family contains its commands, input schemas, policy decisions, operation implementations, and narrowly defined dependency interfaces. Split files by responsibility as implementation requires. Do not replace the large worker with a large universal action service.

The core package depends on Zod and plain TypeScript contracts. It must not import Next.js, discord.js, Prisma, root DI, or application credentials. Keep SQL utilities behind the separate `@drasil/application/postgres` entry point. Core imports must not load persistence code.

Use compiled CommonJS with TypeScript declarations and explicit package exports compatible with Node 22.22.0 and the Next.js build. Build the package before its consumers in development, tests, CI, and the bot image. Do not copy the contracts package's ESM-only source exports into a bot runtime dependency without verifying CommonJS execution.

Bot composition implements dependencies using the existing Discord client, DI services, and repositories. Web composition uses the existing pg and Discord REST adapters. Shared operations accept IDs and domain values. SDK objects remain inside runtime adapters. Keep established domain workflows intact rather than rewriting discord.js-dependent internals solely to remove their SDK dependency.

## Context, commands, and results

The application context carries the guild ID, trusted actor, invocation source, and request ID. Direct invocations receive a request ID for correlation without requiring a durable request row.

Actors are distinct variants for an authenticated Discord user and an internal system operation. A system actor has an allowlisted purpose and cannot stand in for an unrestricted administrator. Reporter operations preserve reporter authority separately from staff authority. Neither web forms nor future MCP arguments choose the acting identity or grant a system actor.

Invocation source describes provenance, not permission. Preserve existing stored source strings. Extend shared types for future adapters without registering an MCP endpoint or granting MCP access in this PR.

Commands are action-specific discriminated unions derived from boundary schemas. Required case, report, detection, preview, and cleanup bindings belong to the relevant variant. Avoid an unrestricted action string plus optional IDs and arbitrary metadata as the public API. Persisted legacy rows are decoded into these commands at the worker boundary.

Keep domain-specific results. Distinguish completion, already handled, busy or stale state, policy denial, and execution failure. Preserve uncertain enforcement and confirmed enforcement with pending follow-up work. A queued receipt is not a successful moderation outcome. Do not flatten existing result detail into a generic boolean.

The public operation API does not expose raw exception objects, vendor responses, SQL rows, or internal lease tokens. Runtime adapters retain diagnostics and return the existing useful failure distinctions.

## Authorization and confirmation

Authentication stays with the interface adapter. The operation resolves the actor's required authority through a runtime dependency and applies the common action policy. UI availability may use the same policy evaluator, but an earlier availability check never authorizes later execution.

Recheck mutable authority, guild policy, target bindings, and relevant state immediately before effects. Preserve existing fresh-fetch requirements for report bans. Do not treat cached permission or a recorded queued actor ID as sufficient authority.

Recovery after durable enforcement success preserves existing continuation rules even if the initiating actor loses permission or the server later disables the action. Such recovery finalizes the recorded operation and must not perform enforcement again. Keep that internal continuation distinct from authorizing a new action.

Retain interface access restrictions independently of operation authority. For example, the web dashboard currently requires Manage Server access, while Discord acknowledgement accepts moderation permissions. Preserve that web entry restriction and enforce acknowledgement authority in the shared operation. Existing owner-only analytics consent and administrator-only setup, cleanup, and repair rules remain explicit policies.

Move confirmation requirements out of controller-specific conditionals. The interface still gathers the human's confirmation using its existing interaction flow. Bind confirmation to the actor, action, guild, target, and relevant preview or state version where the existing workflow does so. A caller-controlled `confirmed: true` must not replace an existing server-side pending interaction, preview, challenge generation, or report-target confirmation.

Record current permission differences in the implementation inventory. Preserve restrictions during extraction. Where a path currently omits an execution-time check, apply the documented action authority in the common execution operation and test the revoked or departed actor case. This strengthens enforcement without granting new permissions.

## Execution and persistence

Preserve the current choice of direct or queued execution for each interface. The same operation can execute directly in the bot or be called by a worker. A web runtime must not construct root bot DI to invoke an operation.

Extract family-specific processing from `ModerationActionRequestService` into the shared operations and runtime adapters. Leave worker lifecycle and request dispatch in the worker. Use an exhaustive handler registry against the supported queued command union. Adding an enum member without an intentional supported decoder and handler must fail verification.

Keep existing request types, statuses, metadata fields, IDs, idempotency keys, and lease semantics readable. Existing queued rows may outlive a deployment. Decode shipped shapes explicitly and avoid speculative aliases. No new queue or generic workflow engine is needed.

Consolidate duplicated enqueue SQL and its report-ban retry predicate in one shared parameterized statement builder under the postgres entry point. Prisma and pg adapters execute that statement through their existing clients and map its result. Preserve their required transaction boundaries and caller-specific return shapes in adapters. Characterization tests must establish intended concurrency and retry behavior before replacing either statement.

Do not rewrite unrelated worker claim, reconciliation, or domain transaction SQL. Deduplication and recovery remain specific to the operation. A repeated request must not repeat a confirmed ban, revive an uncertain operation, reuse a stale attempt token, or apply a stale cleanup preview.

Existing domain services continue recording moderation audit and outcomes. The boundary supplies the actual actor, source, request correlation, and reason. Do not add duplicate audit records or a durable request for every direct action merely to make receipts look uniform.

## Complete queued-action inventory

All 40 current queue types remain supported. Their current per-interface queue behavior stays unchanged. The target family owns the execution rules; the worker owns delivery.

| Target family   | Existing queue action types                                                                                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cases           | `open_case_from_observed_detection`, `open_admin_case`, `manual_flag_user`, `verify_case_user`, `close_case_no_action`, `kick_case_user`, `ban_case_user`, `ban_case_user_by_id`, `repair_active_case`, `reopen_case`, `refresh_case_notification`, `sync_existing_ban` |
| Reports         | `submit_user_report`, `start_report_intake`, `close_report_intake`                                                                                                                                                                                                      |
| Detections      | `dismiss_observed_detection`, `mark_observed_detection_false_positive`, `undo_observed_detection_action`, `kick_observed_detection`, `ban_observed_detection`, `ignore_detection_accounting`, `restore_detection_accounting`                                            |
| Containment     | `preview_account_quarantine`, `quarantine_compromised_account`, `request_captcha_challenge`, `retry_captcha_challenge`, `bypass_captcha_challenge`, `apply_captcha_pass`, `notify_captcha_attention`                                                                    |
| Message cleanup | `preview_case_message_deletion`, `execute_case_message_deletion`, `ban_case_user_with_message_cleanup`                                                                                                                                                                  |
| Operations      | `sync_moderation_queue`, `clear_moderation_queue`, `close_resolved_case_threads`, `audit_case_role_lockdown`, `apply_case_role_lockdown`, `intake_role_members`                                                                                                         |
| Setup           | `complete_setup_verification`, `upsert_report_instructions`                                                                                                                                                                                                             |

Cross-family operations coordinate through existing domain workflow services rather than reimplementing the same ban, role-release, or report-claim sequence. In particular, a submitted-report ban retains its report-bound workflow even though its persisted type is `ban_observed_detection`.

## Operations outside the queue

These are part of the same PR. Queue coverage alone does not finish the migration.

| Family          | Additional existing operations and callers                                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cases           | Direct member or message context case opening; case verification, closure, repair, refresh, reopening, ordinary bans, kicks, and ban-by-ID in `CaseCommandHandler`, `ModerationCommandHandler`, and `InteractionHandler`                                                                                   |
| Reports         | User and message report submission; intake creation, candidate confirmation and rejection, target-bound submission, reporter or staff closure; submitted-report actioned, dismissed, and false-positive review; case opening from a submitted report; uncertain-report-ban preparation and operator review |
| Detections      | Direct observed-alert open, dismiss, false-positive, undo, kick and ban actions; ignore and restore accounting where invoked outside the worker                                                                                                                                                            |
| Containment     | Direct quarantine preview and execution; moderator challenge, retry and bypass; the existing browser CAPTCHA completion handoff and internal pass/attention commands                                                                                                                                       |
| Message cleanup | Every existing preview, execute, and combined ban/cleanup entry point, including frozen preview and administrator checks                                                                                                                                                                                   |
| Operations      | Single and visible-batch attention acknowledgement; queue sync and clear; integrity audits and supported repairs; thread sweeps; lockdown audit and apply; bulk role intake                                                                                                                                |
| Setup           | Onboarding and verification setup; report-panel upsert, repair, deliberate repost, and clear; role-gate, role-quarantine, queue, manual-intake, detection, case-staff, case-review, report, analytics, verification, heuristic, and lockdown configuration updates                                         |

Web entry points include admin `cases`, `reports`, `inbox`, `operations`, `setup`, `onboarding`, member actions, and reporter-facing report actions. Discord entry points include all command, modal, button, and select handlers that initiate the operations above. Intake and browser callbacks keep their existing authenticated or confirmed subject bindings.

During implementation, maintain a per-operation caller checklist with exact symbols, required authority, confirmation requirements, direct or queued delivery, target operation, and covering tests. Expand the checklist from the current schema, command definitions, handlers, web exports, and their actual callees. Every listed operation must reach its shared owner before the PR is ready.

Automatic detection scoring, message observation, evidence ingestion, scheduled reminder rendering, and internal recovery mechanics remain in their established domain services. They are not newly exposed as user-callable actions. If a migrated operation is also called by an automatic or recovery path, keep the internal actor and existing authority explicit; do not force the path to impersonate a moderator. Public read-only dashboards and detection algorithms are outside this refactor except for action availability and diagnostics attached to the listed operations.

## Migration within one PR

1. Establish the per-operation inventory and characterize current behavior, especially permission differences and the two enqueue statements. Add the shared context, command, result, and dependency types with an actual migrated operation.
2. Migrate attention acknowledgement and submitted-report review as the first complete family checkpoint. They already have shared service precedents and exercise both direct web and Discord execution.
3. Migrate cases and observed detections, including direct report bans and uncertain-ban review. Route all relevant Discord and web callers plus worker handlers through shared owners.
4. Migrate containment, CAPTCHA, and message cleanup while preserving their preview, claim, lease, evidence, and reconciliation behavior.
5. Migrate operations, intake, onboarding, and configuration families. Consolidate enqueue persistence after its characterization cases pass against both existing callers.
6. Remove superseded policy and orchestration helpers, hardcoded actor-source assumptions, and cross-app imports of migrated root services. Complete the inventory and run the full verification.

These checkpoints can use separate commits. They remain on the same branch and in the same PR. Temporary in-branch duplication must be removed before that family is considered complete. The later implementation plan must assign every inventory row to a task and must not turn this work into separate PRs.

## Verification

Use focused red/green tests for moved policies and behavior, preserving useful existing domain regression tests. Avoid tests that only assert that a wrapper forwards arguments.

Required scenarios:

- The same action and authority produce equivalent decisions from Discord, direct web, and worker callers, subject to the existing interface entry restrictions.
- A revoked, departed, or unavailable actor cannot authorize a queued staff mutation. Reporters cannot use staff actions, and external input cannot select a system actor.
- Wrong guild, target, case, detection, report, challenge generation, or preview binding fails before effects.
- Duplicate submissions, stale previews, concurrent close/open/ban/verify, and retries preserve existing claims and final states.
- Confirmed and uncertain bans do not repeat enforcement. Post-ban reconciliation and operator review retain their existing distinctions.
- CAPTCHA completion remains case-bound. Cleanup keeps administrator checks, frozen candidates, evidence preservation, and the existing partial-success receipts.
- Owner-only analytics consent, server policy switches, required reasons, and current setup restrictions survive every caller migration.
- Both enqueue clients use the same tested statement and retain protected retry behavior under concurrent submissions.
- Audit identity, source, reasons, evidence links, and actual outcomes are preserved without duplicate audit records or new content retention.
- Previously queued rows and shipped Discord custom IDs still reach supported operations after deployment.
- A compiled CommonJS bot consumer and the Next.js production build both load the shared package successfully. Test the built package, not only a source alias.

At each checkpoint run the affected shared-package, bot, web, and integration suites. Keep database suites serial unless each has its own isolated database. Before marking the one PR ready, run `npm run check:ci` with the new package checks included, `npm run code:metrics`, and `npm run agent:check`. Keep required CI results in status checks and document any additional manual verification separately.

Add an inventory verification check that compares queued enum coverage with registered command decoders and handlers, and rejects migrated UI modules importing forbidden workflow dependencies or retaining known superseded entry points. Keep the dependency check narrowly scoped to migrated action adapters; do not prohibit unrelated read-model imports or domain-internal calls.

No live moderation, production repair, merge, or deployment is part of design or local verification.

## Alternatives

Queueing every mutation gives uniform durable execution, but changes ordinary Discord and configuration behavior without helping reuse enough to justify it. Preserve the queue where it is already useful.

A separate application API service centralizes remote access but adds authentication, deployment, availability, and operational work before the current duplication is removed. A shared package fits the existing two runtimes.

A single generic dispatcher that owns all policy would relocate the large worker rather than simplify it. Keep the worker mechanical and give each family clear ownership. A small exhaustive dispatcher is still appropriate for queued delivery.

## Completion criteria

- All 40 queue types and all nonqueued operations in the completed caller checklist use shared family operations.
- Discord and web retain their supported behavior, permissions, confirmations, and execution paths.
- Worker handlers no longer contain independent family-specific business workflows.
- Shared operations have no dependency on either app's framework or bot DI.
- Enqueue and report-ban retry SQL have one maintained implementation used by both clients.
- Superseded internal action paths are removed, with documented compatibility only for shipped external or persisted formats.
- Existing recovery, concurrency, and evidence-retention guarantees pass their regression tests.
- The full migration is reviewable and delivered as one PR. An MCP adapter can subsequently call the shared operations without inventing moderation rules.
