# Documentation Update Plan (2025-04-01)

**Goal:** Ensure the Memory Bank documentation is accurate, consistent, up-to-date with the current implementation (`Bot.ts`, schema), and free of obsolete information (like the cancelled `user_flags` table plan), focusing on the minimum viable implementation details.

**Plan:**

1.  **Update `database-implementation.md`:**
    *   **Implementation Plan (Chunks):**
        *   In Chunk H3 ("Detection History & Flagging"), explicitly add status tracking for `VerificationEventRepository` and `AdminActionRepository` implementation (likely 🔄 or ✅ based on their usage in `Bot.ts`).
        *   Review all status markers (✅, 🔄, ⏳, ❌) across Chunks H1-H8 for consistency with `progress.md` and `activeContext.md`.
    *   **Schema Description:**
        *   In the description of the `server_members` table, explicitly mention the `verification_status` column and its role in the verification flow.
        *   Add a brief note about the purpose of the `admin_actions` table in tracking the verification lifecycle.
    *   **Remove Obsolete References:** Ensure no detailed descriptions or plans remain for the cancelled `user_flags` table, other than noting its cancellation.

2.  **Update `systemPatterns.md`:**
    *   **Core Components / Service Layer:** Add entries for `VerificationService` and `AdminActionService`, describing their roles.
    *   **Data Flow Patterns:** Update the "User Verification Flow" and potentially "Moderation Actions Flow" to explicitly show the involvement of `VerificationService` and `AdminActionService`. Include the Mermaid diagram below if helpful.

3.  **Update `activeContext.md`:**
    *   **Current Architecture State:** Under "User Management" or a new "Verification & Moderation" subsection, explicitly list `VerificationService`, `AdminActionService`, and `UserModerationService`.
    *   **Next Steps / Alpha Release:**
        *   Update the status (✅, 🔄, ⏳) for "Thread & verification tracking" to reflect the implementation state of `VerificationEventRepository` and `AdminActionRepository`.
        *   Update the status for "Extend Existing Tables for Flag Functionality", confirming the addition and use of `verification_status` in `server_members`.
    *   **Active Decisions:** Ensure decisions related to the verification flow are captured accurately.

4.  **Update `techContext.md`:**
    *   **Environment Variables:** Double-check that the "Required Environment Variables" section only lists essential secrets.
    *   **Slash Commands:** Verify the list exactly matches the commands implemented in `Bot.ts`.

5.  **Update `progress.md`:**
    *   **What's In Progress / Alpha Release:** Align the status markers for "Extend Existing Tables for Flag Functionality" and "Verification thread tracking" with updates made in other files. Add status for `AdminActionRepository`.
    *   **Known Issues:** Review issue #7 "Dependency Injection Testing Challenges" and update/remove as needed based on current state.

6.  **Review `documentation-consolidation.md`:**
    *   No updates needed, serves as a record.

7.  **General Consistency and Cleanup:**
    *   Cross-check all updated files for consistency.
    *   Remove any remaining detailed descriptions related to the cancelled `user_flags` repository.

**Proposed Core Verification Flow Diagram:**

```mermaid
sequenceDiagram
    participant B as Bot.ts
    participant SAS as SecurityActionService
    participant VS as VerificationService
    participant NM as NotificationManager
    participant RM as RoleManager
    participant AAR as AdminActionRepository
    participant VER as VerificationEventRepository
    participant SMR as ServerMemberRepository

    alt Suspicious Join/Message
        B->>SAS: handleSuspiciousJoin/Message(member, result)
        SAS->>VS: startVerification(member, result.detectionEventId)
        VS->>VER: create(status='pending', detection_event_id)
        VS->>SMR: update(is_restricted=true, verification_status='pending')
        VS->>RM: assignRestrictedRole(member)
        VS->>NM: sendAdminNotification(member, result)
        NM-->>B: Returns notification message
        SAS->>NM: createVerificationThread(member) # Optional, can also be triggered by button
        NM-->>SAS: Returns thread
        SAS->>VS: attachThreadToVerification(eventId, threadId)
        VS->>VER: update(thread_id=threadId)
    end

    alt Admin Clicks Verify Button
        B->>VS: verifyUser(member, adminId)
        VS->>VER: update(status='verified', resolved_by=adminId)
        VS->>AAR: create(action='verify', admin_id=adminId)
        VS->>SMR: update(is_restricted=false, verification_status='verified')
        VS->>RM: removeRestrictedRole(member)
        B->>NM: logActionToMessage(message, 'verified', admin)
        B->>NM: updateNotificationButtons(message, userId, 'verified')
        B->>B: manageThreadState(lock=true, archive=true)
    end

    alt Admin Clicks Ban Button
        B->>VS: rejectUser(member, adminId)
        VS->>VER: update(status='rejected', resolved_by=adminId)
        VS->>AAR: create(action='reject', admin_id=adminId)
        VS->>SMR: update(verification_status='rejected') # Restriction might remain or ban happens
        B->>B: member.ban() # Direct Discord action
        B->>AAR: create(action='ban', admin_id=adminId) # Log ban separately
        B->>NM: updateNotificationButtons(message, userId, 'rejected')
        B->>B: manageThreadState(lock=true, archive=true)
    end

     alt Admin Clicks Reopen Button
        B->>VS: reopenVerification(member, adminId)
        VS->>VER: update(status='reopened') # Or create new PENDING event? TBD by service logic
        VS->>AAR: create(action='reopen', admin_id=adminId)
        VS->>SMR: update(is_restricted=true, verification_status='pending') # Re-restrict
        VS->>RM: assignRestrictedRole(member) # Re-assign role
        B->>NM: updateNotificationButtons(message, userId, 'pending')
        B->>B: manageThreadState(lock=false, archive=false) # Unlock/Unarchive
    end