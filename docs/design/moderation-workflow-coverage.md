# Moderation workflow design coverage

Status: exploratory mockups for review, not production integration. The user requested all six remaining workflow areas be designed before implementation begins. This supersedes the earlier suggestion to integrate the ordinary case first and fill in these workflows later.

Browse the [screenshot gallery](previews/workflows/README.md) for all six areas.

The new studies are in **Design foundation → Complete moderation workflows** in Storybook. They reuse the approved neutral-grey foundation, logo, typography, evidence reading structure and contextual confirmations. State controls live in Storybook, outside product screens. Actions only create local simulated queued receipts. Page destinations are the intended application routes, not implemented pages in this standalone study.

The screenshots use a fixed browser clock of October 23, 2026, 15:16 UTC. New quotations, identities, roles, channel names and reply timestamps are authored design fixtures, not claims about stored production records. Cleanup records retain the existing contract-backed fixture dates and source identifiers. The studies expose the information each workflow needs without inventing that information in a live adapter.

## 1. Mixed inbox

Keep the same queue/detail grammar across item kinds. Show the identity of the actual subject, a concrete concern, kind and event time. A case, report and attention item remain different records even when they concern the same member. Cases, Reports, Alerts, Replies and Screening are filters, not separate top-level applications.

| Kind                   | Selected detail                                                                                   | Actions and boundaries                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case                   | Current case/member state, source evidence and checks                                             | Direct permitted decisions, or Investigate case for the full reading layout. Preserve member-wide effects of verification/closure.                                                                      |
| Submitted report       | Confirmed target or Unknown target, reporter separately, statements and attachments               | Dismiss, mark handled, false positive, open case and ban only when supplied by current eligibility. A report does not gain kick/verify controls just to match a case.                                   |
| Observed alert         | Detection reasons, confidence, actual detection time and available sources                        | Dismiss, false positive, open case; kick only when enabled, ban only when allowed. No existing case or restriction is implied. Dismissal may also close a linked report.                                |
| Report reply           | Reporter identity, actual latest reply, intake stage and linked evidence                          | Mark reviewed removes the attention item. It does not submit or close the report. Follow-ups can arrive while evidence is still being collected or target confirmation is pending.                      |
| Support/recovery reply | Actual reply, related case and current quarantine state                                           | Mark reviewed removes the attention item. Open case uses that case's separate capabilities; a reply neither establishes recovery nor resolves quarantine.                                               |
| Containment breach     | Preserve the support-attention subtype, actual prohibited posting location and containment status | Open the source message and affected case; mark the attention item reviewed with confirmation. Never label a breach location as the recovery thread.                                                    |
| Pending screening      | Actual pending-since date, attention threshold and last screening check                           | Read-only screening detail and an explicit Discord destination. No approve, dismiss or bypass mutation exists for this kind. This is Discord membership screening, not Drasil's browser security check. |

Use Reply sent, Detected, Pending since and Queue updated only with the respective timestamps. Queue creation/staleness is not a substitute for event age. Counts identify records or collections, not independent corroboration.

Reporter replies are especially important: the current report-detail contract accepts only submitted/reviewed reports. The replacement needs a read-only attention detail loader for earlier intake stages. It must not grant submitted-report actions to those earlier stages.

For unavailable reply content, retain author/time/source access and omit the quotation. Do not use a report summary or URL as if it were the reply body. The same detail composition supports loading, unavailable sources and changes while selected, without changing its action target.

## 2. Compromised accounts and recovery

Keep containment status near the identity. A live role/permission preview uses the center reading column, where moderators can inspect its actual consequences. The right rail can summarize current containment and recorded history. Keep ordinary action ordering; use Verify and release only for an actual compromised-account case.

| State                      | Data to present                                                                                                                              | Available next step                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before quarantine          | Case/member, enablement and relevant existing restrictions                                                                                   | Request live preview with reason/contextual confirmation. No role effects yet.                                                                                                                                                             |
| Preview ready              | Removable/privileged roles, retained roles and reasons, permission bypasses, case-role readiness, recovery thread and notification readiness | Confirm quarantine. Bind the preview to actor/server/member/case.                                                                                                                                                                          |
| Preview expired or changed | Preview time and the actual stale/changed condition                                                                                          | Refresh preview. Preview validity is under 10 minutes and its live fingerprint must still match. Never offer execution using a stale preview.                                                                                              |
| Containment running        | Actual request state                                                                                                                         | Continue reading; block duplicate containment requests.                                                                                                                                                                                    |
| Incomplete containment     | Removed/retained/failed role counts, remaining bypasses and actual blockers                                                                  | Keep the case in review. Repair blockers and preview again. Partial removals remain in effect. The backend can attempt incomplete containment; do not invent a policy that prevents all execution whenever full containment is impossible. |
| Contained and parked       | Parking actor/time, containment effects and recovery thread                                                                                  | Wait for recovery information or deliberately review/release, kick or ban. Parked is an open case. Do not add unsupported Park/Unpark or Close without action controls.                                                                    |
| Recovery reply             | Actual reply and current containment separately                                                                                              | Review the case. Acknowledging the reply does not release or unpark it.                                                                                                                                                                    |
| Release                    | Eligible role restoration and role-gate effects; skipped restoration where recorded                                                          | Confirm verification/release. Kick or ban abandons the role snapshot rather than restoring access.                                                                                                                                         |

Quarantine removes manageable roles, including privileged ones, while retaining the case role and user-facing recovery thread. It is not a Discord timeout. Confirmations describe eligible restoration rather than promising every saved role will return.

The current case contract has counts and parking data, not a typed recovery-attention object or exact current release-role list. Compose attention data explicitly and show an exact role list only when an actual preview/record supplies it. A new read contract may be needed; a new case database is not.

## 3. Browser security checks

Keep this in the case's checks context, with generation history available in the reader. The expanded study uses the center column to inspect the full record. Do not crowd ordinary punitive decisions with every security-check command.

| State                 | Presentation and actions                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not issued            | Issue check only for an eligible pending standard case with checks enabled. Never for compromised-account recovery.                                                                                                 |
| Pending and delivered | Delivery location, expiry, generation and submission count. Wait or confirm Continue without browser check. A normally delivered pending check does not offer Retry.                                                |
| Delivery failed       | Concrete delivery problem, requested time, no invented delivered time. Retry or bypass when currently allowed.                                                                                                      |
| Failed or expired     | Recorded outcome and time. Confirm retry or bypass when allowed.                                                                                                                                                    |
| Bypassed              | Actor, time and mandatory reason. No pass recorded; retry when allowed.                                                                                                                                             |
| Cancelled             | Recorded cancellation. Retry only if current eligibility supplies it.                                                                                                                                               |
| Passed, evidence only | Recorded pass and source/effect. Case stays open. No further issue/retry for this case.                                                                                                                             |
| Automatic join pass   | Show recorded policy effect separately from actual resolution. Auto-verification requires the unchanged original join-only case, enabled policy and no other pending case. A pass alone does not establish release. |

Retry invalidates older links, creates a new generation and resets its submission allowance. Retry and bypass bind the displayed challenge ID and generation so a stale confirmation cannot act on a newer challenge. Bypass requires a reason and keeps the case/restriction open. If the member is absent, current eligibility can leave bypass available while retry is unavailable.

Use actual request/delivery/pass/expiry timestamps and expand earlier generation outcomes. Product copy should state concrete status and effect. Avoid identity-verification, safe-account or recovery claims, and avoid repeating generic lectures about what a check does not prove.

## 4. Message cleanup

Cleanup uses the center reader, not a small right-rail menu. It has its own reviewed scope and frozen candidate list. Plain Ban remains a separate operation and does not silently delete messages.

| Stage                         | Presentation and actions                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configure                     | Source message, last hour, last 24 hours or last 7 days. Choose deletion only or explicit combined ban/deletion. Record a reason, then request a preview.                                                              |
| Discovering                   | Durable request/job state, chosen scope and window. No execution control yet.                                                                                                                                          |
| Frozen preview                | Actual window, preview time, candidate count, reason, evidence destination and each candidate's source/author/channel IDs, preview, attachments and evidence state. Review the list before a count-bound confirmation. |
| Coverage blocked              | Partial time-window coverage, indexing, permission denial, unavailable search or more than 100 execution candidates blocks deletion. Explain the actual blocker and offer a new/narrower preview.                      |
| Single-source exception       | A partial-coverage preview of one source message can execute. This does not imply that partial time-window searches can execute.                                                                                       |
| Executing                     | Preserve evidence before deleting each unchanged message. In combined mode ban first, then clean up, then finalize the case. Block duplicate execution.                                                                |
| Results                       | Separate deleted, already missing, changed since preview, evidence failure, deletion failure and permission denied. A completed job can have item failures. Keep source/evidence access.                               |
| Finalization failed after ban | Show confirmed ban, completed deletion outcomes and failed case/thread updates independently. Confirm Retry case finalization using the same job. It must not repeat the ban or completed deletions.                   |

Administrator permission, matching pending case/target and a usable evidence thread are required for preview/execution. Keep the backend's 1–1000 character reason requirement. A preview can contain up to 500 candidates, but execution is limited to 1–100. A blocked preview is not permission to delete a guessed subset. Execution requires the exact reviewed job/candidate count and unchanged eligibility.

Channel names require metadata. A channel ID is preferable to a made-up name. Candidate previews are not full transcripts. Clicking the source/evidence item opens the actual supplied URL; no separate redundant Open attachment control is needed.

## 5. Channel conversations

Keep the saved source above a continuous chronological channel stream with actual authors and times. Highlight its corresponding message. View in conversation and Back to source are reading navigation. Use one Conversation collection in the index, not a menu entry for each message.

Load an initial source-centered window and explicit earlier/later pages, with loaded extent clear. Prepending messages must retain reading position. The shared design proposes 50-message pages and a 200-message in-memory bound; further reading remains available in Discord. Changing or refreshing a window does not replace saved evidence.

| Available data                          | Honest presentation                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Current channel messages loaded         | Conversation, named channel when resolved, actual participants, fetch timestamp and loaded extent                                  |
| Recent member previews only             | Recent member messages grouped by channel; never present these as a continuous multi-person conversation                           |
| Source changed                          | Keep saved quotation and current source separately, with their own provenance                                                      |
| Source deleted                          | Retain saved quotation, identify absence in the current conversation, and display surrounding messages only when actually returned |
| Channel inaccessible or API unavailable | Concise unavailable state and saved evidence preserved. No synthetic participants or replacement quotation                         |
| Expired stored context                  | Do not show expired previews or imply a complete historical archive                                                                |

The new endpoint verifies source linkage, guild and actual actor channel access on every page request, including thread permissions, plus bot access. It takes no arbitrary client URL and adds no database retention. The source-centered Discord read is new boundary work; the existing recent-member context store cannot supply it.

## 6. Live results and changes during review

Replace the confirmation with its receipt in the same action area. Keep evidence readable, target identity stable, reasons retained after failure and duplicate actions blocked. No automatic next-item jump.

| Evidence                                              | Product status                                         | Next step                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queued/processing request                             | Queued or In progress                                  | Read, wait or inspect the request. Do not infer a Discord result.                                                                                          |
| Explicit validation or known pre-enforcement failure  | Concrete blocker; Not sent only if established         | Fix the cause, refresh eligibility and deliberately confirm another attempt.                                                                               |
| Generic failed status/error only                      | Request failed                                         | Inspect current member/ban/case state. Do not infer no effect or offer unconditional Retry ban.                                                            |
| Explicit observed/report-ban `banned_updates_pending` | Banned. Report updates pending.                        | Existing backend reconciliation finishes updates without sending another ban.                                                                              |
| Explicit `ban_outcome_unknown`                        | Ban outcome needs review                               | Keep another ban blocked. Inspect the operation; existing Discord review workflow verifies current ban state. Do not invent a web reconciliation mutation. |
| Explicit reviewed/no current ban                      | Reviewed: no current ban                               | Historical outcome stays uncertain. A new action requires fresh eligibility and explicit confirmation.                                                     |
| Cleanup job says ban succeeded / finalization failed  | Banned. Case updates incomplete.                       | Finalization-only retry on the same job, never repeat enforcement.                                                                                         |
| Another moderator's recorded outcome                  | Current recorded result with actor/time when available | Retain evidence and let the moderator continue deliberately. No invented actor if only Already handled is known.                                           |

An ordinary failed request does not contain typed proof of its execution stage. The existing receipt and ban-resubmission helpers are useful, but the new presentation must not turn their generic retry allowance into a claim that enforcement never happened. Special observed/report-ban result metadata and cleanup job outcomes are stronger evidence and must stay attached to the correct record types.

Report closure also has meaningful immediate outcomes: closed, already handled, busy, and queue-message cleanup warnings. The current web adapter collapses these to a boolean. Preserve that information in the new result contract instead of reporting every false result as the same failure. Successful closure can coexist with a failed queue-message cleanup; it should not reopen the report in the UI.

## Contracts needed before route adoption

- A selected-item union that retains the queue subtype, separate case/report/detection IDs, event timestamps and actual source references. Current `sourceId` alone is ambiguous for attention records.
- Screening pending-since/threshold/last-checked data from existing queue/member fields.
- Reply detail including earlier report-intake stages, actual author/time/text/attachments and source-message references. Existing storage and Discord helpers already provide the material.
- Server-supplied capabilities and required reason policy per concrete action. Treat submitted-report, observed-alert, case and attention mutations separately.
- Case containment/security/cleanup records and durable receipts composed by identity, not inferred from similarly named fields or generic status strings.
- A source-centered authenticated conversation read, with source/guild/actor access checks and bounded pagination.
- Structured closure outcomes and queue cleanup warning rather than the current boolean-only web result.

No new web reply composer, screening approval command, assignment system, snooze, unread-count policy, cross-server intelligence model or permanent transcript archive is proposed by this design pass.

## Review and implementation boundary

All six areas now have explicit state/data/action designs, with interactive studies for their central screens and important outcomes. This is material to review together; it is not a claim that the design has been approved or production behavior implemented. Iterate these shared components and settle the flow before creating the detailed implementation plan.

Underlying sources include `packages/contracts/src/{inbox,cases,reports,messageCleanup}.ts`, `apps/web/lib/{moderationInboxDataAdapter,activeCaseDataAdapter,inboxActionState,inboxActionReceipts,moderationActionRequestDataAdapter}.ts`, `docs/compromised-account-quarantine.md`, `docs/captcha-case-challenge-plan.md`, and the current report-review, attention, quarantine, cleanup and ban services.
