# Moderation Permission Policy

Discord does not expose a `Manage Members` permission. Drasil uses Discord's
`ModerateMembers` permission for staff who can open cases, and reserves
`KickMembers` and `BanMembers` for destructive member actions.

## Staff-facing actions

| Surface                                               | User permission                    | Bot permission or config                                                                        | Notes                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Open Case` user context action                       | `ModerateMembers`                  | Case role requires `ManageRoles` and role hierarchy                                             | Opens the reason modal before applying the case role.                                                                                                                      |
| `Open Case` message context action                    | `ModerateMembers`                  | Case role requires `ManageRoles` and role hierarchy                                             | Preserves the selected message as case source evidence.                                                                                                                    |
| `/case open`                                          | `ModerateMembers`                  | Case role requires `ManageRoles` and role hierarchy                                             | Uses a confirmation button before opening the case.                                                                                                                        |
| `/case repair`                                        | `Administrator`                    | Thread and role permissions as needed                                                           | The slash command is visible to `ModerateMembers` because Discord scopes default permissions to the whole `/case` command; runtime checks keep this subcommand admin-only. |
| `/case refresh`                                       | `Administrator`                    | Admin notification access                                                                       | Runtime admin-only for stored case notification repair.                                                                                                                    |
| `/case intake-role`                                   | `Administrator`                    | Case role requires `ManageRoles` and role hierarchy                                             | Bulk case opening remains admin-only.                                                                                                                                      |
| `Ban User` user/message context action                | `BanMembers`                       | `moderator_ban_action_enabled`; bot needs `BanMembers`                                          | Opens a reason modal, then a second confirmation modal before banning.                                                                                                     |
| `Kick User` user/message context action               | `KickMembers`                      | `moderator_kick_action_enabled`; bot needs `KickMembers`                                        | Opens a reason modal, then a second confirmation modal before kicking.                                                                                                     |
| Case/observed ban buttons                             | `BanMembers`                       | `moderator_ban_action_enabled`; bot needs `BanMembers`                                          | Uses a ban reason modal.                                                                                                                                                   |
| Case kick buttons                                     | `KickMembers`                      | `moderator_kick_action_enabled`; bot needs `KickMembers`                                        | Uses a kick reason modal before resolving pending cases as kicked.                                                                                                         |
| Observed kick buttons                                 | `KickMembers`                      | `observed_action_kick_enabled`; bot needs `KickMembers`                                         | Uses a kick reason modal before actioning the observed alert.                                                                                                              |
| Case verify, close, repair, reopen, history           | `ManageGuild` or `ModerateMembers` | Varies by action                                                                                | Existing admin-action menu behavior.                                                                                                                                       |
| Observed open case, dismiss, false positive, history  | `ManageGuild` or `ModerateMembers` | Varies by action                                                                                | Existing observed-alert action behavior.                                                                                                                                   |
| `/ban`                                                | `BanMembers`                       | `moderator_ban_action_enabled`; bot needs `BanMembers`                                          | Uses a confirmation button before banning.                                                                                                                                 |
| `/audit`                                              | `ManageGuild`                      | None for read-only checks; repair actions depend on target                                      | Runtime also enforces `ManageGuild`.                                                                                                                                       |
| `/flaguser`                                           | `Administrator`                    | Case role requires `ManageRoles` and role hierarchy                                             | Legacy manual suspicious-user flow; not broadened in this audit.                                                                                                           |
| `/config`, `/setupverification`, `/setupreportbutton` | `Administrator`                    | Setup-specific permissions                                                                      | Server configuration stays admin-only.                                                                                                                                     |
| `/close-report` in report intake threads              | Reporter or staff context          | Report-intake staff can be `ManageGuild`, `ModerateMembers`, or configured case responder roles | Role fallback is intentionally limited to report-intake thread moderation, not case opening.                                                                               |

## Reason policies

These guild settings control whether the reason field is optional or required:

| Setting key                             | Applies to                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `admin_case_open_requires_reason`       | `Open Case` context actions, `/case open`, and executed role-intake case opens. |
| `moderator_ban_action_requires_reason`  | Native ban actions, case/observed ban buttons, and `/ban`.                      |
| `moderator_kick_action_requires_reason` | Native kick actions and case/observed kick buttons.                             |

`observed_action_ban_requires_reason` is preserved as a legacy alias for the
shared ban reason policy so existing guild settings keep their behavior.

## Product notes

- Native action command visibility is only a Discord-level hint. Every action
  still re-checks permissions at execution time.
- Case responder roles control who is notified or added to case/report review
  threads. They do not grant case-opening permission.
- For selected-message case opens, Drasil keeps the latest
  `source_channel_id`/`source_message_id` fields for existing renderers and also
  appends unique entries to `source_messages` for later evidence rendering.
