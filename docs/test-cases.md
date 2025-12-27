# Test Cases

## Manual regression checks

- Suspicious message: user gets restricted, verification thread auto-created, admin notification sent.
- Additional suspicious message while pending: no new verification event; notification updated.
- New suspicious message after verification resolved: new verification event and new notification message.
- Suspicious join: same flow as suspicious message.
- Manual flag: creates a detection event and follows the same flow.
- User report: creates a detection event with `USER_REPORT` and follows the same flow.
- Verify button: restricted role removed, thread resolved, notification updated, admin action logged.
- Ban button: member banned, verification status set to BANNED (if present), thread resolved, admin action logged.
- Reopen button: verification returns to PENDING, thread reopened, user restricted again.

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
- `UserModerationService.verifyUser`
  - Updates `verification_event` to VERIFIED with `resolved_by` and `resolved_at`.
  - Removes restricted role and updates `server_member`.
  - Resolves thread, updates notification, records admin action.
- `UserModerationService.banUser`
  - Calls Discord ban and updates `server_member` to BANNED.
  - Updates `verification_event` and resolves thread when one exists.

## Full-stack smoke test (optional)

- Use a dedicated staging Discord server and bot token.
- Script a message that triggers suspicion, then verify and ban via interactions.
- Assert database state and notification updates.
- Run manually or nightly (not ideal for every PR due to external deps).

## CI gates (minimal set)

- `npm run build`
- `npm run test`
- `npm run format:check`
- `npm run lint`
