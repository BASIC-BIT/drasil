# Moderation Cases

Drasil currently treats `verification_events` as local moderation cases. A
separate `cases` table is not needed yet because the existing model already
captures the near-term lifecycle for one user in one server.

## Current Model

- `verification_events` is the case record for a user in a server.
- `detection_events` records why the case was opened or updated.
- `admin_actions` records moderator lifecycle actions against the case.
- Discord verification threads and admin notifications are case surfaces.

## Statuses

- `pending`: the case is open and needs moderator review.
- `verified`: the case was resolved as legitimate, and the user was unrestricted.
- `banned`: the case was resolved by banning the user.
- `closed_no_action`: the case was resolved without verifying or banning the user.

Additional product labels such as `duplicate`, `needs_more_info`, or
`false_report` should be added only when a concrete UI or moderation workflow
requires them.

## Restriction State

`pending` cases can be restricted or unrestricted. Restriction is tracked on the
server member and can change while the case remains open:

- Restricted cases use the configured restricted role and a normal user-visible
  verification/case thread.
- Unrestricted cases are still normal cases with a user-visible thread; they are
  not moderator-only report review workspaces.
- Moderators can use case actions to restrict the user or lift restriction
  without moving the case to a terminal status.

## Case Entry Points

- Suspicious message or join: records the detection result. Server response
  settings can leave it as record/notification only or restrict the user; there
  is no automatic open-case-without-restriction mode for these detections.
- User report: creates a `user_report` detection event. The default path is a
  moderator-facing observed alert; configured report-intake escalation or
  moderator actions can create or reuse a pending case.
- Manual flag: creates a detection event with `metadata.type = "admin_flag"` and
  creates or reuses a pending case.

If the target user already has a pending case in that server, Drasil records the
new detection event, links it to the existing `verification_event`, and updates
the existing admin notification instead of opening a duplicate case. If the
previous case is resolved, a later report or flag opens a new pending case.

## Schema Decision

Use `verification_events` as the local case model for now. A separate `cases`
table should be considered only if Drasil needs richer case types that do not
map to a user/server verification lifecycle, such as cross-server intelligence
cases, multi-user incidents, evidence-only investigations, or global review
workflows.
