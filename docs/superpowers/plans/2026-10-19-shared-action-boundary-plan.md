# Shared action boundary implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All tasks use one integration branch and produce one PR.

**Goal:** Move every existing externally initiated Drasil action behind reusable family operations, migrating Discord, web, and worker callers in one PR.

**Architecture:** Add `@drasil/application` with typed commands, policy decisions, family operations, and runtime dependency interfaces. Preserve direct execution and existing durable queues. Keep Discord workflows and transaction/recovery mechanisms in their established services, with runtime adapters connecting them to the shared operations.

**Tech Stack:** TypeScript, Node >=22.22.0, Zod 3.25.76, CommonJS package exports, Jest and ts-jest, Next.js 16, Vitest, discord.js 14, pg 8, Prisma 7, Postgres.

**Spec:** [Approved design](../specs/2026-10-19-shared-action-boundary-design.md). Research baseline: `8a7655d`; approved-spec commit: `93a1497`.

## Global constraints

- Use one PR and one integration branch for this initial effort.
- Cover all current action families, including operations outside the moderation request queue.
- Migrate Discord callers, web callers, and queued workers together for each family.
- Keep direct interactions responsive and keep existing durable jobs durable.
- Enforce action permissions and mutable policy at execution, including queued execution.
- Preserve existing access restrictions, confirmation requirements, audit provenance, evidence retention, request deduplication, and recovery outcomes.
- Remove replaced internal entry paths in the same PR. Retain shipped database and Discord payload compatibility where required.
- Core application code must not import Next.js, discord.js, Prisma, root DI, or credentials. Separate the postgres entry point from core exports.
- Preserve existing actor-source strings, queue IDs, idempotency keys, statuses, metadata, lease tokens, and recovery phases. No schema migration is required by this plan.
- Recovery after confirmed enforcement may finish recorded follow-up work after permission or policy changes. It must not enforce again.
- Do not implement MCP, add a queue or application API service, change detection algorithms, introduce new evidence retention, or perform live moderation.
- Follow `AGENTS.md`: keep private server names out of public artifacts, prefix public issue/PR prose with `[AGENT]`, and run database tests serially.

## Review focus

Each condition has a named test owner below:

1. A direct Discord action can require moderation authority while web entry still requires Manage Server. Preserve both restrictions without making source provenance a permission grant. Tasks 1, 3, and 11.
2. A completed or uncertain report ban is replayed after actor revocation or policy disablement. Finish existing follow-up only, with no second enforcement. Tasks 5 and 12.
3. An old queued row, target binding, CAPTCHA generation, or frozen preview reaches a newer build. Decode shipped fields, reject stale subjects, and preserve legitimate recovery. Tasks 3, 6, 7, 8, and 12.
4. Config schemas move between CommonJS and ESM consumers, or npm pruning leaves a broken workspace link. Test compiled package imports, owner-only consent, and the final Docker image. Tasks 1, 11, and 13.
5. Both enqueue clients race on an idempotency key after a dismissal undo. Permit the existing safe explicit no-op retry, protect active/confirmed/uncertain operations, and retain attempt fencing. Task 12.

---

## File ownership and contracts

New production files belong to these owners. Existing domain-service internals are retained unless a particular orchestration or policy actually moves.

| Location                                                                                     | Responsibility                                                                   | Introduced in          |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------- |
| `packages/application/{package.json,tsconfig.json,jest.config.cjs,eslint.config.mjs}`        | Compiled CommonJS, declarations, isolated tests and lint                         | 1                      |
| `packages/application/src/{index.ts,context.ts,authorization.ts,confirmation.ts,results.ts}` | Trusted context, actor facts, operation decisions, confirmation requirements     | 1                      |
| `packages/application/src/<family>/{commands.ts,ports.ts,actions.ts,actions.test.ts}`        | Family schema, dependency interfaces, policy and orchestration                   | Owning family task     |
| `packages/application/src/requests/{commands.ts,decode.ts,encode.ts,receipt.ts}`             | Transport-neutral queued commands and persisted-row mapping                      | 2, extended per family |
| `packages/application/src/postgres/{index.ts,enqueue.ts,enqueue.test.ts}`                    | One parameterized enqueue implementation                                         | 12                     |
| `src/application/{createBotApplication.ts,context.ts,requestDispatch.ts}`                    | Bot composition, authenticated context, typed queue dispatch                     | 1, extended per family |
| `src/application/adapters/<family>.ts`                                                       | SDK/repository projections and existing workflow invocation                      | Owning family task     |
| `apps/web/lib/application/{createWebApplication.ts,context.ts}`                              | Web composition and authenticated session context                                | 1, extended per family |
| `apps/web/lib/application/adapters/<family>.ts`                                              | pg and Discord REST implementations of shared ports                              | Owning family task     |
| `scripts/{check-action-boundary.mjs,check-action-boundary.test.mjs}`                         | Queue coverage and narrow forbidden-dependency checks                            | 13                     |
| `docs/dev/action-boundary-inventory.md`                                                      | Action, caller, authority, confirmation, delivery, operation, and test checklist | 1, completed per task  |

Use `operations/attention.ts` in Task 1 and `reports/review.ts` in Task 2 because these operations already have focused interfaces. Later add the family `actions.ts` modules without folding the focused files into a large class.

### Common signatures established in Task 1

```ts
interface ActionContext {
  readonly guildId: string;
  readonly requestId: string;
  readonly source: string;
  readonly actor:
    | { readonly kind: 'user'; readonly userId: string }
    | { readonly kind: 'system'; readonly purpose: SystemPurpose };
}
type SystemPurpose = 'captcha_pass' | 'captcha_attention' | 'report_ban_recovery';
interface AuthorityFacts {
  readonly userId: string;
  readonly guildId: string;
  readonly present: boolean;
  readonly owner: boolean;
  readonly permissions: string;
  readonly roleIds: readonly string[];
}
interface AuthorityPort {
  loadFresh(guildId: string, userId: string): Promise<AuthorityFacts | null>;
}
type ActionDenialCode =
  | 'permission_denied'
  | 'policy_disabled'
  | 'reason_required'
  | 'confirmation_required'
  | 'binding_mismatch'
  | 'stale_state'
  | 'actor_unavailable';
type ActionResult<T> =
  | { readonly kind: 'outcome'; readonly outcome: T }
  | { readonly kind: 'denied'; readonly code: ActionDenialCode };
```

`source` is trusted provenance, kept open for shipped strings and future adapters; it never grants authority. Parse external commands with strict schemas that cannot supply context, actor, source, permission facts, or internal attempt tokens. Authenticate in adapters and obtain current actor facts at execution. Reporter actions apply their existing membership/external-report policy rather than assuming every user must be a staff member.

A recovery system context authorizes only continuation of the matching persisted operation. The runtime loads that operation's original initiating actor and source for audit and outcome attribution; it does not replace them with the system-purpose label.

Declare each family's `FamilyCommand` as a discriminated union with `kind` identifying the operation. Required IDs, reasons, preview references, and expected generations belong to that variant. Family signatures are `execute(context: ActionContext, command: FamilyCommand): Promise<ActionResult<FamilyOutcome>>`. Family outcomes retain their existing domain statuses and detail, including uncertain and partially completed actions. Unexpected infrastructure exceptions propagate to the runtime's existing failure recorder and renderer; do not expose raw exceptions as public results.

Each `createFamilyActions(deps: FamilyDependencies): FamilyActions` factory has explicit named ports for the state, settings, and workflows it uses. Move plain dependency interfaces from existing services where possible. Do not export SDK types or introduce an `executeAnything(metadata)` port. The operation owns policy and orchestration; ports load facts or invoke the existing domain workflow. Composition types grow with migrated families and do not become optional-field bags.

Confirmation adapters verify existing pending interaction state, authenticated form submissions, or persisted previews and pass action-bound evidence. Keep current confirmation stores, expiry, actor/guild/target binding, and preview generation. Shared operations decide whether that evidence is sufficient for the command. Never interpret arbitrary command metadata or an external boolean as proof. Internal recovery commands use a narrow persisted-operation binding rather than user confirmation.

### Persisted requests and dispatch

`decodeQueuedAction(row: unknown): DecodedQueuedAction` validates persisted rows and projects their shipped IDs and metadata into a discriminated command. `encodeQueuedAction(context: ActionContext, command: QueuedCommand): EnqueueInput` retains the existing action type, ID bindings, source, metadata, and operation-specific idempotency key. `EnqueueInput` is the typed storage boundary representation; only the codec owns the optional-column storage shape.

`dispatchQueuedAction(application: BotApplication, action: DecodedQueuedAction): Promise<QueuedActionOutcome>` calls the owning family and projects its result back into the existing stored receipt format. `QueuedActionOutcome` is a discriminated union retaining existing payloads, not `Record<string, unknown>`. Keep internal leases and report-ban attempt tokens in the worker/runtime execution envelope, outside public commands.

Introduce decoders and dispatch entries as their families migrate. Existing private worker handlers may remain only for not-yet-migrated families during this branch. Delete each migrated handler immediately. Task 12 makes the final registry exhaustive and removes the temporary fallback.

## Task 1: Shared package and complete attention acknowledgement

**Files:** Create the Task 1 files above, `packages/application/src/operations/{attention.ts,attention.test.ts}`, bot/web `adapters/attention.ts`, `src/__tests__/unit/ActionContext.unit.test.ts`, and `apps/web/lib/queueAttentionActionAdapter.test.ts`. Modify root and web `package.json`, `package-lock.json`, `Dockerfile`, `src/di/{container.ts,symbols.ts}`, `src/services/ModerationQueueService.ts`, `src/controllers/InteractionHandler.ts`, `apps/web/lib/queueAttentionActionAdapter.ts`, and `apps/web/app/admin/guild/[guildId]/inbox/actions.ts`. Move and then delete `src/services/QueueAttentionService.ts`; migrate its tests.

**Interfaces:** Produce the common contracts above and `createAttentionActions(deps: AttentionDependencies): AttentionActions`, with `acknowledge(context, {itemId}): Promise<ActionResult<AttentionOutcome>>` and `acknowledgeBatch(context, {itemIds}): Promise<readonly ActionResult<AttentionOutcome>[]>`. Derive `AttentionOutcome` from current acknowledgement results. `AttentionDependencies` preserves the current repository and message-deleter contracts and adds `AuthorityPort`.

- [ ] **1. Write policy and behavior tests.** Extend the current acknowledgement fakes. Arrange a present moderator with Moderate Members but no Manage Server, an existing attention item, and a separate web entry test. Name the tests `allows_discord_moderator_but_keeps_web_entry_gate`, `denies_revoked_actor_before_deleting_attention`, and `batch_preserves_each_items_binding_and_result`. Assertions:

```ts
expect(discordResult.kind).toBe('outcome');
expect(webEntryDenied).toBe(true);
expect(revokedResult).toEqual({ kind: 'denied', code: 'permission_denied' });
expect(deletedItemIdsAfterDeniedCall).toEqual([]);
expect(foreignGuildItemStillExists).toBe(true);
```

- [ ] **2. Run RED:** `npm test -- --runInBand --testPathPattern='ActionContext|QueueAttention|ModerationQueue'`. Run the new workspace test once its manifest exists. Confirm the new policy assertion or missing new package causes the failure; retain the existing behavior tests.
- [ ] **3. Implement the package and migrated operation.** Add `packages/application` to root workspaces and add file dependencies from the root bot and web manifests. Use `module: commonjs`, declaration output, `main/types` and `.`/`./postgres` exports pointing to `dist`. Define workspace `build`, `typecheck`, `lint`, `test`, and `test:coverage` scripts using existing root tool dependencies; the package Jest config uses ts-jest without the bot database setup. Add root `application:*` aliases and build prerequisites for root bot/dev/test and direct web build/test/typecheck entry points, including contracts checks once Task 11 adds their dependency. Copy all workspace manifests before Docker `npm ci`, build before consumers, and copy `packages/application/package.json` and `dist` into the production image so workspace links survive pruning. Wire both compositions, preserve web access checks, and remove duplicate action policy from the migrated handlers. Initialize the caller checklist with every row in this plan's coverage ledger.
- [ ] **4. Run GREEN:** `npm run application:build && npm run application:typecheck && npm run application:test -- --runInBand`; repeat the RED bot command and `npm run web:test -- lib/queueAttentionActionAdapter.test.ts lib/inboxActionReceipts.test.ts`. Add the web adapter test file if absent. Assert direct acknowledgement creates no durable request row.
- [ ] **5. Verify build loading:** `node -e "require('@drasil/application')"`, `node --input-type=module -e "import('@drasil/application')"`, `npm run build`, and `npm run web:typecheck`. Both package imports must succeed without credentials or bot bootstrap. Postgres entry loading is tested after Task 12.
- [ ] **6. Commit this complete checkpoint** with a focused `[AGENT]` commit message. Keep it on the single integration branch and link the existing shared-operation issue #89 when preparing the one draft PR.

## Task 2: Submitted-report review and case opening

**Files:** Create `packages/application/src/reports/{review.ts,review.test.ts,ports.ts}`, the initial request codec files, `src/application/adapters/reportReview.ts`, and `apps/web/lib/application/adapters/reportReview.ts`. Modify `apps/web/lib/reportQueueDataAdapter.ts`, `apps/web/app/admin/guild/[guildId]/reports/actions.ts`, `src/controllers/ReportInteractionHandler.ts`, and DI/composition. Move and delete `src/services/ReportReviewService.ts`; migrate `ReportReviewService.unit.test.ts` and `apps/web/lib/reportQueueDataAdapter.test.ts`.

**Interfaces:** Consume Task 1 context and authority. Produce `createReportReviewActions(deps: ReportReviewDependencies): ReportReviewActions`, with `close(context, {reportId, action}): Promise<ActionResult<CloseSubmittedReportResult>>` and `openCase(context, {reportId}): Promise<ActionResult<OpenSubmittedReportCaseResult>>`. Move the existing plain result and repository types into this module, remove raw actor input, and retain busy/already-handled/queue-cleanup results. Add the `open_case_from_observed_detection` codec; execution is migrated in Task 3.

- [ ] **1. Write tests** `denies_review_without_staff_authority`, `claimed_report_remains_busy`, `closure_keeps_actor_and_source`, and `open_case_retains_queued_receipt`. Arrange the existing report-review fakes, a claimed report, and a web actor authenticated by context. Assert:

```ts
expect(denied.kind).toBe('denied');
expect(claimed.outcome.status).toBe('busy');
expect(savedMetadata).toMatchObject({ closed_by: 'moderator-1', closed_surface: 'web' });
expect(opened.outcome).toMatchObject({ status: 'queued', requestId: 'request-1' });
```

- [ ] **2. Run RED:** `npm run application:test -- --runInBand --testPathPattern=review` and `npm run web:test -- lib/reportQueueDataAdapter.test.ts`. Confirm denial or actor-source coverage fails before moving code.
- [ ] **3. Migrate both callers completely.** Keep direct report closures direct. Move repository and Discord REST construction into runtime adapters. Use the existing queue for report-to-case opening, with shared command encoding. Preserve target/report bindings and source strings. Remove relative imports into root `src` and old review orchestration in UI modules.
- [ ] **4. Run GREEN:** the RED commands plus `npm test -- --runInBand --testPathPattern='ReportInteractionHandler|ReportReview'`, `npm run application:typecheck`, and `npm run web:typecheck`.
- [ ] **5. Complete the report-review caller checklist and commit.** Do not leave the old service as a compatibility re-export.

## Task 3: Case lifecycle and identity binding

**Files:** Create `packages/application/src/cases/{commands.ts,ports.ts,actions.ts,actions.test.ts}`, `src/application/adapters/cases.ts`, and `src/__tests__/unit/CaseActions.unit.test.ts`. Modify `CaseCommandHandler.ts`, case branches in `InteractionHandler.ts`, `ModerationActionRequestService.ts`, `apps/web/lib/{activeCaseDataAdapter.ts,memberOpenCaseActionQueue.ts,memberManualFlagActionQueue.ts}`, case/member web actions, compositions, and request codecs. Use the full controller/service paths identified in the coverage ledger.

**Interfaces:** Produce `createCaseActions(deps: CaseDependencies): CaseActions` and `execute(context, command: CaseCommand): Promise<ActionResult<CaseOutcome>>`. Cover the 12 queued case kinds in the ledger. Commands bind case actions to `caseId` and `targetUserId`; open-case variants carry selected-message channel/message references when present. An unbound slash/context ban belongs to Task 4, not a fabricated case.

- [ ] **1. Write tests** `rejects_case_from_another_guild_or_subject`, `verify_rechecks_actor_at_execution`, `resolved_case_is_not_reopened_by_stale_verify`, and `selected_message_survives_case_open`. Arrange the real existing verification workflow fakes and feed the same command through direct and worker paths. Assert:

```ts
expect(mismatch).toEqual({ kind: 'denied', code: 'binding_mismatch' });
expect(verificationCountAfterRevocation).toBe(0);
expect(resolvedCaseStatus).toBe('verified');
expect(storedSource).toMatchObject({
  source_channel_id: 'channel-1',
  source_message_id: 'message-1',
});
```

- [ ] **2. Run RED:** the new `CaseActions` suite and focused `InteractionHandler`, `UserModerationService`, and `SecurityActionService` units. Run `npm run web:test -- lib/activeCaseDataAdapter.test.ts` for the queued path.
- [ ] **3. Implement and migrate lifecycle callers.** Move authorization, enabled-action/reason decisions, current target binding, and coordination into the family. Reuse the current verification/role-release and repair workflows. Preserve administrator-only refresh and repair where required, membership/departure behavior, shipped custom IDs, prompt deduplication, and case source metadata. Remove migrated private worker methods and direct UI workflow calls. Keep automatic domain callers internal.
- [ ] **4. Run GREEN:** `npm run application:test -- --runInBand --testPathPattern=cases`, `npm test -- --runInBand --testPathPattern='CaseActions|InteractionHandler|UserModerationService|SecurityActionService'`, and the web test above. Run serial focused Postgres coverage using `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern='src/__tests__/integration/(UserModerationService|SecurityActionService|VerificationEventMetadata)'` with `DATABASE_URL` targeting the configured test database.
- [ ] **5. Update the 12 case rows and commit.** List remaining unbound staff moderation work under Task 4, not as an alternate case API.

## Task 4: Ordinary staff bans, kicks, and shared confirmation policy

**Files:** Extend case commands, ports, and actions; add `packages/application/src/cases/moderation.test.ts` and `src/__tests__/unit/{ModerationCommandHandler.unit.test.ts,SlashCommandConfirmations.unit.test.ts}`. Modify `src/controllers/{ModerationCommandHandler.ts,InteractionHandler.ts}`, `src/utils/slashCommandConfirmations.ts`, case web actions, and bot/web confirmation adapters in their context modules. Keep current pending-confirmation stores and modal parsers.

**Interfaces:** Add `ban_user` and `kick_user` direct command variants, with `targetUserId`, reason, and optional selected-message references. Add action-bound confirmation evidence to staff command input and a `ConfirmationPort.verify(context, command): Promise<boolean>` dependency implemented by existing trusted interface flows. Staff evidence is never reconstructed from arbitrary persisted metadata.

- [ ] **1. Write tests** `confirmation_cannot_move_to_another_target`, `ban_by_id_preserves_departed_subject`, and `disabled_action_and_missing_reason_block_all_callers`. Arrange the existing ten-minute slash confirmation and native modal paths. Assert:

```ts
expect(wrongTarget.code).toBe('confirmation_required');
expect(enforcementCountAfterExpiredConfirmation).toBe(0);
expect(departedBanTargetId).toBe('user-1');
expect(requiredReason.code).toBe('reason_required');
```

- [ ] **2. Run RED:** `npm run application:test -- --runInBand --testPathPattern=moderation` and focused controller/confirmation units in `npm test`.
- [ ] **3. Implement the common action policy and migrate every unbound native/slash/context caller.** Keep confirmation presentation and authentication in adapters. Recheck staff and bot capability before effects, and preserve current reason and self-target restrictions. Retain current `UserModerationService` enforcement, outcome, and audit paths. Have web policy availability and execution use the same evaluator without moving its entry gate into action policy.
- [ ] **4. Run GREEN:** the RED commands, `npm run web:test -- app/admin`, and `npm run web:typecheck`. Check the current case-flow fixture journey after migration.
- [ ] **5. Record direct versus queued staff paths, remove replaced helper branches, and commit.**

## Task 5: Observed detections, direct report bans, and uncertain-ban review

**Files:** Create `packages/application/src/detections/{commands.ts,ports.ts,actions.ts,actions.test.ts}`, `src/application/adapters/detections.ts`, and `apps/web/lib/observedAlertActionQueue.test.ts`. Modify observed/report-ban branches in `InteractionHandler.ts`, `ModerationCommandHandler.handleReviewReportBanCommand`, relevant worker methods, `apps/web/lib/{observedAlertActionQueue.ts,detectionAccountingActionQueue.ts}`, inbox/report/member web actions, and `moderationActionRequestDataAdapter.ts` receipt projection only where needed.

**Interfaces:** Produce `createDetectionActions(deps: DetectionDependencies): DetectionActions`. Cover all seven queued detection kinds plus direct `prepare_report_ban_review` and `review_uncertain_report_ban`. Keep the existing `ban_observed_detection` kind and model its `subject` as a report-bound or ordinary-observed discriminated union, rather than adding a queue type. Preserve report ID, expected detection/target, operation ID, and internal attempt fencing through runtime adapters.

- [ ] **1. Write tests** `revoked_actor_cannot_start_report_ban`, `confirmed_ban_recovery_finishes_after_policy_disable`, `uncertain_ban_never_reenforces`, and `accounting_change_is_guild_bound`. Use current report-ban database fixtures and domain services. Assert:

```ts
expect(banCallsAfterRevocation).toBe(0);
expect(banCallsAcrossRecovery).toBe(1);
expect(recoveredReceipt.status).toBe('banned');
expect(uncertainReceipt.status).toBe('ban_outcome_unknown');
expect(foreignDetectionAccountingUnchanged).toBe(true);
```

- [ ] **2. Run RED:** detection family and worker/controller units, followed by `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern='src/__tests__/integration/ReportBan(Persistence|Recovery)'`. Preserve currently passing domain cases while adding cross-entry assertions.
- [ ] **3. Migrate all seven queued kinds and direct observed/report-ban callers.** Reuse current durable preparation, report claim, evidence collector, enforcement, finalization, reconciliation, and operator-review flows. Fresh-fetch authority for new enforcement. Internal recovery loads the owned persisted operation and continues without granting new enforcement. Preserve source, outcome receipts, safe undo behavior, and already-banned/departed paths. Keep no raw recent-message content in new persistent evidence.
- [ ] **4. Run GREEN:** RED suites plus `npm run web:test -- lib/observedAlertActionQueue.test.ts lib/moderationActionRequestDataAdapter.test.ts lib/inboxActionReceipts.test.ts app/admin`; run `npm run web:e2e -- e2e/report-ban.spec.ts` once the web build fixtures are ready.
- [ ] **5. Update detection/report-ban ledger entries and commit.** Do not refactor domain claim or reconciliation SQL as incidental cleanup.

## Task 6: Compromised-account quarantine

**Files:** Create `packages/application/src/containment/{quarantine.ts,quarantine.test.ts,ports.ts}` and `src/application/adapters/quarantine.ts`. Modify quarantine branches in worker, `InteractionHandler.ts`, case web actions, and `src/utils/accountQuarantinePreview.ts` only to share the transport-neutral binding calculation.

**Interfaces:** Produce `createQuarantineActions(deps: QuarantineDependencies): QuarantineActions`, with `preview(context, {caseId,targetUserId})` and `execute(context, {caseId,targetUserId,reason,previewReference})` returning the current preview/result data inside `ActionResult`. `previewReference` is a discriminated reference to the existing Discord confirmation fingerprint or persisted web preview request, resolved server-side. No caller supplies a trusted preview object.

- [ ] **1. Write tests** `changed_role_or_readiness_invalidates_preview`, `quarantine_does_not_overwrite_newer_verification`, and `preview_from_another_case_is_rejected`. Use existing fingerprint and quarantine fakes. Assert:

```ts
expect(stalePreview.code).toBe('stale_state');
expect(roleRemovalCountAfterStalePreview).toBe(0);
expect(caseStatusAfterVerificationWins).toBe('verified');
expect(wrongCase.code).toBe('binding_mismatch');
```

- [ ] **2. Run RED:** application quarantine tests and focused `AccountQuarantineService`/worker units.
- [ ] **3. Migrate preview and execute for every caller.** Keep existing lockdown, privilege, role-hierarchy, recovery-thread, notification-readiness, lease, and restoration fences. Store request references in runtime execution context rather than exposing worker tokens publicly. Preserve the difference between a failed containment and committed containment with pending presentation.
- [ ] **4. Run GREEN:** `npm run application:test -- --runInBand --testPathPattern=quarantine`, `npm test -- --runInBand --testPathPattern='AccountQuarantine|ModerationActionRequestService|InteractionHandler'`, affected web case tests, and serial `AccountQuarantinePersistence.integration.test.ts`.
- [ ] **5. Complete both queued quarantine rows and direct confirmation paths, delete migrated orchestration, and commit.**

## Task 7: CAPTCHA moderation and browser completion

**Files:** Create `packages/application/src/containment/{captcha.ts,captcha.test.ts}`, bot/web `adapters/captcha.ts`, and extend request codecs. Modify `src/services/CaptchaChallengeService.ts` enqueue callers, CAPTCHA worker/interaction branches, `apps/web/lib/captchaCompletion.ts`, and the existing routes under `apps/web/app/api/captcha/`.

**Interfaces:** Produce `createCaptchaActions(deps: CaptchaDependencies): CaptchaActions` for the five queued CAPTCHA kinds. Also expose the existing browser mutation operations `beginAttempt`, `recordIdentityMismatch`, `completeAttempt`, and `requeuePassEffect` using action context and the existing attempt/challenge references. Retain case ID, target ID, challenge ID, expected generation, and revision on the command variants that need them. Ports accept verified provider outcomes, not provider secrets or raw vendor responses.

- [ ] **1. Write tests** `stale_generation_cannot_apply_pass`, `external_input_cannot_select_captcha_system_actor`, `provider_budget_and_identity_mismatch_keep_current_outcomes`, and `moderator_bypass_rechecks_authority`. Assert:

```ts
expect(staleGeneration.code).toBe('stale_state');
expect(passApplicationCount).toBe(0);
expect(externalCommandWithActor.success).toBe(false);
expect(identityMismatchState).toBe('identity_mismatch');
```

- [ ] **2. Run RED:** CAPTCHA application tests, `CaptchaChallengeService`/worker units, and `npm run web:test -- lib/captchaCompletion.test.ts`.
- [ ] **3. Migrate moderator, callback, and internal enqueue callers.** Authenticate browser identity and validate provider responses in route/runtime adapters. Keep existing transactional budget/attempt/challenge updates atomic in persistence ports. Only the internal context factory can select `captcha_pass` or `captcha_attention`; verify its persisted challenge binding. Leave read-only public challenge retrieval and expiry scheduling internal while routing their action effects through the shared operation or codec.
- [ ] **4. Run GREEN:** RED suites plus serial `CaptchaChallengeRepository.integration.test.ts`. Confirm completion still returns the current public state and queues exactly one pass effect.
- [ ] **5. Complete the five queue rows and all browser mutation callers, remove old policy branches, and commit.**

## Task 8: Message cleanup and combined ban/cleanup

**Files:** Create `packages/application/src/messageCleanup/{commands.ts,ports.ts,actions.ts,actions.test.ts}` and `src/application/adapters/messageCleanup.ts`. Modify three cleanup worker handlers, the cleanup submission branches in `apps/web/lib/{activeCaseDataAdapter.ts,messageCleanupDataAdapter.ts}`, and case action handlers. Preserve `src/services/{MessageCleanupService.ts,MessageDeletionService.ts}` workflows.

**Interfaces:** Produce `createMessageCleanupActions(deps: MessageCleanupDependencies): MessageCleanupActions`, covering the three queued cleanup kinds. Commands carry the job, case, subject, scope/reason where required, and bound frozen-preview reference. Results preserve candidate, preserved, deleted, missing, changed, and failed counts plus ban/finalization states.

- [ ] **1. Write tests** `cleanup_requires_current_administrator`, `changed_frozen_job_cannot_execute`, and `combined_retry_resumes_after_ban_without_reenforcement`. Assert:

```ts
expect(nonAdministrator.code).toBe('permission_denied');
expect(deleteCallsBeforeEvidencePreserved).toBe(0);
expect(combinedBanCallsAcrossRetry).toBe(1);
expect(result.outcome).toMatchObject({ deletedCount: 1, deleteFailedCount: 1 });
```

- [ ] **2. Run RED:** cleanup family, existing cleanup/worker units, and `apps/web/app/admin/guild/[guildId]/cases/messageCleanupActions.test.ts`.
- [ ] **3. Move binding, administrator, enabled-action and confirmation policy into the family.** Keep discovery, frozen candidates, evidence preservation, Discord deletion, combined-operation markers, and recovery in established workflows. New enforcement requires authority; already-committed ban recovery continues its owned cleanup without banning again.
- [ ] **4. Run GREEN:** RED suites, serial `MessageDeletionJobRepository.integration.test.ts`, and `npm run web:e2e -- e2e/message-cleanup.spec.ts` with fixture services running.
- [ ] **5. Complete all cleanup caller rows, remove moved private methods, and commit.**

## Task 9: Operations, audits, lockdown execution, and bulk intake

**Files:** Create `packages/application/src/operations/{commands.ts,ports.ts,actions.ts,actions.test.ts}`, `src/application/adapters/operations.ts`, and `apps/web/lib/moderationQueueOperationActionQueue.test.ts`. Modify `ModerationCommandHandler.ts`, `CaseCommandHandler.ts`, `LockdownConfigCommandHandler.ts`, operations worker handlers, `apps/web/lib/moderationQueueOperationActionQueue.ts`, and admin operations actions. Keep the Task 1 attention module focused.

**Interfaces:** Produce `createOperationsActions(deps: OperationsDependencies): OperationsActions`, covering six queued operation kinds and direct `audit_integrity`. Bulk intake commands carry role ID, limit, reason, and existing execute/preview intent. Preserve existing scope, limit, unsync, and dry-run options. Current domain audit output remains structured and SDK-free at the boundary.

- [ ] **1. Write tests** `bulk_intake_requires_admin_and_existing_reason_policy`, `queue_clear_is_guild_scoped`, and `audit_preview_has_no_repair_effects`. Assert:

```ts
expect(bulkWithoutReason.code).toBe('reason_required');
expect(otherGuildQueueCount).toBe(originalOtherGuildQueueCount);
expect(repairCallsDuringPreview).toBe(0);
expect(lockdownUnsyncIntent).toBe(false);
```

- [ ] **2. Run RED:** operations family and affected `IntegrityAuditService`, `ModerationQueueService`, `CaseRoleLockdownService`, and worker units.
- [ ] **3. Migrate all direct and queued operations callers.** Preserve administrator/Manage Server restrictions, bounded intake, audit-versus-apply semantics, actual confirmation flags, and existing sweep behavior. Leave scheduled sweeps internal; where they share a workflow, do not grant them staff identity or add new durable jobs.
- [ ] **4. Run GREEN:** RED suites, `npm run web:test -- lib/moderationQueueOperationActionQueue.test.ts app/admin`, and `npm run web:typecheck`.
- [ ] **5. Complete six queued and direct audit/bulk rows, remove orchestration from handlers, and commit.**

## Task 10: Report submission, intake, and target confirmation

**Files:** Create `packages/application/src/reports/{commands.ts,ports.ts,actions.ts,actions.test.ts}` and `src/application/adapters/reports.ts`. Modify `src/controllers/{ReportCommandHandler.ts,ReportInteractionHandler.ts}`, `src/services/ReportIntakeAgentService.ts` submission caller where needed, three worker report handlers, `apps/web/lib/{userReportActionQueue.ts,reportIntakePortalDataAdapter.ts}`, and reporter-facing actions. Preserve domain internals in `ReportIntakeService` and `ReportSubmissionService`.

**Interfaces:** Produce `createReportActions(deps: ReportDependencies): ReportActions`. Cover the three queued report kinds plus `submit_message_report`, `confirm_intake_candidate`, and `reject_intake_candidates`. Intake closure supports its existing reporter/staff identity variants. A candidate-confirmation command references the intake and existing prompt token/message, and target submission uses the confirmed platform ID. Preserve current reporter external-report policy and reason requirements.

- [ ] **1. Write tests** `reporter_cannot_choose_staff_authority`, `candidate_confirmation_is_bound_to_current_prompt`, `external_report_policy_is_preserved`, and `report_claim_blocks_conflicting_closure`. Assert:

```ts
expect(spoofedStaff.code).toBe('permission_denied');
expect(wrongPrompt.code).toBe('confirmation_required');
expect(unconfirmedTargetSubmissionCount).toBe(0);
expect(claimedClosure.outcome.status).toBe('busy');
```

- [ ] **2. Run RED:** application report tests, `ReportInteractionHandler`/`ReportIntakeService`/`ReportSubmissionService` units, and reporter web action tests.
- [ ] **3. Migrate intake creation, user/message submission, confirm/reject, reporter/staff closure, and existing agent submission.** Keep screenshot analysis and message-evidence ingestion internal. Preserve source message/attachment references, configured staff-role exceptions, report claims, thread creation/cleanup, summary provenance, and existing response copy. Remove duplicated worker thread orchestration only after the runtime workflow dependency owns it.
- [ ] **4. Run GREEN:** RED suites, serial `ReportIntakeRepository.integration.test.ts`, relevant `ReportBanPersistence` conflict tests, and `npm run web:test -- app/report lib/reportIntakePortalDataAdapter.test.ts`.
- [ ] **5. Complete the report-submission/intake rows and commit.**

## Task 11: Setup, onboarding, report panels, and every settings mutation

**Files:** Create `packages/application/src/setup/{commands.ts,settings.ts,ports.ts,actions.ts,actions.test.ts}` and bot/web `adapters/setup.ts`. Modify `packages/contracts/src/setup.ts` and its manifest only to consume shared input validation; keep existing contract exports. Modify `src/controllers/{CommandHandler.ts,ConfigSubcommandHandler.ts,LockdownConfigCommandHandler.ts,SetupCommandHandler.ts,SetupVerificationModalHandler.ts,ReportInstructionsManager.ts,ReportCommandHandler.ts}`, two setup worker handlers, `apps/web/lib/{setupArtifactActionQueue.ts,setupDashboardService.ts,setupDataAdapter.ts,setupAuthorization.ts}`, and setup/onboarding web actions.

**Interfaces:** Produce `createSetupActions(deps: SetupDependencies): SetupActions`, with kinds `complete_setup_verification`, `upsert_report_instructions`, `clear_report_instructions`, `update_setup`, `update_settings`, `update_heuristics`, `reset_heuristics`, `lockdown_allow_add`, `lockdown_allow_remove`, and `disable_lockdown`. `update_settings` has a closed section union: roleGate, roleQuarantine, queue, manualIntake, detection, caseStaff, caseReview, report, analytics, verification, lockdown. Each section accepts its actual typed setting changes, not unrestricted JSON. Report-panel commands retain deliberate-repost and expected-message/channel/submission bindings.

- [ ] **1. Write tests** `only_owner_can_enable_full_analytics`, `setup_requires_admin_beyond_web_entry_access`, `section_patch_preserves_other_settings`, `report_panel_repost_requires_fresh_submission`, and `provider_mode_requires_configuration`. Assert:

```ts
expect(nonOwnerFullAnalytics.code).toBe('permission_denied');
expect(manageGuildOnlySetup.code).toBe('permission_denied');
expect(savedSettings.unrelated_setting).toBe(originalSettings.unrelated_setting);
expect(panelCreateCountAfterRepeatedSubmission).toBe(1);
```

- [ ] **2. Run RED:** setup family, current `packages/contracts/src/setup.test.ts`, web setup authorization/dashboard tests, and setup worker units.
- [ ] **3. Consolidate input policy and migrate all settings callers.** Move transport-neutral setup mutation schemas and constants from contracts into application/setup/settings, retaining their existing names and validation limits. Export those names from the application core entry point and add the contracts workspace's file dependency on application. Contracts re-export their existing public names from that core entry; application never imports the ESM contracts package. Preserve all existing values, reset behavior, cache invalidation, normalization, field-specific metadata updates, consent, and provider checks. Keep form parsing, Discord option parsing, view-formatting, and interface access gates in adapters. Reuse provisioning and setup compensation workflows, including permission provenance. Remove obsolete `setupAuthorization.ts` after callers and tests move. Keep read-only config views on existing query paths.
- [ ] **4. Run GREEN:** `npm run application:test -- --runInBand --testPathPattern=setup`, `npm run contracts:test`, `npm run contracts:typecheck`, focused setup/config bot units, `npm run web:test -- lib/setupAuthorization.test.ts lib/setupDashboardService.test.ts lib/setupDataAdapter.test.ts app/admin`, and serial `SetupReportChannelPersistence.integration.test.ts`. Remove obsolete test paths from this command when their tests have moved; run the replacement setup family suite instead.
- [ ] **5. Complete every configuration-section and onboarding/panel row in the checklist, delete duplicated write helpers, and commit.**

## Task 12: One enqueue implementation and final mechanical worker

**Files:** Create `packages/application/src/postgres/{index.ts,enqueue.ts,enqueue.test.ts}`, `src/__tests__/integration/ActionRequestEnqueue.integration.test.ts`, and finalize request codec tests. Modify `src/repositories/ModerationActionRequestRepository.ts`, `apps/web/lib/moderationActionRequestQueue.ts`, their current tests, `src/application/requestDispatch.ts`, and `src/services/ModerationActionRequestService.ts`.

**Interfaces:** Produce `buildEnqueueStatement(input: EnqueueInput): {text: string; values: readonly unknown[]}` from the postgres subpath. Both existing clients execute this same parameterized statement and map its result into their existing return types. Export `queuedCommandSchemas` from the shared request codec and `queuedActionHandlers` from bot dispatch; check the latter with `satisfies Record<QueuedCommand['kind'], QueuedHandler>` and verify schema-to-registry equality. Preserve workers' narrow internal execution envelope separately from user commands.

- [ ] **1. Characterize both current enqueue paths in Postgres before replacement.** Tests `same_key_same_binding_is_idempotent`, `completed_noop_retry_requires_eligible_unowned_subject`, `protected_receipts_never_reset`, `concurrent_retry_mints_one_attempt_token`, and `mismatched_immutable_bindings_cannot_reuse_key` run against Prisma and pg callers. Assert:

```ts
expect(new Set(concurrentReceipts.map((receipt) => receipt.id)).size).toBe(1);
expect(new Set(concurrentAttemptTokens).size).toBe(1);
expect(confirmedRequestAfterReplay).toEqual(confirmedRequestBeforeReplay);
expect(staleAttemptCanComplete).toBe(false);
```

- [ ] **2. Run characterization GREEN first**, then add a shared-builder contract test and run it RED. Use serial `ActionRequestEnqueue`, `ReportBanPersistence`, and `ReportBanRecovery` integration tests. Explicitly compare the current SQL differences; keep protected-operation and immutable-binding constraints from either path in the shared contract. A conflict never authorizes another actor/action/target under an existing key.
- [ ] **3. Implement the one builder and migrate both clients.** Parameterize values; never interpolate user values into SQL text. Preserve serialized setup's advisory lock and caller transaction boundaries. Update bot `enqueue` return mapping without duplicating predicates. Delete both old SQL copies. Finish all 40 legacy row decoders and receipt encoders with fixtures using existing stored source strings and metadata. Remove the worker's migrated private action methods and fallback registry; retain claim, heartbeat, completion/failure, and internal reconciliation scheduling.
- [ ] **4. Run GREEN:** `npm run application:test -- --runInBand`, `npm test -- --runInBand --testPathPattern=ModerationActionRequestService`, `npm run web:test -- lib/moderationActionRequestQueue.test.ts`, and serial integration command from Step 2. Assert old payload fixtures reach their registered family, unknown/invalid rows fail without effects, and completed/uncertain report-ban recovery remains enforcement-free.
- [ ] **5. Verify both built entry points:** `node -e "require('@drasil/application'); require('@drasil/application/postgres')"` and the equivalent dynamic ES imports. Importing core must not evaluate postgres code. Finish the persistence rows and commit.

## Task 13: Complete coverage, production packaging, and the one PR

**Files:** Add `scripts/check-action-boundary.mjs`, its `node:test` tests, and `docs/dev/action-boundary.md`. Modify root quality scripts, `scripts/check-metrics.sh`, `.github/workflows/ci.yml`, `Dockerfile`, action availability consumers, and the completed caller checklist. Delete unused superseded action services, worker helpers, UI policy helpers, and their implementation-only tests.

**Interfaces:** `node scripts/check-action-boundary.mjs` exits zero only when all 40 current enum types have codecs and worker handlers and the caller checklist has no unmigrated action. Compare the schema enum with `queuedCommandSchemas` and `queuedActionHandlers`. Use the existing TypeScript compiler API to follow imports and aliases. In mixed controllers or data adapters, inspect the inventoried mutation method bodies rather than forbidding dependencies needed by unrelated read methods. For action-only UI modules, prohibit direct workflow imports. Runtime adapters and domain internals are allowed to call their owned dependencies. Include `packages/application/src` in size/complexity checks.

- [ ] **1. Write check tests** `missing_enum_handler_fails`, `aliased_workflow_import_in_ui_fails`, `domain_internal_call_is_allowed`, and `core_import_does_not_load_postgres`. Add cross-entry action parity tests for representative case, report, CAPTCHA, cleanup, and setup commands. Assert:

```ts
expect(missingHandlerExitCode).not.toBe(0);
expect(aliasedBypassExitCode).not.toBe(0);
expect(domainInternalExitCode).toBe(0);
expect(directDecision).toEqual(workerDecision);
expect(directDomainEffects).toEqual(workerDomainEffects);
expect(auditSources).toEqual(['discord_interaction', 'web']);
```

- [ ] **2. Run RED:** `node --test scripts/check-action-boundary.test.mjs` and the cross-entry regression suites. Prove the checker detects a temporary missing fixture registration or forbidden aliased dependency, without modifying tracked production sources for the probe.
- [ ] **3. Finish the check, scripts, and removal pass.** Add `application:build`, lint, typecheck, coverage, and boundary verification to `check:ci`, ahead of affected consumers. Keep shared package tests outside bot global integration setup. Document the actual interfaces and direct/queued choices. Verify every coverage-ledger row has exact callers, confirmation policy, delivery, operation, and covering test; search migrated controllers and web mutations for remaining direct orchestration. Compare policy decisions and domain effects in cross-entry tests while separately asserting each entry's actual source and correlation IDs. Remove only superseded implementation tests, retaining domain behavior coverage.
- [ ] **4. Run focused GREEN**, then the full required gate once: `npm run check:ci`, `npm run code:metrics`, `npm run agent:check`, and `node scripts/check-action-boundary.mjs`. Configure the local test database, then run its suites serially. The existing `npm run test:integration` script does not forward test arguments; use `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern=...` for focused runs. Treat new failures as work in this PR, not reasons to drop a family. Do not refresh visual snapshots unless the rendered output actually and intentionally changes.
- [ ] **5. Verify production packaging:** build `docker build -t drasil-action-boundary:local .`, then run `docker run --rm --entrypoint node drasil-action-boundary:local -e "require('@drasil/application'); require('@drasil/application/postgres')"`. This import probe must succeed after production pruning without starting the bot or using live credentials. Run Next.js production build and the existing fixture `case-flow`, `report-ban`, and `message-cleanup` journeys. If Docker is unavailable, record that limitation and arrange an equivalent exact-head CI image smoke before declaring the PR ready.
- [ ] **6. Commit and finish the same PR.** Commit the completed checks, documentation, and removal pass before the final branch review. Use one draft PR for the integration branch, update its description around the complete migration, and attach its URL to the chat. Include design/plan links and issue #89. Follow repository review/recycle rules, including delayed review sweeps. Do not merge or deploy as part of this plan. Report exact-head checks, extra packaging verification, and any genuine remaining limitations.

## Coverage ledger

Each queued kind is listed once. All use the existing persisted spelling as the command kind. Direct operations have additional discriminants above. During implementation, expand each row into its exact caller checklist entry; do not use the family row as evidence that each caller was migrated.

| Task | Existing queued kinds                                                                                                                                                                                                                                                   | Current worker methods to remove after migration                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | `open_case_from_observed_detection`, `open_admin_case`, `manual_flag_user`, `verify_case_user`, `close_case_no_action`, `kick_case_user`, `ban_case_user`, `ban_case_user_by_id`, `repair_active_case`, `reopen_case`, `refresh_case_notification`, `sync_existing_ban` | `openObservedDetectionCase`, `openAdminCase`, `manualFlagUser`, `verifyCaseUser`, `closeCaseNoAction`, `kickCaseUser`, `banCaseUser`, `banCaseUserById`, `repairActiveCase`, `reopenCase`, `refreshCaseNotification`, `syncExistingBan` |
| 10   | `submit_user_report`, `start_report_intake`, `close_report_intake`                                                                                                                                                                                                      | `submitUserReport`, `startReportIntake`, `closeReportIntake`                                                                                                                                                                            |
| 5    | `dismiss_observed_detection`, `mark_observed_detection_false_positive`, `undo_observed_detection_action`, `kick_observed_detection`, `ban_observed_detection`, `ignore_detection_accounting`, `restore_detection_accounting`                                            | `dismissObservedDetection`, `undoObservedDetectionAction`, `kickObservedDetection`, `banObservedDetection`, `ignoreDetectionAccounting`, `restoreDetectionAccounting`                                                                   |
| 6    | `preview_account_quarantine`, `quarantine_compromised_account`                                                                                                                                                                                                          | `previewAccountQuarantine`, `quarantineCompromisedAccount`                                                                                                                                                                              |
| 7    | `request_captcha_challenge`, `retry_captcha_challenge`, `bypass_captcha_challenge`, `apply_captcha_pass`, `notify_captcha_attention`                                                                                                                                    | `requestCaptchaChallenge`, `bypassCaptchaChallenge`, `applyCaptchaPass`, `notifyCaptchaAttention`                                                                                                                                       |
| 8    | `preview_case_message_deletion`, `execute_case_message_deletion`, `ban_case_user_with_message_cleanup`                                                                                                                                                                  | `previewCaseMessageDeletion`, `executeCaseMessageDeletion`, `banCaseUserWithMessageCleanup`                                                                                                                                             |
| 9    | `sync_moderation_queue`, `clear_moderation_queue`, `close_resolved_case_threads`, `audit_case_role_lockdown`, `apply_case_role_lockdown`, `intake_role_members`                                                                                                         | `syncModerationQueue`, `clearModerationQueue`, `closeResolvedCaseThreads`, `auditCaseRoleLockdown`, `applyCaseRoleLockdown`, `intakeRoleMembers`                                                                                        |
| 11   | `complete_setup_verification`, `upsert_report_instructions`                                                                                                                                                                                                             | `completeSetupVerification`, `upsertReportInstructions`                                                                                                                                                                                 |

Task 3 introduces the shared case-side execution of kicks and bans; Task 4 completes native unbound moderation and shared confirmation policy. Neither task is a separate PR. Task 5 keeps report-bound bans distinct from ordinary bans. Task 12 owns final persisted encoding and exhaustive dispatch, not the business workflows.

| Tasks | Nonqueued operations                                                                                                          | Concrete caller groups                                                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Single and visible-batch attention acknowledgement                                                                            | `InteractionHandler.handleQueueAcknowledgeButtonInteraction`, `ModerationQueueService.acknowledgeAttentionItem`, inbox `acknowledgeQueueAttentionItem`, `acknowledgeQueueAttentionItems`, and their inbox wrappers                                                                                                                          |
| 2     | Close submitted report, mark actioned/dismissed/false-positive, open submitted report case                                    | `ReportReviewService.closeSubmittedReport/openCaseFromSubmittedReport`, reportQueueDataAdapter, admin report action exports, ReportInteractionHandler admin-review path                                                                                                                                                                     |
| 3, 4  | Case lifecycle; member/message case opening; ordinary slash/context bans and kicks; ban by ID                                 | `CaseCommandHandler` open/repair/refresh, `ModerationCommandHandler` ban/flag/context methods, `InteractionHandler` case/modal/native handlers, member web `queueMemberOpenCaseAction` and `queueMemberManualFlagAction`, case web exports                                                                                                  |
| 5     | Observed open/dismiss/false-positive/undo/kick/ban; report-ban preparation and uncertain-ban review; accounting changes       | `InteractionHandler` observed branches, `ModerationCommandHandler.handleReviewReportBanCommand`, inbox/report exports, member `queueObservedDetectionUndoAction` and `queueDetectionAccountingAction`                                                                                                                                       |
| 6     | Direct quarantine preview, confirm, and execute                                                                               | `InteractionHandler.handleAccountQuarantineModalSubmit`, existing preview fingerprint confirmation path, web case quarantine phases                                                                                                                                                                                                         |
| 7     | Direct challenge/retry/bypass; browser attempt begin, mismatch, completion, pass requeue                                      | `InteractionHandler` CAPTCHA branches, `CaptchaChallengeService` internal enqueue methods, `captchaCompletion.beginCaptchaAttempt/recordCaptchaIdentityMismatch/completeCaptchaAttempt/requeueCaptchaPassEffect`, captcha callback/complete routes                                                                                          |
| 8     | Every direct cleanup preview/execute/combined entry                                                                           | Case cleanup controls, activeCaseDataAdapter/messageCleanupDataAdapter submission paths, current worker cleanup orchestration                                                                                                                                                                                                               |
| 9     | Direct queue maintenance, integrity audit/supported repairs, thread sweeps, lockdown audit/apply, role-intake preview/execute | `ModerationCommandHandler.handleAuditCommand/handleIntegrityAuditCommand/handleCloseResolvedThreadsCommand`, `CaseCommandHandler.handleCaseRoleIntakeCommand/executeRoleIntake`, `LockdownConfigCommandHandler`, admin operations exports                                                                                                   |
| 10    | User/message reports, intake creation, candidate confirm/reject, confirmed submission, reporter/staff closure                 | `ReportCommandHandler`, `ReportInteractionHandler` initiate/confirm/reject/modal/close methods, `ReportSubmissionService` externally initiated methods, `ReportIntakeAgentService` confirmed submission, reporter web exports                                                                                                               |
| 11    | Onboarding, setup, report panel repair/repost/clear, all configuration mutations                                              | `SetupCommandHandler`, `SetupVerificationModalHandler`, `ReportInstructionsManager.upsertReportInstructionsMessage/clearReportInstructions`, `ReportCommandHandler.handleSetupReportButtonCommand`, CommandHandler config dispatch, all ConfigSubcommandHandler groups, LockdownConfigCommandHandler writes, admin setup/onboarding exports |

The Task 11 section union covers every configuration group: role-gate, role-quarantine, queue, manual-intake, detection, case-staff, case-review, report, analytics, verification, and lockdown. Heuristic updates and resets have their own commands. Map every mutating subcommand in `src/controllers/commandDefinitions.ts` and every mutable field in `guildSetupUpdateSchema` to one of those commands, including prompt/context reset and watched-term data. Read-only view commands stay queries.

## Plan review and execution

The design spec is approved. This plan is a new artifact and needs review before implementation. No execution method has been selected yet.

Recommended method: **subagent-driven, sequential tasks**. The migration touches shared controllers and recovery-sensitive operations, so an independent review at each checkpoint is useful. Keep implementers serial on the integration branch; do not parallelize edits to shared controllers, worker dispatch, codecs, or composition. Native execution is also available, with one independent whole-branch review after implementation. Either method delivers the same one PR and full coverage.
