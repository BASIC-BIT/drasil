# Complete review journey exploration

Status: an editable design and isolated interactive study. This is not approval to implement production routes or change moderation policy.

The user approved exploring one difficult case through evidence inspection, an action failure, recovery, confirmed completion and the next queue item. Preserve the commissioned logo, neutral grey surfaces, flat composition and the existing mint/grey/amber/red action progression.

## Artifacts

- [Evidence inspection](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=30-199).
- [Failure before execution](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=30-386).
- [Retry with the original reason](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=30-579).
- [Confirmed ban and case completion](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=30-779).
- [Next item and retained receipt](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=30-972).
- [Mobile failure](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=30-1164).

Figma contains editable snapshots and vertically scrollable evidence regions. The end-to-end interaction lives in `/workspace/artifacts/drasil-foundation/drasil-design-playground.html`, under **Full review journey**. Controls outside the product canvas simulate the worker, permission restoration and completion. No Discord or application requests are sent.

The source HTML, CSS and JavaScript are beside the offline bundle. `package-playground.py` embeds the commissioned logo, fonts and source files. `verify-review-journey.cjs` exercises the isolated interaction. These are design artifacts, not production components.

## Evidence and reading

The study extends the earlier fixture with clearly fictional material: six submitted records and eight saved context items. It includes overlapping accounts, a long member reply, two screenshot metadata records and an unavailable source. The screenshot pixels are not supplied. This does not test visual attachment inspection or authenticity.

Keep submitted accounts, saved conversation context and unavailable sources distinguishable. Counts identify collections rather than independent confirmations. The member's explanation remains available in full. A scrollable reading region keeps the action area available while reading; the prototype preserves per-tab reading positions and the saved-context disclosure across request updates and record selection.

This nested reading region is a hypothesis to evaluate with users, particularly on mobile and under zoom. Compare it with a single scrolling page and a persistent action footer before choosing a production pattern.

## Request and recovery behavior

| Stage                          | Visible behavior                                                              | Moderator action                                               |
| ------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Inspect                        | Full evidence remains available, with source context and explicit counts      | Read and choose a permitted action                             |
| Confirm                        | Inline member identity, effect, reason and explicit confirmation              | Queue the ban or cancel                                        |
| Queued / processing            | Case remains open; conflicting submissions are blocked                        | Continue reading or inspect request details                    |
| Known failure before execution | “Ban not attempted,” permission explanation, original reason retained         | Have permission restored in Discord, then review the ban again |
| Retry                          | Original reason is retained; confirmation resets                              | Deliberately queue another attempt                             |
| Confirmed result               | Ban and case finalization are explicitly confirmed; no deletion was requested | Choose when to continue                                        |
| Continue                       | Next item follows the current filtered queue; focus moves to its heading      | Review the next item or return to the completed receipt        |

The worker simulation deliberately stops the first attempt at the bot-permission check, before the Discord ban operation. This is grounded in `banCaseUser` and `assertBotPermission` in `src/services/ModerationActionRequestService.ts`. Restoring permission does not automatically retry or assert that access was freshly checked; the next execution checks it again.

Existing request states are `queued`, `processing`, `completed` and `failed`; see `apps/web/lib/inboxActionState.ts`. Failed requests can be resubmitted under the queue's existing rules. `blocksBanResubmission` in `apps/web/lib/inboxActionReceipts.ts` also protects known bans, pending finalization and uncertain outcomes.

**A failed status alone does not mean nothing happened.** The “not attempted” receipt is valid only when an actual pre-execution failure is established. An unknown ban outcome or successful ban with incomplete case updates must not offer the same retry path. Likewise, a completed request alone does not establish both a successful ban and completed case finalization; inspect the result and current case state. The simulation supplies explicit confirmation of both for its completion stage.

The prototype keeps the reviewed row stable during the session, including pending and completed states. It does not automatically advance. After the moderator chooses **Next item**, the resolved case leaves the pending view and a recent-completion receipt remains accessible. With no other matching item, the next control is disabled and says so. Filtering must not silently change the target of an action.

The later [Storybook inbox](storybook-report-inbox.md) supersedes the retained-receipt handoff: completion stays in the report detail, and leaving it returns to the pending queue without a pinned receipt.

## Reusable components and verification

Added `Drasil / Request receipt` in Figma, node `29:198`, with editable title, description and request details plus a shared button instance. Existing button variants, semantic colors, detail tabs and commissioned logo remain in use. Longer evidence text now sizes to its content. Only the logo is raster content in the journey frames.

The offline interaction passed at 320, 390 and 1440 pixels in dark and light themes. Checks cover evidence scrolling without moving the action row, keyboard tab navigation, reading-position retention, confirmation enforcement, cancel focus restoration, preserved reasons, explicit retry, pending/completed distinctions, filter-aware handoff, return to the receipt, horizontal wrapping and restoration of the earlier dense-case scenario. No page errors or network requests occurred. Figma snapshots were checked for wrapped text, unintended clipping, editable structure and Manrope typography.

No production code or Storybook stories changed in this pass.

## Questions for the next iteration

- Design unknown and partial outcomes, including a successful Discord ban with case updates still pending. Identify the correct status check or finalization action before offering retry.
- Test another moderator resolving the case while it is open, stale permissions and changes to `allowedActions` before submission.
- Inspect real attachment previews and source navigation; the current study covers metadata and text only.
- Compare mobile reading/scrolling patterns and zoom behavior with representative moderators.
- Test queue continuation when sorting changes, a filter becomes empty or a newly arrived item changes priority.
- Use these states as candidate Storybook stories for request receipts, evidence records and action controls before route adoption.

## Operator copy review

A UX-writer subagent audited the operator flow and reviewed the revisions. Repeated demo notices and moderation lectures were removed from product views. Source labels now carry specific metadata; redundant intake badges, non-case state rows and activity bodies were removed. Action scope, submit labels and missing update timestamps were corrected. See [the operator-copy standard](operator-copy.md).
