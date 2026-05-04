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

Additional product labels such as `duplicate`, `needs_more_info`,
`resolved_no_action`, or `false_report` should be added only when a concrete UI
or moderation workflow requires them.

## Case Entry Points

- Suspicious message or join: creates or reuses a pending case based on the
  detection result.
- User report: creates a `user_report` detection event and creates or reuses a
  pending case.
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
