# Workflow Overview

This project uses direct orchestration (no internal EventBus). Controllers call
services, and services handle side effects in a single flow.

## Suspicious message or join

1. `EventHandler` receives a guild message or a new member join (DMs are ignored).
2. `DetectionOrchestrator` returns a `DetectionResult` (with `detectionEventId`
   when available).
3. `EventHandler` calls `SecurityActionService.handleSuspiciousMessage` or
   `handleSuspiciousJoin`.
4. `SecurityActionService`:
   - Ensures `server`, `user`, and `server_member` records exist.
   - Ensures a `detection_event` record exists (creates one if needed).
   - If an active verification exists, updates the admin notification only.
   - Otherwise creates a `verification_event` (PENDING), restricts the user,
     creates a verification thread, and upserts the admin notification.

## Manual flag

1. Admin initiates a manual flag.
2. `SecurityActionService.handleManualFlag` creates a `detection_event` with
   `detection_type = GPT_ANALYSIS` and follows the same flow as above.

## User report

1. A user submits the report modal.
2. `SecurityActionService.handleUserReport` creates a `detection_event` with
   `detection_type = USER_REPORT` and follows the same flow as above.

## Admin verify or ban

1. `InteractionHandler` or `CommandHandler` calls `UserModerationService`.
2. Verify:
   - Update `verification_event` to VERIFIED with `resolved_by` and `resolved_at`.
   - Remove restricted role and update `server_member`.
   - Resolve the verification thread and update the admin notification.
   - Record the admin action.
3. Ban:
   - Update `verification_event` to BANNED if one exists.
   - Ban the member in Discord.
   - Update `server_member`.
   - Resolve the thread, update the admin notification, and record the admin action.

## Reopen verification

1. `InteractionHandler` calls `SecurityActionService.reopenVerification`.
2. The event is set back to PENDING, the thread is reopened, the user is
   re-restricted, and the notification is updated.

## Failure handling (current)

We fail fast and let errors bubble up. There is no retry or compensation layer
yet. The most likely future hardening points are:

- Restricted role assignment/removal
- Thread creation/reopen/resolve
- Notification upsert/logging
- Discord ban action
