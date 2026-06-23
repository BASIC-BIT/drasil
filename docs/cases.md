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
- `verified`: the case was resolved as legitimate, and the case role was removed.
- `banned`: the case was resolved by banning the user.
- `closed_no_action`: the case was resolved without verifying or banning the user.

Additional product labels such as `duplicate`, `needs_more_info`, or
`false_report` should be added only when a concrete UI or moderation workflow
requires them.

## Case Role State

`pending` cases always use the configured case role plus a normal user-visible
verification/case thread. The current database still stores this as
`servers.case_role_id` and `server_members.case_role_active`, but product
behavior treats that state as active-case access control rather than a separate
case-role/no-case split.

## Case Entry Points

- Suspicious message or join: records the detection result. Server response
  settings can leave it as record/notification only or open a case by applying
  the case role and creating a user-visible thread.
- User report: creates a `user_report` detection event. The default path is a
  moderator-facing observed alert; configured report-intake escalation or
  moderator actions can create or reuse a pending case.
- Manual flag: creates a detection event with `metadata.type = "admin_flag"` and
  creates or reuses a pending case.
- Honeypot role assignment: when role gate is enabled and a member newly receives
  the configured honeypot role, Drasil creates a `honeypot_role` detection and
  applies the configured honeypot response mode.

If the target user already has a pending case in that server, Drasil records the
new detection event, links it to the existing `verification_event`, and updates
the existing admin notification instead of opening a duplicate case. If the
previous case is resolved, a later report or flag opens a new pending case.

## Role-Gate Resolution Cleanup

When role gate is enabled, verify and close-no-action confirmations include the
role effects that will happen with the resolution. Drasil removes a configured
honeypot role if the member currently has it or if role quarantine already
removed it, and adds the configured member access role when present. This is part
of the same confirmed case action, not a separate follow-up button.

## Schema Decision

Use `verification_events` as the local case model for now. A separate `cases`
table should be considered only if Drasil needs richer case types that do not
map to a user/server verification lifecycle, such as cross-server intelligence
cases, multi-user incidents, evidence-only investigations, or global review
workflows.
