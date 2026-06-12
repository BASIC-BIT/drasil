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

- `/case open` creates `detection_type = ADMIN_CASE` events. It restricts by
  default; pass `restrict:false` to open an unrestricted case.
- `/case intake-role` creates `detection_type = ROLE_INTAKE` events with source
  role ID/name and batch metadata.
- Admin-facing reasons render Discord mentions for the moderator and, for role
  intake, the source role. Embed allowed-mentions remain disabled so these fields
  render clearly without causing extra pings.

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

## User report

1. A user submits the report modal.
2. `SecurityActionService.handleUserReport` creates a `detection_event` with
   `detection_type = USER_REPORT`.
3. If the reported user already has an active case in the server, Drasil links
   the report to that case and updates the case notification.
4. Otherwise Drasil posts or updates an observed alert with moderator action
   buttons. No verification event or thread is created until a moderator opens a
   case or restricts the user.

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
   matches legacy reports. Servers can opt into `open_case` or `restrict`, but
   escalation only happens when report AI recommendations and configured thresholds
   allow it. There is no auto-ban path.

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
