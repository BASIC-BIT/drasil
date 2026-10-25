# Moderation workspace implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the moderator inbox and case/report investigation UI with the approved design, including all six workflow areas in one coherent release.

**Architecture:** Keep existing moderation services, authorization rules, durable action queue and database. Compose truthful, authorized read models at the web boundary; share the same production components between routes and Storybook. Build the work in reviewable commits, then switch the moderator routes together after the full journey works.

**Tech stack:** Existing Next.js, React, TypeScript, CSS modules, Zod contracts, Postgres adapters, Vitest, Playwright and Storybook. Retain the commissioned transparent logo and local Manrope assets.

**Approved specifications:** [Workspace design](../specs/2026-10-23-moderation-workspace-design.md) and [complete workflow coverage](../../design/moderation-workflow-coverage.md), approved by the user on October 24, 2026. [Screenshot gallery](../../design/previews/workflows/README.md) and `Design foundation/Complete moderation workflows` are the visual references.

## Global constraints

- All six areas ship together: mixed inbox, compromised-account recovery, browser checks, cleanup, conversations and action results. Tasks are implementation order, not permission to defer one of these areas to a later release.
- "Every state-changing operation requires contextual confirmation." Reading, filtering, attachment access and conversation paging remain immediate.
- "Existing moderation rules, stored records and Discord effects remain authoritative."
- "Keep source text complete as returned by its source." A saved preview is still a preview, not a complete message.
- "No new UI framework, state library, backend rewrite or schema migration is proposed."
- "Conversation reads add no database retention and do not change the existing message-context collection policy."
- Conversation pages contain up to 50 messages; the reader retains at most 200. Cleanup retains the existing 500-preview/100-execution limits and 1–1000 character reason requirement. Quarantine preview validity is less than 10 minutes with matching live state.
- Use the approved flat grey composition, severity labels/colors, shared theme preference, absolute/relative dates and operator-copy standard. No product nickname, generic evidence disclaimers or prototype notices in product screens.
- Public reporting, OAuth and security-check URLs remain stable. History/member review, setup/onboarding, Operations and the landing page remain the subsequent design slices identified in the approved spec; their existing destinations must keep working.
- The current UI is disposable. Preserve useful backend behavior, not old layouts or unpublished component APIs. Never import design fixtures or simulated action handlers into a production dependency graph.

## Review focus

1. A selection changes while a detail read/submission is pending: preserve its target and ignore a late response for another item. Tests belong to Tasks 3 and 4.
2. A moderator can manage a guild but cannot read a private channel/thread: deny new conversation reads without leaking content. Tests belong to Task 5.
3. A request fails after a possible Discord effect: show uncertainty and prohibit an unsupported repeat ban. Tests belong to Task 3; cleanup's stronger evidence belongs to Task 8.
4. A preview, security generation or allowed action changes before confirmation: reject stale intent without executing a replacement operation. Tests belong to Tasks 3, 6, 7 and 8.
5. The selected item resolves or disappears while the moderator investigates: restore the filtered queue using the agreed continuation rule, without selecting a new arrival automatically. Tests belong to Tasks 4 and 9.

## Working branch and release boundary

At execution time, create an implementation issue and isolated worktree using the repository workflow. Fetch the latest main and approved design branch. If design PR #265 has merged, branch from main; otherwise branch from its current head and declare that dependency in the implementation PR. Reconcile current main before the final checks. Do not reset this design worktree or discard unrelated changes.

Use one integration branch and a draft implementation PR. Each task has its own commit and review, while production route adoption waits for all required components. A single release does not require a single large commit. Do not merge or deploy as part of writing this plan.

## File ownership map

| Area                | Production files and responsibility                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read contracts      | Extend `packages/contracts/src/inbox.ts`, `cases.ts`, `reports.ts`, `index.ts` only where serialized source data needs a public shape. New `apps/web/lib/moderationWorkspaceTypes.ts` composes existing case/report/member/cleanup/request types.             |
| Selected reads      | New `moderationWorkspaceDataAdapter.ts`, `moderationAttentionDataAdapter.ts` and their tests under `apps/web/lib`; new selected-detail API route under `app/api/admin/guild/[guildId]/inbox/[itemId]`.                                                        |
| Shared presentation | `components/workspace/WorkspaceShell.tsx`, `Foundation.tsx`, `Timestamp.tsx`, `WorkspaceNavigation.tsx` and CSS modules; `components/cases/CaseWorkspaceView.tsx`, `CaseEvidenceReader.tsx` and shared source grouping.                                       |
| Queue controller    | `components/inbox/InboxWorkspace.tsx`, `InboxQueue.tsx`, `InboxItemDetail.tsx`; `lib/inboxLocation.ts` and `inboxContinuation.ts` own URL and continuation rules.                                                                                             |
| Actions             | New `components/workspace/actions/{ActionConfirmation,ActionReceipt,ConfirmedAction}.tsx`; new `lib/workspaceActionTypes.ts`, `workspaceActionPresentation.ts`, `workspaceConfirmation.ts`; adapt existing server-action modules and receipt/polling helpers. |
| Conversations       | New `lib/conversationDataAdapter.ts`, `conversationAccess.ts`, `conversationWindow.ts`; extend `discordApi.ts`; new conversation API route and `components/cases/ChannelConversation.tsx`.                                                                    |
| Case tools          | New `components/cases/{AccountQuarantinePanel,BrowserSecurityPanel,MessageCleanupPanel,CaseTools}.tsx`, focused CSS/stories and existing action/job adapters.                                                                                                 |
| Verification        | New `apps/web/e2e/moderation-workspace.spec.ts`, `storybook-e2e/moderation-workspace.spec.ts`; update existing case-flow, report-ban, message-cleanup and visual tests when their UI callers change.                                                          |

Keep related CSS, stories and tests beside each production component. The large exploration files are references, not production controllers to copy wholesale.

## Task 1: Supply truthful selected-record data

**Files:** Modify contracts `inbox.ts`, `cases.ts`, `reports.ts` and matching tests; `activeCaseDataAdapter.ts`, `moderationInboxDataAdapter.ts`, fixtures and tests. Create `apps/web/lib/moderationWorkspaceTypes.ts`, `moderationWorkspaceDataAdapter.ts`, `moderationAttentionDataAdapter.ts`, their `.test.ts` files, and `apps/web/app/api/admin/guild/[guildId]/inbox/[itemId]/route.ts` with `route.test.ts`.

**Interfaces:**

- `createModerationWorkspaceDataAdapter().getInboxItemDetail({ guildId, itemId }): Promise<WorkspaceItemDetail | null>` resolves a stable record ID on the server. Keep `case:{id}` and `report:{id}`; use `detection:{id}` for observed alerts and `queue:{id}` for attention/screening. Update the observed-alert summary producer and fixtures accordingly. Canonical case/report/detection reads work after the record leaves the pending queue, so reload can still show its durable result; acknowledged/deleted attention rows can return 404. `getCaseWorkspaceData({ guildId, caseId }): Promise<CaseWorkspaceData | null>` supports direct links, including resolved cases.
- Export `workspaceItemDetailSchema` from `moderationWorkspaceTypes.ts` to validate the composed JSON at both ends of the selected-detail boundary. Reuse existing nested Zod schemas and derive `WorkspaceItemDetail` from this schema. `WorkspaceItemDetail` is a discriminated union with `kind` equal to the six existing inbox kinds. Every branch contains `item: ModerationInboxItem` and `policy: WorkspaceActionPolicy`; the branch-specific payloads are listed below. Derive nested types from existing schemas.
- `WorkspaceActionPolicy` contains `allowedActions: readonly ModerationInboxAction[]` filtered for current actor/settings, plus `canQueueCaseActions`, `canOpenReportCases`, `canManageCleanup`, `kickReasonRequired` and `banReasonRequired`. Project current actor permissions/settings into availability without replacing server validation.
- `CaseWorkspaceData` contains `detail: CaseDetail`, `report: ReportDetail | null`, `membership: MemberProfile['membership'] | null`, `requests: readonly ModerationActionRequestSummary[]`, `cleanup: { workspace: MessageCleanupCaseWorkspace; jobs: readonly MessageCleanupJobDetail[] } | null`, `policy: WorkspaceActionPolicy` and `loadedAt: string`. Requests/jobs and report linkage must match guild, case and member identity.
- `getAttentionDetail({ guildId, queueItemId }): Promise<AttentionDetail | null>` in the attention adapter retains the actual queue subtype and separate case/report/detection/source IDs. It does not interpret the overloaded current `sourceId` as a case unconditionally.
- Extend `ModerationActionRequestDataAdapter` with `getRequest(guildId: string, requestId: string): Promise<ModerationActionRequestSummary | null>`, scoped to that guild. A tracked request can be read directly rather than falling out of a 25-record recent list. Validate that its target/detection/report/case matches the selected record before attaching it.
- `GET /api/admin/guild/[guildId]/inbox/[itemId]` returns a validated read model, 401 for missing session, 403 for guild denial and 404 for no matching item. Use `Cache-Control: private, no-store`; do not return stack traces or raw metadata.

The detail union uses `data: CaseWorkspaceData` for a case; `report: ReportDetail` and matching `requests` for a submitted report; `detection: MemberProfileDetection` and matching `requests` for an alert; `intake: ReportAttentionRecord` plus `reply: ReplyReadState` for report attention; `subtype`, `caseData: CaseWorkspaceData | null` and `reply` for support attention; and `screening: { pendingSince: string | null; thresholdDays: number | null; lastCheckedAt: string | null }` for screening. `ReportAttentionRecord` derives ID, guild, reporter, target, evidence and linked-case fields from `ReportDetail`, replacing its status with the full intake read enum. `ReplyReadState` is defined below.

Branch payloads and source rules:

| Branch              | Required source data                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `case`              | `CaseWorkspaceData`. Add required `status` to the case summary/detail contract using the actual `verification_events.status` enum: pending, verified, banned, kicked, closed_no_action. Update all producers and typed fixtures together; do not infer resolution from available buttons. |
| `submitted_report`  | Existing `ReportDetail`, actual reporter/target identities where available and matching requests. Unknown target stays unknown.                                                                                                                                                           |
| `observed_alert`    | Direct guild/detection-ID read using the existing `MemberProfileDetection` schema for complete reasons, detected time and source references. Do not depend on the limited member-history list finding a particular detection.                                                             |
| `report_attention`  | Read-only intake ID/status, reporter, confirmed target if any, submitted evidence, actual latest-reply reference and linked case if recorded. The intake-status schema includes all nine current Prisma values. Keep `ReportDetail`'s submitted/reviewed semantics separate.              |
| `support_attention` | Subtype support reply/recovery reply/quarantine breach, actual reply reference and matching case when present. A prohibited posting location is not the recovery thread.                                                                                                                  |
| `pending_screening` | Real pending-since, threshold days and last-checked timestamps from queue/member fields; read-only destinations. Missing values remain null.                                                                                                                                              |

Represent reply reads as `{ kind: 'available'; message: CaseDiscordMessage } | { kind: 'unavailable'; sourceUrl: string | null }`. Fetch only the selected reply. Resolve the channel from trusted record linkage and use the actor channel-access guard from Task 5 for newly composed live message reads; until that task lands, return the unavailable branch with a valid source destination. Submitted/saved evidence access retains existing policy.

- [ ] Write schema/adapter/route tests for all six branches, early report intake, breach subtype, unknown report target, missing reply and cross-guild IDs. Add a case-schema test asserting that a status-less summary fails parsing and a pending summary with explicit status passes.
- [ ] Assert these important adapter results, with mocked existing pool/detail boundaries following current tests:

```ts
expect(earlyReply).toMatchObject({
  kind: 'report_attention',
  intake: { status: 'collecting_evidence' },
});
expect(earlyReply.item.allowedActions).toEqual(['acknowledge', 'open_discord']);
expect(breach).toMatchObject({ kind: 'support_attention', subtype: 'quarantine_breach' });
expect(screening.pendingSince).toBe('2026-10-21T14:40:00.000Z');
expect(
  await adapter.getInboxItemDetail({ guildId: 'guild-2', itemId: 'queue:foreign-item' })
).toBeNull();
```

The local arrangement names above are test results, not new production APIs. Verify query parameters and joins are guild-scoped, including joined evidence and source records. Preserve existing source text and event dates; never substitute queue dates or epoch dates for unknown event dates.

- [ ] Run `npm --workspace packages/contracts run test -- inbox.test.ts cases.test.ts reports.test.ts` and `npm --workspace apps/web run test -- moderationWorkspaceDataAdapter.test.ts moderationAttentionDataAdapter.test.ts route.test.ts`. Confirm new assertions fail before implementation.
- [ ] Implement the contracts, composed readers and authenticated endpoint. Extend summaries with validated source metadata needed for real event times, screening and attention subtypes. Reuse existing evidence mapping rather than creating a second interpretation of report attachments. Load case/report/request resources in parallel where independent; do not prefetch full detail for every queue row.
- [ ] Rerun the targeted tests, contracts/web typechecks and existing adapter tests. Update all case fixtures/callers required by the new status field. Expect pass with no unknown-stage intake cast to `ReportDetail`.
- [ ] Commit `[AGENT] Add source-backed moderation workspace reads`.

## Task 2: Promote the approved presentation into production components

**Files:** Create the shared workspace and case presentation files in the ownership map, `apps/web/lib/evidenceSources.ts` and its test, and production `.stories.tsx` files. Move the reusable foundation/timestamp implementation out of `components/inbox/foundation` and update every import in the same commit. Extract source/history rendering from the foundation case studies; keep historical layout experiments separate.

**Interfaces:** `WorkspaceShell({ guildId, guildName, sessionUsername, currentPage, children })` owns brand, account/server navigation, theme and responsive frame. `CaseEvidenceReader({ detail, report, onOpenConversation })` renders stored sources and channel-grouped recent previews. `groupEvidenceSources({ detail, report }): readonly EvidenceSourceGroup[]` preserves individual records while grouping only matching message identity/URL. `CaseWorkspaceView({ data, actionArea, tools, conversation, returnHref })` composes the approved header/subbar/index/reader/rail; `data` is Task 1's `CaseWorkspaceData`, and the other regions are React nodes supplied by later tasks.

- [ ] Add meaningful source-grouping tests. Feed two different saved quotations pointing to the same message; assert one group with both original strings. Assert unrelated messages in different channels stay separate and recent member previews are never represented as a multi-person conversation.
- [ ] Run `npm --workspace apps/web run test -- evidenceSources.test.ts` and confirm the new behavior is absent before implementing the grouping function.
- [ ] Extract the reusable source blocks, history, checks, timestamps and buttons into focused components. Use real guild/member identity, real source dates, direct attachment links and nullable source data. Member-wide detection history is labeled accordingly. Never infer channel names or an exact release-role list from IDs/counts.
- [ ] Add production Storybook stories using injected data/handlers for the approved layouts and all 28 existing study states. Keep the exploration stories as visual references; production imports must not reach `exploration`, authored study data or fixture libraries.
- [ ] Verify representative production stories against the approved screenshots at 1440px and 390px. Run `npm --workspace apps/web run typecheck` and `npm --workspace apps/web run storybook:build`. This task needs visual/a11y verification, not tests that merely reproduce CSS declarations.
- [ ] Commit `[AGENT] Promote the approved moderation workspace components`.

## Task 3: Connect contextual confirmation and truthful durable results

**Files:** Create the workspace action files in the ownership map and tests; modify `InboxActionForm.tsx`, `InboxActionRequestPoller.tsx`, `inboxActionState.ts`, `inboxActionReceipts.ts`, `reportQueueDataAdapter.ts` and the existing cases/inbox/reports server-action modules with their tests. Do not create a second moderation service.

**Interfaces:**

- `WorkspaceMutationResult` in `workspaceActionTypes.ts` is a union of `{ kind: 'request'; receipt: ModerationActionRequestReceipt }`, `{ kind: 'report_closure'; result: CloseSubmittedReportResult }`, `{ kind: 'report_open'; result: OpenSubmittedReportCaseResult }`, `{ kind: 'attention'; result: AcknowledgeQueueAttentionResult }`, and `{ kind: 'failed'; message: string }`. Use type-only imports of existing service/receipt types. `failed` makes no execution-stage claim.
- `WorkspaceMutation = (formData: FormData) => Promise<WorkspaceMutationResult>`. `WorkspaceActions` exposes these exact properties, each returning `Promise<WorkspaceMutationResult>`:
  - `caseAction(input: { guildId: string; caseId: string; action: WebCaseAction }, formData: FormData)`.
  - `reportAction(input: { guildId: string; reportId: string; action: Exclude<ReportQueueAction, 'open_report_thread'> }, formData: FormData)`.
  - `observedAction(input: { guildId: string; detectionId: string; action: ObservedAlertWebAction }, formData: FormData)`.
  - `attentionAction(input: { guildId: string; queueItemId: string }, formData: FormData)`.

  Import the existing action types rather than copying their literals. Cleanup keeps its existing dedicated action types.

- Export `submitWorkspaceCaseAction`, `submitWorkspaceReportAction`, `submitWorkspaceObservedAction` and `submitWorkspaceAttentionAction` from their existing server-action modules, using the matching property signature from `WorkspaceActions`. They reuse current orchestration/policy helpers, return the union above and revalidate the same affected routes. Do not force a direct-case login redirect to the inbox; validate and preserve the same-guild return descriptor.
- `assertWorkspaceConfirmation(formData, { recordId, targetUserId }): void` requires `confirmAction=on`, matching `confirmedRecordId`, and matching `confirmedTargetUserId` when a target exists. Resolve the expected values afresh on the server. Keep existing quarantine-preview, security-generation and cleanup-count checks as additional requirements.
- `ConfirmedAction({ target, action, submit, durableRequest })` owns confirmation, reason draft and submitting/uncertain state. `ActionReceipt` consumes `deriveWorkspaceActionPresentation({ localResult, durableRequest, cleanupJob, record })`. Return type `WorkspaceActionPresentation` distinguishes ordinary failure, confirmed enforcement with pending updates, explicit unknown outcome and cleanup finalization retry. Its `kind` cases are `idle`, `pending`, `completed`, `blocked`, `failed_uncertain`, `banned_updates_pending`, `ban_outcome_unknown` and `finalization_retry`. Derive input field types from `WorkspaceMutationResult`, `ModerationActionRequestSummary`, `MessageCleanupJobDetail`, `CaseDetail` and `ReportDetail`; accept null when no value exists. Generic request completion is Request completed, not proof of a refreshed membership outcome.

- [ ] Change the web report closure adapter to return `CloseSubmittedReportResult` rather than boolean. Migrate every web caller and fixture implementation in the same task. Do not alter `ReportReviewService`'s established outcome semantics.
- [ ] Add boundary tests proving missing confirmation, wrong record/member, stale action, reason-policy failure and cross-guild targets cause no queue submission. Include dismiss, handled, false positive, acknowledgement, ordinary verify/close and maintenance operations, not only kick/ban. A report without a confirmed target can still receive its allowed report-closure operation.
- [ ] Add result tests with these assertions:

```ts
expect(closedWithCleanupFailure).toMatchObject({
  kind: 'report_closure',
  result: { status: 'closed', queueCleanupStatus: 'failed' },
});
expect(deriveWorkspaceActionPresentation(genericFailure).kind).toBe('failed_uncertain');
expect(deriveWorkspaceActionPresentation(explicitUnknownBan).kind).toBe('ban_outcome_unknown');
expect(deriveWorkspaceActionPresentation(confirmedBanPendingUpdates).kind).toBe(
  'banned_updates_pending'
);
```

The last three inputs are arrangements of actual adapter fields. Do not derive unknown enforcement from `processing`, or label an ordinary failed request Not sent. A cleanup finalization presentation must additionally read its actual job data.

- [ ] Run `npm --workspace apps/web run test -- workspaceConfirmation.test.ts workspaceActionPresentation.test.ts actions.test.ts reportQueueDataAdapter.test.ts inboxActionState.test.ts inboxActionReceipts.test.ts` before and after implementing the new boundaries/results.
- [ ] Adapt the existing queue actions rather than copying their actor/bot permission checks. Resolve observed-alert target from the detection, and report target from the actual report. Keep durable IDs, idempotency and special observed/report-ban resubmission protection. A rejected or unavailable response never claims nothing happened.
- [ ] Connect polling/reconciliation to both inbox and case views. Retain a locally submitted request until its matching durable result arrives; ignore stale failed snapshots during retry. Refresh only while relevant requests are active and clean up timers. Preserve the loaded item after it leaves the pending summary list so the result remains readable until Next/Back. Surface structured report cleanup warnings without reopening a closed report. In `already_handled`/`busy` closure results, `reportStatus` is the requested target status, not evidence that status was applied. Refresh the actual record; do not label either result a successful dismissal. Add a presentation assertion for this distinction.
- [ ] Browser-test confirmation focus/cancel, reason preservation, required reasons, double submit, network response loss, delayed completion while reading, reload of a pending request and another moderator changing eligibility. If response loss leaves submission uncertain, refresh durable state before another attempt. Do not steal focus when a result arrives after the moderator resumes reading.
- [ ] Commit `[AGENT] Connect confirmed actions and durable moderation results`.

## Task 4: Implement queue selection and return navigation

**Files:** Create `apps/web/lib/inboxLocation.ts`, `inboxContinuation.ts`, matching tests, and `components/inbox/{InboxWorkspace,InboxQueue,InboxItemDetail}.tsx` with CSS/stories. Reuse `moderationInboxViewModel.ts`; add browser cases to the final workspace test file as the controller becomes runnable in Storybook.

**Interfaces:**

- `InboxLocation` contains `controls: ModerationInboxViewControls` and `selectedItemId: string | null`, plus `trackedRequestId: string | null`. `parseInboxLocation(params: URLSearchParams): InboxLocation` validates `view`, `kind`, `freshness`, `sort`, `q`, `selected` and `request`; `serializeInboxLocation(location): URLSearchParams` emits canonical values. A named `view` supplies a preset; the normalized controls are authoritative and the active preset can be derived. Add the missing all-cases preset to `moderationInboxViewModel.ts`: ID `cases`, kind `case`, freshness `all`, sort `priority`, empty search. Old case/report queue redirects target `?view=cases` and `?view=reports` respectively.
- `chooseInboxContinuation({ previousIds, selectedId, currentItems }): string | null` receives current items already filtered/sorted. Restore the selected item if present; otherwise next surviving item after its old position, previous surviving item, first current match, then null.
- `InboxWorkspace({ items, initialLocation, loadDetail, actions })` takes summary items, parsed initial state, a `(itemId: string, signal: AbortSignal) => Promise<WorkspaceItemDetail>` reader and Task 3's `WorkspaceActions` bindings. Its detail state is an explicit loading/ready/unavailable union keyed by guild and item ID.

- [ ] Write location round-trip, invalid-filter and continuation tests. The core continuation assertion is:

```ts
expect(
  chooseInboxContinuation({
    previousIds: ['a', 'b', 'c'],
    selectedId: 'b',
    currentItems: [{ id: 'new' }, { id: 'a' }, { id: 'c' }],
  })
).toBe('c');
```

Use `Pick<ModerationInboxItem, 'id'>` for the continuation function's item argument so the test does not invent complete records. Also assert previous-item fallback, no matches, removed selected row and URL encoding of arbitrary search text.

- [ ] Run `npm --workspace apps/web run test -- inboxLocation.test.ts inboxContinuation.test.ts` and observe the missing behavior.
- [ ] Implement the controller and kind-specific details using Task 1's union, Task 2's components and existing filtering/sorting. Cancel superseded requests and check the response identity even if abort arrives too late. Filtering can leave the selected target explicit until the moderator changes it; it must not retarget a confirmation. On narrow screens, an explicit selected URL opens detail and Back returns focus to its row.
- [ ] Persist only scroll/focus metadata and the captured queue ordering in per-tab history/session storage keyed by guild/view. Keep controls/selection and any tracked durable request ID in the URL. Attach the request only after the matching-record check from Task 1; unknown/cross-record IDs must not affect the selected action state. Do not persist evidence, reason drafts or bulk mutation selections. Forward a same-guild internal return descriptor to case/report links; preserve native modified-click and browser Back. Keep the application history state object intact when adding metadata.
- [ ] Add browser checks for slow A/fast B detail reads, changing filters during review, direct selected URLs, browser Back, keyboard row selection and restoration after a resolved item disappears. Completion does not auto-advance. Next follows the agreed continuation rule and an empty queue has one empty state.
- [ ] Run the helper tests and relevant Storybook browser cases. Commit `[AGENT] Preserve inbox selection and review navigation`.

## Task 5: Add authorized source-centered conversation reads

**Files:** Extend `apps/web/lib/discordApi.ts` and tests; create `conversationAccess.ts`, `conversationDataAdapter.ts`, `conversationWindow.ts` with tests; create `app/api/admin/guild/[guildId]/conversation/route.ts` with tests and `components/cases/ChannelConversation.tsx` with CSS/stories. Wire the access helper into Task 1's live reply reads.

**Interfaces:**

- `ConversationQuery` is `{ recordKind: 'case' | 'report'; recordId: string; sourceKey: string; page: { kind: 'around' } | { kind: 'before' | 'after'; cursor: string } }`. The selected read model emits source keys for the case source surface and real evidence IDs; the server resolves them again. No channel ID, arbitrary URL or user ID from the client is authority.
- `readConversationPage({ guildId, actorId, query }): Promise<ConversationReadResult>` returns `available` with chronological `CaseDiscordMessage[]`, source identity, channel label when known, fetch time and earlier/later availability, or `unavailable` with a bounded denied/missing/upstream reason. Export `conversationQuerySchema` and `conversationReadResultSchema` from `conversationDataAdapter.ts` for HTTP-boundary validation, deriving message fields from the existing mapping.
- `fetchBotChannelMessagePage({ channelId, page, limit: 50 }): Promise<DiscordMessage[]>` is a new bounded HTTP helper. Keep `fetchBotChannelMessages` for existing thread snapshot callers; do not change its recent-history semantics secretly.
- `assertConversationAccess({ guildId, actorId, channelId }): Promise<void>` performs current guild eligibility plus effective actor View Channel/Read Message History, parent/thread membership and bot access. Add typed guild-member/channel/thread-member fetches at the existing bot HTTP boundary. Missing metadata fails closed; owners/administrators and private-thread Manage Threads semantics follow Discord's rules.
- `mergeConversationWindow({ current, incoming, direction }): ConversationWindow` deduplicates by channel/message ID, orders chronologically and returns `atLimit` instead of silently evicting context when the combined window would exceed 200.

- [ ] Write access/route tests: unauthenticated, cross-guild record/channel, unrelated source key, malformed cursor/URL, actor with Manage Guild but denied channel, private-thread nonmember, authorized private-thread member, owner/admin, deleted source and upstream failure. Assert denied requests never fetch message bodies or serialize content.
- [ ] Write window tests asserting no duplicate source, chronological before/after merges, 50-message page limit and the 200-message bound. Assert a 201st distinct message is not silently substituted for existing reading context.
- [ ] Run `npm --workspace apps/web run test -- conversationAccess.test.ts conversationDataAdapter.test.ts conversationWindow.test.ts route.test.ts` and observe failure before adding the reader.
- [ ] Implement source resolution and access checks. Restrict URL parsing to supplied canonical Discord source references and same-guild channel records. Fetch only on demand, with private no-store responses. A deleted source can coexist with available surroundings; never fill gaps from unrelated recent-member previews.
- [ ] Implement the shared reader with source highlight, actual authors/times, loaded extent, earlier/later controls, persistent Discord continuation, and Back to source. Preserve scroll when prepending and preserve visible keyboard focus when paging controls change. The saved quotation remains independently available if current content changes or access fails.
- [ ] Browser-test reading/return round trip, earlier/later paging, cap handling, source deletion, denied channel, and accessible attachment links at 320px/390px/1440px. Rerun boundary/window tests. Commit `[AGENT] Add permission-scoped channel conversation review`.

## Task 6: Complete quarantine and recovery integration

**Files:** Create `components/cases/AccountQuarantinePanel.tsx`, CSS/stories and focused tests; connect through `CaseTools.tsx`. Adapt current account-quarantine rendering from `CaseActionControls.tsx` and existing request helpers, removing its old rendering once all callers move in Task 9.

**Interfaces:** `AccountQuarantinePanel({ data, requests, policy, submissions })` consumes `CaseWorkspaceData`, existing `AccountQuarantineActionRequests`, the server policy and `submissions: { preview: WorkspaceMutation; execute: WorkspaceMutation; release: WorkspaceMutation }`, bound through Task 3's case action. Preview and execute submit the existing `quarantinePhase`, actor-bound preview request ID, reason and confirmation fields. It produces no new park/unpark command.

- [ ] Add focused capability/fixture tests: fresh matching preview offers execution, 10-minute-old or changed preview does not, running containment blocks duplicates, incomplete containment stays in review, and a parked compromised case does not expose Close without action. Preserve the service's ability to attempt incomplete containment rather than requiring `canContain=true` for all execution.
- [ ] Run focused web tests and existing `CaseActionControls.test.ts` before adapting presentation. Expect the new production component tests to fail initially.
- [ ] Implement near-header containment state, the full live preview in the reader, recorded role effects/blockers and recovery-thread access. Use actual parking actor/time and recorded recovery attention. Show counts when only counts are supplied; do not invent a current release-role preview. Keep expired previews visible as records while disabling their execution and offering confirmed refresh.
- [ ] Connect Verify and release to existing eligible role restoration/role-gate behavior. Keep separate confirmed kick/ban consequences. Acknowledgement of a recovery reply or breach removes attention only; it neither establishes recovery nor releases quarantine. A breach always links to its own member/case and actual source channel.
- [ ] Browser-test preview → confirmation/cancel → queued receipt, partial result, parked recovery review, stale preview rejection and identity preservation from breach/reply entry. Reuse existing worker/unit tests for effects; run relevant quarantine service tests only if their callers/contracts changed.
- [ ] Commit `[AGENT] Integrate account containment and recovery review`.

## Task 7: Complete browser-check integration

**Files:** Create `components/cases/BrowserSecurityPanel.tsx`, CSS/stories and focused tests; adapt security controls in `CaseActionControls.tsx`, `casePresentation.ts` and the existing server actions only as required. Add tests to the workspace browser journey.

**Interfaces:** `BrowserSecurityPanel({ detail, policy, submissions })` consumes the real `CaptchaChallengeSummary`, source/effect and allowed actions on `CaseDetail`. `submissions: { issue: WorkspaceMutation; retry: WorkspaceMutation; bypass: WorkspaceMutation }` binds the current guild/case/action through Task 3. Current case/actor capabilities determine action visibility. Retry/bypass submit the displayed `expectedCaptchaChallengeId` and `expectedCaptchaGeneration` in addition to confirmation; bypass carries the required reason.

- [ ] Write eligibility/presentation tests for not issued, pending delivered, pending delivery failed, failed, expired, bypassed, cancelled, passed evidence-only and automatic join pass. Assert a compromised-account case never shows issuance, a passed case never shows retry and a normally delivered pending check does not show retry. Member absence can leave bypass available without retry.
- [ ] Assert a passed evidence-only challenge plus pending case still renders the case as open. An automatic pass effect alone must not render the case resolved. Run focused tests before implementing the new panel.
- [ ] Implement status, concrete delivery errors, requested/delivered/passed/expired dates, submission count, bypass provenance and generation history. Do not manufacture delivered time when delivery failed, or render generic lectures about identity/recovery. Preserve the actual current generation across ordinary data refreshes.
- [ ] Connect issue/retry/bypass through contextual confirmations and existing server checks. Add an action test: confirmation of generation 2 is rejected without a queued action if the server now holds generation 3. Keep the entered bypass reason for review; never silently submit against generation 3 instead.
- [ ] Run the relevant action/presentation tests and browser checks for generation change, retry invalidation, bypass and evidence-only completion. Commit `[AGENT] Integrate case browser security checks`.

## Task 8: Complete message cleanup integration

**Files:** Create `components/cases/MessageCleanupPanel.tsx` with CSS/stories and focused tests; reuse/refactor current `CaseMessageCleanupControls.tsx`, `MessageCleanupJobDetail.tsx`, `MessageCleanupJobPoller.tsx` and dedicated actions/adapters. Update `apps/web/e2e/message-cleanup.spec.ts` as its callers change.

**Interfaces:** `MessageCleanupPanel({ integration, policy })` consumes the existing `CaseMessageCleanupIntegration` workspace/jobs/request/action bindings; move its type to new `components/cases/caseToolBindings.ts` and update all imports when its owning renderer is retired. Preserve `getMessageCleanupExecutionEligibility` as the policy owner. Add `adaptInboxStateAction(action: InboxStateAction): WorkspaceMutation` in `workspaceActionTypes.ts` for these existing action signatures. Preserve returned request IDs/status and stable cleanup intent tokens; do not replace them with a locally fabricated queued receipt. The standard ban binding remains available independently of cleanup.

- [ ] Keep existing executable-flow tests and add production-panel assertions for all four scopes, delete-only/combined mode, required 1–1000 character reason, frozen candidate count and actual coverage. Unit-test the displayed result against real job fields, not request status alone.
- [ ] Pin these shared eligibility boundaries using existing fixture records and schemas:

```ts
expect(singleSourcePartial.execution.canExecute).toBe(true);
expect(partialWindow.execution.canExecute).toBe(false);
expect(over100Candidates.execution.canExecute).toBe(false);
expect(completedBanFailedFinalization.banStatus).toBe('succeeded');
expect(completedBanFailedFinalization.caseFinalizationStatus).toBe('failed');
```

For transformed fixtures recalculate eligibility with the current shared helper; do not copy a stale embedded fixture flag. Add explicit item assertions for deleted, missing, changed, evidence-failed, deletion-failed and permission-denied outcomes.

- [ ] Run `npm --workspace apps/web run test -- messageCleanupDataAdapter.test.ts` and existing cleanup browser tests as the baseline, then the new assertions before panel implementation.
- [ ] Implement the full-width reader preview with actual scope/window/time/reason, frozen source and evidence links, candidate IDs/authors/attachments and counts. Render real channel metadata when available or IDs otherwise. Coverage blockers offer a new preview, not execution of a guessed subset. Changing scope/mode invalidates the old execution intent.
- [ ] Connect count-bound confirmation and existing stable intent/request tokens. Apply Task 3's record/target confirmation helper in `cases/messageCleanupActions.ts` while retaining its additional job/count checks. Extract readiness fields/tokens into one confirmation form; do not nest the old confirmation UI under another confirmation. Keep ban → evidence-preserving deletion → case finalization order. A completed job can still contain item failures. Show confirmed ban and failed finalization independently; confirmed Retry case finalization uses the same job and never repeats ban/deletion.
- [ ] Browser-test ordinary ban with cleanup off, explicit combined action, denied/indexing/too-many previews, the single-source exception, worker failure/retry, changed-message skip, count drift, non-admin denial and finalization-only retry. Confirm no second ban or deletion request in the finalization test.
- [ ] Commit `[AGENT] Integrate reviewed message cleanup and partial outcomes`.

## Task 9: Adopt routes, remove superseded UI and verify one release

**Files:** Switch `apps/web/app/admin/guild/[guildId]/inbox/page.tsx`, `cases/[caseId]/page.tsx`, `reports/[reportId]/page.tsx`; redirect the old `cases/page.tsx` and `reports/page.tsx` queues to the corresponding inbox views. Update `app/admin/page.tsx`, root metadata, real account/server navigation and affected cleanup detail pages. Update case-flow/report-ban/message-cleanup/visual and Storybook browser tests; retire obsolete renderers and their obsolete snapshots after searching all callers.

**Interfaces:** Server pages compose Task 1 reads, Task 3 bindings and Task 2/3/5/6/7/8 components. Canonical record URLs remain usable with no inbox return context. Any same-guild return context is validated, and missing/invalid context falls back to that guild's inbox. Public report, OAuth and CAPTCHA routes retain their existing contracts.

- [ ] Add full-journey browser tests before switching routes. Start with an ordinary report: inspect statement/screenshot → cancel dismissal → confirm dismissal → explicit next item → investigate case → read source in channel context → confirmed decision → durable result → return to the same filtered queue position.
- [ ] Add the release matrix to `moderation-workspace.spec.ts`: each inbox kind; early reporter reply/unknown target; breach identity; quarantine preview/incomplete/parked; browser-check generations/pass effects; cleanup blocked/partial/finalization; generic failure and explicit unknown ban; concurrent resolution; direct resolved-case URL; reload after a case/report/alert leaves the pending queue; tracked request from another guild/record; unavailable source. Use controlled fixtures for Discord/worker effects, not live moderator actions.
- [ ] Wire the replacement routes together, update navigation and remove simulated data from the production graph. Selected data/API requests and mutation actions reauthorize independently of initial page access. Keep the selection cached while its pending summary disappears, then apply continuation only on the moderator's explicit Next/Back action.
- [ ] Remove superseded `ModerationInboxView`, old case/report detail renderers and old action rendering only after all live callers move. Search before deleting shared helpers still used by History, Operations or cleanup job routes. Remove obsolete void action wrappers/unpublished APIs once no caller needs them. Historical design studies may remain isolated, but there must be one production implementation of each confirmation/result rule.
- [ ] Verify dark/light at 320px, 390px, 1024px and 1440px, keyboard-only focus, sticky-bar target visibility, mobile source/Checks/History navigation, attachment access, full source text, and absolute/relative time refresh with timer cleanup. Update visual baselines intentionally against approved screenshots. Do not preserve obsolete layouts merely to keep their snapshots green.
- [ ] Run targeted web/contracts suites, production Storybook build, new Storybook and route browser tests; then the repository's required `npm run check:ci` in a correctly configured integration environment. This includes existing report-ban, cleanup, public entry and security-check regressions. Do not reset a shared/production database to make a local check pass.
- [ ] Review the final production dependency graph for fixtures, ambiguous target IDs, silent retries and fabricated result labels. Exercise a real built application with controlled provider/worker boundaries. Record remaining environmental blockers honestly; do not substitute passing isolated studies for a passing integrated journey.
- [ ] Commit `[AGENT] Adopt the complete moderation workspace`. Update the implementation PR around the resulting behavior, complete CI/review cycles and follow the repository's final review sweep before any separately authorized merge/release. The release includes all six areas.

## Plan self-review

Coverage is mapped above: truthful data and intake distinctions in Task 1; approved presentation in Task 2; queue continuation in Task 4; all confirmations/results in Task 3; actual conversations in Task 5; quarantine, browser checks and cleanup in Tasks 6–8; integrated release and old-UI removal in Task 9. The five review-focus conditions each have an owning task and a concrete assertion/browser scenario.

No production tests are claimed to have run as part of writing this plan. Execution must run each task's checks against the actual implementation. Remaining choices such as CSS class names, pure-component extraction details and test fixture arrangement belong to the implementer; they do not change the approved behaviors or release boundary.
