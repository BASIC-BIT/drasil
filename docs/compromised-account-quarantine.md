# Compromised-Account Quarantine

## Goal

Allow moderators to contain a compromised Discord account without removing it from the server.
The account remains able to use its existing user-facing case thread to report recovery, while the
case is parked outside Drasil's routine moderation-review queue.

This is distinct from an ordinary active case. An ordinary case asks moderators to work toward a
decision through the queue. A compromised-account quarantine is an intentionally durable holding
state: contain the account, preserve a recovery contact surface, and wait for the legitimate owner
to return.

Related work:

- Issue #214 tracks this compromised-account quarantine capability.
- Issue #135 covers the compromised-account kick workflow.
- Issue #144 introduced configurable role quarantine for restricted users.

## Product Principles

- Quarantine is manual-only in the first release.
- A quarantined case remains open; quarantine is not a terminal moderation outcome.
- Drasil parks the case only after it confirms that in-server containment succeeded.
- The user-facing case thread remains open so the account owner can report recovery.
- A thread reply requests moderator review; it does not prove recovery or release quarantine.
- Drasil does not apply or renew Discord timeouts as part of this workflow.
- Drasil describes the result as containment inside the server, not complete account isolation.

## Lifecycle

### Enter Quarantine

Expose `Quarantine Compromised Account...` from an active case's admin actions. The action requires
an explicit reason and a confirmation preview because it removes more access than an ordinary case.

The preview shows:

- Roles Drasil will remove, including manageable privileged roles.
- Roles Drasil cannot remove because they are managed or at or above Drasil's highest role.
- Member-specific permission overwrites that could bypass the case-role lockdown.
- The case role and user-facing thread that will remain.
- Whether the proposed changes can produce complete in-server containment.

Execution follows this order:

1. Create or reuse the user's pending case.
2. Preserve the existing user-facing case thread, or create one if it is absent.
3. Preserve or create the admin evidence thread and case notification.
4. Snapshot the member's current roles with a compromised-account purpose.
5. Remove every role allowed by the explicit compromised-account policy.
6. Apply the case role and validate that the configured case-role lockdown is already complete.
7. Check remaining effective permissions and member-specific overwrites.
8. Record the quarantine action, actor, reason, role effects, and containment result.
9. Park the case only if containment is complete.

If containment is incomplete, Drasil keeps the case in the normal review queue with a prominent
warning. It does not automatically restore roles that were already removed: retaining partial
containment is safer while moderators repair the remaining permission problem.

### Park the Case

A successfully quarantined case remains open but leaves routine review surfaces:

- Remove its live case-mirror message.
- Exclude it from stale-case digests.
- Disable automated user-facing reminder messages.
- Exclude it from the normal web `Needs Review` queue.
- Show it in a persistent `Parked Quarantines` section.

The user-facing case thread remains open and usable. The quarantined account can read the existing
instructions and reply when its owner believes recovery is complete.

An optional `review_after` timestamp can return a parked case to moderator attention later without
requiring recurring reminders by default.

### Receive a Recovery Reply

A message in the open user-facing case thread:

- Creates or refreshes one deduplicated queue-attention item.
- Uses quarantine-specific copy such as `Quarantined user reports account recovery.`
- Does not automatically verify, release, or unpark the account.
- Does not create one queue item per message.

Acknowledging the attention item clears only that notification. The underlying case remains parked
until a moderator resolves it. Existing evidence mirroring can continue to copy the reply into the
admin evidence thread.

### Verify and Release

Keep the existing `Verify User` action, but make its confirmation quarantine-aware. The confirmation
explains that verification will:

- End the compromised-account quarantine.
- Remove the case role.
- Restore eligible snapshotted roles.
- Apply configured role-gate cleanup.
- Resolve the user-facing and admin evidence threads.
- Resolve the case with the normal verified terminal status.

Role restoration remains additive and safety-checked. Drasil skips and reports roles that are
missing, managed, newly privileged since quarantine began, or no longer below its highest role.
Roles that were already privileged when quarantine began remain eligible for restoration.

Kick and ban remain available when recovery is unsuccessful or quarantine is no longer appropriate.
Those actions abandon the active role snapshot without restoring it.

## Data Model

Keep `verification_events.status = pending` while a case is quarantined. `pending` continues to mean
that the case is open; quarantine changes how the open case receives attention.

Add to `verification_events`:

- `case_kind`: `standard | compromised_account`
- `attention_state`: `review_required | parked`
- `containment_status`: `not_applicable | contained | incomplete`
- `parked_at`
- `parked_by`
- Optional `review_after`

Existing rows receive `standard` and `review_required` defaults.

Add audit vocabulary:

- `admin_action_type.quarantine_compromised_account`
- `moderation_outcome_type.account_quarantined`

Continue using the normal verify, kick, and ban actions for terminal resolution, attaching quarantine
context to their metadata where applicable.

Add a typed purpose to role-quarantine snapshots:

- `standard_case`
- `compromised_account`

This distinguishes ordinary automatic role quarantine, which intentionally skips privileged roles,
from an explicitly confirmed compromised-account containment action.

## Service Design

Introduce an `AccountQuarantineService` to coordinate the workflow without adding another large
orchestration path to `UserModerationService`.

Responsibilities:

- Build the dry-run containment preview.
- Coordinate with the existing case-repair path, which ensures the case thread and notification
  exist before containment begins.
- Invoke role removal using an explicit compromised-account policy.
- Assign the case role and validate the existing guild-wide case-role lockdown without rewriting
  server permissions from a per-user action.
- Determine a `contained` or `incomplete` result.
- Park or return the case to review.
- Record action, outcome, and failure metadata.
- Supply quarantine-aware context to verification and release presentation.

Refactor role classification around a policy object instead of a boolean flag. The
compromised-account policy:

- Removes manageable privileged roles.
- Does not inherit ordinary role-quarantine exemptions unless they are explicitly declared safe for
  compromised-account containment.
- Skips managed roles and roles Drasil cannot control.
- Reports all retained roles and permissions clearly.

The workflow does not use Discord timeouts.

## Queue and Reminder Behavior

Preserve `findActiveByUserAndServer`: parked cases remain active so new detections link to the same
case instead of creating duplicates.

Add a repository query such as `findReviewablePendingByServer`, returning pending cases whose
attention state is `review_required`. Use it for:

- Live case mirrors.
- Daily case-review reminders.
- The normal web active-case queue.

Support-thread attention remains independent. A parked case can therefore generate a temporary
attention item after a recovery reply without returning the entire case to routine review.

## Containment and Breach Handling

While a compromised-account quarantine is active:

- Newly assigned manageable roles are removed using the compromised-account policy.
- A failed role removal changes containment to incomplete and returns the case to review.
- Activity outside explicitly permitted case surfaces creates urgent moderator attention.
- Member departure ends active containment and follows the existing member-left workflow.
- Drasil never presents `contained` while dangerous retained roles or overwrites remain.

The per-user action does not rewrite guild-wide channel permissions. A lockdown audit that still
has planned changes blocks parking and sends the case back to review so a moderator can explicitly
repair the server-wide configuration.

Member-specific permission allows can override role-level denies. The first release detects and
reports those overwrites but does not automatically rewrite and later restore every channel
overwrite. A blocking overwrite prevents the case from being parked until a moderator removes or
neutralizes it.

Quarantine cannot prevent mutual-server direct messages. If direct-message abuse is active, kick or
ban remains the stronger containment option.

## Discord and Web Experience

Case surfaces show:

- `Compromised account`
- `Parked`
- Containment status
- Quarantined-at timestamp and moderator
- Removed, retained, and failed role counts
- User-facing case-thread link
- Latest recovery-reply attention state
- `Verify User`, `Kick User`, and `Ban User` actions

Copy must not imply that Drasil verified ownership of the Discord account. A reply from the
quarantined account is a request for human review, not evidence that the legitimate owner has
regained control.

## Implementation Slices

### 1. State and Queries

- Add case-kind and attention-state fields with safe defaults.
- Add quarantine action/outcome vocabulary and role-snapshot purpose.
- Add reviewable-pending repository queries.
- Keep active-case lookup behavior unchanged.

### 2. Containment Preview and Execution

- Add `AccountQuarantineService`.
- Add compromised-account role policy and dry-run preview.
- Detect unmanageable roles and member-specific overwrite bypasses.
- Apply containment and park only on a complete result.

### 3. Discord Workflow

- Add the quarantine admin action, confirmation, and result presentation.
- Preserve or create the user-facing case thread.
- Suppress scheduled reminders for parked cases.
- Produce deduplicated attention after a recovery reply.
- Make `Verify User` quarantine-aware.

### 4. Web Workflow

- Add the quarantine action with the same authority, preview, and confirmation contract.
- Separate `Needs Review` from `Parked Quarantines`.
- Render containment state, role effects, recovery attention, and terminal actions.

### 5. Integrity and Operations

- Audit parked cases that lack an active role snapshot or case role.
- Audit parked cases whose user is missing from the server.
- Audit queue mirrors that still reference parked cases.
- Surface incomplete containment as an operational finding.

## Verification

Unit coverage includes:

- Successful quarantine and parking.
- Existing case and thread reuse.
- Thread creation when absent.
- Manageable privileged-role removal.
- Managed and above-bot role failures.
- Member-specific overwrite detection.
- Incomplete containment remaining queued.
- Parked cases being excluded from mirrors and reminders.
- A thread reply creating one coalesced attention item.
- A reply not releasing quarantine.
- Quarantine-aware verification restoring roles and resolving the case.
- Kick, ban, and member departure not restoring roles.
- New role assignment being removed or requeued on failure.

Integration coverage includes:

- Existing cases receiving safe schema defaults.
- Reviewable-pending queries excluding parked cases.
- Active-case lookup still returning parked cases.
- Admin actions and moderation outcomes retaining quarantine provenance.

Manual staging QA:

1. Quarantine an ordinary member with several roles.
2. Confirm that only the user-facing case surface remains usable.
3. Confirm that the case leaves normal queues and reminders.
4. Reply as the quarantined member.
5. Confirm that one attention item appears.
6. Verify the user and inspect role restoration.
7. Repeat with a privileged role, an unmanageable role, and a member-specific overwrite.

## Rollout

1. Ship additive schema fields with safe defaults.
2. Ship the read-only containment preview and tests.
3. Ship the manual Discord action behind a disabled server setting.
4. Ship parked-case queue and reminder behavior.
5. Ship web visibility and action parity.
6. Enable the capability in a controlled server and complete the manual QA matrix.
7. Document operational recovery and incomplete-containment handling.

## Non-Goals

- Automatic model-triggered compromised-account quarantine.
- Discord timeouts or timeout renewal.
- Automatically determining whether the legitimate owner recovered the account.
- Preventing mutual-server direct messages.
- Automatically rewriting member-specific channel overwrites in the first release.
- Automatically releasing quarantine based on a thread message.
