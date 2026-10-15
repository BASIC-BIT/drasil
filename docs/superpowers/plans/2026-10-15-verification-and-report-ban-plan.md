# Verification and report ban implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair verification lifecycle races and provide audited direct report bans in Discord and web.

**Architecture:** Serialize initial thread setup and repair per case, persist prompt identity, and patch owned metadata atomically. Extract the existing case evidence collector and reuse the observed-ban operation for report bans. Add report-bound confirmation and queue entry points with execution-time validation.

**Tech stack:** Existing TypeScript, discord.js, Inversify, Prisma/Postgres, Next.js, Zod, Jest, web unit tests, and Playwright. No new dependencies.

**Spec:** [Confirmed scope and behavior](../specs/2026-10-15-verification-and-report-ban-design.md).

## Global constraints

- Both Discord and web are in scope. No case thread or case-role requirement for direct bans.
- Preserve existing moderator Ban Members permissions and server reason/policy settings.
- Preserve all available evidence and audit links; explicitly record unavailable optional fields.
- No live moderation, historical repair, merge, deployment, or duplicate-message deletion as part of implementation.
- Keep the protected mirror clean. Use `D:/bench/drasil-wt/verification-case-investigation` for the first PR, and a separate feature worktree after the first PR's interface is settled.
- Use neutral public examples, prefix GitHub prose with `[AGENT]`, and link issues. No private guild names or incident identities in committed files or public posts.

## Review focus

1. A member leaves while setup/evidence is awaiting Discord or profile data: retain departure and correct controls.
2. A report changes or is handled after confirmation but before queued execution: reject the stale action.
3. Discord bans successfully but a database/presentation operation fails: record/report partial completion and never blindly repeat enforcement.
4. Two clicks or repairs overlap: one destructive operation and one initial verification prompt.
5. The target left or optional profile/context sources are unavailable: ban by ID with the available evidence and explicit gaps.

## PR 1: Verification lifecycle fixes

### Task 1: Coordinate initial thread setup and repair

**Files:** `src/services/ThreadManager.ts`, `src/repositories/VerificationEventRepository.ts`, `src/__tests__/unit/ThreadManager.unit.test.ts`, `src/__tests__/fakes/inMemoryRepositories.ts`.

**Interfaces:** Keep public `createVerificationThread(member, event)` and `repairVerificationThread(member, event)` signatures. Add private `ensureInitialVerificationPrompt(member: GuildMember, thread: ThreadChannel, verificationEvent: VerificationEvent): Promise<{ messageId: string; sent: boolean }>` and a shared per-case setup promise. Add verification repository/fake `patchMetadata(id: string, patch: Record<string, unknown>, options?: { touchUpdatedAt?: boolean }): Promise<VerificationEvent | null>` using one database-side JSONB merge; use it to store `initial_verification_prompt_message_id`. Task 2 consumes this primitive. Refactor shared work into unlocked private helpers to avoid recursive lock waits when repair creates a missing thread.

- [ ] Add deterministic tests where creation pauses after storing the thread ID while repair starts, and where two repairs inspect a missing prompt. Assert one thread and one initial prompt, with both callers receiving the same thread identity.
- [ ] Add restart/partial-failure tests for an existing stored prompt, a confirmed missing message, failed member addition, and permission/timeout/history-read failures. Match a prompt by bot plus case-bound action ID. Assert unrelated bot mentions do not suppress a needed prompt, and unreadable messages/history never trigger a replacement.
- [ ] Run the focused ThreadManager suite and observe the overlap assertions fail on the current code.
- [ ] Implement coordination and identity reconciliation while preserving existing error-stage reporting and prompt copy.
- [ ] Run the focused suite and a repository integration test proving independent JSON patches both survive, then commit the tested change.

### Task 2: Preserve concurrent case state and departure controls

**Files:** `src/repositories/VerificationEventRepository.ts`, `src/services/SecurityActionService.ts`, `src/services/UserModerationService.ts`, `src/services/ThreadManager.ts`, `src/services/CaseReviewReminderService.ts`, their unit suites/fakes, and repository integration tests.

**Interfaces:** Consume Task 1's `patchMetadata` primitive. Convert the affected setup/evidence and departure writers to owned patches. Use existing row/status guards for updates that can alter lifecycle state; do not replace guarded resolution methods with an unrestricted merge.

- [ ] Reproduce departure during evidence collection using the actual service method. Assert the departure marker, reminder state, and terminal/quarantine state survive, and final notification/queue controls reflect the latest row.
- [ ] Add a real-Postgres integration test with independent concurrent patches. Assert both metadata keys remain and unrelated fields are unchanged.
- [ ] Add reminder eligibility tests for left members, verified/banned members, and present pending members. Keep the existing second-reminder timing tests.
- [ ] Observe new assertions fail, then implement the merge and fresh-state presentation. Leave a departed case pending and show existing Ban by ID/Close No Action controls.
- [ ] Run bot unit tests, build, lint, format, and serial local integration tests using the integration-testing skill. Open the linked bugfix draft PR after source checks pass. Do not merge or repair production.

## PR 2: Direct report bans with evidence parity

### Task 3: Share evidence capture and bind bans to current reports

**Files:** create `src/services/ModerationEvidenceService.ts`; modify `src/services/SecurityActionService.ts`, `src/services/UserModerationService.ts`, `src/services/ReportReviewService.ts`, `src/services/ModerationActionRequestService.ts`, `src/repositories/ModerationActionRequestRepository.ts`, `src/repositories/DetectionEventsRepository.ts`, `src/repositories/ReportIntakeRepository.ts`, DI files, fakes, `apps/web/lib/inboxActionReceipts.ts`, and their unit/integration tests.

**Interfaces:** Extract existing evidence collection into `capture(input: { guildId: string; userId: string; member: GuildMember | null }): Promise<ModerationEvidenceSnapshot>`. Move the existing `ProfileAssetSnapshot` type alongside it; the snapshot carries profile assets, optional `ProfileImageDescription`, detection history, recent `MessageContext`, capture time, and explicit unavailable sources. The service collects data without Discord sends or case creation. Case and report paths own persistence/presentation. Add `patchMetadata(detectionEventId: string, patch: Record<string, unknown>): Promise<DetectionEvent | null>` for `moderation_evidence`, preserving observed-action claims.

Continue using `BAN_OBSERVED_DETECTION`; include `report_intake_id` and expected target/detection. Add report repository `claimBan(input: { reportId: string; serverId: string; targetUserId: string; detectionEventId: string; operationId: string }): Promise<ReportIntake | null>`, backed by an atomic conditional update of the submitted report and a metadata operation marker. Claim before evidence I/O. Make competing close/open/target-update paths honor that marker. A close before claim cancels the queued request; after claim it returns busy. Reread and verify ownership before enforcement. Reuse the existing request ID as operation identity, with phases `preparing`, `enforcement_started`, `discord_confirmed`, and `reconciliation_required`; do not expire an uncertain enforcement phase into an automatic resend.

Replace ambiguous boolean outcomes for the affected observed-ban callers with `ObservedBanResult = { status: 'banned' } | { status: 'already_handled' } | { status: 'banned_updates_pending'; operationId: string } | { status: 'ban_outcome_unknown'; operationId: string }`. Carry the confirmed-enforcement result through the user-moderation finalization seam instead of swallowing post-ban failures. Migrate all callers and their tests. Worker completion payloads retain this result; presentation maps pending updates to "Banned. Report updates are still pending." Unknown outcomes show "Ban outcome needs review." Neither state offers another Ban submit.

Add `claimReportBanReconciliation(now: Date): Promise<ModerationActionRequest | null>` to the request repository/fake. It atomically leases one due report-ban operation using existing metadata fields, including completed requests with pending-update receipts and interrupted enforcement phases. Run at most `DEFAULT_MAX_REQUESTS_PER_TICK` such operations at the beginning of every `processPendingRequests` poll, including startup. Reconcile only missing idempotent audit/report updates when Discord confirms the ban. Record retry time and last error, retrying at 1 minute, 5 minutes, 15 minutes, then hourly; retain the visible partial/unknown receipt. If the ban is absent after an uncertain send, require moderator review and never automatically enforce again. Lease expiry allows another worker to resume cleanup after a crash without removing the report/detection enforcement claims.

- [ ] Add tests for member and by-ID direct report bans that assert persisted evidence precedes Discord enforcement, report/detection/action/outcome links remain, and no thread or role is created. Test an existing linked case resolves normally.
- [ ] Add stale/closed/foreign-guild report tests and duplicate-action tests. Check request acceptance, execution, and a close/target change while evidence capture is paused. Assert the report claim rejects competing mutations and policy/actor permissions are checked at execution.
- [ ] Test missing optional context versus failed required persistence, and a successful Discord ban followed by a finalization failure. Assert unavailable fields remain explicit, failed persistence prevents enforcement, and partial completion returns `banned_updates_pending`. Restart the worker with a completed pending-update receipt, assert the reconciliation sweep resumes and clears it, and assert zero additional Discord ban calls. Test cleanup retry timing, lease expiry, and interrupted enforcement with absent/current bans; an absent ban after an uncertain send becomes moderator review rather than automatic enforcement.
- [ ] Observe failures, extract the shared collector, and route both observed-ban variants through evidence persistence before enforcement. Preserve report closeout, prompt retirement, and queue cleanup semantics.
- [ ] Run service tests and serial repository integration tests, then commit.

### Task 4: Add the Discord and web entry points

**Files:** `src/controllers/ReportInteractionHandler.ts`, `src/controllers/InteractionHandler.ts`, `src/utils/reportIntakeAdminActions.ts`, `packages/contracts/src/reports.ts`, `apps/web/components/reports/ReportDetailView.tsx`, `apps/web/app/admin/guild/[guildId]/reports/actions.ts`, report detail page, `apps/web/lib/reportQueueDataAdapter.ts`, `apps/web/lib/reportDetailDataAdapter.ts`, `apps/web/lib/inboxActionReceipts.ts`, `apps/web/components/inbox/ModerationInboxView.tsx`, exhaustive action maps, stories, and tests.

**Interfaces:** Add the contract action `ban_user`. Add `banSubmittedReport(guildId: string, reportId: string, previousState: InboxActionState, formData: FormData): Promise<InboxActionState>` as the web server action, returning existing queue receipt states. Discord intake actions resolve a submitted intake to its confirmed target/detection, then use the existing reason-modal flow with a report-bound identifier. Server-side code always reloads identity/target; neither surface supplies an authoritative user ID from client state.

- [ ] Add tests asserting Ban is available to authorized moderators on an eligible submitted report, and absent/disabled with a clear reason for unconfirmed, handled, or inaccessible reports.
- [ ] Add Discord tests for a moderator confirmation, reporter denial, target mismatch, stale submission, and Ban by ID. Keep moderation-only controls ephemeral and existing reporter close behavior unchanged.
- [ ] Add web action/component tests for target/reason confirmation, auth return to the same report, queue receipts, stale report rejection, and failure recovery. Confirm `banned_updates_pending` displays its distinct receipt and never offers another Ban submit while reconciliation is pending. Update exhaustive contract/action maps and stories.
- [ ] Observe failures, implement the controls using the existing confirmation patterns, and show Queued until the bot receipt confirms completion. Revalidate the report detail, report queue, and inbox after completion.
- [ ] Add a Playwright report-ban flow with simulated provider I/O. Assert no Open Case step, no case creation, and the final report status reflects the actual result.
- [ ] Run `npm run check:ci` with the repository's local test prerequisites. Request a whole-branch review and open the linked feature draft PR. Report any unavailable checks explicitly.

## Completion and release boundaries

Update task checkboxes as work completes. Each PR gets an issue and a focused description. A PR is not merge-ready until the latest head is pushed, 30 minutes have elapsed since that commit, and a post-window sweep covers all checks, comments, reviews, inline threads, and mutable review summaries. Every commit restarts the window. No merge or deployment is authorized by this plan.

## Plan review

Recommendation: native implementation, because repository, collector, and request interfaces are shared across tasks. Task-by-task subagents are available if preferred. Review the behavior and choose the execution approach before product-code edits, as required by the writing-plans skill.
