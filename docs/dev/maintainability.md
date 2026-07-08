# Maintainability Plan

Issue #110 tracks the plan to split the largest handlers/services and add practical maintainability gates. This document is the first-phase inventory and strategy artifact; it should guide small refactor PRs instead of encouraging mechanical line moves.

## Current Inventory

Captured from `main` after PR #109 on 2026-06-03.

| Lines | File                                                    | Primary concern                                                                                                                              |
| ----: | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 4,674 | `src/controllers/CommandHandler.ts`                     | Slash/context command catalog, routing, config, setup, report, audit, case, and moderation command implementations live in one controller.   |
| 4,443 | `src/__tests__/unit/CommandHandler.unit.test.ts`        | One test file mirrors the large command surface and increases refactor blast radius.                                                         |
| 2,717 | `src/__tests__/unit/SecurityActionService.unit.test.ts` | Broad service tests cover many orchestration paths in one file.                                                                              |
| 2,387 | `src/services/SecurityActionService.ts`                 | Detection persistence, case opening, report triage, observed actions, role intake, repair, notification, and thread orchestration are mixed. |
| 2,378 | `src/controllers/InteractionHandler.ts`                 | Button/modal routing, admin actions, observed alerts, reports, setup wizard, and legacy case actions are interleaved.                        |
| 2,260 | `src/__tests__/unit/InteractionHandler.unit.test.ts`    | Tests mirror multiple interaction surfaces in one file.                                                                                      |
| 1,684 | `src/services/NotificationManager.ts`                   | Notification mutation, embed construction, button construction, verification-channel setup, and history rendering are mixed.                 |
| 1,185 | `src/services/GPTService.ts`                            | GPT prompt construction, request handling, parsing, and diagnostics are centralized.                                                         |
| 1,102 | `src/__tests__/fakes/inMemoryRepositories.ts`           | All repository fakes and shared fake defaults live together.                                                                                 |
| 1,073 | `src/__tests__/unit/NotificationManager.unit.test.ts`   | Notification behavior and presentation tests are coupled.                                                                                    |
|   998 | `src/__tests__/unit/EventHandler.unit.test.ts`          | Event handling scenarios are broad.                                                                                                          |
|   957 | `src/controllers/EventHandler.ts`                       | Discord event routing and orchestration are growing.                                                                                         |
|   941 | `src/services/ThreadManager.ts`                         | Thread lifecycle, message formatting, metadata updates, staff routing, and fetch/retry helpers are mixed.                                    |

## Responsibility Seams

`src/controllers/CommandHandler.ts`

- Extract first: Discord application command catalog into a pure builder module.
- Later domains: setup/config handlers, report commands, case commands, audit command, command response formatting helpers.
- Boundary rule: split by slash-command domain, not arbitrary line count.

`src/controllers/InteractionHandler.ts`

- Extract surfaces: admin actions, observed detection actions, report intake/modals, setup verification modal, legacy verification actions.
- Boundary rule: preserve Discord defer/reply semantics; avoid moving router and side effects in the same slice.

`src/services/SecurityActionService.ts`

- Extract lower-risk domains first: observed detection actions, role intake, report AI triage, detection accounting.
- Higher-risk domain: core suspicious-member case opening because it coordinates persistence, roles, threads, notifications, and warnings.
- Boundary rule: separate domain services from Discord presentation/adapters where possible.

`src/services/NotificationManager.ts`

- Extract first: embed/action-row factories and field formatters.
- Later domains: observed notification service, verification notification service, verification-channel setup service.
- Boundary rule: keep message mutation/update logic together until presentation builders are isolated.

`src/services/ThreadManager.ts`

- Extract first: thread message factories and case responder routing helpers.
- Later domains: verification thread lifecycle and report/private evidence thread lifecycle.
- Boundary rule: do not split fetch/retry/permission-sensitive behavior without focused tests.

`src/__tests__/fakes/inMemoryRepositories.ts`

- Extract repository fakes one file at a time under `src/__tests__/fakes/repositories/`.
- Move shared defaults/clone helpers into a shared fake utility module.
- Boundary rule: preserve imports through a barrel initially to reduce test churn.

## Metrics And Gates

Current state:

- `npm run code:metrics` exists and CI has a separate `metrics` job.
- The previous metrics script only inspected `apps/web` and `packages/contracts`, missing the bot `src` directory where the issue #110 hotspots live.
- Root Jest, web Vitest, and contracts Vitest coverage commands exist, but there are no committed coverage thresholds yet.
- ESLint catches correctness issues such as explicit `any`, missing return types, unused variables, and floating promises, but it does not enforce complexity or file/function size.

First metrics slice:

- Include root `src` in `scripts/check-metrics.sh`.
- Keep `lizard` strict for production code only, but start at a non-noisy ratchet baseline: cyclomatic complexity over `50` and function length over `300`.
- PR #116 ratchets the cyclomatic complexity gate from `50` to the documented non-noisy target baseline of `25`.
- Exclude tests from strict complexity checks for now.
- Add an advisory largest-file report so growth is visible without failing existing known hotspots.

Ratcheting path:

- Capture and update this inventory as large-file splits land.
- Add a baseline or allowlist before any file-length gate becomes blocking.
- Prefer preventing touched hotspots from growing before enforcing a global max-file-lines rule.
- Continue ratcheting cyclomatic complexity under issue #114 once extracted setup/config handlers are split enough to establish the next non-noisy baseline below `25`.

Coverage strategy:

- Do not add hard global thresholds until current package coverage baselines are measured.
- Prefer package-specific thresholds over one repo-wide threshold because root Jest, web Vitest, and contracts Vitest cover different surfaces.
- Start with low, non-noisy thresholds or changed-domain thresholds if baseline coverage is uneven.

Lint strategy:

- Keep existing correctness rules strict.
- Defer `max-lines`, `max-lines-per-function`, and `complexity` ESLint rules until baseline/allowlist mechanics are in place.
- Avoid adding rules that create busywork without clear refactor guidance.

## Execution Slices

1. Metrics and plan slice: add this document, include root `src` in metrics, and keep file-size reporting advisory.
2. Command catalog slice: extract `CommandHandler` command definitions into a pure `commandDefinitions` module while keeping handlers in place.
3. Command test slice: split registration/catalog tests away from behavioral command tests.
4. Interaction admin-actions slice: isolate Admin Actions button/menu/confirmation handling behind a focused controller.
5. Notification presentation slice: extract embed/action-row/field factories before moving message mutation behavior.
6. Service domain slices: extract observed detection actions, role intake, and report AI triage from `SecurityActionService` with focused tests.

## Slice Progress

- Metrics and plan slice implemented: `scripts/check-metrics.sh` now includes root `src`, keeps production `lizard` checks strict, and reports the largest tracked plus untracked source/test files.
- Command catalog slice implemented: `CommandHandler` now delegates command registration JSON construction to `src/controllers/commandDefinitions.ts`; `CommandHandler.ts` dropped from 4,674 to 3,742 lines, and the command catalog lives behind a pure builder.
- The new command catalog module is still intentionally visible in the advisory largest-file report; it is a real boundary, not a strict-gate bypass.
- Config subcommand slice implemented: `/config` detection, report, analytics, verification, heuristic, case-staff, and case-review handlers moved to `src/controllers/ConfigSubcommandHandler.ts`.
- Report instructions slice implemented: report button message upsert/recreate logic moved to `src/controllers/ReportInstructionsManager.ts`.
- Setup slice implemented: `/setupverification`, `/config setup`, `/config validate`, and shared setup diagnostics/rollback helpers moved to `src/controllers/SetupCommandHandler.ts`; `CommandHandler.ts` dropped to 1,455 lines.
- Case command slice implemented: `/case` open, repair, and intake-role handlers moved to `src/controllers/CaseCommandHandler.ts`.
- Reporting slice implemented: `/report`, report context-menu handlers, `/setupreportbutton`, and user-install reporting env checks moved to `src/controllers/ReportCommandHandler.ts` and `src/utils/userInstallReporting.ts`.
- Moderation slice implemented: `/ban`, `/flaguser`, and `/audit` handlers moved to `src/controllers/ModerationCommandHandler.ts`.
- Lockdown slice implemented: `/config lockdown` view, disable, allow-list, audit, apply, and lockdown report formatting moved to `src/controllers/LockdownConfigCommandHandler.ts`.
- Legacy `!test` prefix commands were removed after slash-command workflows became the supported command surface.
- `CommandHandler.ts` is now a 403-line command router/coordinator; the next maintainability targets are the newly extracted domain handlers that still appear in the advisory largest-file report, especially `ConfigSubcommandHandler.ts`, `SetupCommandHandler.ts`, and `commandDefinitions.ts`.
- Setup remains a complexity ratchet target: the first gate used cyclomatic complexity `50` to avoid noisy failures, and PR #116 ratchets that gate to the documented baseline of `25` after splitting setup permission checks and config setup reply/result handling.
- Command test split implemented: `src/__tests__/unit/CommandHandler.unit.test.ts` was replaced by domain files plus `src/__tests__/unit/commandHandlerTestHarness.ts`; the largest command-handler test slice is now `CommandHandler.setup.unit.test.ts` at 1,470 lines.
- Metrics advisory report now skips tracked-but-deleted paths so pre-commit splits do not produce stale `wc` errors.
- Interaction setup modal slice implemented: setup verification modal submission and rollback handling moved from `src/controllers/InteractionHandler.ts` to `src/controllers/SetupVerificationModalHandler.ts`.
- Interaction report slice implemented: report button intake, report-intake confirmation, typed user report modal, message report modal, user resolution, and report reason checks moved to `src/controllers/ReportInteractionHandler.ts`; associated report interaction tests moved to `src/__tests__/unit/ReportInteractionHandler.unit.test.ts`.
- `InteractionHandler.ts` is now a 1,616-line button/modal router plus remaining admin, observed, setup, and legacy verification flows; `InteractionHandler.unit.test.ts` is now 1,302 lines.
- Security role-intake slice implemented: role member selection, dry-run accounting, execution loop, and delay handling moved from `src/services/SecurityActionService.ts` to `src/services/RoleIntakeProcessor.ts`; associated processor tests moved to `src/__tests__/unit/RoleIntakeProcessor.unit.test.ts`.
- Security report-AI slice implemented: report AI settings lookup, eligible evidence selection, metadata extraction, and recommendation capping moved to `src/services/ReportAiAnalyzer.ts`.
- Setup workflow service slice implemented: candidate validation, verification-channel creation/sync, config save, analytics capture, and rollback cleanup moved to `src/services/SetupWorkflowService.ts`; setup command and modal controllers now keep Discord input/reply formatting while sharing workflow mechanics.
- Report submission service slice implemented: report permission/settings checks and user/message report submission calls moved to `src/services/ReportSubmissionService.ts`, with Discord member/user resolution isolated in `src/services/DiscordUserResolver.ts`.
- Security report-detection slice implemented: user-report and message-report detection event construction, report attachment metadata serialization, and report AI metadata attachment moved to `src/services/ReportDetectionBuilder.ts`.
- Observed action correctness fix implemented: observed open-case/kick/ban paths now treat `UserModerationService` boolean `false` returns as failed moderation actions instead of recording success.
- `SecurityActionService.ts` is now 2,039 lines and `SecurityActionService.unit.test.ts` is now 2,604 lines after adding observed false-return regression coverage.
- Current largest-file follow-ups after this pass: `SecurityActionService.unit.test.ts`, `SecurityActionService.ts`, `NotificationManager.ts`, `InteractionHandler.ts`, and `CommandHandler.setup.unit.test.ts`.

## Non-Goals

- Do not split files solely to reduce line counts.
- Do not rewrite moderation behavior as part of maintainability work.
- Do not add strict gates that fail the current tree without a staged ratchet.
- Do not hide complexity behind shallow wrappers with unclear ownership.
