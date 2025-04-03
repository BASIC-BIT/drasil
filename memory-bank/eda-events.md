# Event-Driven Architecture: Core Business Events

This document defines the core business events used in the Discord Anti-Spam Bot's event-driven architecture.

## 1. `UserDetectedSuspicious`

- **Description:** Fired when the `DetectionOrchestrator` completes its analysis and flags a user as 'SUSPICIOUS'.
- **Purpose:** To initiate the verification and restriction process for a potentially problematic user.
- **Payload:**
  - `userId: string` - The Discord ID of the suspicious user.
  - `serverId: string` - The Discord ID of the server where the detection occurred.
  - `detectionResult: DetectionResult` - The detailed result from the orchestrator (label, confidence, reasons, triggerSource, triggerContent).
  - `profileData?: UserProfileData` - User profile information used during detection, if available.
  - `sourceMessageId?: string` - The ID of the message that triggered the detection, if applicable.
  - `detectionEventId: string` - The unique ID of the corresponding record saved in the `detection_events` table.

## 2. `VerificationStarted`

- **Description:** Fired by the `VerificationService` after successfully creating a `VerificationEvent` record in the database for a suspicious user.
- **Purpose:** To signal the start of the formal verification workflow, allowing other components to react (e.g., assign restricted role, send admin notification).
- **Payload:**
  - `verificationEventId: string` - The unique ID of the newly created `verification_events` record.
  - `userId: string` - The Discord ID of the user undergoing verification.
  - `serverId: string` - The Discord ID of the server where verification is occurring.
  - `detectionEventId?: string` - The ID of the `detection_events` record that triggered this verification, if applicable.

## 3. `UserVerified`

- **Description:** Fired when an administrator successfully verifies a user, typically resolving a pending verification event.
- **Purpose:** To signal that a user has been cleared, triggering actions like role removal, status updates, and logging.
- **Payload:**
  - `verificationEventId: string` - The ID of the `verification_events` record being resolved.
  - `userId: string` - The Discord ID of the verified user.
  - `serverId: string` - The Discord ID of the server.
  - `adminId: string` - The Discord ID of the administrator who performed the verification.

## 4. `UserBanned`

- **Description:** Fired when an administrator bans a user from the server.
- **Purpose:** To signal that a user has been removed, triggering status updates, logging, and potentially cross-server reputation adjustments.
- **Payload:**
  - `userId: string` - The Discord ID of the banned user.
  - `serverId: string` - The Discord ID of the server.
  - `adminId: string` - The Discord ID of the administrator who performed the ban.
  - `reason: string` - The reason provided for the ban.
  - `verificationEventId?: string` - The ID of the associated `verification_events` record, if the ban occurred during a verification process.

## 5. `VerificationThreadCreated`

- **Description:** Fired after a dedicated verification thread has been successfully created in Discord.
- **Purpose:** To signal that the communication channel for verification is ready, allowing for updates to the verification event record (linking the `thread_id`) or sending notifications.
- **Payload:**
  - `verificationEventId: string` - The ID of the associated `verification_events` record.
  - `threadId: string` - The Discord ID of the newly created thread.
  - `userId: string` - The Discord ID of the user the thread is for.
  - `serverId: string` - The Discord ID of the server.

## 6. `AdminActionRecorded`

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
