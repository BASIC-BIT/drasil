# Test Cases

## Manual regression checks

For a real-server walkthrough, use `docs/manual-qa.md`.

- Suspicious message: user gets restricted, verification thread auto-created, admin notification sent.
- Additional suspicious message while pending: no new verification event; notification updated.
- New suspicious message after verification resolved: new verification event and new notification message.
- Suspicious join: same flow as suspicious message.
- Manual flag: creates a detection event with admin flag metadata and follows the same case flow.
- User report without an active case: creates a detection event with `USER_REPORT` and posts an observed alert with moderator actions.
- User report with an active case: records a new detection event and reuses the existing case.
- Manual flag while pending: records a new detection event but reuses the existing case.
- Repeated pending-case reports/flags link the new detection event to the reused case.
- User report after resolution: posts a new observed alert instead of reopening a case automatically.
- Manual flag after resolution: opens a new pending case.
- Verify button: restricted role removed, thread resolved, notification updated, admin action logged.
- Verify button with role gate: honeypot role is removed or kept removed from quarantine, member access role is added when configured, and confirmation/result copy names the roles.
- Ban button: member banned, verification status set to BANNED (if present), thread resolved, admin action logged.
- Reopen button: verification returns to PENDING, thread reopened, user restricted again.
- Stale case digest: groups pending cases into fresh, stale, and very stale; very stale users remain pending for moderator review.
- User-facing support reminder: pings only the target user in their verification thread, not admins, and stops after the target replies or reaches the very-stale day threshold.

## Automated tests (high-signal, easy to maintain)

- `SecurityActionService.handleSuspiciousMessage`
  - Creates `detection_event` if `detectionEventId` is missing.
  - Creates `verification_event` and restricts user when none exists.
  - Creates a verification thread and upserts the admin notification.
- `SecurityActionService.handleSuspiciousMessage` with active verification
  - Does not create a new `verification_event` or thread.
  - Updates the admin notification only.
- `SecurityActionService.handleUserReport`
  - Creates `detection_event` with `detection_type = USER_REPORT` and reporter metadata.
  - Posts an observed alert when no active case exists.
  - Reuses an existing pending `verification_event` instead of creating a duplicate case.
  - Links repeated reports to the reused pending `verification_event`.
  - Posts a new observed alert after a previous case was resolved.
- `SecurityActionService.handleManualFlag`
  - Creates `detection_event` with admin flag metadata.
  - Reuses an existing pending `verification_event` instead of creating a duplicate case.
  - Links repeated manual flags to the reused pending `verification_event`.
- `UserModerationService.verifyUser`
  - Updates `verification_event` to VERIFIED with `resolved_by` and `resolved_at`.
  - Removes restricted role and updates `server_member`.
  - Applies role-gate cleanup when configured.
  - Resolves thread, updates notification, records admin action.
- `UserModerationService.banUser`
  - Calls Discord ban and updates `server_member` to BANNED.
  - Updates `verification_event` and resolves thread when one exists.
- `CaseReviewReminderService`
  - Sends one grouped admin digest per repeat window.
  - Shows next user reminder timestamps using the same scheduling logic that sends reminders.
  - Moves user reminders to the end of the admin review window when they collide with a digest.
  - Stops user reminders after target response or the very-stale reminder limit.
- `RoleGateService`
  - Supports honeypot-only, member-access-only, and combined role-gate setups.
  - Removes/keeps removed the honeypot role during verify and close-no-action.
  - Adds the member access role during verify and close-no-action when configured.
  - Reports role hierarchy, managed role, missing role, and same-role diagnostics.
- `EventHandler` honeypot role update
  - Routes newly assigned configured honeypot roles through the configured response mode.
  - Ignores disabled role gate, missing honeypot roles, bots, and unchanged role sets.
- `RoleQuarantineService`
  - Does not restore a configured honeypot role because role gate owns that role.

## Role gate

- Disabled role gate: role updates do not trigger honeypot handling and verify/close copy is unchanged.
- Honeypot only: gaining the configured honeypot role records/routes a honeypot detection; verify/close removes the role.
- Member access only: verify/close adds the configured member access role when permissions allow it.
- Honeypot plus member access: gaining honeypot routes the detection; verify/close removes honeypot and adds member access.
- Quarantined honeypot: verify/close does not restore the honeypot role from role quarantine.

## Full-stack smoke test (optional)

- Use a dedicated staging Discord server and bot token.
- Prefer the deterministic steps in `docs/manual-qa.md` over ad hoc message spam.
- Script a message that triggers suspicion, then verify and ban via interactions.
- Assert database state and notification updates.
- Run manually or nightly (not ideal for every PR due to external deps).

## CI gates (minimal set)

- `npm run build`
- `npm run test`
- `npm run format:check`
- `npm run lint`
