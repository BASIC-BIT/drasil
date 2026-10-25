# Moderation data presentation: exploration 04

Status: design exploration, not implementation approval.

The user prefers the flatter inbox, neutral greys and the transparent commissioned logo. This pass adds subtle pane boundaries and tests a denser information hierarchy alongside the original composition.

## Artifacts

- [Original inbox with refined separation](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=3-83).
- [Dense case: review](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=9-60).
- [Dense case: evidence](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=9-172).
- [Dense case: mobile](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=10-118).
- Interactive, self-contained study: `/workspace/artifacts/drasil-foundation/drasil-design-playground.html`. Choose **Dense case** and switch between Review, Evidence and Activity.

The dense study uses the fields and sample values of `fixtureCaseDetails[0]`, with a generic display label. It has two submitted evidence items, two saved message-context items, two detections and one recorded moderation outcome. It does not imply those are independent confirmations.

## Hierarchy to evaluate

| Moderator question                 | First view                                       | Deeper information                             | Current source                                                             |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------- |
| Why is this in my queue?           | Short reason, item type and relevant age         | Detection reasons and original report          | Inbox item, case/report detail                                             |
| What is true about the member now? | Member/case state and any urgent blocker         | Quarantine effects, security-check history     | `presenceState`, `containmentStatus`, `attentionState`, `captchaChallenge` |
| What has already happened?         | Last recorded action, explicitly labeled as such | Separate detections and recorded outcomes      | `lastActionType`, `lastActionAt`, `moderationOutcomes`, `detectionHistory` |
| What supports the concern?         | A source-labeled excerpt                         | Full typed evidence and surrounding context    | `evidenceItems`, `messageContext`, report `evidence`                       |
| Is the information current?        | Relevant age and stale-state explanation         | Absolute timestamp and source freshness        | `updatedAt`, `latestDetectionAt`, live Discord snapshot metadata           |
| What can I do?                     | Applicable next action and any pending request   | Consequential choices with reason/confirmation | Existing allowed actions, permissions and action-request lifecycle         |
| Which exact record am I viewing?   | Readable identity and server context             | Copyable IDs and full timestamps               | User identity, case/report ID, guild ID                                    |

The first screen should answer the first few questions without requiring a tour through every field. Deeper views must retain source context and critical state.

## The current proposal

The information tabs now sit directly beneath the member identity, before the persistent attention message. This ties navigation to the selected record. Labels and counts share the same text size and line height, with consistent 44-pixel tab heights and one underline/divider. Desktop, evidence and mobile frames use the same component treatment. The interactive study retains arrow-key tab navigation; the revised layout was checked at 320, 390 and 1440 pixels in both themes.

**Review** holds the reason for review, current state, last recorded action and key source. It should help a moderator orient, not make the moderation decision for them.

**Evidence** holds member-submitted accounts and material with source/type labels. Saved surrounding messages are a separate disclosure. A submitted account, saved snapshot and fresh Discord read must remain distinguishable. Keep the full content available; do not use excerpts as the only way to inspect evidence.

**Activity** holds a chronological account of detections and outcomes. Label each event's nature and actor. A detection, a requested action and an executed action are different things. The current sample demonstrates detections and one recorded outcome; queued/failed action states still need their own design studies.

**Record details** discloses IDs and exact timestamps. It is supplementary information rather than a grid that competes with the source evidence.

The sidebar and queue stay visible on desktop. A continuous one-pixel boundary distinguishes the queue from the reading pane. Neutral surface levels and spacing provide the remaining separation. The mobile design uses list/detail navigation rather than compressing both panes.

## Rules that should survive iteration

- Do not put a containment failure, expired check that blocks an action, unknown member state or pending action request only inside an inactive tab. Critical state must remain visible where a decision is made.
- A last recorded restriction does not independently establish the member's current role/access state. Label historical actions as historical.
- Age labels must say what is aging. The fixture's 48-hour age is time since queue update, not a verified deadline or time since the last moderator review.
- Counts describe objects in a named collection. Two detections concerning one message do not establish two independent sources. Do not sum unlike records into a threat score.
- Detection confidence describes the check's output. It does not establish a policy violation or the probability of guilt.
- A missing source is an explicit state. A saved snapshot is useful, but must not silently stand in for a live message.
- Unavailable actions need a useful explanation. Pending requests need an accurate status rather than an optimistic success treatment.
- Filters and saved views should reduce queue work without silently losing the selected item's context. The prototype explicitly labels a selected item that is outside the current filter; this behavior still needs usability review.
- Use time in the operator's locale with an explicit timezone and accessible absolute time where relevant. The current fixed sample uses Indianapolis time.
- Context and source links remain close to the evidence they describe. Avoid a generic links bucket that forces users to reconstruct the relationship.

## Direct action exploration

The generic **Review case** CTA was a placeholder in the redesign. Production already exposes permitted case actions inside `ModerationInboxView` through `CaseActionControls`; `view_case` separately follows `detailHref` to the case detail page. Preserve that direct workflow in the redesign.

The dense case now exposes **Verify member**, **Close without action**, **Kick** and **Ban** without navigating away. These match this fixture's `allowedActions`, not a universal list for every item. Maintenance tools and the optional full case destination are secondary. Action colors follow the user’s requested severity progression: mint for Verify member, neutral grey for Close without action, amber for Kick member and red for Ban member. Text and borders carry the color while the flat surface remains unchanged. Labels remain explicit, and confirmation controls carry the matching tone. New Positive, Warning and Danger button variants share the existing editable label property; the danger token has dark and light values. The browser study’s action text contrast exceeds 7:1 in both themes.

- [Inline ban confirmation](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=18-164).
- [Queued ban request](https://www.figma.com/design/fIM6hUL8tQ0hadf7DdjM6I?node-id=18-275).
- The offline playground's **Dense case** scenario supports all four action previews, cancellation, a queued receipt and reset. It sends no requests.

Confirmation stays inline with the evidence and identifies the member and effect. The action area stays outside the tab panels. A queued receipt does not remove the case or mark the member banned. Block conflicting submissions while pending; keep reading and source inspection available. Only confirmed completion should update the outcome. Failure/recovery and completed-next-item states are now explored in [the complete review journey](review-journey-exploration.md).

Do not equate closing a case with acknowledging a notification. `closeCaseNoAction` can remove the case role and restore quarantined roles for a standard case; it rejects compromised-account quarantine release. Verification also changes access. These actions need accurate effect copy even if the final interaction uses fewer confirmation steps. Routine report dismissal and queue acknowledgment should not inherit an unnecessary case-confirmation flow.

The current prototype demonstrates confirmation for all four access-changing case outcomes. Confirmation requirements, reason requirements, and available actions must ultimately follow actual state and policy. Also inspect the scope before implementation: moderation services can resolve multiple pending events for the same member, so a single-case label must not conceal wider effects. Ban with message cleanup needs a separate scoped preview before deletion; this study does not add deletion to a standard ban.

Verified all four preview flows at 320, 390 and 1440 pixels in both themes, including cancel focus restoration, required confirmation, pending receipt persistence across tabs, unchanged case-open status, and no horizontal overflow or network requests. Figma compositions were checked for clipping and retain editable Manrope text and the commissioned logo. No production behavior changed.

## Next stress tests

| Case                                                        | What to evaluate                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Many mixed queue items                                      | Scan speed, priority explanation, repeated identity, filters and keeping place        |
| Long messages and many attachments                          | Reading width, source navigation, attachment provenance and full-content access       |
| Live message missing, saved context present                 | Whether freshness and provenance are understood                                       |
| Incomplete containment or unknown member state              | Whether the blocker remains obvious in every information view                         |
| Queued, failed and stale action requests                    | Whether moderators understand what has and has not executed                           |
| Report, observed alert and active case for similar activity | Whether the information structure preserves the different policy meanings             |
| Returning after another moderator acts                      | Stale selection, changed actions, conflict handling and the new outcome               |
| Mobile, zoom and keyboard-only review                       | Reachability of evidence/actions, reading order, tab navigation and focus restoration |

Keep the existing simple composition as a comparison. The denser study is a hypothesis to test, not a requirement to add tabs to every page. Future Storybook work should use these concrete states to evaluate reusable patterns before route adoption.
