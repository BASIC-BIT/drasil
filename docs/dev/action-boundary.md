# Shared action boundary

The application package owns execution authority, mutable policy, confirmation requirements, binding checks and orchestration for every current action family. SDK, database and credential work stays in runtime adapters. The [caller inventory](action-boundary-inventory.md) records the concrete entry points, policies, confirmation paths, delivery choices and tests. The [design](../superpowers/specs/2026-10-19-shared-action-boundary-design.md) explains the boundary and issue #89 tracks the migration.

## Execution interfaces

`ActionContext` contains trusted `guildId`, `requestId`, `source` and an authenticated user actor or a narrow system purpose. Source is audit provenance and never grants authority. Runtime adapters build context; strict public command schemas cannot supply actor, context, source, permission facts, credentials or internal attempt tokens.

Each family exposes `execute(context, command): Promise<ActionResult<FamilyOutcome>>` through a `createFamilyActions(deps)` factory. The focused attention and submitted-report review APIs retain `acknowledge`/`acknowledgeBatch` and `close`/`openCase`. Dependencies are named interfaces for authority, current state, settings and existing domain workflows. `AuthorityPort.loadFresh` reloads actor membership, permissions and roles; mutation settings reads are fresh and fail closed. The web dashboard's entry gate remains separate from operation authority.

A result is either `{ kind: 'outcome', outcome }` or `{ kind: 'denied', code }`. Outcomes preserve domain detail, partial completion and uncertainty. Unexpected infrastructure exceptions propagate to the runtime's existing failure recorder and renderer. Shared policy helpers, including `evaluateCasePolicy` and `readCasePolicy`, also supply availability to web consumers; an availability hint never replaces the execution check.

`ConfirmationPort.verify(context, command)` consumes runtime-issued evidence bound to actor, guild, operation and target. Existing slash stores, pending modal state, authenticated web forms and persisted previews supply evidence. An arbitrary boolean or metadata field is not proof. `operationNeedsConfirmation` is shared by operations and its issuers. The bot's confirmation store removes evidence on verification and bounds abandoned evidence to ten minutes and 1,024 outstanding requests; its oldest proof is evicted at capacity, so saturation fails closed. Quarantine previews retain their own expiry and binding. Web form evidence is request-local.

## Direct and durable delivery

Discord interactions remain direct and acknowledge before forced authority requests where needed. Attention acknowledgement, submitted-report closure, native moderation and settings updates create no artificial queue records. Existing web case, detection, quarantine, CAPTCHA, cleanup, report, operations and provisioning submissions keep their durable jobs. CAPTCHA browser transactions preserve atomic state transitions and effect insertion. No new queue, service or universal action endpoint was added.

`encodeQueuedAction(context, command): EnqueueInput` owns shipped storage columns, metadata and idempotency keys. `decodeQueuedAction(row): DecodedQueuedAction` validates a persisted row and restores a typed command. `queuedCommandSchemas` and `queuedActionHandlers` cover all forty members of Prisma's `moderation_action_request_type`; direct-only commands are deliberately outside that registry.

`prepareQueuedRequest` binds persisted leases, CAPTCHA system identity and generations, cleanup job state and report-ban recovery. `dispatchQueuedAction` selects the family and projects its typed result into the existing receipt. The worker owns claiming, heartbeat, completion/failure and recovery scheduling. The separate `@drasil/application/postgres` export provides `buildEnqueueStatement`; Prisma and pg execute the same parameterized statement in their own runtime transaction contexts.

Confirmed enforcement recovery may finish recorded follow-up work despite later permission changes. It loads the matching persisted operation, preserves the original actor/source, and must not enforce again. System-purpose strings are not a general authorization mechanism.

## Package and browser contracts

`@drasil/application` remains compiled CommonJS with declarations and has no Postgres side effect. `@drasil/application/postgres` is explicitly imported by persistence adapters. `@drasil/application/setup-settings` is the browser-safe canonical schema leaf: `require` selects CommonJS and `import` selects a standalone ES module built from the same TypeScript source. Contracts explicitly re-export their established public names from this leaf. Browser validation therefore does not load the root's Node fingerprint implementation, and webpack's React Refresh can parse its ES module instrumentation.

The production Docker build runs `check-application-imports.mjs` after `npm prune --omit=dev`; CI repeats it in the final image. It imports all three entries through CommonJS and ES module loading without starting the bot or requiring credentials. The browser suite also exercises actual Next development bundling, while `web:build` checks production bundling.

## Maintaining the boundary

Run `npm run action:boundary` after building the package. The checker compares the Prisma enum with AST-derived codec and handler registrations, checks every queued kind and mutable setup field in the caller inventory, rejects pending checklist rows, and follows the core's runtime imports/re-exports. TypeScript's checker resolves imported aliases and method declarations rather than matching call text alone.

Action-only UI modules cannot import domain workflows. Mixed controllers and data adapters retain legitimate reads and presentation dependencies: the check inspects the concrete `mutationMethods` inventory in `scripts/check-action-boundary.mjs`, follows same-file helpers and rejects direct owned-workflow calls. New mutation entry points must be added to that inventory and the caller ledger. Runtime adapters, domain internals and automatic lifecycle/detection orchestration may invoke their owned dependencies. The guard is a targeted regression check; reviewers still assess newly introduced entry paths and runtime policy.

`check-action-boundary.test.mjs` constructs temporary source trees to prove missing codec/handler, alias bypass and pending-row failures without altering tracked production files. It also tests allowed domain internals, core isolation, matching CommonJS/ES schema exports and all 73 mutable setup fields. `ActionBoundaryParity.unit.test.ts` covers real codec/worker dispatch and family execution for representative cases, reports, CAPTCHA, cleanup and setup; existing domain tests cover persistence and recovery behavior. Cleanup has no shipped Discord action and retains `web_case` in both reusable-operation and durable-worker tests.

`npm run check:ci` builds and checks the application before its consumers, runs isolated application coverage outside the bot's integration setup, and retains all existing web production, browser, visual and serial database gates. `code:metrics` includes application production source, excluding colocated test files with the same production-only intent as bot test exclusions. The migration removes the replaced attention/review services, private worker handlers, fallback registry and obsolete web setup authorization helper while retaining domain behavior tests.
