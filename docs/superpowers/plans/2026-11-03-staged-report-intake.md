# Staged report intake implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Identify reported Discord accounts from saved evidence and direct unresolved situations to an admin without requiring another reporter action.

**Architecture:** Keep current report and moderation boundaries. Add revisioned evidence and a leased intake worker, use typed extraction plus deterministic account resolution, and deliver one recoverable admin-review item per intake. Lookup and extraction never perform moderation.

**Tech Stack:** TypeScript, discord.js, existing OpenAI Responses integration, Prisma/Postgres, Inversify, Jest, and existing application/contracts packages. No new dependency or queue framework.

**Spec:** [Approved design](../specs/2026-11-03-report-intake-agent-design.md), with its [investigation](../research/2026-11-03-report-intake-investigation.md).

## Review brief

The user approved the design on November 3, 2026 and requested this plan. Tasks 1 through 8 are implemented and reviewed. Task 9 implementation and full local acceptance passed; paid provider, live Discord and rollout checks remain pending. See the [acceptance report](../reports/2026-11-03-staged-report-intake-acceptance.md) for exact source evidence and the failed-submission recovery limitation. Retain useful tests from the prior local patches; replace the no-match request for more reporter input with admin handoff.

This is one connected workflow. Each task below has its own tests and commit. Tasks 3 and 4 can proceed independently after Task 1. The main risks are stale identity selection, incomplete directory coverage, and saved handoffs that never reach admins. Production migration, feature enablement, historical recovery, and live Discord/provider exercises retain their separate approval gates.

## Global Constraints

- Resolve username, account display name, server nickname, and effective server display name: `nickname ?? globalName ?? username`. The server title is context.
- One sufficiently supported candidate can reach reporter confirmation. Ambiguity, uncertain reading, failure/incomplete lookup, rejection, and unanswered confirmation go to admin review.
- Voluntary evidence after handoff is analyzed for the admin without restarting reporter confirmation, clearing acknowledgement, or repeating a role ping.
- Normalize Unicode canonical form, case, and surrounding/repeated whitespace. Preserve originals. Do not fold confusable characters or use avatar similarity as identity proof.
- Directory: five-minute snapshot lifetime, 1,000 members per page, at most ten pages and fifteen seconds per scan. Partial coverage cannot establish name uniqueness or no-match certainty.
- Processing: 15-second debounce, 30-second maximum batching delay, existing 60-second minimum interval, 45-second persisted investigation deadline, at most two model requests per revision, at most one transient retry within those limits.
- Confirmation reaches admin review after ten minutes without an answer. Delivery retries: 30 seconds, two minutes, ten minutes, then periodic reconciliation while open.
- Reserve each model request durably before dispatch. Initial extraction, reread, retry, and unknown outcomes share the two-request allowance and absolute deadline across restarts.
- Reuse `needs_admin_confirmation`, displayed as "Needs admin review". Saved, delivered, acknowledged, and resolved are distinct facts.
- Exact receipt: "Your evidence is saved for moderator review. You don't need to do anything else." Claim notification only after recording delivery.
- Preserve authorization, submission policy, and destructive-action confirmations. No model output can authorize moderation.
- No private community names, real screenshots, production identifiers or credentials in source fixtures/public prose. Use synthetic evidence.
- Execute in `D:/bench/drasil-wt/report-intake-no-match` after checking its status. Keep the protected base checkout clean. Integration tests require an isolated local database; setup truncates tables.

## Review Focus

1. Delete followed by stale create/update must not resurrect evidence or increment a revision twice. Task 2.
2. Name/membership changes during a directory scan must not produce a supposedly current unique match. Task 4.
3. A provider accepts a request but its response is lost before restart: preserve spent attempts and deadline. Task 5.
4. Discord accepts a handoff before its database receipt fails: reconcile without another role ping. Task 6.
5. Web/MCP acknowledgement keeps identity review open, while other queue types retain existing semantics. Task 7.

## File and interface map

| Owner            | Files                                                                                | Responsibility                                                    |
| ---------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Shared contracts | New `packages/application/src/reports/analysis.ts`, test, package index              | Validated metadata, clues, coverage and outcomes; no Discord I/O. |
| Persistence      | Prisma schema/migration, `ReportIntakeRepository.ts`, repository types/fake          | Atomic evidence revisions, claims, budgets, outcomes.             |
| Ingestion        | `ReportIntakeService.ts`, new `src/utils/reportIntakeEvidence.ts`, `EventHandler.ts` | Idempotent create/edit/delete and due scheduling.                 |
| Extraction       | `GPTService.ts`, existing attachment/settings helpers                                | Source-associated clues, completeness, typed failures.            |
| Lookup           | New `ReportMemberDirectory.ts`, `ReportCandidateService.ts`                          | Bounded directory and fresh identity checks.                      |
| Orchestration    | New `ReportIntakeAnalysisWorker.ts`, existing agent, Bot and DI                      | Fixed stages, leases and lifecycle.                               |
| Handoff          | New `ReportIntakeHandoffService.ts`, existing moderation queue/repository            | Delivery, reconciliation, acknowledgement and receipts.           |
| Staff/read flows | Application reports/attention, bot/web adapters, contracts                           | Authorized decisions and accurate status.                         |
| Acceptance       | Unit/integration suites, synthetic fixtures, evaluation script                       | Adversarial, concurrency and controlled live proof.               |

Paths below are relative to the worktree. Shared analysis types belong in `@drasil/application`; it must not import `@drasil/contracts`, which already depends on it. Contracts may expose safe projections.

## Task 1: Persist revisioned intake processing

**Files:** Create `packages/application/src/reports/analysis.ts` and `.test.ts`; export from `packages/application/src/index.ts`. Modify `prisma/schema.prisma`, `src/repositories/types.ts`, `src/repositories/ReportIntakeRepository.ts`, `src/__tests__/fakes/inMemoryRepositories.ts`, `src/utils/reportIntakeSettings.ts` and its tests; `packages/application/src/setup/settings.ts`, its tests, and `apps/web/lib/e2eFixtures.ts`. Create migration `prisma/migrations/20261103000000_report_intake_processing/migration.sql` and `src/__tests__/integration/ReportIntakeProcessing.integration.test.ts`.

**Interfaces:** Export validated shared types below. Serialized timestamps are ISO strings; repository timestamps are `Date`.

- `ReportEvidenceRef`: evidence ID, message ID, source version, role `reporter | staff`, kind `text | image`.
- `ReportSubjectClues`: subject ID, role `target | reporter | other | unknown`, readability `clear | uncertain | unreadable`, source refs, user IDs, usernames, display names, message links, uncertainty.
- `ReportDirectoryCoverage`: discriminated `complete | partial | unavailable`. Complete includes scan/expiry timestamps and member count. Partial includes those plus reason `page_limit | deadline | interrupted`. Unavailable includes reason `permissions | rate_limited | transport`.
- `ReportIdentityCandidate`: portable identity fields `candidateId`, `discordUserId`, `serverId` as strings; `username`, `globalName`, `nickname`, `displayName`, `avatarUrl` as nullable strings; `subjectId` and source refs; and `matchedFields: ('username' | 'globalName' | 'nickname' | 'displayName' | 'userId' | 'messageAuthor')[]`. Define these in the shared module without importing bot source types. Do not use candidate probability as a decision threshold.
- `ReportAnalysisOutcome`: discriminated by `kind`, either `confirm` with one candidate or `admin_review` with reason and candidates. Both carry coverage plus included/excluded evidence IDs.
- `ReportHandoffReason`: `no_match | ambiguous | conflicting_anchors | uncertain_text | incomplete_coverage | evidence_unavailable | evidence_over_budget | provider_failure | lookup_failure | rejected | confirmation_timeout`.
- `ReportAnalysisMetadata`: schema version 1, source-version index, current outcome/coverage, request reservations, and handoff `none | pending | delivered | acknowledged | resolved`. Delivery stores actual message/channel IDs, attempts/next due and receipt state. Acknowledgement stores actor/time and retains delivery identifiers.

Add intake columns `evidence_revision`, `analysis_revision` as nonnegative integers default zero; nullable timestamptz `analysis_due_at`, `analysis_started_at`, `analysis_deadline_at`, `analysis_lease_until`; nullable UUID `analysis_lease_token`; integer `analysis_attempts` default zero constrained to 0..2. Index due work for open statuses. Null due time means no pending analysis; old rows must not auto-enqueue.

Add these repository methods:

```ts
recordEvidenceBatch(input: ReportEvidenceBatch): Promise<'recorded' | 'duplicate' | 'stale' | 'closed'>;
claimAnalysis(now: Date, leaseMs: number): Promise<ReportAnalysisClaim | null>;
reserveModelAttempt(claim: ReportAnalysisClaim, now: Date): Promise<boolean>;
renewAnalysisLease(claim: ReportAnalysisClaim, now: Date, leaseMs: number): Promise<boolean>;
completeAnalysis(claim: ReportAnalysisClaim, outcome: ReportAnalysisOutcome, now: Date): Promise<boolean>;
```

`ReportEvidenceBatch` includes intake/source message/channel/author IDs, source version/fingerprint, observed/edited timestamps, `upsert | delete`, and evidence rows. `ReportAnalysisClaim` includes `kind: analyze | confirmation_timeout`, intake snapshot, claimed revision, lease token and persisted deadline/attempts. Confirmation timeout claims need no provider budget; use `analysis_due_at` for their due time too. Source version is also recorded on appended evidence metadata; no extra evidence table.

- [x] Write contract and repository tests: assert `duplicateRevision === initialRevision`, `oldCompletion === false`, and only one non-null claim from two concurrent workers. An old row without due time is not claimed; invalid metadata never clears evidence.
      Named regression assertion: `it('allows only one claim for a revision')`; `expect(claims.filter(Boolean)).toHaveLength(1)` and `expect(staleCompletion).toBe(false)`.

- [x] Run `npm run application:test -- --runInBand reports/analysis.test.ts` and the focused integration command below. Confirm behavior failures, not environment errors.
- [x] Implement schemas, additive migration, transactional repository methods and fake parity. Lock intake before comparing source versions/inserting rows. Preserve report-first lock order. New evidence resets the new revision's deadline/attempts, retains last start for throttling, and invalidates previous prompt authority. Completion/reservation require matching lease/revision/open status/unset target. Update owned metadata sections under the row lock while preserving concurrent acknowledgement/delivery fields.
- [x] Run tests green, `npm run prisma:generate`, `npm run application:build`, and `npm run build`. Verify old rows survive migration and no work is scheduled for them.
- [x] Commit persistence and shared contracts.

For controlled rollout, add `report_intake_staged_enabled` to existing settings validation/config plumbing, default false. Expose it as `reportIntakeStagedEnabled` through the existing report-settings patch, mapping to `report_intake_staged_enabled`; test false defaults and patch/reset preservation. This temporary selector chooses the actually shipped processor or the new one, never both. Its eventual removal follows explicit migration of active servers; do not remove the old path during initial controlled rollout.

## Task 2: Capture complete, idempotent evidence revisions

**Files:** Modify `src/services/ReportIntakeService.ts`, `src/controllers/EventHandler.ts`, their unit tests and processing integration test. Create `src/utils/reportIntakeEvidence.ts` and `src/__tests__/unit/reportIntakeEvidence.unit.test.ts`.

**Interfaces:** `buildReportEvidenceBatch(message: Message, intake: ReportIntake, operation: 'upsert' | 'delete'): ReportEvidenceBatch`. Extend `IReportIntakeService` with `handleThreadMessageUpdate(message: Message): Promise<boolean>` and `handleThreadMessageDelete(input: { guildId: string; threadId: string; messageId: string }): Promise<boolean>`. Keep `handleThreadMessage` for existing callers.

- [x] Test screenshot-only creation, duplicate delivery, reversed edits, delete then delayed create, partial-message fetch failure and staff corrections. Assert one revision per real change, original versions retained, deleted sources excluded, and no mutation from unrelated channels/users.
      Named regression assertion: `it('does not resurrect deleted evidence from a stale create')`; `expect(activeEvidence).toHaveLength(0)` and `expect(afterDuplicate.evidence_revision).toBe(beforeDuplicate.evidence_revision)`.

- [x] Run `npx jest --runInBand --runTestsByPath src/__tests__/unit/reportIntakeEvidence.unit.test.ts src/__tests__/unit/ReportIntakeService.unit.test.ts src/__tests__/unit/EventHandler.unit.test.ts` red.
- [x] Use `node:crypto`, source IDs, current edit timestamp and canonical content/attachment descriptors for fingerprints. Fetch current authorized messages for updates when necessary; reject stale versions and retain deletion tombstones. Record one transaction/revision per message, not per attachment. Schedule with approved debounce/batching/interval. Save before acknowledgement; known inaccessible sources retain an evidence-unavailable outcome.
- [x] Register `MessageUpdate`/`MessageDelete` through the existing recoverable event wrapper. Acknowledge the first accepted evidence batch once. Evidence retained after submission is not eligible for identity analysis. In staged mode, replace the old pre-analysis generic attention notice with the later handoff. Terminal reports retain voluntary evidence without retargeting. Run tests green.
- [x] Commit ingestion.

## Task 3: Extract subject-associated clues with explicit completeness

**Files:** Modify `src/services/GPTService.ts`, `src/utils/reportAiSettings.ts`, `src/utils/reportAttachments.ts` as needed, and their unit tests. Add synthetic metadata/text fixtures under `src/__tests__/fixtures/report-intake/`.

**Interfaces:** Add `extractReportIdentity(input: { sources: readonly ReportEvidenceSource[]; signal: AbortSignal }): Promise<ReportIdentityExtraction>`. Define/export these alongside Task 1 types: `ReportEvidenceSource` pairs a source ref with text or validated image URL; `ReportIdentityExtraction` is `extracted` with subjects/context labels/included and excluded IDs, or `failed` with reason `provider_failure | invalid_output | evidence_unavailable` and included/excluded IDs. Keep the previous extraction API only while the rollout selector still needs it.

- [x] Write tests with target, reporter, bystander and server title in one source. Assert associations survive, server title never becomes target, and numeric confidence cannot override uncertain reading. Assert excluded inputs are listed and image detail is `high`. Test hostile instructions, expired URLs and unsupported attachments.
      Named regression assertion: `it('keeps a server title out of target subjects')`; `expect(targetSubjects.flatMap(s => s.displayNames)).not.toContain(serverTitle)` and `expect(extraction.excludedEvidenceIds).toEqual(excludedIds)`.

- [x] Run `npx jest --runInBand --runTestsByPath src/__tests__/unit/GPTService.unit.test.ts src/__tests__/unit/reportAttachments.unit.test.ts` and observe the relevant failures.
- [x] Implement a strict bounded schema and extraction-only prompt with source IDs/roles. Use configured model and existing image/byte caps. Count submitted sources, not all saved evidence. Preserve explicit anchors already parsed deterministically. Refresh URLs only through the original authorized message and attachment ID. Return typed failures; propagate aborts. No internal provider retries, which would bypass Task 5's reservation.
- [x] Run tests green. Choose the smallest output limit that accommodates the bounded schema and four synthetic images, and pin it in the payload test. Do not run paid provider calls during unit tests.
- [x] Commit extraction.

## Task 4: Resolve current names with measured coverage

**Files:** Create `src/services/ReportMemberDirectory.ts` and `src/__tests__/unit/ReportMemberDirectory.unit.test.ts`. Modify `src/services/ReportCandidateService.ts`, its test, DI symbols/container and `src/controllers/EventHandler.ts` invalidation hooks.

**Interfaces:** `IReportMemberDirectory.snapshot(guild: Guild, signal: AbortSignal): Promise<ReportDirectorySnapshot>` and `invalidate(guildId?: string): void`. Snapshot contains Task 1 coverage and minimal members `{id, username, globalName, nickname, displayName}`. Add `IReportCandidateService.resolveIdentity(input: { guild: Guild; reporterId: string; subjects: readonly ReportSubjectClues[]; signal: AbortSignal }): Promise<ReportAnalysisOutcome>`.

- [x] Test distinct values for every name field, exact match beyond five prefix results, duplicates, Unicode canonical equivalents, distinct confusables, excluded reporter/bot, conflicting anchors and uncertain OCR with one apparent match. Global-display-name matches must work when prefix search returns nothing. Partial coverage cannot produce a name-only `confirm` result.
- [x] Test directory pagination, ten-page cap, fifteen-second abort, five-minute expiry, coalesced scans, and user updates/removal during a scan. A scan invalidated while loading must not enter the reusable complete cache. Run directory and candidate suites red.
      Named regression assertion: `it('finds a global display name outside prefix-search results')`; after narrowing `outcome.kind`, assert `expect(outcome.candidate.matchedFields).toContain('globalName')`.

- [x] Implement the small in-memory directory using existing SDK `members.list`, `members.search`, and uncached member fetch. Explicit validated anchors do not require a full scan; name-only confirmation requires a complete fresh snapshot. Preserve subject associations/matching fields while deduplicating by account ID. Keep all ambiguity internally and apply five only to admin presentation. Return typed coverage failures rather than empty-success results.
- [x] Handle `UserUpdate`, member add/update/remove, guild removal and gateway interruption. Invalidate a generation if an intersecting update cannot be applied reliably. Revalidate membership and relied-on name before returning confirmation. Run focused tests, lint and build green.
- [x] Commit lookup and coverage.

## Task 5: Execute fixed stages with durable leases and budgets

**Files:** Create `src/services/ReportIntakeAnalysisWorker.ts` and its unit test. Refactor `src/services/ReportIntakeAgentService.ts` and its test. Modify `src/Bot.ts`, `src/di/symbols.ts`, `src/di/container.ts`, `src/controllers/EventHandler.ts`, `src/__tests__/unit/Bot.unit.test.ts`, and processing integration tests.

**Interfaces:** `IReportIntakeAgentService.analyze(input: { claim: ReportAnalysisClaim; signal: AbortSignal }): Promise<ReportAnalysisOutcome>`. `IReportIntakeAnalysisWorker` exposes `start(): void`, `stop(): void`, `processPending(limit?: number): Promise<number>`. Worker owns claim/reserve/complete; agent owns the ordered investigation. Remove previous scheduling APIs after their staged callers/tests migrate, retaining only the necessary temporary legacy path for rollout.

- [x] Test restart after an outcome-unknown request, lease expiry/renewal failure, deadline exhaustion, one transient retry, optional reread and concurrent workers. Assert total reservations <= 2, persisted deadline unchanged after recovery, and lost lease cannot publish. Test newer evidence superseding work and post-handoff evidence staying admin-owned.
      Named regression assertion: `it('retains request budget after an unknown provider outcome')`; `expect(saved.analysis_attempts).toBe(2)` and `expect(thirdReservation).toBe(false)`.

- [x] Run worker/agent suites and processing integration tests red. Test disabling the rollout selector during work; pending evidence/review survives, and a disabled worker cannot publish new controls. Use a fake clock and abort-aware provider, not wall-clock sleeps.
- [x] Implement five-second polling, at most five sequential claims per tick, thirty-second lease, ten-second heartbeat, one in-flight drain per process. Start after Discord login. Stop claiming and abort owned work during shutdown. Reserve each model attempt before dispatch. Permit only one safe transient read retry within both deadline and request allowance; no retries of submission/moderation effects.
- [x] Run evidence snapshot, deterministic anchors, extraction when needed, name resolution, optional targeted reread, and conditional outcome commit in that order. Hand off incomplete evidence coverage. Route expired ten-minute confirmation due rows without a model call. Ensure the rollout selector dispatches to exactly one processor. Run unit/integration tests, lint and build green.
- [x] Commit worker integration.

## Task 6: Persist and deliver admin handoff

**Files:** Create `src/services/ReportIntakeHandoffService.ts` and its unit test. Modify `src/services/ReportIntakeService.ts`, `src/services/ModerationQueueService.ts`, `src/repositories/ModerationQueueRepository.ts`, existing tests, DI wiring and processing integration tests.

**Interfaces:** `IReportIntakeHandoffService.deliverPending(limit?: number): Promise<number>` and `publishOutcome(intakeId: string): Promise<void>` operate on saved results only. Add intake repository methods `claimPendingPresentation(now: Date): Promise<ReportPresentationClaim | null>` and `completePresentation(claim: ReportPresentationClaim, result: ReportPresentationResult): Promise<boolean>`. Presentation has its own lease/state in validated metadata so retries cannot rerun analysis. Claim carries intake/revision/lease token; result carries actual channel/message IDs or safe delivery failure. Add `IModerationQueueService.upsertReportIdentityReview(input: { intake: ReportIntake; outcome: ReportAnalysisOutcome; revision: number }): Promise<ModerationQueueAttentionResult>`.

- [x] Test each handoff reason, persistence before I/O, exact receipt sent once, queue-send success followed by database failure, authorized fallback channel, both destinations unavailable, and acknowledged review receiving new evidence. Recovery must find the authored intake marker and avoid another role ping.
      Named regression assertion: `it('reconciles an accepted handoff after receipt persistence fails')`; `expect(createdMessages).toHaveLength(1)` and `expect(rolePings).toHaveLength(1)`.

- [x] Run handoff/queue/intake and targeted Postgres suites red. Failed receipt delivery must not become a false submission failure or restart extraction.
- [x] Persist admin status/reason/pending delivery with outcome completion. Reuse `report_thread_attention`, with explicit identity-review metadata and stable intake marker; update existing message. Outcome/revision changes must bypass the old same-source-message early return so completed analysis can upgrade the earlier generic item. Persist attempts and next due time. Apply approved retry delays, then existing periodic reconciliation cadence. Validate queue and fallback admin-channel access, without changing permissions. Resume from saved state after restart.
- [x] Publish one supported candidate through existing disabled-until-persisted controls, bound to evidence revision and ten-minute due time. On handoff retire reporter controls and retain the review. Recheck current revision and terminal state before publishing controls or changing a queue item. Run tests green and verify escaping and one-time role pings.
- [x] Commit handoff and presentation.

## Task 7: Complete staff resolution and distinct acknowledgement

**Files:** Modify `packages/application/src/reports/ports.ts`, `commands.ts`, `actions.ts`, `delegation.ts`, `resolution.ts` and their tests; `src/application/adapters/reports.ts`, `src/controllers/ReportInteractionHandler.ts`, `src/utils/reportIntakeAdminActions.ts`, `src/services/ReportIntakeService.ts`, `src/repositories/ReportIntakeRepository.ts`. Modify `packages/application/src/operations/attention.ts` and test, `src/repositories/ModerationQueueRepository.ts`, `apps/web/lib/application/adapters/attention.ts`, and bot/web application wiring. Update `packages/application/src/reports/commands.ts`, `packages/application/src/reports/resolution.ts`, and `packages/application/src/requests/reports.ts` for strict parsing and stored-action compatibility; update `apps/web/lib/mcp/adapters/reports.ts` wherever it constructs the same revision-bound references.

**Interfaces:** Extend `ReportIntakeState` with `evidenceRevision` and bound presentation revision. Reuse `confirm_intake_candidate` for authorized staff selecting a validated candidate or supplying a current-member ID in admin review. Add optional `expectedEvidenceRevision` to queued confirmation commands solely for persisted v1 compatibility; every newly generated staged action must supply it. Thread closure and review resolution are distinct: extend `close_report_intake` with optional `closeMode: { kind: thread_only } | { kind: resolve_review; reason: string }`. Omission retains shipped thread-close semantics; `resolve_review` requires current staff authorization, nonblank reason and expected evidence revision. Pass this through the existing close port/service instead of inventing another moderation path. Add `acknowledgeIdentityReview(input: { itemId: string; guildId: string; actorId: string; acknowledgedAt: Date }): Promise<'acknowledged' | 'already_handled'>` to the attention repository port.

- [x] Test reporter, staff and unauthorized actors in both confirmation states. Staff manual-ID submission requires current membership, different reporter/target, current revision, fresh staff authorization and explicit confirmation. Test unrelated guild, removed staff role, stale queued action, old v1 command against a superseded staged prompt, concurrent close/confirm and exactly one submission.
- [x] Test shared acknowledgement: identity-review row/intake remain open and actor/time are saved; other attention kinds retain existing deletion behavior. Run application report/attention, bot interaction and intake integration tests red.
      Named regression assertion: `it('acknowledges identity review without resolving it')`; assert `expect(savedIntake.status).toBe('needs_admin_confirmation')` and `expect(savedHandoff.kind).toBe('acknowledged')`.

- [x] Implement shared authorization and matching service/repository preconditions. Staff manual ID is accepted only from the current admin-review artifact after uncached lookup. Reporter input cannot bypass the candidate set. Bind new references to revision without gratuitous custom-ID format changes. Stored v1 commands can complete only against unchanged legacy state; they cannot bypass staged revision checks. Use existing submission/policy after the target claim.
- [x] Implement acknowledgement as a separate update. Staff unresolved close uses `resolve_review`, requires a reason and preserves evidence; mere thread closure never substitutes for resolution. Reporter thread closure after handoff preserves admin review. Successful submission or staff closure resolves the handoff. Run affected shared/unit/Postgres concurrency suites green.
- [x] Commit staff ownership and resolution.

## Task 8: Expose accurate reporter, admin and diagnostic status

**Files:** Modify `packages/contracts/src/reports.ts` and its tests; `apps/web/lib/reportIntakePortalDataAdapter.ts`, `reportDetailDataAdapter.ts`, `moderationAttentionDataAdapter.ts`, `moderationInboxDataAdapter.ts`, `readDiagnostics.ts` and their tests; `apps/web/lib/mcp/queries.ts` and its tests. Update `apps/web/components/inbox/InboxItemDetail.tsx`, its test, and `apps/web/components/inbox/foundation/ReportReview.tsx` for the existing detail flow. Update `src/services/SetupDiagnosticsService.ts` only if its current projection cannot carry the new failure reason.

**Interfaces:** Add a safe `identityReview` projection to `ReportAttentionRecord`: phase `pending | delivered | acknowledged | resolved`, reason, evidence revision, candidate count, coverage kind and relevant timestamps. Reporter reads expose status/receipt only. Staff reads may expose candidate identities/match reasons after current authorization, never provider payloads or unrelated directory contents.

- [x] Test every handoff phase, missing/unknown delivery, acknowledged-but-unresolved review, and `targetUserId: null`. Assert the UI does not call this a submitted account report or expose target enforcement actions. Test reporter versus staff MCP projection.
      Named regression assertion: `it('renders an unidentified report as admin review')`; `expect(view.statusLabel).toBe('Needs admin review')` and `expect(view.allowedActions).not.toContain('ban_user')`.

- [x] Run `npm run contracts:test -- reports` and targeted adapter/component tests with `npm run web:test -- <test-file>`; confirm missing-projection cases fail.
- [x] Implement shared projection, read adapters and existing detail views. Display "Needs admin review" and truthful delivery state. Show distinct account display name/server nickname, username and ID. Reuse existing flat lists and links; add no new dashboard shell.
- [x] Run tests green, `npm run contracts:typecheck`, `npm run web:typecheck`, and affected component/browser fixtures. Reporter copy avoids AI labels and raw internal error codes.
- [x] Commit status/read integration.

## Task 9: Verify the journey and prepare controlled rollout

**Files:** Create `src/__tests__/integration/ReportIntakeStagedFlow.integration.test.ts`, synthetic assets/labels under `src/__tests__/fixtures/report-intake/`, and `src/scripts/evaluateReportIntake.ts`. Update `docs/test-cases.md`. Record actual results in `docs/superpowers/reports/2026-11-03-staged-report-intake-acceptance.md`, leaving unexecuted checks explicitly pending.

**Interfaces:** The evaluation script consumes labeled synthetic fixtures and Task 3 extraction only, with no Discord client or moderation actions. Require explicit opt-in before paid provider calls and print the maximum request count before execution. Labels specify subject separation, readable names, uncertainty and permitted identity outcome, not exact model prose.

- [x] Add end-to-end tests for global-name-only resolution, multiple people/server-title distraction, OCR uncertainty, evidence over budget, unavailable directory, restart at each persisted boundary, acknowledgement and voluntary post-handoff evidence. Assert no role/kick/ban calls from investigation/handoff and one existing submission after human confirmation.
- [x] Run focused unit/application/contracts/web and isolated-Postgres suites. Run repository `npm run check:ci` before declaring implementation complete. Repair valid failures; do not treat unrelated failures as permission to skip required checks or broaden the change without explanation.
- [x] Prepare synthetic provider evaluation and controlled Discord checklist. Obtain approval before paid provider execution or live Discord messages. Required live cases: clean match, forced unresolved handoff, restart, delivery failure/recovery, staff resolution and permission revocation. Record actual request count, elapsed time, lookup coverage and outcome. Local mocks are not live acceptance.
- [ ] Prepare additive schema deployment and enable `report_intake_staged_enabled` only for an approved controlled server. Review wrong-candidate rate, budgets, delivery and acknowledgement before broader rollout. Historical re-enqueue requires an approved exact-ID list, not startup backfill. Rollback disables staged processing and preserves evidence/pending reviews; it does not drop the migration.
- [x] Commit tests, tooling and truthful acceptance notes. Follow PR workflow and exact-head review requirements before claiming merge readiness. This plan alone does not authorize merge or deployment.

Provider and controlled Discord execution remain pending in the acceptance checklist. Deployment preparation is documented; migration, enablement and historical re-enqueue have not run.

## Verification commands and checkpoints

Use `scripts/prepare-test-database.js` and `scripts/owned-test-database.js` for an owned, isolated local database. Verify its target before running integration tests: setup truncates tables. After that setup, a focused PowerShell run is:

```powershell
$env:JEST_INTEGRATION = '1'
npx jest --runInBand --runTestsByPath src/__tests__/integration/ReportIntakeProcessing.integration.test.ts
Remove-Item Env:JEST_INTEGRATION
```

Restore the previous `JEST_INTEGRATION` value if one was already set. Never run this against a shared development or production database. Use the integration skill at execution time.

Other focused checks:

```powershell
npm run application:test -- --runInBand reports/analysis.test.ts
npx jest --runInBand --runTestsByPath src/__tests__/unit/ReportMemberDirectory.unit.test.ts src/__tests__/unit/ReportCandidateService.unit.test.ts
npm run contracts:typecheck
npm run web:typecheck
npm run build
git diff --check
```

For each task, first observe its new behavioral tests fail, then pass with the implementation. Inspect `git status` and commit the task's source, tests and necessary schema/generated artifacts together. Read the current Prisma workflow before schema changes. Do not run integration databases concurrently with another worktree unless isolated.

Required CI results belong in status checks. PR prose describes product behavior, linked issue and non-routine provider/concurrency/live evidence. Apply `[AGENT]` and generic environment labels to public prose. Any new commit resets the repository's thirty-minute merge-readiness window and requires the later feedback sweep.

## Plan self-review and traceability

| Approved requirement                                             | Task    |
| ---------------------------------------------------------------- | ------- |
| All name fields, accurate subject/source association             | 3, 4    |
| Single clear candidate; uncertainty to admin                     | 4, 5, 6 |
| No further required reporter action                              | 6, 7, 8 |
| Revised/deleted/excluded evidence, no false analyzed count       | 1, 2, 3 |
| Restart-safe work and persisted budgets                          | 1, 5    |
| Admin notification recovery, distinct acknowledgement/resolution | 6, 7    |
| Current authorization and stale-reference rejection              | 7, 8    |
| Safe rollout, rollback and controlled acceptance                 | 9       |

The five Review Focus cases each have a named owning test above. Shared types and method names are the task contracts; change their dependent callers in the same task if implementation reveals a necessary correction. Tests, ports, fakes, configuration and exports belong to the task that changes their behavior. No independent reviewer was dispatched for this plan; the writing-plans skill calls for self-review, which includes coverage, interfaces and task size.

## Evidence appendix

- Source baseline: `46b2b053060e19b35beccf23f7cf6756490cbe5f`.
- Current local checkpoint before planning: `a0c8233d15a6f84c011ee54d5ddbc4b52a09a7f6`, containing the reviewed design and investigation after two provisional code commits.
- Existing ownership inspected: `src/Bot.ts`, `src/controllers/EventHandler.ts`, report services/repository, `packages/application/src/reports`, `packages/application/src/operations/attention.ts`, bot/web attention adapters and intake/read adapters.
- Existing acknowledgement deletes queue rows, so Task 7 must implement the approved identity-review exception and test unchanged behavior for other types.
- Existing shared-package direction is contracts to application. New analysis contracts must preserve that direction.
- No product code, migration, provider evaluation, live message, merge or deployment was executed while writing this plan.
