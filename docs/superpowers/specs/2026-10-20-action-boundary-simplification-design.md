# Action boundary simplification

Date: 2026-10-20
Related work: #89, merged PR #255, [shared action boundary design](2026-10-19-shared-action-boundary-design.md)

## Purpose

Simplify how the existing Discord and web callers use the shared action boundary before adding MCP. PR #255 moved action authority, policy, confirmation requirements, binding checks and orchestration into `@drasil/application`. This follow-up removes redundant submission wrappers, misleading runtime capabilities and duplicated contracts around that boundary.

Deliver these changes in one focused follow-up PR. The existing bot and dashboard must benefit immediately. Success means fewer command-to-argument-to-command conversions, one owner for queue representations and confirmation bindings, and application interfaces whose exposed methods are usable.

MCP planning is paused until this work is complete. Its agreed audience, full human-authorized action coverage, standard-client compatibility and web hosting remain future requirements.

## Scope and behavior

This is a behavior-preserving refactor of existing callers. Preserve:

- Current operation permissions, mutable policy, target/state checks, confirmation requirements and fresh execution authority.
- Direct Discord execution and existing direct web mutations, including acknowledgement before potentially slow authority refreshes.
- The forty shipped durable request kinds, their stored representations, idempotency key formats and deduplication/retry semantics.
- Authenticated actor identity and shipped provenance values, including `web`, `web_report`, `web_case`, `discord_interaction` and internal CAPTCHA sources.
- Existing receipt statuses, persisted outcome shapes, UI result mapping, partial completion and uncertain enforcement outcomes.
- CAPTCHA state/effect atomicity, setup serialization, report-ban attempt fencing, committed-enforcement recovery and completion-hook ordering.
- Current fixture behavior at the web boundary, including specialized completed/queued receipts used by browser tests.

Do not add MCP endpoints, SDKs, OAuth, browser approval pages, new queued action kinds, new public APIs, new read-access policy, or changes to database schemas. Ordinary native bans/kicks remain direct. Read authorization and any additional bot delivery coverage belong to the later MCP design.

## Observed problems

| Current code                                                                    | Problem to remove                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/*ActionQueue.ts`                                                  | Several helpers repeat context construction and `encodeQueuedAction` plus persistence, and return either a status or a receipt.                                                                                                    |
| `apps/web/lib/userReportActionQueue.ts`                                         | An admitted typed report command is expanded into helper arguments, reconstructed as the same command and given another context. Its three low-level exported helpers have no production callers outside this module.              |
| `apps/web/lib/activeCaseDataAdapter.ts`                                         | Nullable command translation retains a second queue-metadata builder, request-type map and idempotency helper alongside the shared codec. Current case actions already have typed translations, subject to their admission checks. |
| `apps/web/lib/moderationActionRequestQueue.ts`                                  | Queue input fields, statuses and receipt identity repeat contracts already owned by the application package.                                                                                                                       |
| `src/application/createBotApplication.ts`                                       | `messageCleanup.execute` always throws until the worker replaces it with a request-bound implementation.                                                                                                                           |
| `src/application/requestRuntime.ts`                                             | Preparation copies the entire application to replace individual family actions. The dispatcher accepts the same application type before and after preparation.                                                                     |
| `src/application/context.ts`, web context adapter and core confirmation matcher | Each repeats the selection of intake, case, operation or user as the confirmation target.                                                                                                                                          |

These are interface and composition problems. They do not justify rebuilding the shared operations or merging different families' admission policies.

## Approaches considered

1. **Consolidate the existing interfaces and delete replaced paths. Selected.** Keep family operations, the canonical codec, shared SQL builder and worker lifecycle. Add a small command-oriented submission adapter, make request preparation explicit and derive duplicate contracts.
2. **Only deduplicate types and helpers.** This is smaller but leaves the report round trip, nullable case fallback and unusable cleanup capability in place.
3. **Introduce a universal action dispatcher or command bus.** This would introduce routing and delivery policy beyond current needs and risk turning every mutation into a durable job. It is outside this follow-up.

## Design

### 1. Command-oriented queued submission

Use one ordinary web submission path that accepts an existing trusted `ActionContext` and `QueuedCommand`, encodes through `encodeQueuedAction`, writes through the existing shared Postgres statement and returns a receipt. Its home is the web application adapter layer, not a new domain service or HTTP endpoint.

The path is mechanical persistence. It does not authenticate callers, grant permission, issue confirmation evidence or replace family admission. Authenticated server actions and existing admission operations retain those responsibilities. The worker still checks fresh authority, policy and bindings at execution.

Use one receipt-returning convention internally. Callers that only display a status read `receipt.status` when mapping their result. Do not introduce a new union combining queued receipts and direct domain outcomes. Existing direct operations keep their family result contracts.

Keep the existing persistence modes explicit:

- Ordinary submission uses the pool and returns the persisted receipt.
- CAPTCHA effects write through the transaction's existing client. Their challenge update and effect insert remain in the same transaction. Retain a narrowly scoped encoded-input writer for effects already encoded by the trusted CAPTCHA adapter.
- Setup provisioning retains its named serialized path, advisory lock, active-submission conflict check and transaction ownership. It uses the same encoder and low-level writer as ordinary submission.

Do not make the ordinary path choose transaction or serialization policy from `context.source`, arbitrary options or caller metadata. Do not move fixture detection into application core or generic SQL code. Fixture adapters retain operation-specific receipts while using the same command-oriented interface where applicable.

Construct web contexts once at the authenticated entry or family adapter, using existing request identity rules. Extend the web context builder to accept an explicit request ID when the current caller uses a submitted ID, detection/case binding or repeatable-action attempt. Preserve source values explicitly. Generated submission IDs remain generated once per submission; current idempotency formats and retry boundaries must remain unchanged.

### 2. Migrate callers and remove redundant representations

Migrate member case opening, manual flagging, observed alert actions and undo, detection accounting, moderation operations, setup artifacts, admitted user reports, submitted-report case opening and report bans to the command-oriented path. Each caller builds its command once after its current admission checks.

Delete the member-open and member-flag queue-only modules once their callers use the new path. Retain observed/accounting UI-action translation only where it still does real work; remove its repeated context, encoding and status-only persistence wrappers. Keep setup serialization and user-report target creation as named runtime behavior rather than hiding them in generic submission.

In user reports, pass the admitted command and trusted context into persistence without converting them through the three exported queue helpers. Preserve target-user creation for `submit_user_report`, reporter membership/activity and reason checks, intake ownership, confirmation, fixture behavior and existing error messages. Preserve report submission idempotency semantics when removing the second context allocation.

In case submission, replace nullable translation plus raw fallback with an exhaustive typed translation. Invalid or stale CAPTCHA/quarantine inputs continue to return the existing denial result before insertion. A new UI action must require an explicit translation at compile time. Remove `requestTypeByCaseAction`, the raw metadata branch and `buildCaseActionIdempotencyKey` after moving its useful retry-identity assertions to tests of the actual shared encoding/submission path. No production caller uses that helper except the fallback being removed.

The canonical codec continues to own stored metadata, optional-column representation and idempotency keys. Do not change shipped key strings or remove compatibility handling for persisted rows. Migrate imports and tests together; do not leave forwarding aliases for replaced internal APIs.

### 3. Explicit prepared request execution

Change request preparation to return a narrow execution object:

```ts
interface PreparedQueuedRequest {
  execute(): Promise<QueuedActionOutcome>;
  afterComplete?: () => Promise<void>;
}
```

Preparation decodes the claimed row, binds any family-specific persisted state, establishes the existing accepted-submission confirmation evidence and captures the executor for that request. The returned execution closes over the decoded action and the required runtime dependencies. It does not expose a replacement `BotApplication` or accept a different request at execution time.

The dispatcher retains an exhaustive handler registration for all forty queued kinds, its existing family receipt projections and the boundary checker's coverage guarantee. Give it a narrow queued-runtime dependency contract derived from the existing operations and runtime factories it uses. Request-aware handlers select the bound cleanup, CAPTCHA, quarantine or detection executor for the same claimed row. Direct handlers use the existing reusable operations. Do not copy the entire application to substitute methods, add a second action registry or redesign receipt projection.

Remove the always-throwing `BotApplication.messageCleanup` field. Cleanup is available through its request-runtime factory, with its persisted job and preview binding established before execution. Keep legitimate direct capabilities and controller-used runtimes, including setup context and operation progress handling.

The worker sequence remains:

1. Claim a row and maintain its heartbeat/attempt ownership.
2. Prepare its execution.
3. Call `execution.execute()`.
4. Record the existing completion or failure, using the same attempt token.
5. Run `afterComplete` only after successful completion persistence.

Preserve the report-ban reconciliation special case that returns without recording another completion for an already-handled recovery. Preserve cleanup decoding of shipped rows, family-specific recovery checks, CAPTCHA system-purpose reconstruction, and setup analytics timing. Preparing a closure must not introduce an authority bypass or count as human confirmation. Existing persisted recovery rules and authenticated accepted-submission rules still determine continuation authority and evidence issuance.

### 4. Shared contracts and confirmation target calculation

Derive web queue statuses and receipt identity from `QueuedActionReceipt`. Represent the web-only optional cleanup-job binding as a narrow extension. Consume `EnqueueInput` at the encoded writer instead of maintaining a parallel optional-field input interface. Callers produce canonical inputs through the encoder; test fixtures supply complete canonical values where they intentionally exercise the writer.

Add one pure confirmation-binding projection in `packages/application/src/confirmation.ts`. Given context and command, it returns the existing binding for a user actor and no binding for a system actor. Preserve target precedence exactly: intake, case, operation, then user. Use it in `matchesConfirmation`, the Discord confirmation store and the authenticated web form adapter.

This helper calculates identity only. The Discord store still issues evidence after its authenticated interaction, consumes it once and preserves expiry/capacity limits. The web adapter still requires its authenticated checkbox or normalized report form. Preview generations, option-bound operation identity and quarantine confirmation remain their existing protocols. A matching calculated binding alone is not approval evidence.

Move `createBotAuthority` and `createWebAuthority` into dedicated runtime authority adapter modules and update imports while touching their consumers. They are shared by several families and currently live in attention-specific modules. Preserve each runtime's fetching, permission calculation and error behavior; do not merge discord.js and REST implementations or add caching.

## Ownership after the change

| Concern                                                               | Owner                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| Authentication, form parsing, UI action translation, fixture response | Existing runtime interface or family adapter             |
| Admission policy and human evidence issuance                          | Existing family operation and authenticated runtime flow |
| Execution authority, mutable policy, binding and orchestration        | Existing application family operations                   |
| Command encoding, stored keys/metadata, shared receipt identity       | `@drasil/application`                                    |
| SQL construction                                                      | Existing `@drasil/application/postgres` builder          |
| Pool/client use and setup serialization                               | Web persistence adapters                                 |
| Claimed-row binding and prepared execution                            | Bot request runtime                                      |
| Claiming, heartbeat, attempt fencing, completion/failure              | Existing worker and repository                           |

## Verification

Use existing characterization and workflow tests as the primary evidence. Add tests only for meaningful risks introduced by the changed interfaces:

- Exercise command-to-persisted-request parity through the real codec for migrated web actions, including all case translations, repeatable CAPTCHA attempts, observed/report identities, setup serialization and report target creation. Preserve independently supplied expected keys and metadata rather than deriving expected values with the encoder under test.
- Verify invalid case inputs cannot fall through to an untyped enqueue. Existing actor, current-state and confirmation failures still prevent effects.
- Run the forty-kind stored-row/dispatch fixture suite and existing receipt snapshots. Update fixture construction for the narrow runtime contract without replacing real routing with a mocked prepared closure.
- Exercise preparation through actual request-aware handlers for cleanup, CAPTCHA, quarantine and report-ban recovery. Verify request binding, revoked authority, committed follow-up without duplicate enforcement, failure recording and completion-hook ordering remain intact.
- Verify shared confirmation projection handles each target category and system actors. Retain runtime evidence issuance, one-use, expiry and options-binding tests; do not replace them with equality-only helper tests.
- Run the existing real Postgres enqueue and relevant transactional tests serially. Retain deduplication, immutable bindings, protected receipts and concurrent setup/attempt behavior.
- Build/typecheck both runtimes, run the boundary checker and required repository CI checks. Preserve the application's browser-safe exports and production package import checks.

Update `docs/dev/action-boundary.md`, its caller inventory and the boundary checker as needed for moved callers. The checker must retain its existing protections and exhaustive coverage rather than exempting new submission entry points.

## Completion criteria

- Existing Discord and web workflows retain their observed behavior and delivery choices.
- Ordinary web queued submission takes a typed command and trusted context and returns a receipt.
- Report submission no longer reconstructs admitted commands through queue wrappers.
- Case submission has one exhaustive typed translation and no handwritten persistence fallback.
- The bot exposes no unusable cleanup method, and request preparation no longer replaces fields on application copies.
- Queue contracts and confirmation-binding selection have one owner each.
- Replaced internal helpers and their forwarding aliases are deleted. Remaining wrappers perform identifiable admission, translation, transaction or presentation work.
- The PR reports the concrete deleted paths and before/after production-code size, with any increase explained by a required invariant. File/line reduction is useful evidence, not a reason to weaken policy or recovery checks.
- No MCP product implementation, additional durable kinds or database migration is included.

## Review handoff

This document is the architectural design for the cleanup PR. After written-spec approval, draft a separate implementation plan with caller migrations, deletion checkpoints and focused verification. Implementation begins after that plan is reviewed and its execution method is selected.
