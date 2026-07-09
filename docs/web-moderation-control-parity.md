# Web Moderation Control Parity Matrix

This matrix tracks Discord bot controls and the intended web workbench target for
each control family. It is the working inventory for the web moderation parity
goal in `docs/web-moderation-workbench-goal.md`.

Use this document before adding web actions. It should answer:

- What control exists today?
- Which actor and bot permissions gate it?
- Which code path owns the behavior today?
- What data, audit, outcome, or Discord side effect must web preserve?
- Where should it live in the website?
- Should it ship now, later, or only after a shared service boundary exists?

## Status Legend

- **Current**: already exists in the website.
- **Near**: a good early web slice after the read model or shared action service
  exists.
- **Later**: useful, but should wait for more infrastructure or UX design.
- **Discord-only**: keep in Discord unless a later product decision changes it.
- **Do not expose**: should not become a normal web control.

## Global Web Gates

Every mutating web action must meet these gates before it can ship:

- Guild authorization is rechecked server-side for the current session.
- The actor's Discord user ID is captured in audit metadata.
- The shared service path enforces the same policy as the Discord path.
- Bot capability and role hierarchy diagnostics are checked before showing or
  executing the action.
- Required reasons, confirmations, and role-gate previews match the Discord
  behavior.
- Admin actions, moderation outcomes, report statuses, queue items, Discord
  notifications, and case/report threads are updated consistently.
- The action is idempotent enough for browser retry, refresh, and double submit.

## Landing Gate For This Epic

No web moderation parity work should merge to `main` without AI-assisted review.
For this epic, "reviewed" means:

- Open a PR instead of pushing directly to `main`.
- Request or wait for available AI reviewers such as Copilot, Greptile, Codex, or
  other configured repo review tooling.
- Address, resolve, or explicitly acknowledge every AI and human review thread.
- Do a final review sweep after required checks pass, because AI comments can
  arrive after CI is green.
- Keep the PR description focused on non-required verification, migration,
  provider, exploratory, or production-impact checks.

Docs-only planning changes can land with docs-focused review, but code,
behavior, migration, or production-surface changes need the full recycle loop.

## Information Architecture Decisions

- Use `/admin/guild/[guildId]/inbox` as the primary triage route.
- Keep `/admin/guild/[guildId]/cases` as a focused case queue/history route.
- Keep `/admin/guild/[guildId]/reports` as a focused report review route until
  the inbox can fully replace it.
- Keep setup under `/admin/guild/[guildId]/setup`, but organize it into policy
  sections as parity grows.
- Add history and operations routes only after the inbox and action boundary are
  established.

## Report Controls

| Control                              | Current Discord surface                              | Gate                                                             | Current owner                                                                                                                                                                       | Required side effects                                                                                                                    | Web target                                        | Status                           |
| ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------- |
| Submit direct server report          | `/report`, `Report User`, `Report Message`           | User in guild; reason policy may require a reason                | `moderation_action_requests` queues bot execution through `ReportSubmissionService.submitUserReport` and `SecurityActionService.handleUserReport`                                   | Create `USER_REPORT` detection; link active case or observed alert; no case role by default                                              | `/report` reporter portal                         | Current queued handoff           |
| Start guided report intake           | Report instructions button                           | User in guild; report instructions channel; thread capability    | `moderation_action_requests` queues bot execution through `ThreadManager.createReportIntakeThread` and `ReportIntakeService.openIntakeFromThread`                                   | Create private intake thread; collect evidence; require target confirmation before submission                                            | `/report` reporter portal                         | Current queued handoff           |
| Close open intake before submission  | `/close-report` in intake thread                     | Reporter owns current open intake; confirmation; thread access   | `moderation_action_requests` queues bot execution through `ReportIntakeService.closeIntakeForThread`                                                                                | Mark intake closed; archive thread; no submitted report                                                                                  | `/report` reporter portal when open intake exists | Current queued handoff           |
| Review submitted report              | Web report queue/detail plus Discord observed alert  | Manage Guild or Moderate Members for moderator actions           | `ReportQueueDataAdapter`, `ReportDetailDataAdapter`, observed alert handlers                                                                                                        | Read report evidence, target, linked detection, linked case                                                                              | Inbox and report detail                           | Current read                     |
| Mark submitted report actioned       | Web report queue                                     | Manage Server web auth today; should use shared moderator policy | `ReportReviewService` through `PostgresReportQueueDataAdapter.closeSubmittedReport`                                                                                                 | Set intake `actioned`; capture actor/surface metadata; clear report-thread attention queue items                                         | Report detail action                              | Current through service boundary |
| Dismiss submitted report no action   | Web report queue; observed report close in Discord   | Manage Server web auth today; should use shared moderator policy | `ReportReviewService` for web; `SecurityActionService.dismissObservedDetection` for observed alerts                                                                                 | Set intake `dismissed`; capture actor/surface metadata; action observed alert when linked; record admin action consistently              | Report detail and inbox action                    | Current through service boundary |
| Mark submitted report false positive | Web report queue; observed false-positive in Discord | Manage Server web auth today; should use shared moderator policy | `ReportReviewService` for web; `SecurityActionService.dismissObservedDetection` for observed alerts                                                                                 | Set intake `false_positive`; capture actor/surface metadata; action observed alert when linked; record admin action/outcome consistently | Report detail and inbox action                    | Current through service boundary |
| Open case from report                | Observed alert `Open Case`; report queue placeholder | Moderate Members; bot role/thread capability                     | `ReportReviewService.openCaseFromSubmittedReport` validates web intent; `moderation_action_requests` queues bot execution through `SecurityActionService.openObservedDetectionCase` | Create/reuse case; apply case role; create user-visible case thread; update notification; preserve report evidence                       | Report detail action and inbox action             | Current queued handoff           |
| Kick from report alert               | Observed alert kick                                  | Kick Members; observed kick setting; bot Kick Members            | `moderation_action_requests` queues bot execution through `SecurityActionService.kickObservedDetection`                                                                             | Kick member; mark observed alert actioned; record admin action/outcome; no case thread                                                   | Inbox observed-alert action                       | Current queued handoff           |
| Ban from report alert                | Observed alert ban                                   | Ban Members; ban action enabled; bot Ban Members                 | `moderation_action_requests` queues bot execution through `SecurityActionService.banObservedDetection` or `banObservedDetectionById`                                                | Ban member or by ID; mark alert actioned; record admin action/outcome; no case thread                                                    | Inbox observed-alert action                       | Current queued handoff           |
| Undo report/alert dismissal          | Observed admin menu                                  | Manage Server web auth today; should use shared moderator policy | `moderation_action_requests` queues bot execution through `SecurityActionService.undoObservedDetectionAction`                                                                       | Remove dismissal/false-positive metadata; restore actionable observed alert, queue mirror, and linked submitted report                   | Member profile detection history                  | Current queued handoff           |
| Report history                       | Observed admin menu history                          | Manage Server web auth today; should use shared moderator policy | `MemberProfileDataAdapter`                                                                                                                                                          | Read prior detections/cases/outcomes                                                                                                     | Member profile and case/report detail             | Current read                     |

## Observed Alert Controls

| Control                         | Current Discord surface                        | Gate                                                                                                            | Current owner                                                                                                                        | Required side effects                                                           | Web target                 | Status                 |
| ------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------- | ---------------------- |
| View unresolved observed alerts | Admin observed notification; live queue mirror | Configured response mode and notification channel                                                               | `NotificationManager`, `ModerationQueueService.upsertObservedAlertMirror`                                                            | Persist detection and mirror queue item where configured                        | Inbox                      | Current read           |
| Open case                       | Observed alert action                          | Manage Server web auth today; Discord path allows Manage Guild or Moderate Members; case role/thread capability | `moderation_action_requests` queues bot execution through `SecurityActionService.openObservedDetectionCase`                          | Create/reuse case; apply case role; create thread; update notification/queue    | Inbox action               | Current queued handoff |
| Dismiss alert                   | Observed alert action                          | Manage Server web auth today; should use shared moderator policy                                                | `moderation_action_requests` queues bot execution through `SecurityActionService.dismissObservedDetection`                           | Mark observed action; update notification/queue; admin action                   | Inbox action               | Current queued handoff |
| Mark false positive             | Observed alert action                          | Manage Server web auth today; should use shared moderator policy                                                | `moderation_action_requests` queues bot execution through `SecurityActionService.dismissObservedDetection`                           | Mark false positive; update notification/queue; admin action                    | Inbox action               | Current queued handoff |
| Undo dismissal                  | Observed admin menu                            | Manage Server web auth today; should use shared moderator policy                                                | `moderation_action_requests` queues bot execution through `SecurityActionService.undoObservedDetectionAction`                        | Reopen observed alert actionability, restore queue mirror, reopen linked report | Member profile action      | Current queued handoff |
| Kick from observed alert        | Observed alert kick                            | Kick Members; observed kick enabled; bot Kick Members                                                           | `moderation_action_requests` queues bot execution through `SecurityActionService.kickObservedDetection`                              | Kick; action detection; update queues; record outcome                           | Inbox action               | Current queued handoff |
| Ban from observed alert         | Observed alert ban                             | Ban Members; ban action enabled; bot Ban Members                                                                | `moderation_action_requests` queues bot execution through `SecurityActionService.banObservedDetection` or `banObservedDetectionById` | Ban member or by ID; mark alert actioned; record outcome                        | Inbox action               | Current queued handoff |
| View history                    | Observed admin menu                            | Manage Server web auth today; should use shared moderator policy                                                | `MemberProfileDataAdapter`                                                                                                           | Read history only                                                               | Member profile/history     | Current read           |
| Web queue link                  | Discord digest/notification buttons            | Web auth                                                                                                        | `CaseReviewReminderService`, `InteractionHandler`, and presentation builders                                                         | Link to dashboard                                                               | Keep Discord link to inbox | Current                |

## Case Controls

| Control                | Current Discord surface                 | Gate                                                          | Current owner                                                                                                                    | Required side effects                                                                                                 | Web target                     | Status                 |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------- |
| View active case queue | Web `/cases`; Discord digest/live queue | Manage Server web auth; Discord moderator for bot actions     | `ActiveCaseDataAdapter`, `CaseReviewReminderService`, `ModerationQueueService`                                                   | Read pending `verification_events`, surfaces, outcomes, evidence                                                      | Inbox plus focused case route  | Current read           |
| View resolved history  | Web `/history`; Discord history menu    | Manage Server web auth                                        | `ActiveCaseDataAdapter` plus client-side history filters and visible export                                                      | Read resolved `verification_events`, outcomes, Discord surfaces, and linked case detail                               | History                        | Current read           |
| View case detail       | Web `/cases/[caseId]`                   | Manage Server web auth                                        | `ActiveCaseDataAdapter`, `caseDiscordContent`                                                                                    | Read case, history, evidence, live Discord messages where available                                                   | Case detail workbench          | Current read; improve  |
| Open case by user      | `/case open`, Open Case user context    | Moderate Members; case role `ManageRoles`; hierarchy          | `moderation_action_requests` queues bot execution through `SecurityActionService.openAdminCase`                                  | Create `ADMIN_CASE` detection; apply case role; create thread; notify admins                                          | Member profile action          | Current queued handoff |
| Open case from message | Open Case message context               | Moderate Members; case role `ManageRoles`; hierarchy          | `moderation_action_requests` queues bot execution through `SecurityActionService.openAdminCase`                                  | Preserve selected message as source evidence; open case                                                               | Member detection source action | Current queued handoff |
| Manual flag user       | `/flaguser`                             | Administrator; case role capability                           | `moderation_action_requests` queues bot execution through `SecurityActionService.handleManualFlag`                               | Create `ADMIN_FLAG` detection; open/reuse case                                                                        | Member profile action          | Current queued handoff |
| Verify user            | Case admin button                       | Manage Guild or Moderate Members                              | `moderation_action_requests` queues bot execution through `UserModerationService.verifyUser`                                     | Resolve case verified; remove case role; role-gate cleanup; close threads; update notifications; admin action/outcome | Case action rail               | Current queued handoff |
| Close no action        | Case admin button                       | Manage Guild or Moderate Members                              | `moderation_action_requests` queues bot execution through `UserModerationService.closeCaseNoAction`                              | Resolve no action; remove case role; role-gate cleanup; close threads; close linked reports; admin action/outcome     | Case action rail               | Current queued handoff |
| Kick user from case    | Case admin button                       | Kick Members; kick enabled; bot Kick Members                  | `moderation_action_requests` queues bot execution through `UserModerationService.kickUser`                                       | Kick; resolve case kicked; close threads; update notifications; outcome                                               | Case action rail               | Current queued handoff |
| Ban user from case     | Case admin button                       | Ban Members; ban enabled; bot Ban Members                     | `moderation_action_requests` queues bot execution through `UserModerationService.banUser`                                        | Ban; resolve case banned; close threads; update notifications; outcome                                                | Case action rail               | Current queued handoff |
| Ban by ID              | Case admin button when member left      | Ban Members; ban enabled; bot Ban Members                     | `moderation_action_requests` queues bot execution through `UserModerationService.banUserById`                                    | Ban by ID; resolve pending case; update state/outcome                                                                 | Case action rail               | Current queued handoff |
| Sync existing ban      | Case admin button                       | Ban Members; Discord already shows banned                     | `moderation_action_requests` queues bot execution through `UserModerationService.syncAlreadyBannedUser`                          | Resolve pending case as banned without new ban attempt                                                                | Case action rail               | Current queued handoff |
| Repair active case     | Case admin button; `/case repair`       | Manage Guild/Moderate Members in menu; admin for slash repair | `moderation_action_requests` queues bot execution through `SecurityActionService.repairActiveCase`                               | Recreate/reopen missing user-facing thread or repair state                                                            | Case operations panel          | Current queued handoff |
| Create missing thread  | Case admin button when no thread        | Manage Guild or Moderate Members; thread capability           | `moderation_action_requests` queues bot execution through `SecurityActionService.repairActiveCase`                               | Create user-facing case thread                                                                                        | Case operations panel          | Current queued handoff |
| Refresh notification   | `/case refresh`                         | Administrator                                                 | `moderation_action_requests` queues bot execution through `SecurityActionService.refreshCaseNotification`                        | Re-render stored notification from case state                                                                         | Case operations panel          | Current queued handoff |
| Reopen case            | Case admin button                       | Manage Guild or Moderate Members                              | `moderation_action_requests` queues bot execution through `SecurityActionService.reopenVerification`                             | Set pending; reopen thread; reapply case role; update notification                                                    | History/detail action rail     | Current queued handoff |
| Bulk intake role       | `/case intake-role`                     | Administrator; case role capability                           | `moderation_action_requests` queues bot execution through `SecurityActionService.intakeRoleMembers`                              | Preview/execute batch case opens from role membership                                                                 | Operations role-intake flow    | Current queued handoff |
| View history           | Case admin menu                         | Manage Guild or Moderate Members                              | `NotificationManager.handleHistoryButtonClick`; web resolved history uses `ActiveCaseDataAdapter` and `MemberProfileDataAdapter` | Read history only                                                                                                     | Member profile/history         | Current read           |

## Live Queue Controls

| Control                         | Current Discord surface                             | Gate                                             | Current owner                                                                                                                                               | Required side effects                                          | Web target                | Status                 |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------- | ---------------------- |
| Configure live queue channel    | `/config case-queue set-channel/clear-channel/view` | Administrator                                    | Web setup stores `moderation_queue_channel_id`; Discord command owns immediate sync/clear                                                                   | Store queue channel setting; sync/delete queue messages later  | Setup > required surfaces | Current setting        |
| Sync case mirrors               | Background/manual queue sync                        | Server queue configured                          | `ModerationQueueService.syncServerQueue`                                                                                                                    | Upsert/delete `case_mirror` items and Discord queue messages   | Inbox read model          | Current read           |
| Sync observed alert mirrors     | Background/manual queue sync                        | Server queue configured                          | `ModerationQueueService.syncServerQueue`                                                                                                                    | Upsert/delete `observed_alert_mirror` items                    | Inbox read model          | Current read           |
| Record support-thread attention | User reply in support thread                        | Pending case and queue configured                | `ModerationQueueService.recordSupportThreadAttention`                                                                                                       | Upsert attention item; ping role once; show acknowledge button | Inbox attention item      | Current read           |
| Record report-thread attention  | Reporter follow-up                                  | Report intake and queue configured               | `ModerationQueueService.recordReportThreadAttention`                                                                                                        | Upsert attention item; ping role once; show acknowledge button | Inbox attention item      | Current read           |
| Acknowledge attention           | Discord queue `Acknowledge` button                  | Manage Guild or Moderate Members                 | `InteractionHandler.handleQueueAcknowledgeButtonInteraction`, shared `QueueAttentionService`; visible-batch web action loops through the same service       | Delete queue message and queue item                            | Inbox action              | Current first write    |
| Long-pending screening item     | Discord queue mirror                                | Pending screening threshold and queue configured | `ModerationQueueService.upsertPendingScreeningMember`                                                                                                       | Upsert queue item until screening clears/member leaves         | Inbox item                | Current read           |
| Clear/sync queue                | Internal service and audit paths                    | Administrator                                    | `moderation_action_requests` queues bot execution through `ModerationQueueService.clearServerQueue/syncServerQueue`; Operations reads recent request status | Rebuild or clear queue messages/items                          | Operations                | Current queued handoff |

## Setup And Configuration Controls

| Control family                       | Current Discord surface                                                                        | Gate                                         | Current owner                                                                                                      | Required side effects                                                           | Web target                                | Status                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| Validate setup                       | `/config validate`                                                                             | Administrator                                | Web setup page loads Discord-backed setup diagnostics and checklist items where the bot token can access the guild | Read guild roles/channels/permissions; no mutation                              | Setup diagnostics                         | Current                                                                 |
| Unified required setup               | `/config setup`, `/setupverification`, `/setupreportbutton`                                    | Administrator; bot channel/role capability   | `SetupWorkflowService`; web queues core setup and report-button repair through the bot worker                      | Configure required roles/channels/messages; post/update report instructions     | Setup checklist                           | Current queued handoff for selected-role setup and report-button repair |
| Direct server field set              | `/config set`                                                                                  | Administrator                                | `CommandHandler`, server repository                                                                                | Update core IDs                                                                 | Setup advanced/raw fallback               | Later or avoid                                                          |
| Lockdown                             | `/config lockdown view/audit/apply/disable/allow-*`                                            | Administrator; bot manage channel overwrites | Web setup stores allow-list; `moderation_action_requests` queues bot execution through `CaseRoleLockdownService`   | Audit/apply case-role channel overwrites                                        | Setup > role policy; Operations for apply | Current queued audit/apply                                              |
| Role quarantine                      | `/config role-quarantine view/set-mode/exempt-*`                                               | Administrator                                | `CommandHandler`, role quarantine settings                                                                         | Store mode/exempt roles; affect future case role handling                       | Setup > role policy                       | Current                                                                 |
| Role gate                            | `/config role-gate view/enable/disable/set-*`                                                  | Administrator                                | `CommandHandler`, role gate settings                                                                               | Store honeypot/member access roles and response mode                            | Setup > role policy                       | Current                                                                 |
| Heuristic detection                  | `/config heuristic view/set-threshold/set-timeframe/keywords-*`                                | Administrator                                | `CommandHandler`, heuristic settings                                                                               | Update threshold/timeframe/keywords                                             | Setup > detection policy                  | Current                                                                 |
| Detection response policy            | `/config detection view/set-mode/set-event-mode/clear-event-mode/...`                          | Administrator                                | `CommandHandler`, detection response settings                                                                      | Update response modes, notification channel, thresholds, reason/action settings | Setup > detection policy                  | Current                                                                 |
| Case staff                           | `/config case-staff view/add-role/remove-role/set-routing/set-member-cap`                      | Administrator                                | `CommandHandler`, case responder settings                                                                          | Store responder roles/routing/member cap                                        | Setup > case staffing                     | Current                                                                 |
| Case review reminders                | `/config case-review view/enable/disable/set-stale-hours/set-repeat-hours/set-very-stale-days` | Administrator                                | Web setup stores reminder settings with the same bounds as the Discord case-review config                          | Store reminder cadence/thresholds                                               | Setup > case review                       | Current                                                                 |
| Manual intake                        | `/config manual-intake view/set-role/clear-role/enable/disable/set-grace-period`               | Administrator                                | `CommandHandler`, manual intake settings                                                                           | Store trigger role/mode/grace period                                            | Setup > role policy/manual intake         | Current                                                                 |
| Report policy                        | `/config report view/reason-*/external-reports/intake-confirmed-response/ai-*`                 | Administrator                                | `CommandHandler`, report settings                                                                                  | Store report reason/external response/AI text-image caps/max action             | Setup > report policy                     | Current                                                                 |
| Analytics                            | `/config analytics view/set-level`                                                             | Administrator; server owner for full sharing | Web setup stores consent level with owner gate for full sharing                                                    | Store consent level                                                             | Setup > analytics/privacy                 | Current                                                                 |
| Verification prompt/context/analysis | `/config verification prompt-* context-* analysis-*`                                           | Administrator                                | `CommandHandler`, verification settings                                                                            | Store prompt/context/analysis policy                                            | Setup > verification policy               | Current                                                                 |
| Message deletion policy              | Web setup controls; bot config paths                                                           | Administrator; Manage Messages diagnostics   | `setupDataAdapter`, message deletion settings                                                                      | Store source-message/watchlist deletion policy                                  | Setup > message deletion                  | Current                                                                 |

## Audit, Maintenance, And Operations

| Control                   | Current Discord surface           | Gate                                                                                      | Current owner                                                                                                        | Required side effects                              | Web target                       | Status                 |
| ------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------- | ---------------------- |
| Integrity audit           | `/audit integrity`                | Manage Guild                                                                              | Web reads database-backed durable-record and queue-pointer findings; Discord command keeps live Discord fetch checks | Read-only audit of cases, role state, queue state  | Operations read-only report      | Current DB snapshot    |
| Close resolved threads    | `/audit close-resolved-threads`   | Manage Guild; execute flag for mutation; web currently uses Administrator operations gate | `moderation_action_requests` queues bot execution through `CaseThreadClosureSweepService`                            | Dry-run or archive/lock resolved threads           | Operations repair flow           | Current queued handoff |
| Ignore detection          | `/audit ignore-detection`         | Manage Server web auth today; should use shared moderator policy                          | `moderation_action_requests` queues bot execution through `SecurityActionService.excludeDetectionFromAccounting`     | Exclude detection from future suspicion accounting | Member profile detection history | Current queued handoff |
| Restore detection         | `/audit restore-detection`        | Manage Server web auth today; should use shared moderator policy                          | `moderation_action_requests` queues bot execution through `SecurityActionService.restoreDetectionAccounting`         | Restore detection to suspicion accounting          | Member profile detection history | Current queued handoff |
| Deployment/runtime health | GitHub Actions, logs, deploy docs | Operator                                                                                  | Operations lists repo-owned deploy/IaC workflows and runtime runbooks                                                | Deploy, migrate, ECS/Vercel health                 | Operations/operator docs         | Current operator docs  |

## Read-Only Web Coverage Already Present

The website already has useful read paths that should be preserved while adding
the inbox:

- Active case summaries and detail data through `ActiveCaseDataAdapter`.
- Report summaries and closures through `ReportQueueDataAdapter`.
- Live Discord source message and thread message reads on case detail.
- Setup diagnostics and core settings through setup adapters.
- Fixture mode for web E2E coverage.

## First Safe Web Writes

Recommended first write sequence:

1. **Acknowledge queue attention** because it only deletes attention queue items
   and mirrors an existing Discord button with a small side-effect surface. This
   is the first shared Discord/web write path through `QueueAttentionService`.
2. **Report closure through a shared service** because web already has the UI.
   This path now runs through `ReportReviewService`; observed-alert report
   closeout still has deeper parity work before report/open-case flows converge.
3. **Open case from report/observed alert** because it is central to moderation
   flow but has real case-role/thread/notification side effects. The report
   path now has a `ReportReviewService` orchestration boundary and
   `moderation_action_requests` handoff so the logged-in bot executes the
   existing `SecurityActionService.openObservedDetectionCase` path.
4. **Single-case destructive actions** now queue kick, ban, and ban by ID through
   `moderation_action_requests` after web-side moderator permission, server
   policy, live bot capability, confirmation, and reason capture. The bot worker
   repeats policy and bot-permission gates before calling the existing
   `UserModerationService` methods.
5. **Observed alert undo** now queues from member-profile detection history for
   dismissed and false-positive detections. The bot worker calls
   `SecurityActionService.undoObservedDetectionAction`, preserving Discord
   notification restoration, queue mirror restore, linked report reopen, audit,
   outcome, and analytics behavior.
6. **Open case by member** now queues from the member profile for in-server
   targets. The web action repeats the Moderate Members/Admin owner gate,
   confirmation, target-state, and required-reason checks before the logged-in
   bot worker calls `SecurityActionService.openAdminCase`.
7. **Manual flag by member** now queues from the member profile for in-server
   targets. The web action keeps `/flaguser` admin-only policy, confirmation,
   target-state, and reason capture before the logged-in bot worker calls
   `SecurityActionService.handleManualFlag`.
8. **Live queue sync/clear** now queues from the Operations page. The web action
   keeps the operation administrator-only and confirmation-gates queue clearing,
   while the logged-in bot worker calls `ModerationQueueService` so Discord
   queue messages and persisted mirror items stay owned by the bot runtime. The
   Operations page also reads recent web request status so queued, completed,
   and failed handoffs are visible from the dashboard.
9. **Integrity snapshot** now exposes database-backed durable-record and
   queue-pointer drift in Operations. Live Discord member, ban, channel, and
   message fetches remain in `/audit integrity` until the web runtime has an
   explicit bot-owned audit handoff.
10. **Visible inbox export** now emits the currently filtered rows as a
    tab-separated review packet. It is intentionally read-only and does not add
    moderation side effects.
11. **Resolved-thread sweep** now queues from the Operations page. The dry-run
    form is the default path; confirmed execution passes through the logged-in
    bot worker and `CaseThreadClosureSweepService`, preserving the existing
    `/audit close-resolved-threads` closure semantics while recent request
    history shows the resulting counts.
12. **Case-role lockdown audit/apply** now queues from the Operations page. Web
    keeps allow-list editing in Setup, queues read-only audit separately from
    confirmed apply, and lets the bot worker call `CaseRoleLockdownService` so
    Discord channel overwrites, optional allowed-channel unsync, and enablement
    updates stay owned by the bot runtime.
13. **Bulk role intake** now queues from the Operations page. The dry-run form
    previews selected eligible members for a role, while confirmed execution
    calls `SecurityActionService.intakeRoleMembers` in the logged-in bot worker
    so case creation, case-role assignment, audit metadata, and active-case skips
    match `/case intake-role`.
14. **Direct server reports** now queue from `/report` for signed-in Discord
    users who share a configured guild with Drasil. The web action validates
    membership, target ID shape, self-report, confirmation, and reason policy;
    the logged-in bot worker verifies reporter membership in Discord and calls
    `ReportSubmissionService.submitUserReport`, preserving `/report` detection
    and observed-alert behavior.
15. **Guided report intake start** now queues from `/report` for signed-in
    Discord users who share a configured guild with Drasil. The web action
    requires a configured report instructions channel; the logged-in bot worker
    verifies reporter membership, avoids duplicate open intakes, creates and
    activates the private report thread, persists intake state, and sends the
    same admin notification affordance as the Discord report button.
16. **Close open report intake** now queues from `/report` when the signed-in
    reporter has an open intake in that guild. The web action requires explicit
    confirmation and revalidates the intake belongs to the reporter before the
    logged-in bot worker loads the Discord thread and calls
    `ReportIntakeService.closeIntakeForThread`.

Do not start broader destructive bulk moderation cleanup or role-gate cleanup
until the service boundary and confirmation model are proven for more
single-item actions.

## Matrix Maintenance

Update this matrix whenever a Discord control changes, a web parity slice lands,
or a future product decision marks a control as web-supported, deferred, or
Discord-only. Keep rows grouped by user workflow rather than source filename so
future agents can navigate from product intent to code.
