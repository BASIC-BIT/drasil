# Report-ban policy and lifecycle follow-up implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Fix the queued reason-policy gap and the three maintenance findings from PR #252 in one focused follow-up PR.

**Architecture:** Keep both database adapters and their atomic writes. Share their static retry/reset policy, put the report-ban metadata and transition rules behind a typed boundary, and declare the moderation capabilities the service actually calls. Preserve the existing durable operation and recovery flow.

**Tech Stack:** TypeScript, Prisma, Postgres, discord.js, Next.js, Jest, Vitest.

**Spec:** [Issue #253](https://github.com/BASIC-BIT/drasil/issues/253), implementing the four findings approved by the user. The user has authorized implementation with subagents and a follow-up PR; this document records that scope without adding another approval gate.

## Global Constraints

- Preserve current persisted metadata, concurrency and enforcement guarantees, audit/evidence retention, user-facing copy, and adapter boundaries.
- No schema migration, broad rewrite, deployment, or historical moderation repair is included.
- Preserve existing locking, attempt fencing, one-time enforcement, monotonic confirmation and recovery behavior.
- Do not add dependencies, a general state-machine framework, or compatibility formats that never shipped.
- Public prose uses generic environment labels and an `[AGENT]` prefix.
- Controllers coordinate work only. Implementers own code changes, tests and commits; reviewers are read-only and do not spawn agents.

## Review focus

- Blank and whitespace-only reasons must remain distinguishable from moderator-provided text until execution policy validation. Task 1 covers both entry points and current worker policy.
- Optional reasons must still receive the existing default at enforcement. Task 1 preserves the existing success path and tests it.
- Retry must never release an uncertain or confirmed ban for fresh enforcement. Task 2 retains and runs database recovery/persistence coverage.
- Stale attempt tokens and late preparation writes must not overwrite newer ownership or confirmed state. Task 3 retains and runs lifecycle and persistence regressions.
- Existing partial persisted metadata and unrelated metadata must survive parsing and typed writes. Task 3 tests boundary behavior without migrating stored JSON.

## Task 1: Preserve the moderator's reason through queueing

**Files:** `apps/web/app/admin/guild/[guildId]/reports/actions.ts`, `src/controllers/InteractionHandler.ts`, their existing tests, and `src/__tests__/unit/ModerationActionRequestService.unit.test.ts`. Change the worker only if needed to preserve validation before defaulting.

**Interfaces:** Queue the trimmed moderator reason, including an empty string, in `metadata.reason`. Keep the worker's execution-time required-reason check and its existing default reason afterward.

- [ ] Add regressions that submit blank or whitespace-only reasons with optional policy through web and Discord, assert the queued reason is empty, then show current required policy rejects that request before any ban. Retain explicit reason and optional-default success coverage.
- [ ] Run the affected tests before editing production code and record the expected failure.
- [ ] Remove premature fallback text at both entry points. Do not change other moderation actions or product copy.
- [ ] Run affected Jest and web Vitest tests, format touched files, self-review, and commit.

## Task 2: Share retry eligibility and reset policy

**Files:** `src/repositories/ModerationActionRequestRepository.ts`, `apps/web/lib/moderationActionRequestQueue.ts`, a small dependency-free shared module in `packages/contracts/src/`, and the relevant queue/persistence tests. Follow the existing bot CommonJS source-import convention rather than changing package loading.

**Interfaces:** Both adapters consume the same fixed SQL retry predicate and report-ban retry/reset expressions. Static SQL must not accept caller-controlled SQL or interpolate user input; values remain parameterized by each adapter.

- [ ] Identify every enqueue caller, current reset assignment and adapter-specific condition. Add or extend focused tests proving fresh completed no-op retry resets the expected fields, while changed targets, active phases, uncertain outcomes and confirmed bans remain fenced.
- [ ] Record the existing behavior with tests before extraction. Use existing real-Postgres coverage for the SQL semantics and adapter-equivalence coverage where useful.
- [ ] Extract only shared retry/reset policy. Keep transaction ownership, SQL parameters, receipts, and adapter-specific enqueue conditions in their current adapters. Remove duplicated definitions.
- [ ] Run affected queue tests and available integration tests, format touched files, self-review, and commit.

## Task 3: Type report-ban state and name its transitions

**Files:** `src/services/SecurityActionService.ts`, `src/repositories/ModerationActionRequestRepository.ts`, `src/repositories/VerificationEventRepository.ts`, a small `src/utils/reportBanState.ts` module, repository fakes, and existing lifecycle/persistence tests.

**Interfaces:** Define the shipped phase union and typed persisted report-ban fields in one module. Provide a parser for persisted JSON at reads and typed named transition inputs for report-ban writes. Add an explicit report-ban repository write operation, removing routing based on a metadata-key prefix. Keep generic unrelated metadata merging available for its existing callers.

- [ ] Inventory all report-ban reads/writes and repository implementations. Characterize stale attempts, monotonic confirmation, protected preparation fields, terminal completion, malformed field types and unrelated metadata retention before changing the boundary.
- [ ] Use the shared typed definition and transition rules in the service and repositories. Keep database locks and compare-and-set checks in repositories. Avoid casts that claim unvalidated JSON is typed state. Do not require already-persisted partial records to gain new fields.
- [ ] Migrate all affected callers and fakes and remove obsolete helpers/phase lists. Do not refactor unrelated moderation state.
- [ ] Run focused boundary, lifecycle, unit repository and real-Postgres recovery/persistence tests, format touched files, self-review, and commit.

## Task 4: Declare the required moderation dependency

**Files:** `src/services/SecurityActionService.ts` and affected constructor test doubles. Reuse `IUserModerationService` and `ICombinedBanLifecycleService` from `src/services/UserModerationService.ts`.

**Interfaces:** Declare the dependency as the actual intersection or a named composition of the two existing interfaces. Remove both casts that add lifecycle capabilities at call sites. The DI token and concrete implementation remain unchanged.

- [ ] Find all constructor callers and test doubles. Update only doubles that now fail to satisfy the real dependency.
- [ ] Change the declared dependency and remove capability casts. Use compilation and existing lifecycle behavior tests to verify this type-only correction; do not add tests that mirror type declarations.
- [ ] Run bot build and affected lifecycle/service tests, format touched files, self-review, and commit.

## Delivery

- [ ] Each task receives independent spec-compliance and code-quality review before the next task.
- [ ] Run a whole-branch review and the applicable repository quality gates after integration. Use a dedicated local database if available; CI supplies the required full check gate.
- [ ] Create one PR closing #253, inspect all feedback, handle valid findings, and push the final head.
- [ ] After at least 30 minutes from the final commit timestamp, refresh checks, comments, inline threads, formal reviews and sticky summaries for that exact head before declaring merge-ready. Leave merging and deployment to the user.
