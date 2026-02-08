# Event-Driven Architecture: Core Business Events

This document defines the core business events used in the Discord Anti-Spam Bot's event-driven architecture.

## 1. `UserDetectedSuspicious`

- **Description:** Fired by the `EventHandler` when the `DetectionOrchestrator` completes its analysis and flags a user as 'SUSPICIOUS'.
- **Purpose:** To initiate the verification and restriction process for a potentially problematic user.
- **Payload:**
  - `userId: string` - The Discord ID of the suspicious user.
  - `serverId: string` - The Discord ID of the server where the detection occurred.
  - `detectionResult: DetectionResult` - The detailed result from the orchestrator (label, confidence, reasons, triggerSource, triggerContent, detectionEventId).
  - `sourceMessageId?: string` - The ID of the message that triggered the detection, if applicable.
  - `channelId?: string` - The ID of the channel where the triggering message occurred, if applicable.
  - `detectionEventId: string` - The unique ID of the corresponding record saved in the `detection_events` table.

## 2. `VerificationStarted`

- **Description:** Fired by the `SecurityActionService` after successfully creating a `VerificationEvent` record in the database for a suspicious user.
- **Purpose:** To signal the start of the formal verification workflow, allowing other components to react (e.g., assign restricted role, send admin notification).
- **Payload:**
  - `verificationEventId: string` - The unique ID of the newly created `verification_events` record.
  - `userId: string` - The Discord ID of the user undergoing verification.
  - `serverId: string` - The Discord ID of the server where verification is occurring.
  - `detectionEventId?: string` - The ID of the `detection_events` record that triggered this verification, if applicable.
  - `detectionResult: DetectionResult` - The original detection result that led to this verification.

## 3. `AdditionalSuspicionDetected`

- **Description:** Fired by the `SecurityActionService` when a new suspicious activity (message or join) is detected for a user who _already_ has an active verification event.
- **Purpose:** To update the existing admin notification with the latest detection information without creating a new verification workflow.
- **Payload:**
  - `userId: string` - The Discord ID of the user.
  - `serverId: string` - The Discord ID of the server.
  - `detectionEventId: string` - The ID of the _new_ detection event record.
  - `detectionResult: DetectionResult` - The _new_ detection result.
  - `existingVerificationEvent: VerificationEvent` - The verification event that was already active.
  - `sourceMessage?: Message` - The Discord message object that triggered the new detection, if applicable.

## 4. `AdminVerifyUserRequested`

- **Description:** Fired by the `InteractionHandler` or `CommandHandler` when an administrator requests to verify a user (e.g., via button click or command).
- **Purpose:** To decouple the user interaction from the moderation logic. Signals the `UserModerationService` to initiate the verification process.
- **Payload:**
  - `targetUserId: string` - The Discord ID of the user to be verified.
  - `serverId: string` - The Discord ID of the server.
  - `adminId: string` - The Discord ID of the administrator making the request.
  - `interactionId?: string` - Optional ID of the interaction for potential follow-up replies.
  - `verificationEventId?: string` - Optional ID of the associated verification event, if applicable.

## 5. `UserVerified`

- **Description:** Fired by the `UserModerationService` after successfully updating the `VerificationEvent` status to 'VERIFIED'.
- **Purpose:** To signal that a user has been cleared, triggering side effects like role removal, status updates, and logging.
- **Payload:**
  - `verificationEventId: string` - The ID of the `verification_events` record being resolved.
  - `userId: string` - The Discord ID of the verified user.
  - `serverId: string` - The Discord ID of the server.
  - `moderatorId: string` - The Discord ID of the administrator who performed the verification.

## 6. `AdminBanUserRequested`

- **Description:** Fired by the `InteractionHandler` or `CommandHandler` when an administrator requests to ban a user.
- **Purpose:** To decouple the user interaction from the moderation logic. Signals the `UserModerationService` to initiate the ban process.
- **Payload:**
  - `targetUserId: string` - The Discord ID of the user to be banned.
  - `serverId: string` - The Discord ID of the server.
  - `adminId: string` - The Discord ID of the administrator making the request.
  - `reason: string` - The reason provided for the ban.
  - `interactionId?: string` - Optional ID of the interaction.
  - `verificationEventId?: string` - Optional ID of the associated verification event, if applicable.

## 7. `UserBanned`

- **Description:** Fired by the `UserModerationService` after successfully banning the user via the Discord API and updating relevant records.
- **Purpose:** To signal that a user has been removed, triggering side effects like status updates, logging, and potentially cross-server reputation adjustments.
- **Payload:**
  - `userId: string` - The Discord ID of the banned user.
  - `serverId: string` - The Discord ID of the server.
  - `moderatorId: string` - The Discord ID of the administrator who performed the ban.
  - `reason: string` - The reason provided for the ban.
  - `verificationEventId?: string` - The ID of the associated `verification_events` record, if the ban occurred during a verification process.

## 8. `VerificationReopened`

- **Description:** Fired by the `SecurityActionService` when an administrator reopens a previously closed (verified or banned) verification event.
- **Purpose:** To trigger side effects like reopening the verification thread, re-applying the restricted role, and logging the action.
- **Payload:**
  - `verificationEventId: string` - The ID of the verification event being reopened.
  - `userId: string` - The Discord ID of the user.
  - `serverId: string` - The Discord ID of the server.
  - `moderatorId: string` - The Discord ID of the administrator reopening the event.

## 9. `VerificationThreadCreated`

- **Description:** Fired by the `ThreadManager` after a dedicated verification thread has been successfully created in Discord.
- **Purpose:** To signal that the communication channel for verification is ready, allowing for updates to the verification event record (linking the `thread_id`) or sending notifications.
- **Payload:**
  - `verificationEventId: string` - The ID of the associated `verification_events` record.
  - `threadId: string` - The Discord ID of the newly created thread.
  - `userId: string` - The Discord ID of the user the thread is for.
  - `serverId: string` - The Discord ID of the server.

## 10. `AdminActionRecorded`

- **Description:** Fired by the `AdminActionService` after successfully recording any administrative action (verify, ban, reopen, etc.) in the `admin_actions` table.
- **Purpose:** To provide a generic stream of moderation actions for auditing, logging, or potentially triggering other workflows. Can be used alongside more specific events like `UserVerified` or `UserBanned`.
- **Payload:**
  - `adminActionId: string` - The unique ID of the `admin_actions` record.
  - `actionType: AdminActionType` - The type of action performed (e.g., 'verify', 'ban').
  - `userId: string` - The Discord ID of the user affected by the action.
  - `serverId: string` - The Discord ID of the server where the action occurred.
  - `adminId: string` - The Discord ID of the administrator who performed the action.
  - `verificationEventId?: string` - The ID of the associated `verification_events` record, if applicable.
  - `timestamp: Date` - The time the action was recorded.
