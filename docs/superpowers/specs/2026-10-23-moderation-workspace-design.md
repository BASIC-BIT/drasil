# Drasil moderation workspace design

Status: proposed design for review. Product implementation has not started.

## Intent and scope

Build a new moderator website around the approved flat grey inbox and case detail page. The user confirmed that the existing website is unused and its UI can be replaced from the ground up. Existing page layouts, navigation and component APIs impose no compatibility requirement. Existing moderation rules, stored records and Discord effects remain authoritative.

The first release replaces the moderator shell, mixed inbox and investigation experience together. It supports inbox selection, direct triage, investigation, confirmed actions, durable results and continuing review. The broader website can adopt this foundation in subsequent slices. This boundary is a proposal, not a user requirement to keep any current screen.

Success means a moderator can understand what needs attention, inspect its sources and act without leaving the new workflow for routine review. Visual design should match the [approved case detail preview](../../design/previews/source-desk.png), including the transparent commissioned logo, Manrope, neutral surfaces, flat separation and restrained severity colors.

Avoid redundant case/report navigation, generic evidence disclaimers, fabricated titles or attribution, nested card stacks and extra navigation before an ordinary action. Do not add a broad new fixture campaign before integration; reuse existing stories and test the real workflow.

## Approaches and decision

| Approach                                                                                           | Consequence                                                                              | Decision                                                                                 |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Adopt the approved case detail design while retaining the current inbox                            | Smaller route change, but keeps the old interface and delays the coherent review journey | Rejected by the user. The current website is unused and can be replaced.                 |
| Rebuild the moderator shell, inbox and case review together, reusing existing backend capabilities | More UI work in the first slice, with one consistent navigation and action model         | Selected direction. This document proposes its boundaries and interactions.              |
| Rewrite the website and moderation backend together                                                | Changes policy and execution while also changing presentation                            | Unnecessary for this goal. Retain useful services, contracts and durable queue behavior. |

## Information architecture

The proposed primary navigation is Inbox and History. Put server selection and account controls in the shared shell. Settings and Operations are secondary destinations. Cases, Reports, Alerts, Replies and Screening become named inbox views, rather than independent top-level queue pages. This is a design recommendation for review.

Keep a distinct canonical case URL for direct links and investigation. Retain report and member detail URLs where they are useful identities, not as reasons to keep their existing layouts. Old case/report queue URLs can redirect to the corresponding inbox view after migration. Preserve query parameters needed for explicit request tracking. Do not change public report, OAuth or security-check URLs merely to simplify navigation.

History is the destination for completed work and past outcomes. A completion receipt belongs with the item being reviewed; it must not become a stale pinned item in the pending queue.

## Inbox

Use the approved two-pane composition. The queue sits on the left, with a clear, quiet boundary to the selected item's review pane. On narrow screens selection opens the detail view; Back to inbox restores the queue position and selected row.

Use one row pattern across all existing inbox kinds. Each row presents member identity when known, the kind of work, its concrete concern or excerpt, the relevant status and an absolute/relative timestamp. A member name is not a report title. Unknown targets remain unknown. Show counts for collections, without implying that several records independently corroborate a concern.

The existing six kinds stay semantically distinct:

| Kind              | Detail and ordinary next step                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submitted report  | Reporter statement, submitted material and confirmed target if known; dismiss, mark handled, mark false positive, open case or ban only when supplied capabilities allow it |
| Observed alert    | Recorded detection, reasons and source; dismiss, mark false positive, open case, kick or ban only when supplied capabilities allow it                                       |
| Active case       | Member and case state, important source material and checks; direct decisions plus Investigate to open the case detail page                                                 |
| Report reply      | Read the linked reporter follow-up, open its thread and confirm marking the attention item reviewed                                                                         |
| Support reply     | Read the linked support/recovery thread, preserve relevant containment status and confirm marking the attention item reviewed                                               |
| Pending screening | Screening age/status and Discord destination; do not invent case decisions for a member who has no case                                                                     |

Use a kind-specific renderer backed by a discriminated view model. Reuse contract types for records and action identifiers. Do not make reports look like cases or convert an alert into a case just to fit a common component.

Load queue summaries first. Fetch full records only for the selected item, using its guild and stable record IDs. The selected pane has an explicit loading/error state, and late responses for a previous selection cannot replace the current one. Where an attention record supplies only a thread destination, expose that destination honestly rather than inventing an inline transcript.

Retain the useful existing filtering and sorting functions, but replace their presentation. Default to the existing priority order. Named views and search live above the queue; advanced filters can be a compact disclosure. Never let filtering or polling silently change the member named in an open confirmation.

## Case detail page

Retain the approved structure: member header, top action subbar, local source index, reading column and right-hand checks/history. The action subbar shows member identity after the main header scrolls away. On narrow screens Checks and History are section navigation, and source/context jumps retain a visible Back to source link.

Reuse the same evidence records, action controller and confirmation components in the inbox and investigation view. Investigation offers more reading space, not a separate decision model. Keep source text complete as returned by its source, group saved representations of the same message without discarding either, and make attachment items themselves clickable.

Present three different data collections accurately:

- Saved evidence consists of submitted text, attachment metadata and recorded message excerpts. Preserve its recorded content and dates.
- Recent member messages are expiring saved previews from that member in this server, potentially across channels. Group them by channel ID. Do not label this collection a continuous conversation or imply that previews are full messages.
- Conversation is a separately fetched view of channel messages around a source, including other participants. Distinguish it from saved evidence and identify when it was fetched. Do not silently replace a saved quotation with current Discord text.

### Conversation access

View conversation opens a continuous chronological stream around the source message in the reading column, with the source highlighted and a return link. Keep one collection entry in the source index. Individual messages are content, not menu items.

Fetch on demand through an authenticated server endpoint. Resolve the channel/message from a source linked to the authorized case or report, verify that the channel belongs to that guild, and use the existing bot HTTP boundary. Never accept an arbitrary client-supplied Discord URL or use bot credentials in the browser.

For this new full-channel read, guild management eligibility alone is insufficient. Require the actor's effective View Channel and Read Message History permissions, respecting channel overwrites, thread parent permissions and private-thread access. Honor Discord owner/administrator semantics. Recheck access on every page request; missing or unverifiable access produces the unavailable state. The bot must also be able to read the channel. This is the author's proposed access rule for the new capability; it does not change saved-evidence access policy.

The proposed initial window is up to 50 messages using Discord's `around` parameter. Load older/newer messages in explicit pages of up to 50 using message-ID cursors. Preserve chronological order, deduplicate by channel/message ID, and keep the reader's position when prepending. Bound the in-memory stream to 200 messages; at the bound, provide Open in Discord for further reading rather than silently dropping the reader's context. These limits are implementation proposals for this release.

Use attribution actually returned by Discord. When the source is deleted, show the saved source separately and explain that it is unavailable in the current window. If access fails, preserve saved evidence, provide a concise unavailable state and retain a valid Discord link. Do not fabricate surrounding messages. Conversation reads add no database retention and do not change the existing message-context collection policy.

## Decisions and results

Every state-changing operation requires contextual confirmation, including dismiss, mark handled, mark false positive, acknowledge and secondary maintenance actions. Reading, changing views, opening attachments and fetching conversation context happen immediately.

The confirmation identifies the server, member or report, operation and actual effects. Cancellation restores focus. Required kick/ban reasons follow server policy; do not keep the prototype's unconditional Optional label. Preserve entered reasons after a failed submission. Role effects, security-check generation, quarantine previews and message cleanup retain their existing semantic requirements.

Order routine case decisions Verify member, Close case, Kick member and Ban member when available. Use mint, neutral, amber and red respectively, with text labels as well as color. Other actions appear in a secondary Case tools disclosure or their relevant status section. A plain ban does not delete messages; optional cleanup is an explicit preview-and-confirm flow. Keep compromised-account containment and browser security checks visible when relevant, without crowding every ordinary case.

The server owns authorization, current allowed actions, reason policy, request deduplication and execution. Client availability is helpful presentation, not authority. Reuse the current worker and queue; add only the boundary data or receipt-returning actions the new UI needs.

The UI models confirmation separately from execution. Execution moves through submitting, queued, processing and a recorded result. A durable request ID ties the local submission to subsequent server refreshes. Reuse request reconciliation, polling and ban-resubmission protections. Poll only while relevant requests are active, and stop on unmount or terminal results. Refreshes preserve selection, disclosure state, reading position and a reason draft.

A failed request does not establish that no Discord effect happened. A completed request does not establish the latest member state. Present recorded outcomes and refreshed case state separately. Known pre-execution failures can offer deliberate retry; partial or uncertain bans must retain existing retry restrictions and expose the correct request/finalization details. Never automatically re-execute an action after refresh.

If another moderator changes the record, show the new status without automatically opening another item. Re-evaluate available decisions and close a now-invalid confirmation with a concrete explanation. A locally pending request keeps its target identity until reconciled.

## Continuing review

Do not advance automatically on submission or completion. Keep the result in the selected detail until the moderator chooses Next item or returns to the queue. Then remove resolved work from the pending view and refresh counts. With no remaining work, render one empty state.

Encode the selected item, named view, search, filters and sort in validated inbox URL parameters. Store only scroll/focus restoration metadata in per-tab browser history or session storage, keyed by guild and view. Do not store evidence, reasons or bulk mutation selections there. Preserve native modified-click and browser Back behavior. Use an internal return descriptor, not an arbitrary redirect URL.

On return, restore the selected row if it still exists. If it has resolved, continue with the next surviving item in the captured filtered ordering, then the previous item, then the first current match. New arrivals do not take over the review in progress. Empty or invalid views fall back predictably. Use this same continuation rule for Next item. Restored focus must remain visible beneath sticky controls.

## Component and state ownership

| Owner                                   | Responsibility                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Shared workspace shell                  | Brand, server/account navigation, theme, responsive frame and shared tokens                        |
| Inbox route and queue controller        | Authorized summaries, validated URL state, selected-record loading and return context              |
| Item-specific detail composition        | Concrete evidence and permitted actions for one record kind                                        |
| Source reader                           | Saved records, source grouping, context access and reading navigation                              |
| Decision controller                     | Confirmation, reason draft, submission and durable receipt reconciliation for an identified target |
| Existing server actions/adapters/worker | Policy, current eligibility, effects, persistence and idempotency                                  |

Promote the reusable foundation pieces into stable `workspace`, `inbox` and `cases` modules. Keep experiment-only chronology/layout-switch stories separate from the production composition. Storybook imports the same components used by routes. Remove superseded UI and styles as callers migrate; do not maintain two moderator applications or add compatibility wrappers for unpublished component APIs.

Keep Next.js, React, TypeScript, CSS modules, existing contracts, Vitest, Playwright and Storybook. No new UI framework, state library, backend rewrite or schema migration is proposed. Use existing theme preference and commissioned artwork. Defaults come from the server where they express moderation policy.

## Delivery sequence and release boundary

1. Promote the approved tokens, shell, evidence presentation and confirmation components. Establish the mixed inbox row/detail composition in Storybook using current contract-backed fixtures.
2. Wire the new inbox and case detail page to authorized record loaders, including the on-demand conversation reader. Implement URL state and return navigation together.
3. Connect real actions and durable results, including relevant security, quarantine and cleanup controls. Remove superseded inbox/case renderers once all callers use the replacements.
4. Verify the complete ordinary journey and publish updated screenshots for review. Release this coherent moderation slice when its required checks pass.

Subsequent slices replace History and member review, then setup/onboarding and Operations, then public reporting/security-check presentation and the public landing page. Prioritize these by the next actual user journey, and design their contents before implementing them. Shared navigation must keep working destinations during this sequence. Temporary older pages may receive the shared shell, but their layout does not constrain their eventual replacement.

No live moderation, deployment or merge is part of this design task. The implementation plan follows review of this document.

## Verification and acceptance

- An ordinary report can be reviewed and dismissed with confirmation from the inbox. Its closure updates the queue without a stale receipt or duplicate empty heading.
- Opening a case is shown as a request until an actual case exists. The resulting investigation uses that case's real sources and capabilities.
- A moderator can read a source in channel context, return to it and use a confirmed action without losing their place.
- Reloading a queued request reconnects to its durable receipt. Completion refreshes actual record state, and failures retain reasons and follow existing retry restrictions.
- Returning to the inbox preserves the active view, filters and position. Selection and delayed loads never target a different member by accident.
- All six inbox kinds have truthful rendering and working permitted destinations; they do not need six new visual concepts.
- Security checks, quarantine and cleanup remain usable for records that support them, including server reason policy and partial-result handling.
- Keyboard navigation, visible focus, absolute/relative timestamps, light/dark themes and reflow work at 320px and desktop widths. Keep the existing approved 390px and 1440px screenshots as visual references.
- Add meaningful unit tests for state/data boundaries and browser tests for the new full journey. Update superseded visual expectations deliberately. Run the repository's required checks before merge; no broad new stress-fixture project is required.

## Source grounding

- `packages/contracts/src/inbox.ts` defines six kinds and their allowed action identifiers. `apps/web/lib/moderationInboxDataAdapter.ts` supplies summaries from cases, reports and attention records.
- `apps/web/lib/activeCaseDataAdapter.ts` loads case evidence and up to 10 unexpired recent member messages, scoped to server/user rather than a continuous channel conversation.
- `apps/web/lib/caseDiscordContent.ts` supplies a live source message and case thread snapshots. `apps/web/lib/discordApi.ts` has authenticated bot message reads, but its existing list helper walks recent history rather than a source-centered window.
- `apps/web/app/admin/guild/[guildId]/cases/actions.ts` and corresponding inbox/report actions enforce session, guild and policy checks before queueing effects.
- `apps/web/lib/inboxActionState.ts`, `inboxActionReceipts.ts` and `components/inbox/InboxActionRequestPoller.tsx` implement durable reconciliation and polling worth reusing.
- `apps/web/components/cases/foundation/CaseLayoutStudy.tsx` is the approved visual composition, but still contains simulated decisions and placeholder community identity.
- `docs/workflow.md`, `docs/cases.md` and `docs/design/review-journey-exploration.md` document case semantics, context retention and partial/uncertain action outcomes.
