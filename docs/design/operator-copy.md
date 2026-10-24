# Operator copy

Write for an experienced Discord moderator working through a queue. Copy should supply a concrete concern, source, state or consequence. An instruction earns space when the moderator needs to do something specific, such as restore a missing permission.

## Use facts and structure

| Avoid                                                                                                                                         | Prefer                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| “A member submitted a report about repeated links in a public channel. The report is a signal for review; it does not establish a violation.” | “Repeated unsolicited links reported in #general.”                                                                      |
| “Member report · Illustrative content”                                                                                                        | Remove a repeated source label. Where it adds information, use “Source link saved.”                                     |
| “Report received” below the member name                                                                                                       | Omit the redundant badge. Show “Reported 10m ago” as the event time. A dated intake event can still belong in Activity. |
| “These are not 14 independent sources.”                                                                                                       | Name the collections, distinguish origins and expose the underlying records.                                            |
| “No action shown in this study”                                                                                                               | “No action recorded” only where the absence is useful and accurately describes the record. Otherwise omit the row.      |
| “Design exploration · Sample data · No live moderation actions” inside each case                                                              | One preview notice outside the product canvas.                                                                          |
| “Queue verify member”                                                                                                                         | “Queue verification”                                                                                                    |
| “Sample member D resolved”                                                                                                                    | “Sample member D banned · Case resolved”                                                                                |

Do not paste design rationale or general moderation education into case summaries. Provenance, source availability, event types and relevant timestamps should make the distinctions visible. Optional help is the place for general explanations of confidence or evidence interpretation.

Preserve submitted reports, messages and member replies verbatim. These rules apply to interface-authored summaries, labels and metadata, not to source quotations. The copy audit left the sample source quotations unchanged.

## Brevity must preserve meaning

- Every moderation action requires confirmation before changing state. Name the action on the submit button and describe its concrete effect. Cancel preserves the record and returns focus to the trigger. Navigation, search and evidence disclosure remain immediate.

- An action confirmation must match the operation's actual scope. Verification and closure can resolve multiple open events for the member and attempt restoration of eligible quarantined roles. Do not imply only one case changes when the service can change more.
- “No message deletion requested” describes the chosen action. It does not claim that messages still exist or that another actor did not delete them.
- “No action recorded” does not mean no action occurred. Likewise, a missing timestamp is “Not recorded,” not another event's timestamp relabeled as an update time.
- “Preview unavailable” describes attachment availability. It does not assert authenticity or explain the prototype's implementation.
- Failed, queued and completed request states need accurate effects. Keep “Ban not attempted” only for an established failure before execution; unknown or partial outcomes require different copy and recovery.

## Review performed

An independent UX-writer subagent reviewed the exploration as an experienced Discord moderator, then reread the revised sources. Its review led to removal of repeated prototype notes, intake badges, source labels, non-case state rows and redundant activity bodies. It also caught incorrect closure scope, generated submit-label grammar, timestamp semantics and wording that described a person as resolved.

Applied to the editable Figma frames and the isolated playground. The preview controls remain outside the product canvas. This is an ongoing voice standard, not final approval of every label; “Close without action” still warrants a naming decision because the operation can change roles and access.
