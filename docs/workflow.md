# Workflow Overview

This project uses direct orchestration (no internal EventBus). Controllers call
services, and services handle side effects in a single flow.

`verification_events` are Drasil's current local moderation cases. See
`docs/cases.md` for the product-language mapping between cases, detection
events, admin actions, and Discord surfaces.

## Suspicious message or join

1. `EventHandler` receives a guild message or a new member join (DMs are ignored).
2. `EventHandler` loads the server's detection response mode.
3. `DetectionOrchestrator` returns a `DetectionResult` (with `detectionEventId`
   when available), unless the mode is `off`.
4. `EventHandler` applies the configured response mode:
   - `off`: skip automatic detection entirely.
   - `record_only`: persist suspicious detections only.
   - `notify_only`: persist suspicious detections and send/update an admin alert.
   - `open_case`: create a review case and thread without restricting the user.
   - `restrict`: restrict the user, create a review case, create a thread, and
     notify admins.
5. `SecurityActionService` handles case-based modes:
   - Ensures `server`, `user`, and `server_member` records exist.
   - Ensures a `detection_event` record exists (creates one if needed).
   - If an active case exists, links the detection event to that case and
     updates the admin notification.
   - Otherwise creates a `verification_event` case (PENDING), optionally
     restricts the user, creates a verification thread, and upserts the admin
     notification.

## Observe-only notifications

When automatic detection is suspicious but the configured mode does not open a
case, `NotificationManager.upsertObservedDetectionNotification` can post a
distinct "Suspicious Activity Observed" embed. These notifications do not include
case action buttons because no `verification_event` exists yet.

Repeated observe-only detections for the same user update a recent observed
notification when one exists inside the configured notification window. Otherwise
Drasil sends a new alert and safely pings the configured admin notification role,
if one is set.

## Manual flag

1. Admin initiates a manual flag.
2. `SecurityActionService.handleManualFlag` creates a `detection_event` with
   `metadata.type = "admin_flag"` and follows the same case flow as above.

## User report

1. A user submits the report modal.
2. `SecurityActionService.handleUserReport` creates a `detection_event` with
   `detection_type = USER_REPORT` and follows the same case flow as above.

## Admin verify or ban

1. `InteractionHandler` or `CommandHandler` calls `UserModerationService`.
2. Verify:
   - Update the case to VERIFIED with `resolved_by` and `resolved_at`.
   - Remove restricted role and update `server_member`.
   - Resolve the verification thread and update the admin notification.
   - Record the admin action.
3. Ban:
   - Update the case to BANNED if one exists.
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
