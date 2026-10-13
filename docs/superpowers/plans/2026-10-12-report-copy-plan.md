# Reporting copy implementation plan

> For agentic workers: use `superpowers:executing-plans` for native execution or `superpowers:subagent-driven-development` if the user chooses delegation. Follow the checkboxes task by task.

**Goal:** Apply the approved reporting copy and make report outcomes and old buttons accurately reflect the saved state.

**Architecture:** Keep presentation in the current controllers/services and moderation routing in `SecurityActionService`. Reuse conditional repository updates and `ThreadManager` Discord operations. Track confirmation message IDs in existing JSON metadata; add no schema or dependency.

**Tech stack:** TypeScript, discord.js, Prisma/Postgres, Inversify, Jest.

**Spec:** [Clear reporting copy and truthful outcomes](../specs/2026-10-12-report-copy-design.md).

Planning refresh: October 13, 2026. Current `main` is `7ce302eb6a11913503f96f9d670da7fcfe93d968`, including merged PR #242. The isolated implementation worktree is `D:/bench/drasil-wt/report-copy`. Tasks 1 through 4 are implemented and locally reviewed; the delivery task remains open for automated review, controlled Discord QA, and the readiness window. These checkboxes retain the acceptance requirements rather than recording completion. The branch preserves the merged panel publication/recovery logic and its tests.

## Global constraints

- Preserve reporter/moderator permissions, self-report prevention, guild/thread scoping, enforcement settings, evidence, and model provenance.
- Show readable names, usernames, and immutable user IDs in confirmation. Keep full moderator identity records.
- Keep current custom IDs, config keys, command names, enums, and the `Report intake:` thread prefix.
- Default the receipt to "Report submitted for <readable username>." Omit the notification sentence unless returned notification evidence proves it. Do not promise archive success.
- No automatic resubmission, retry button, new reporting state, or database migration.
- Broader verification, web, operations, and general-error edits are follow-ups, not tasks in this PR.

## Review focus

Cover these in the owning task's tests: duplicate/long names and malformed identifiers; legacy buttons without tracked IDs; confirmation racing rejection or slow analysis; routing success followed by persistence or Discord failure; a partial detection saved before routing fails. Cancellation after a reserved selection must not say nothing was submitted or reset that selection.

## Task 1: Reporting text and identity presentation

**Modify:** `src/services/ReportIntakeService.ts`, `src/controllers/ReportInteractionHandler.ts`, `src/controllers/ReportCommandHandler.ts`, `src/controllers/ReportInstructionsManager.ts`, `src/services/ThreadManager.ts`, `src/services/NotificationPresentationBuilder.ts`, `src/services/SecurityActionService.ts`, `src/services/ReportSubmissionService.ts`.

**Tests:** Existing matching unit suites, including `ReportIntakeAgentService.unit.test.ts`, `CommandHandler.report.unit.test.ts`, and `discordUserIdentity.unit.test.ts` as unchanged-contract coverage. Add panel payload assertions to the current report-command suite instead of creating a copy-only test harness.

**Interfaces:** Retain current input signatures. The submitted user-report result carries an optional `targetUsername` from the already resolved member. Direct receipts use it when present and otherwise use the ID fallback; do not add a Discord lookup for presentation. Consume `formatInlineIdentifier(value: string): string` and current resolved `ReportCandidate`/`GuildMember` values. Use reporter-specific formatting at callers; do not change the shared moderator formatter.

- [ ] Update existing assertions to the exact spec strings and identity rows. Assert one person has no numeric prefix; multiple people have numbered rows and `Report 1` through `Report 5`; duplicate and 80+ character names remain distinguishable; usernames containing backticks cannot break formatting; mentions remain suppressed; reporter exclusion controls the match count.
- [ ] Verify the changed assertions fail against the baseline, then apply only these presentation changes and update the report panel/welcome/moderator-start/reopened messages. The moderator-start notice is a historical event: `No report was submitted when the thread opened.` Test delayed notification without asserting the current submission state.
- [ ] Update moderator close-confirmation copy for unselected, selected, and submitted reports. Use `Close report` and `Keep open` without changing custom IDs. Do not promise delivery or archive success in advance.
- [ ] Make stale-result wording state-specific. Assert submitted, reviewed/closed, selected-but-not-submitted, wrong candidate, superseded prompt, not-found, unauthorized, and self-report cases. Never substitute "already submitted" for every rejected click.
- [ ] Run the focused unit suites with `npx jest --runInBand --runTestsByPath src/__tests__/unit/ReportIntakeService.unit.test.ts src/__tests__/unit/ReportInteractionHandler.unit.test.ts src/__tests__/unit/ReportIntakeAgentService.unit.test.ts src/__tests__/unit/CommandHandler.report.unit.test.ts src/__tests__/unit/ThreadManager.unit.test.ts src/__tests__/unit/NotificationPresentationBuilder.unit.test.ts src/__tests__/unit/SecurityActionService.unit.test.ts src/__tests__/unit/discordUserIdentity.unit.test.ts`. All changed assertions and authorization regressions must pass.
- [ ] Review and commit the coherent copy/identity diff on the implementation branch.

## Task 2: Authoritative confirmation state and conditional writes

**Modify:** `src/repositories/ReportIntakeRepository.ts`, `src/services/ReportIntakeService.ts`, `src/services/SecurityActionService.ts`, `src/__tests__/fakes/inMemoryRepositories.ts`, and their service tests.

**Create test:** `src/__tests__/integration/ReportIntakeRepository.integration.test.ts`, following existing integration setup and server/user fixtures.

**Interfaces:** Extend `confirmTargetIfUnset(id, data)` with `expectedMetadata: ReportIntake['metadata']` alongside its existing target and next metadata. Add `updateIfCurrent(intake: ReportIntake, data: ReportIntakeUpdate): Promise<ReportIntake | null>` to the report repository. Compare status, selected target, and metadata with the fetched row. Use exact JSON snapshot equality with null handling, not millisecond timestamps. This single operation serves the concrete pending and post-selection writes below; do not add a separate unconfirmed-update wrapper.

- [ ] Add tests named `confirmation prevents a concurrent rejection`, `rejection invalidates an older confirmation snapshot`, `slow analysis cannot reopen a submitted or cancelled intake`, and `concurrent cancellation preserves a reserved selection`, `submission and thread close retain each other's metadata`, and `late submission preserves a reviewed report status`. Assert one authoritative transition wins, no second submission occurs, and no losing path returns the wrong outcome.
- [ ] Implement the real Prisma and in-memory conditions: confirmation still requires `NEEDS_REPORTER_CONFIRMATION` and no selected target; service callers permit pending evidence/prompt/rejection updates only in an open state with no selected target, and `updateIfCurrent` verifies the complete expected snapshot. This also closes the window between a caller's state check and its write. Re-read on a lost update to select the correct response. Record rejection evidence only after its conditional update wins.
- [ ] Replace unconditional pending metadata/status writes in `recordAgentAnalysis`, `recordMessageEvidence`, and rejection. Keep evidence already captured even if a later presentation update is stale. For cancellation, use the unconfirmed conditional path first; after a reservation wins, record a thread-close request without clearing or cancelling the selected report.
- [ ] Preserve `confirmTargetIfUnset` callers and fakes together. Guard `markSubmitted`, `recordThreadClose`, and service cancellation writes with the same snapshot operation. Also guard the linked-report close and reopen metadata writes in `SecurityActionService`; an unguarded moderator write can otherwise erase a newer submission write. Re-evaluate the existing close/reopen eligibility against the refreshed row on a collision, and never perform thread effects from `updated ?? intake` when no conditional write succeeded. Verify the separate web report-review repository retains its existing atomic metadata merge. Re-read and merge fresh metadata on a collision, with one further conditional state-write attempt using fresh metadata and a recomputed status and no repeated moderation or Discord actions. Preserve reviewed/closed statuses and their `closed_at`, while still recording submission-completion metadata. Keep legitimate moderator closeout/recovery and submitted/reviewed close branches working. Assert a post-selection thread close preserves the target, metadata, and eventual submission state and uses the spec's distinct thread-close message.
- [ ] Exercise both race orders in real Postgres using concurrent calls and then read the final row. Check metadata equality independent of object key order, separate SQL-null and JSON-null metadata fixtures, and legacy metadata without prompt message IDs. Fake-only tests do not prove the database guard.
- [ ] Run focused unit tests and `npm run test:integration -- --runInBand`. Use a dedicated local test database and do not run against a shared database concurrently. Test both submission/thread-close orders and each of `ACTIONED`, `DISMISSED`, `FALSE_POSITIVE`, `CLOSED_BY_REPORTER`, and `EXPIRED` before a late submission completion.
- [ ] Review and commit the conditional-state changes.

## Task 3: Confirmation controls and publication

**Modify:** `ReportIntakeService.ts`, `ReportInteractionHandler.ts`, `ThreadManager.ts`/`IThreadManager`, `SecurityActionService.ts`, `src/__tests__/unit/ReportIntakeService.unit.test.ts`, and `src/__tests__/unit/ReportIntakeAgentService.unit.test.ts`. Verify the existing `src/di/container.ts` binding resolves the added dependency, and update other typed `IThreadManager` mocks identified by the compiler.

**Interfaces:** Add `retireReportConfirmationPrompts(intake: ReportIntake, messageIds: readonly string[]): Promise<void>` to `IThreadManager` and `ThreadManager`. Reuse its existing Discord client. Inject `IThreadManager` into `ReportIntakeService` for prompt replacement and text cancellation; update all manual constructor sites and mocks. Controller and security-action callers already have a thread manager.

- [ ] Add tests named `retires confirmation controls after submission and rejection`, `replacement retires earlier tracked prompts`, `unpublished prompt keeps disabled controls until persistence succeeds`, `enable failure preserves evidence for moderator review`, `authorized stale legacy click retires its own controls`, and `cleanup failure preserves the report outcome`.
- [ ] Retain newly sent message IDs in `confirmation_prompt_message_ids` and `last_confirmation_prompt_message_id`. Add the clicked message ID to confirmation/rejection service inputs for current-message validation. Existing legacy custom IDs and metadata remain accepted through the existing candidate/token checks when no message ID is stored.
- [ ] Send new controls disabled, publish metadata using Task 2's condition, then enable the saved prompt. Retire previous tracked prompts only after the replacement is saved and enabled. On failed/lost persistence, keep the new controls disabled and remove them best effort. If enabling fails, retain evidence and the intake for review and do not acknowledge a ready confirmation or archive. Test a new A/B prompt on an intake with only legacy IDs: A cannot be selected from the new message before persistence and enabling complete. After enabling, re-read the row; if it no longer permits this prompt, retire its controls again so an overlapping closeout cannot be followed by a late re-enable. Confirm/reject must reject an older tracked message even when its candidate still appears in current suggestions.
- [ ] Implement retirement by fetching only supplied IDs in the intake's thread. Verify guild, bot author, and exact matching confirmation/rejection custom-ID prefixes for that intake. Clear components only. Keep text, embeds, and attachments intact. Edit only messages whose controls all belong to that report's confirmation/rejection prompt; skip messages with unrelated or mixed controls rather than removing them. Catch per-message Discord failures and continue; do not let cleanup errors override success.
- [ ] Wire retirement into confirmation, rejection, text/button cancellation, and moderator report closeout. For legacy prompts, include the clicked confirmation message ID after authorized stale handling. Do not edit messages on unauthorized clicks and do not scan historical threads. Resolve intake state and authorize the actor before target-member fetch. Confirm/reject must validate intake guild, thread, and bot author before any mutation. Test a submitted click after member departure and a copied custom ID in another guild/thread.
- [ ] Update service/controller/thread/security-action tests and mocks. Assert foreign-guild/thread, foreign-author, and unrelated-component messages are never edited.
- [ ] Run changed suites, review constructor/DI coverage, and commit the controls change.

## Task 4: Submission receipts and partial failures

**Modify:** `ReportInteractionHandler.ts`, `ReportIntakeService.ts`, and existing submission/controller/security-action tests. Preserve routing and selected-target reservation.

**Interfaces:** Keep `ReportSubmissionService.submitConfirmedReportIntake` and its existing `submitted | failed` result. Change `IReportIntakeService.markSubmitted(input)` and its implementation to `Promise<boolean>`, returning true only after a committed conditional state write. Update its controller caller and typed mocks. Use controller-local milestone state. No new route-wide notification result or persisted state is needed for the default one-line receipt.

- [ ] Add tests named `receipt failure does not report submission failure`, `archive failure preserves submitted success`, `markSubmitted failure retains successful routing and blocks duplicate submission`, and `routing failure after detection persistence does not invite a retry`, and `missing intake or exhausted null updates do not establish persistence`.
- [ ] Set the successful-routing milestone immediately after the service returns `submitted`, before `markSubmitted`. Attempt the state write and require a true return. Handle false and thrown outcomes with a truthful acknowledgement and retained thread for moderator review. A subsequent receipt/edit/cleanup error cannot change that known outcome.
- [ ] Keep backend/routing errors separate from presentation errors. Use the spec's incomplete-submission message when persistence/routing may be partial. Do not clear the reservation, promise moderators were notified, or auto-resubmit. Retain moderator access and the existing intake-linked detection reuse path.
- [ ] Update the web close-report worker in `src/services/ModerationActionRequestService.ts` and its unit tests. Return an observed archive outcome and set the existing `thread_archived` receipt field from that result rather than intent. Cover an already archived thread, successful archive, failed archive, and a saved report outcome surviving a later Discord failure. General web labels remain follow-up scope.
- [ ] Remove the early `Report intake closed.` acknowledgement from the shared reporter/moderator close path. Use the returned report outcome and keep message delivery and archive errors independent. Assert that a failed archive never yields a thread-closed claim, including cancellation, selected-person closeout, and submitted-report closeout.
- [ ] After a successful state write, send the concise receipt, retire known controls, and attempt archive. Failure of one presentation step must not prevent attempting the other independent completion steps or produce a failed-submission message. Do not claim the thread is closed before archive succeeds.
- [ ] Test direct slash/user-context and message-modal outcomes separately. After successful routing, a receipt failure must not become a failed-submission response. Test a detection saved before routing failure and use the direct incomplete-submission wording, "Drasil couldn't finish submitting this report. Please ask a moderator to review it." Do not refer to an intake thread or invite a retry. Preserve validation, reason requirements, target availability, and interaction response modes.
- [ ] Run relevant controller, submission, intake, and security-action tests. Review and commit the outcome-handling changes.

## Task 5: Delivery review and controlled Discord proof

- [ ] Refresh current `main` before continuing or landing. PR #242 is merged; preserve its publication/recovery code and extend its panel tests for the copy changes. Run `npm ci` after reconciling dependencies. Avoid copying the old protected checkout's source.
- [ ] Run `npm run check:ci` against an isolated local database when the final code is ready. Required CI remains the merge gate. Update report docs only where instructions or displayed messages changed; keep model prompts, moderation thresholds, and enforcement policy out of the diff.
- [ ] Review the whole branch for wrong-person reporting, stale or concurrent actions, lost/duplicated reports, side-effect truth, unchanged moderator identity detail, and accidentally broad changes. Use a fresh source reviewer and a separate fresh editorial reviewer for the final copy.
- [ ] In a controlled Discord environment, test mobile and desktop confirmation, duplicate names, unresolved mentions, success, wrong person, old button click, rejected cleanup, archive failure, and selected-report closeout. Do not use production messages as destructive test fixtures. Capture the actual render and distinguish it from unit-test proof.
- [ ] Publish the PR with a linked issue and `[AGENT]` public prose. Do not repeat required CI checks in the PR description; include only manual/provider verification that reviewers cannot infer from CI.
- [ ] After the latest pushed commit's 30-minute window, refresh exact-head checks, comments, reviews, inline threads, and mutable review summaries. Resolve valid feedback and refresh again before claiming merge readiness. The later merge decision includes automatic production deployment.

Implement these dependent tasks natively in one isolated worktree, then run independent whole-branch and editorial reviews. The original planning pass changed no product code and included no tests or live Discord checks. Implementation now has passing local CI and independent source/copy review; controlled Discord proof and the final exact-head PR sweep remain required.

Review correction: direct user-report submission already resolves a member username. Carry that value through the success result rather than treating it as unavailable at the receipt caller. Message-modal receipts use the fetched user name and never the ID placeholder as a username. This replaces the earlier ID-only implementation decision without adding a lookup or changing submission outcomes.

Concurrency review correction: pending candidate publication may collide with a moderator note or another reporter message while the intake remains open. Retire the losing disabled prompt, re-read and merge the candidates/metadata, and retry that state write once. Do not redo evidence insertion or candidate lookup, reopen selected/closed reports, or reintroduce rejected candidates. Exhausted collisions retain evidence and request moderator review. Saved rejection results also survive auxiliary evidence logging and later Discord delivery failures.

Analysis retry preserves the fresh summary and complete analysis metadata when it covered more evidence than the incoming analysis, while merging both candidate sets. Its next status also comes from the fresh snapshot. Cover both with deterministic overlapping-analysis tests.
