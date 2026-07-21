# Workflow Overview

This project uses direct orchestration (no internal EventBus). Controllers call
services, and services handle side effects in a single flow.

`verification_events` are Drasil's current local moderation cases. See
`docs/cases.md` for the product-language mapping between cases, detection
events, admin actions, and Discord surfaces.

For a visual overview of how entry points converge into reports, observed
detections, and cases, see `docs/moderation-flow.md`.

## Suspicious message or join

1. `EventHandler` receives a guild message or a new member join (DMs are ignored).
2. `EventHandler` loads the server's detection response mode.
3. `DetectionOrchestrator` returns a `DetectionResult` (with `detectionEventId`
   when available), unless the mode is `off`.
4. `EventHandler` applies the configured response mode:
   - `off`: skip automatic detection entirely.
   - `record_only`: persist suspicious detections only.
   - `notify_only`: persist suspicious detections and send/update an admin alert.
   - `restrict`: open a case by applying the configured case role, creating a
     user-facing thread, and notifying admins.
5. `SecurityActionService` handles case-based modes:
   - Ensures `server`, `user`, and `server_member` records exist.
   - Ensures a `detection_event` record exists (creates one if needed).
   - If an active case exists, links the detection event to that case and
     updates the admin notification.
   - Otherwise creates a `verification_event` case (PENDING), applies the case
     role, creates a verification thread, and upserts the admin notification.

## Recent message context

Drasil persists short-lived message context for moderation inference by default.
Normal guild messages from non-bot users are stored in `message_contexts` as a
truncated `content_preview` plus lightweight derived features such as URL count,
mention count, attachment count, invite presence, and thread status. This store is
for moderation context, not analytics or model training.

Retention and bounds are intentionally tight:

- Message context expires after 30 days.
- At most 20 recent messages are retained per user per server.
- At most 50,000 message context rows are retained per server.
- Expired rows are pruned opportunistically during message handling.

When GPT profile analysis runs for a message, `EventHandler` reads recent context
from this persistent store instead of relying on process-local memory. If the store
is unavailable, Drasil continues without recent-message context rather than blocking
moderation flow.

## AI detection diagnostics

When `DetectionOrchestrator` asks GPT to classify profile/message context, the
OpenAI call must return structured JSON instead of a free-form label. The parsed
diagnostics include the model, prompt version, result, confidence, reason codes,
primary signal, short summary, token usage, and trace/span IDs when tracing is
available.

Suspicious `detection_events.metadata.gpt` stores only that safe diagnostic
record. It does not store the raw prompt, raw model response, or full Discord
message content beyond the existing detection trigger metadata. Admin embeds show
heuristic reasons separately from the AI analysis field so moderators can tell
whether a detection came from message content, account age, username/nickname,
server context, or mixed evidence.

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
2. `SecurityActionService.handleManualFlag` creates a detection event with
   `detection_type = ADMIN_FLAG` and `metadata.type = "admin_flag"`, then follows
   the same case flow as above.

## Admin-opened case and role intake

Admin-opened cases and bulk role intake are explicit moderator/server workflows,
not GPT detections.

- `/case open` creates `detection_type = ADMIN_CASE` events and applies the
  configured case role before opening the user-facing case thread.
- `/case intake-role` creates `detection_type = ROLE_INTAKE` events with source
  role ID/name and batch metadata.
- Role-triggered manual intake consumes the configured trigger role after opening
  or updating a case. Role quarantine treats that trigger role as policy-managed,
  so it is not captured/restored and cannot loop a resolved verify or no-action
  case back into a fresh role-add case.
- Admin-facing reasons render Discord mentions for the moderator and, for role
  intake, the source role. Embed allowed-mentions remain disabled so these fields
  render clearly without causing extra pings.

## Role gate

Role gate is optional server configuration for onboarding patterns that use a
honeypot role, a member access role, or both.

- Honeypot role only: when a non-bot member newly receives the configured role,
  Drasil records a `HONEYPOT_ROLE` detection and applies the configured response:
  `off`, `record_only`, `notify_only`, or `restrict`.
- Member access role only: no suspicious role trigger exists. During verify or
  close-no-action, Drasil can add the configured member access role as part of
  the same confirmed moderator action.
- Both roles: honeypot assignment can trigger moderation. During verify or
  close-no-action, Drasil removes the honeypot role if it is currently present or
  was removed by role quarantine, and adds the member access role if needed.

Role gate cleanup is shown in the existing verify/close confirmation copy. It is
not a second follow-up prompt. When role quarantine restores roles, configured
honeypot roles are treated as policy-managed and are not restored.

When role quarantine is on, Drasil also enforces it while a case is active. If a
pending-case member gains a removable non-exempt role through onboarding,
Channels & Roles, or another assignment, Drasil removes that newly gained role
and records the active-case role update. These roles are not added to the
pre-restriction restore snapshot, so they are not restored when the case
resolves.

## Case threads and admin evidence

Case notifications are posted in the configured admin channel. Drasil then starts
an attached evidence thread from that admin notification message and stores it as
`verification_events.private_evidence_thread_id`. Because the evidence thread is
attached to the notification message, the embed is visible at the top of the thread
without duplicating/mirroring the embed contents.

Attached evidence threads are not Discord `PrivateThread`s. Their visibility follows
the admin notification channel and thread membership, so servers should keep the
admin notification channel restricted to staff allowed to see case evidence.

Responder routing follows `/config case-staff`:

- `off`: no case responder role routing.
- `ping_only`: the evidence-thread prompt pings configured admin/case roles.
- `ping_and_add_members`: configured case responder members are added when under
  the member cap, and admin/case roles are also mentioned in the prompt.

The user-facing verification thread, when present, remains separate in the
verification/quarantine channel and is linked prominently in the admin embed's
`Case Threads` field.

When a case evidence thread is created, Drasil also posts a bounded evidence
snapshot with profile asset metadata, exact image hashes when fetchable, concise
profile-image descriptions, stored message context, and recent detection history.
This snapshot is moderator evidence only and does not make automatic decisions.

## Daily moderation reminders

`CaseReviewReminderService` runs every 15 minutes and uses a daily, opinionated
moderation workflow by default.

- Admin reminder batches post to the admin channel at most once per server repeat
  window. The default stale-case threshold and rolling repeat cadence are 24 hours.
- A batch can contain case review, newly due long-pending membership-screening members,
  or both. A screening-only batch is sent when no stale cases exist, and case responder
  roles are mentioned only in the first message when a batch needs continuations.
- Long-pending screening members continue to synchronize with the moderation queue on
  every service tick. Their Discord notification waits for the next shared reminder
  window and is sent once per pending episode.
- Case review and pending-screening alerts retain independent enable settings. The
  case-review repeat interval supplies the shared admin reminder cadence even when the
  case-review section is disabled.
- Digests group pending cases as fresh, stale, and very stale. Very stale cases are
  cases beyond the configured day threshold, defaulting to 3 days, and remain pending
  for moderator review.
- User-facing support-thread reminders post only in the normal user-facing
  verification thread. They ping the target user, not admins.
- User reminders use fixed copy: `Ticket reminder: {elapsed} elapsed. {user_mention} See above.`
- User reminders run every 24 hours until the very-stale day threshold or until the
  target user responds. The first target-user reply is mirrored to admin evidence
  and sends a one-time admin-log notification so staff can respond quickly.
- User reminders do not post inside the one-hour admin review window after a batch that
  includes case review. If a reminder would collide with that window, it is moved to
  the end of the window and the digest shows the same next-reminder timestamp.

## Manual resolved-thread sweep

`/audit close-resolved-threads` is a manual repair command for Discord threads
that stayed open after a resolved case. It dry-runs by default and only archives
and locks resolved case/evidence threads when `execute: true` is explicitly used.
It does not post duplicate resolution messages.

## User report

1. A user submits the report modal.
2. `SecurityActionService.handleUserReport` creates a `detection_event` with
   `detection_type = USER_REPORT`.
3. If the reported user already has an active case in the server, Drasil links
   the report to that case and updates the case notification.
4. Otherwise Drasil posts or updates an observed alert with moderator action
   buttons. No verification event, case role, or thread is created until a
   moderator opens a case.

See `docs/report-ux-journeys.md` for the product-level user journeys and the
recommended future direction for report-only cases.

## Report intake thread

1. A reporter clicks the configured report instructions button.
2. Drasil opens a private report intake thread, records durable intake state, and
   posts a no-ping admin embed that the intake has started. This does not submit a
   user report yet.
3. Reporter thread messages are stored as intake evidence. Text, Discord message
   links, and eligible screenshot metadata are persisted; raw image bytes are not.
4. Platform-backed evidence such as mentions, Discord IDs, and valid message links
   can produce immediate candidate prompts. Screenshot/text extraction runs through
   the debounced report intake agent after the reporter pauses, using report AI
   image/text limits.
5. AI/VLM extraction is untrusted evidence only. Extracted IDs and links are
   validated through Discord before they become candidates; extracted names require
   reporter confirmation.
6. The reporter must answer the Yes/No target prompt before Drasil submits a
   report. `No` returns the intake to evidence collection.
7. Confirmed intake submissions create a normal `USER_REPORT` detection event.
   The default `report_intake_confirmed_response_mode` is `observed_alert`, which
   matches legacy reports. Servers can opt into `open_case` or `kick`, but
   escalation only happens when report AI recommendations and configured thresholds
   allow it. There is no auto-ban path.

## Admin verify or ban

1. `InteractionHandler` or `CommandHandler` calls `UserModerationService`.
2. Verify:
   - Update the case to VERIFIED with `resolved_by` and `resolved_at`.
   - Remove the case role and update `server_member`.
   - Apply role-gate cleanup when configured.
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
   case role is reapplied, and the notification is updated.

## Failure handling (current)

We fail fast and let errors bubble up. There is no retry or compensation layer
yet. The most likely future hardening points are:

- Case role assignment/removal
- Thread creation/reopen/resolve
- Notification upsert/logging
- Discord ban action
