# Case workspace exploration

This extends the approved flat grey inbox into the investigation view for an opened case. It is an isolated Storybook composition, with injected action handling and no production route or moderation endpoint changes.

Run `npm --workspace apps/web run storybook` and open **Design foundation → Case workspace → Everyday case**. Busy case exercises saved message context and multiple checks. Light, Failed request, Delayed request and Completed request isolate presentation and request states. Reload a story to reset it.

## Layout choice

Two sketches compared a reading-led page with a split evidence/activity layout. The reading-led page keeps source text at a useful width and gives short cases less structural overhead. The same column holds evidence, checks and recorded activity; secondary context expands in place. Member state stays above the source material. A sticky Case sections navigation row beneath the header links to Evidence and Decision. Section headers retain their titles without separate right-aligned jump links. Anchor destinations account for the navigation height and receive keyboard focus.

The existing transparent commissioned logo, Manrope, semantic action colors, theme tokens and mobile workspace navigation are reused. Cases is the active workspace destination. Route links keep their existing application destinations; the standalone prototype does not implement those pages.

The composition refinement addresses the user's feedback that the sidebar/content relationship and top spacing felt disconnected. The reading column now starts 32px after the navigation boundary on desktop, with a distinct neutral content background. A shared location strip sits above the compact identity/context header. The date stays near the name, and member facts and links share a row where space permits. On phones the existing location row retains the Case label. Related section gaps are smaller. A top-navigation study was compared and rejected because it lost server context and moved global navigation away from the content alignment. The standalone preview's controls collapse outside the product canvas so they do not dominate phone screenshots.

Every timestamp pairs the absolute UTC date/time with its relative age, including the opening time, saved sources, checks, activity and record details. The shared Timestamp component uses one clock per Foundation, updated once a minute. Machine-readable dates remain available. Server and initial client rendering use the same absolute value; relative ages start after hydration. The timer is removed when the foundation unmounts. Missing timestamps retain their existing unknown state.

## Data and provenance

| Presentation                                                        | Source                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Identity, presence, case metadata and allowed decisions             | `CaseDetail`                                                             |
| Current case-role state                                             | A supplied `MemberProfile` matching both guild and user                  |
| Original report statement, screenshot attachment and identification | A supplied `ReportDetail` matching guild, target user and `latestCaseId` |
| Additional saved evidence                                           | `CaseDetail.evidenceItems`                                               |
| Saved source/surrounding message excerpts                           | `CaseDetail.messageContext`                                              |
| Drasil checks and their confidence                                  | Non-report entries in `detectionHistory`                                 |
| Recorded outcomes, actors, reasons and event dates                  | `moderationOutcomes`                                                     |
| Local request receipt                                               | Injected decision handler result                                         |

Quoted content stays complete and unchanged. A screenshot/attachment item with a URL is one native link covering its heading, caption and file metadata; hover and focus indicate the click target. It opens in a new tab without a separate Open attachment link. Missing attachment URLs remain non-interactive. Saved excerpts retain that label because the contract supplies previews, not complete live messages. Records pointing to the same source URL stay together without discarding either saved representation. Older surrounding messages and checks are disclosures; primary statements remain expanded. Detection confidence is labeled as check confidence. Recorded outcomes do not establish current role state. Request receipts receive no invented event timestamp.

The ordinary fixture represents a case after opening has completed. It reuses the inbox report's submitted material and supplies an explicit current case-role state. It does not turn the inbox's queued Open case receipt into a completed case. Busy case adapts the existing `case-stale` fixture, preserves its source quotations/checks/outcome, and adds ten synthetic saved replies solely to exercise density. Shared protection data is absent from the current case contract and is omitted from this exploration.

## Decisions

The prototype covers Verify member, Close case, Kick member and Ban member, filtered by `allowedActions`. Every mutation opens an inline confirmation identifying member name, member ID and case ID. Verification and closure disclose their scope across all open cases for that member in the server and attempted restoration of eligible quarantined roles. A plain ban requests no message deletion. Kick and ban accept an optional reason.

Cancel restores the trigger. Submission prevents conflicting decisions. A queued/processing request preserves the loaded member state and source access. A delayed response preserves focus when the moderator has resumed reading. Completion is labeled as request completion, with the displayed member state identified as the last loaded snapshot. Full request reconciliation and refreshed case state remain production-integration work.

Account quarantine, security checks, maintenance operations, message cleanup, cross-case history aggregation and live Discord reads retain their existing production workflows. This prototype does not replace those controls or add permissions.

## Verification

`npm --workspace apps/web run test:storybook:visual -- case-workspace.spec.ts report-inbox.spec.ts` exercises both compositions. Case coverage includes original source access, shared source grouping, dense-context navigation, all decision confirmations and cancellation, queued/completed request semantics, delayed-response focus, and accessibility/reflow in both themes at 320px and 1440px. Also inspect the exported React composition at 390px and 1024px, including expanded context. Web typecheck, lint, unit tests and the static Storybook build apply.

## Bounded layout comparison

**Design foundation → Case layout comparison** holds two alternatives using the same unchanged `busyCase` fixture. Source desk groups saved representations of the same source. Its actions sit in a compact bar beneath the identity header; checks and recorded activity keep the right column. The action bar stays available while reading and returns to normal document flow when a confirmation or receipt expands. Case chronology displays source excerpts, saved evidence, checks and recorded outcomes by their recorded times. Matching source labels connect repeated records of one source. Both preserve full quotations, surrounding-message disclosure, absolute/relative dates and existing decision confirmations. Decisions simulate queued receipts locally; no live action adapter is connected. The existing Case workspace remains unchanged.

An image-generated concept sheet informed the alternatives; invented avatars, quotations and event times in that image were discarded. The working mockups are React compositions, with dark/light Storybook stories and a standalone A/B comparison. A short UX review led to explicit source relationships in the chronology, removal of a generic legend, and checks preceding decisions when the source layout stacks on phones. The user selected Source desk as the direction. Its next refinement moves actions above the reading area, giving recorded activity more room in the right column.

The first Source desk implementation reused the old evidence renderer and diverged from the selected image concept. The fidelity correction adds a dedicated SourceDesk composition: a local evidence index, flat message blocks, visible surrounding excerpts and an expanded moderation-history section in the right column. Records from the same URL remain grouped. Icons describe record type without inventing authors or avatars. Full activity and case notes remain available in disclosures. The requested top action bar is retained.

The detail pass compares the rendered view directly with the selected image: compact source rows with current-location markers, quieter dividers, distinct generic record icons, shorter text measure and continuous conversation rows. The actual source excerpt is highlighted within its saved chronological context, using its existing ID and URL. Compact index clocks retain relative ages, with the full UTC timestamp on hover and in `datetime`. A focus/scroll observer keeps the source index tied to the current reading location.

Conversation navigation is a collection, not a per-message menu. The source index has one Conversation entry alongside the source records. The source's View conversation link focuses its highlighted excerpt within the chronological stream; all saved messages remain visible together. Per-message index entries and their styling were removed. The conversation count includes the source message, and the same saved message remains identified as the source rather than becoming another independent piece of evidence.

### UX/UI review — 2026-10-22

An independent reviewer inspected the current screenshots and exercised the exported React composition at 1440px, 390px and 320px. No P1 blockers were found. The review identified three P2 recommendations:

- Add mobile jumps to Checks and Moderation history; both currently follow the entire saved conversation.
- Add a Back to source link at the Conversation heading. The current jump does not update browser history, and the mobile source index scrolls away.
- Retain the member name in the sticky action bar once the identity header leaves the viewport. Confirmations already include member and case identity.

Preserve the flat grey composition, severity colors, single Conversation entry, chronological stream and source highlight. Missing author identities and channel names are data-contract limitations; do not invent attribution to complete the design.

The navigation follow-up implements all three: mobile Checks and History links focus the actual section headings, Conversation has a Back to source link that remembers its originating source, and the sticky command bar shows the member name/ID once the identity header leaves view. The measured command-bar height determines anchor offsets so focused content stays visible when the mobile identity row appears. Confirmations and receipts expand in normal document flow. Browser verification covers both themes at 1440px, 1024px, 390px and 320px, including the new return path, section jumps, sticky identity, focus visibility and existing action confirmations.

The reviewer rechecked the follow-up at 1440px, 390px and 320px. The conversation jump also reserves its heading height so Back to source stays visible and clickable beneath the sticky bar. The return link restores focus to the original source heading; no findings remain in that reviewed flow.
