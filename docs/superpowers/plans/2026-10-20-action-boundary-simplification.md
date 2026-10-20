# Action Boundary Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify existing action submission and request execution, deleting redundant paths before MCP development.

**Architecture:** Preserve application family operations, the canonical queue codec, shared SQL builder and worker lifecycle. Consolidate web queued submission around trusted context plus typed command, share confirmation identity calculation and replace application-object substitution with prepared request execution.

**Tech Stack:** Existing TypeScript, Zod 3, discord.js, Next.js 16.3, pg/Prisma, Jest and Vitest. No new dependencies.

**Spec:** [Approved design](../specs/2026-10-20-action-boundary-simplification-design.md). Read it before this plan.

## Global Constraints

- Deliver these changes in one focused follow-up PR.
- This is a behavior-preserving refactor of existing callers.
- Preserve current operation permissions, mutable policy, target/state checks, confirmation requirements and fresh execution authority.
- Preserve direct Discord execution and existing direct web mutations, including acknowledgement before potentially slow authority refreshes.
- Preserve the forty shipped durable request kinds, their stored representations, idempotency key formats and deduplication/retry semantics.
- Preserve authenticated actor identity and shipped provenance values, including `web`, `web_report`, `web_case`, `discord_interaction` and internal CAPTCHA sources.
- Preserve existing receipt statuses, persisted outcome shapes, UI result mapping, partial completion and uncertain enforcement outcomes.
- Preserve CAPTCHA state/effect atomicity, setup serialization, report-ban attempt fencing, committed-enforcement recovery and completion-hook ordering.
- Preserve current fixture behavior at the web boundary, including specialized completed/queued receipts used by browser tests.
- Do not add MCP endpoints, SDKs, OAuth, browser approval pages, new queued action kinds, new public APIs, new read-access policy, or changes to database schemas.
- Follow `AGENTS.md`; check `AGENTS.local.md` when present. Public prose must omit private community/customer names, and GitHub issue/PR prose starts with `[AGENT]`.
- Read `apps/web/AGENTS.md` and the installed Next.js guides before changing server actions. Database integration tests run serially against the designated test database.

## Review Focus

1. A repeated CAPTCHA action must keep the submitted attempt ID and reject a stale/missing challenge generation without inserting a request. Covered in Task 4.
2. A queued action must still fail after moderator permissions are revoked; preparation must not cache authority or turn a closure into approval evidence. Covered in Task 5.
3. A failed CAPTCHA effect insert must roll back its challenge transition, and a conflicting setup submission must retain its serialized conflict behavior. Covered in Task 2.
4. A removed wrapper must not change report actor/source, report/detection binding, target-user creation, or fixture completed/queued feedback. Covered in Task 3.
5. A recorded successful enforcement followed by worker interruption must finish only authorized follow-up work, preserve attempt ownership and never repeat enforcement. Covered in Task 5.

## File structure and sequencing

| Unit                         | Files and responsibility                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirmation identity        | `packages/application/src/confirmation.ts` adds one pure binding projection. Existing Discord/web adapters retain evidence issuance.                                                                                                |
| Runtime authority            | New `src/application/adapters/authority.ts` and `apps/web/lib/application/adapters/authority.ts` own existing SDK-specific authority loaders moved from attention adapters.                                                         |
| Web submission               | New `apps/web/lib/application/queuedSubmission.ts` owns typed ordinary submission and named setup serialization. `apps/web/lib/moderationActionRequestQueue.ts` retains derived contracts and the transaction-aware encoded writer. |
| Caller translation/admission | Existing server actions, observed/accounting translators, setup artifact adapter and admitted report adapter build each command once and use the submission path. Delete queue-only member wrappers.                                |
| Case translation             | New `apps/web/lib/application/caseCommands.ts` owns exhaustive UI-action translation; `activeCaseDataAdapter.ts` retains current-state admission and UI receipt mapping.                                                            |
| Prepared execution           | `src/application/requestRuntime.ts` owns decoding, accepted-submission evidence and completion hooks. `requestDispatch.ts` retains the sole exhaustive queued handler registry and existing receipt projections.                    |
| Worker/composition           | `ModerationActionRequestService.ts` calls a prepared executor. `createBotApplication.ts` stops advertising unbound cleanup execution.                                                                                               |

Tasks 1–4 establish the simpler web boundary; Task 5 changes bot request composition. Task 6 verifies the whole branch and updates documentation. Keep commits on `refactor/action-boundary-simplification`, based on merged commit `f1853d0`. The approved spec is committed as `d1c8cf5`. If an isolated execution worktree is needed, use the worktree skill first and continue this branch there; do not restart from the old refactor branch. Capture production-code size before implementation using the same paths/exclusions as `scripts/check-metrics.sh`.

### Task 1: Share confirmation identity and give authority loaders their own modules

**Files:** Modify `packages/application/src/confirmation.ts`, `src/application/context.ts`, `apps/web/lib/application/context.ts`, both attention adapters and all imports of their authority factories. Create both authority modules listed above and `packages/application/src/confirmation.test.ts`. Extend `apps/web/lib/application/context.test.ts` and existing bot confirmation tests.

**Interfaces:** Produce `confirmationBindingFor(context: ActionContext, command: ConfirmationCommand): ConfirmationBinding | null` through the existing application root export. Keep `matchesConfirmation`, `createBotAuthority(client: Client): AuthorityPort`, `createWebAuthority(): AuthorityPort` and their current behavior/signatures. No dependency on later tasks.

- [x] Add tests named `projects each confirmation target category`, `preserves intake-case-operation-user precedence`, and `does not project system approval`. Use a user context with guild `guild`, actor `actor` and request `submission`. Pin literal expected target IDs for commands containing overlapping fields, and assert:

  ```ts
  expect(
    confirmationBindingFor(context, {
      kind: 'ban_case_user',
      caseId: 'case',
      targetUserId: 'target',
    })
  ).toEqual({ guildId: 'guild', actorId: 'actor', action: 'ban_case_user', targetId: 'case' });
  expect(
    confirmationBindingFor(
      { ...context, actor: { kind: 'system', purpose: 'captcha_pass' } },
      command
    )
  ).toBeNull();
  expect(matchesConfirmation(context, command, null)).toBe(false);
  ```

- [x] Run `npm run application:test -- --runInBand confirmation.test.ts`; expect failure because the new projection does not exist.
- [x] Implement the pure projection and use it in the matcher, Discord store's default binding construction and authenticated web form adapter. Keep explicit supplied evidence, one-use consumption, ten-minute expiry, 1,024-entry limit and report checkbox normalization. Move authority functions without changing fetches, error handling or caching. Update consumers directly, without re-export aliases from attention modules.
- [x] Run the application test above, `npm test -- --runInBand --runTestsByPath src/__tests__/unit/OperationsConfirmation.unit.test.ts src/__tests__/unit/ActionConfirmationIssuance.unit.test.ts`, and `npm run web:test -- lib/application/context.test.ts lib/queueAttentionActionAdapter.test.ts lib/application/adapters/setup.test.ts`. Expect all to pass. Retain existing actor/guild/action mismatch, missing checkbox, expiry and option-change coverage.
- [x] Run `npm run application:typecheck` and `npm run web:typecheck`; expect success. Commit as `refactor: share confirmation identity and isolate runtime authority`.

Task 1 verified at `14d5a6e`: 3 projection tests, 34 bot confirmation/authority tests and 11 web tests passed; bot build and both runtime typechecks passed. Fresh task review passed.

### Task 2: Establish typed web submission and canonical queue contracts

**Files:** Create `apps/web/lib/application/queuedSubmission.ts` and its `.test.ts`. Modify `apps/web/lib/moderationActionRequestQueue.ts`, its tests and `apps/web/lib/application/context.ts`. Extend `apps/web/lib/captchaCompletion.test.ts` only where transactional rollback coverage is missing. Update encoded-input test fixtures affected by canonical required fields.

**Interfaces:**

- Consume core `ActionContext`, `QueuedCommand`, `QueuedSetupCommand`, `EnqueueInput`, `QueuedActionReceipt` and `encodeQueuedAction` unchanged.
- Produce `SubmitQueuedActionInput { readonly context: ActionContext; readonly command: QueuedCommand }` and `submitQueuedAction(input: SubmitQueuedActionInput): Promise<ModerationActionRequestReceipt>`.
- Produce `submitSerializedSetupAction(input: { readonly context: ActionContext; readonly command: Extract<QueuedSetupCommand, { kind: 'complete_setup_verification' }> }): Promise<ModerationActionRequestReceipt>`.
- Keep `insertModerationActionRequestWithReceipt(client: Pool | PoolClient, input: EnqueueInput): Promise<ModerationActionRequestReceipt>` for transaction-owned encoded effects. Derive status from `QueuedActionReceipt['status']`; extend its identity for optional `messageDeletionJobId`.
- Extend `createWebActionContext(input: { readonly guildId: string; readonly userId: string; readonly requestId?: string; readonly source?: string }): ActionContext`, defaulting to the current UUID generation and `web` source. Both overrides come from trusted runtime code.

- [x] Add `keeps a supplied submission identity and provenance` to context tests, asserting request ID `attempt-2`, source `web_report`, guild and user survive unchanged. Add submission tests that run the real encoder/shared SQL builder and fake only pg. For a case ban, assert literal key `web:case-action:ban_user:guild:case`, actor/source and metadata; map all four database receipt statuses and a returned cleanup-job ID. A malformed command with an injected `actor` field must reject before querying pg.
- [x] Run `npm run web:test -- lib/application/context.test.ts lib/application/queuedSubmission.test.ts`; expect the new APIs/identity behavior to fail before implementation.
- [x] Implement ordinary submission with the existing encoded writer and explicit serialized setup submission with the existing advisory lock, active-key conflict check and transaction sequence. Change the writer to accept `EnqueueInput` directly and remove its duplicate optional input interface/default reconstruction. Keep the current status-only/encoded pool entry points temporarily for Task 3–4 callers; do not add any new caller to them. Fixture handling stays out of SQL/core, in runtime entry adapters.
- [x] Add or retain serialized tests for same active submission reuse, different active submission rejection, no-active insertion and rollback/release on insert failure. In CAPTCHA completion tests, inject an effect-insert failure and assert rollback with no commit, using the same transaction client. Do not reimplement the transaction in a mock replacement of the completion function.
- [x] Run `npm run web:test -- lib/application/queuedSubmission.test.ts lib/application/context.test.ts lib/moderationActionRequestQueue.test.ts lib/captchaCompletion.test.ts` and `npm run web:typecheck`; expect success with unchanged serialized conflict text and shared SQL parameters. Commit as `refactor: add typed queued submission and derive queue contracts`.

Task 2 verified at `2193652`: 35 focused and 351 full-web tests passed, with web typecheck/lint/format. Existing setup transaction body was compared unchanged; real database verification follows in Task 6. Fresh task review passed.

### Task 3: Migrate web callers and delete queue-only wrappers

**Files:** Modify `apps/web/lib/observedAlertActionQueue.ts`, `detectionAccountingActionQueue.ts`, `moderationQueueOperationActionQueue.ts`, `setupArtifactActionQueue.ts`, `userReportActionQueue.ts`, `application/adapters/reportReview.ts`; migrate their existing member, inbox, operations, reports, setup/onboarding and public-report server-action callers under `apps/web/app/`. Delete `memberOpenCaseActionQueue.ts` and `memberManualFlagActionQueue.ts`. Update the existing observed/operations/setup queue tests, `reportReviewActions.test.ts`, and server-action tests for reports, operations, setup, onboarding and the public report portal. Create `apps/web/lib/userReportActionQueue.test.ts` if needed for target-user creation/admission evidence.

**Interfaces:** Consume Task 2's submission/context functions. Keep `submitReportRequest(input)` and its current admission inputs and status-facing result. In the observed/accounting request functions, replace their `actorId`, `actorSurface` and `guildId` input fields with `readonly context: ActionContext`; retain the other action/subject fields and build the command once. Do the same for the operation/setup adapters' actor/guild fields. Remaining queue functions return `Promise<ModerationActionRequestReceipt>`; callers project `.status`. Keep only `queueCompleteSetupVerificationRequestWithReceipt` for setup provisioning and delete its status-only sibling after migration. Change observed undo to return a receipt; keep observed actions' existing receipt semantics. Keep pure `isObservedAlertWebAction`, `isDetectionAccountingWebAction` and UI-action translations where still useful.

- [x] Extend current characterization tests to observe the real codec output at pg, rather than mocking the new typed submission adapter. Pin `web:observed-action:ban_user:guild:detection`, `web:detection-accounting:ignore_detection:guild:detection`, and `web:setup:repost_report_instructions:guild:channel:old-panel:submission-1`. Retain report ID, raw reason, expected panel identity and actor/source assertions. Add tests that unchanged/new deliberate submission IDs deduplicate/remain distinct as currently intended.
- [x] Add admitted report tests that pin `web:report:submit_user_report:guild:target:submission-1` when the trusted input context has request ID `submission-1`, and retain source `web_report`. Assert target creation happens for an admitted user report before enqueue, not for opening/closing an intake, and not after admission denial. Keep the existing error strings and ensure each of actor unavailable, self-report, reason-required, stale intake and missing confirmation prevents persistence.
- [x] Run `npm run web:test -- lib/observedAlertActionQueue.test.ts lib/setupArtifactActionQueue.test.ts lib/userReportActionQueue.test.ts`; expect the context-preservation and receipt assertions to expose the old reconstruction/status-only paths. Existing already-passing characterization cases are the preservation baseline, not artificial failing tests.
- [x] Migrate server-owned contexts and typed commands to `submitQueuedAction`. Remove the report command-to-helper-arguments-to-command round trip and its three unneeded exports. Keep report target creation and shared admission in the report adapter. Move pure member command construction into its authenticated caller, then delete both member queue-only modules. Retain admission, bot-capability checks, form confirmation, revalidation, error copy and fixture branches. Use `submitSerializedSetupAction` for provisioning and ordinary submission for panel repair/repost. Remove the old serialized encoded entry point once no production caller uses it.
- [x] Run `npm run web:test -- lib/observedAlertActionQueue.test.ts lib/moderationQueueOperationActionQueue.test.ts lib/setupArtifactActionQueue.test.ts lib/userReportActionQueue.test.ts lib/reportReviewActions.test.ts app/report app/admin/guild` and `npm run web:typecheck`. Expect passing UI/receipt assertions, including observed dismissal's fixture completion, report-ban fixture feedback, setup resume and public-report confirmation. Use Vitest path filters, without shell globbing dynamic route names.
- [x] Search with `rg -n 'queueMemberOpenCaseActionRequest|queueMemberManualFlagActionRequest|queueUserReportSubmissionRequest|queueGuidedReportIntakeRequest|queueReportIntakeCloseRequest|queueCompleteSetupVerificationRequest\(' apps/web`. Expect no references, including tests. Commit as `refactor: migrate web actions to typed queue submission`.

Task 3 verified at `57e82dd`: 86 focused, 366 full-web and 1,703 bot tests / 80 snapshots passed; removed-helper searches returned no references. Fresh task review passed.

### Task 4: Make case translation exhaustive and delete the raw fallback

**Files:** Create `apps/web/lib/application/caseCommands.ts` and its `.test.ts`. Modify `apps/web/lib/activeCaseDataAdapter.ts`, its tests and `application/adapters/captcha.ts`. Finish removing obsolete ordinary pool/status wrappers from `moderationActionRequestQueue.ts` and their test imports after all consumers have migrated. Update affected CAPTCHA/case action tests.

**Interfaces:** Produce `buildQueuedCaseCommand(input: QueueCaseActionInput, userId: string): ActionResult<QueuedCommand>` in the new module, consuming the existing input type with a type-only import. Cover all fourteen `WebCaseAction` members with an exhaustive switch. Return `denied/stale_state` for missing required CAPTCHA or quarantine command binding; the adapter maps denial to its current `not_allowed` result. Consume `submitQueuedAction`; preserve `resolveCaseActionQueueStatus` and the case adapter's public result contract.

- [x] Parameterize the translator test over the fourteen current UI actions and independently specified expected commands. For retry/bypass, pin challenge `challenge-1`, generation `2` and attempts `attempt-1`/`attempt-2`; assert encoding retains keys `web:case-action:retry_captcha:guild:case:attempt-1` and `web:case-action:bypass_captcha:guild:case:attempt-2`. Retain preview versus execute quarantine binding and repair mode/intent assertions.
- [x] Add adapter tests named `does not enqueue missing repeatable attempt`, `does not enqueue stale challenge generation`, and `does not enqueue an unavailable quarantine preview`. Assert `status === 'not_allowed'` and zero persistence calls. Move the old key-helper assertions to these production submission paths rather than preserving an export only for tests.
- [x] Run `npm run web:test -- lib/application/caseCommands.test.ts lib/activeCaseDataAdapter.test.ts`; expect new translator tests to fail before implementation. Preserve existing detail/presence/allowed-action tests.
- [x] Implement the translator, folding the current CAPTCHA translation into explicit action branches and deleting `buildQueuedCaptchaCommand` from the CAPTCHA adapter. Preserve current-state admission in the case adapter and map translation denials explicitly. Replace its nullable command/raw enqueue branch with the one typed submission. Delete `QueuedCaseAction`, `requestTypeByCaseAction`, `buildCaseActionIdempotencyKey` and the handwritten metadata/key construction.
- [x] Remove `QueueModerationActionRequestInput`, `queueModerationActionRequest`, `queueModerationActionRequestWithReceipt` and any remaining obsolete serialized entry point after migrating all callers. Keep derived web status/receipt names and the canonical transaction-aware encoded writer. Run `rg -n 'buildCaseActionIdempotencyKey|requestTypeByCaseAction|buildQueuedCaptchaCommand|queueModerationActionRequestWithReceipt|queueSerializedModerationActionRequestWithReceipt' apps/web`; expect no matches. Check status-only `queueModerationActionRequest` separately to avoid matching unrelated type names.
- [x] Run `npm run web:test -- lib/application lib/activeCaseDataAdapter.test.ts lib/captchaCompletion.test.ts app/admin/guild` and `npm run web:typecheck`; expect success, including malformed command rejection and unchanged CAPTCHA generation checks. Commit as `refactor: remove untyped case submission fallback`.

Task 4 verified at `3032f738`: 58 translator/adapter tests, 133 planned web tests and 10 persistence tests passed, plus web typecheck/lint/format. The later CCN30 finding is corrected and verified against the unchanged gate in Task 6. Fresh task review passed.

### Task 5: Bind queued execution without replacing application methods

**Files:** Modify `src/application/requestRuntime.ts`, `requestDispatch.ts`, `createBotApplication.ts`, `src/services/ModerationActionRequestService.ts`, the dispatch/parity/service/confirmation-issuance unit suites and existing receipt snapshots only if fixture plumbing requires changes. Create `src/__tests__/unit/PreparedQueuedRequest.unit.test.ts`. Preserve family adapters and receipt projections unless needed to receive the narrower runtime interface.

**Interfaces:**

- In `requestDispatch.ts`, produce `QueuedRequestRuntime` as a `Pick<BotApplication, ...>` of `cases`, `reports`, `operations`, `setupRuntime`, `caseConfirmations`, `captchaRuntime`, `messageCleanupRuntime`, `quarantineRuntime` and `detectionRuntime`. Derive factory types from the existing application type rather than repeating port fields.
- Produce `QueuedDispatchInput { readonly runtime: QueuedRequestRuntime; readonly action: DecodedQueuedAction; readonly request: ModerationActionRequest }` and `prepareQueuedAction(input: QueuedDispatchInput): () => Promise<QueuedActionOutcome>`. The existing `queuedActionHandlers` object becomes the sole registry of executor builders; keep its literal keys and exhaustive `Record<QueuedCommand['kind'], QueuedHandler>` check. Request-aware builders obtain the correct family actions with `forRequest(request)` once, then capture them with context/command. Preserve existing command-kind guard around generic narrowing.
- In `requestRuntime.ts`, produce exported `PreparedQueuedRequest` exactly as specified in the design. Change preparation to `prepareQueuedRequest(input: { readonly runtime: QueuedRequestRuntime; readonly request: ModerationActionRequest; readonly analytics: IProductAnalyticsService; readonly recovery?: boolean }): Promise<PreparedQueuedRequest>`. Decode cleanup/CAPTCHA with their current specialized decoders before binding the executor; otherwise use the canonical decoder.
- Remove `dispatchQueuedAction` after migrating its callers/tests and remove `BotApplication.messageCleanup`. Retain legitimate controller-used runtimes and all existing family outcome serializers.

- [x] Add `prepares without executing effects or replacing application methods` using a real request-aware runtime factory around a test operation; assert preparation invokes binding, produces a callable executor, does not enforce, and exposes neither `.application` nor `.action`. Existing confirmation evidence issuance is an intentional preparation effect. Execute it and assert the same persisted request/actor binding reaches the operation. Add tests preparing two different request envelopes to prove neither replaces the other's bound runtime.
- [x] Add `rejects revoked authority at execution` using the real shared operation with authority changed after preparation; assert denial and no domain effect. Add `runs completion hooks only after persisted completion`, including completion-write failure, using the real worker path. Retain the worker's existing treatment of completion-hook failures; do not invent new retry behavior.
- [x] Run `npm test -- --runInBand --runTestsByPath src/__tests__/unit/PreparedQueuedRequest.unit.test.ts`; expect failure because the new preparation contract does not exist.
- [x] Implement executor builders in the existing registry, narrow the request runtime, preserve the exact evidence-issuance exclusions and recovery context rewrite, and return the captured execution/hook. Update the worker to call `execution.execute()`, preserving attempt tokens, recovery's `already_handled` return, heartbeat lifecycle, completion/failure and hook ordering. Delete application object spreading for family substitution and the throwing cleanup placeholder.
- [x] Migrate forty-kind fixture tests to the narrow runtime and real executor builder. Adapt direct/queued parity fixtures by supplying request factories around the same real actions; do not replace dispatch/preparation with mocks. Retain all independent stored rows and receipt snapshots. Run `npm test -- --runInBand --runTestsByPath src/__tests__/unit/PreparedQueuedRequest.unit.test.ts src/__tests__/unit/ModerationActionRequestDispatch.unit.test.ts src/__tests__/unit/ActionBoundaryParity.unit.test.ts src/__tests__/unit/ModerationActionRequestService.unit.test.ts src/__tests__/unit/ActionConfirmationIssuance.unit.test.ts`.
- [x] Ensure that run exercises cleanup legacy decoding and frozen job binding, CAPTCHA system identity/generation, quarantine preview identity, report-ban stale attempt rejection, uncertain outcomes and committed recovery without repeated enforcement. Extend existing service cases only for missing risks. Run `npm run build` and `npm run action:boundary`; expect success with all forty kinds covered and no receipt payload changes. Commit as `refactor: prepare request-bound action executors explicitly`.

Task 5 verified at `db8fbb6d`: six bot suites / 203 tests / 80 unchanged snapshots passed, plus build/boundary/lint/format. Fresh request-runtime and recovery review passed.

### Task 6: Verify deletion, compatibility and the single-PR result

**Files:** Update `docs/dev/action-boundary.md`, `docs/dev/action-boundary-inventory.md`, `scripts/check-action-boundary.mjs` and its test only as required by moved mutation entry points. Update this plan's completed checkboxes during execution. Product code changes here are limited to defects found by verification/review.

**Interfaces:** Consume the final APIs from Tasks 1–5. No new action registry, compatibility forwarding API, queue kind, schema migration or delivery mode.

- [x] Update the caller inventory for every moved server action/submission method. Retain the boundary checker's forty-kind, setup-field, core-isolation and mutation-bypass protections. If a moved method needs a checker change, add a focused negative fixture proving an owned-domain mutation through that entry is still rejected, then run `npm run action:boundary` expecting success.
- [x] Run `npm run check:ci` once with the repository's designated test database. Integration setup must use a test database; never use production credentials. Preserve `maxWorkers: 1` in the existing Jest configuration so integration tests remain serial. Resolve concrete failures and rerun only affected gates, then the required whole-branch checks after the final change.
- [x] Confirm the required CI includes browser/visual checks, production packaging/import probes and serial database coverage. Existing `ActionRequestEnqueue.integration.test.ts`, `CaptchaChallengeRepository.integration.test.ts` and `SetupReportChannelPersistence.integration.test.ts` must retain concurrency/transaction/binding assertions. If an environment cannot run a gate, report that limitation and use the exact final commit's hosted gate instead of claiming a local pass.
- [x] Run `npm run code:metrics` where its existing tools are available. Compare production files/lines with merged base `f1853d0` using the same exclusions, and inspect `git diff --numstat f1853d0 -- src apps/web packages/application`. Record deleted wrappers, eliminated fallback/placeholder and any increase justified by preserved invariants. Do not count tests/docs as production shrinkage or add a metrics subsystem.
- [x] Perform the final whole-branch code review and address findings. Verify there are no references to deleted helper names, no handwritten queue metadata outside canonical/trusted effect adapters, no application copies that swap family executors, and no queued enum/schema change. Update docs to describe the final implementation, then commit as `docs: document simplified action submission and execution`.
- [x] Open or update one PR against `main`, referencing #89 and PR #255. Read `docs/dev/pr-workflow.md` and the repository PR template first. Use `[AGENT]` public prose, describe the final simplification and concrete deletions, and attach the resulting PR with the app artifact tool. Complete the repository AI-review recycle loop and keep checks passing. Do not merge or deploy as part of this plan.

Task 6 scoped verification: case translator/adapter 58 tests passed; its outer switch is CCN17 and the unchanged metrics gate passes. Both new submission entry points have negative bypass fixtures (red before checker registration, green afterward); all 15 guard tests and forty-kind coverage pass. Real Postgres runs used only the designated disposable database with explicit URL overrides and serial Jest execution: enqueue/recovery passed 238 tests; unchanged CAPTCHA/setup persistence passed 41. Canonical persistence fixtures retain independently supplied rows and required metadata, adapting only the repository enum type. No codec, schema or snapshot changes. Production count using the baseline exclusions: 301 files / 89,201 lines at `f1853d0` to 303 files / 88,951 lines, a reduction of 250 lines. Caller inventory and boundary docs describe the final APIs.

Controller verification at implementation head `359407ee`: [hosted CI 39462009544](https://github.com/BASIC-BIT/drasil/actions/runs/39462009544) passed the full `check:ci`, including browser/visual checks, serial database coverage and RLS, plus the production Docker import smoke. The local whole-gate run passed application checks, 1,714 bot tests, 42 contract tests, 393 web tests and 44 functional browser tests before visual differences; it is not a local full-CI pass. Hosted visual results are authoritative, and no visual snapshots changed.

[PR #257](https://github.com/BASIC-BIT/drasil/pull/257) is the single implementation PR and references #89 and PR #255. Independent whole-branch review at `9dac675` passed; scoped review of the stale test-harness cleanup at `359407ee` also passed. [Claude review 39462036589](https://github.com/BASIC-BIT/drasil/actions/runs/39462036589) succeeded with no Important findings, and current-head Codex review completed without findings. The two inline member-fixture checks remain under the approved runtime fixture ownership despite a stylistic suggestion. GraphQL review threads are empty. Copilot was requested twice but exhausted the account quota; [Greptile was requested](https://github.com/BASIC-BIT/drasil/pull/257#issuecomment-6296403836) without a response after several minutes. These are reviewer availability limits, not approvals.

These completed implementation gates are recorded by this documentation-only update. After pushing its commit, the controller must require hosted checks on the final documentation head and repeat the delayed review sweep. No merge or deployment is authorized by this plan.

## Execution handoff

Recommended execution is the user's previously selected subagent-driven approach: one implementation task and fresh review at a time, then whole-branch review. The web migrations share interfaces and the worker changes touch enforcement recovery, so review each deliverable before starting its dependent task. Keep all work in the single cleanup PR. After the plan is reviewed and execution is authorized, use the chosen execution skill; resume MCP design after this follow-up is complete.
