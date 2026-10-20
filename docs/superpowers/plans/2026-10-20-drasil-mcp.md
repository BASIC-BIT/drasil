# Drasil MCP implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let moderators connect ChatGPT, Codex, Claude or another standard MCP client to their selected Drasil servers and use the full existing human-authorized Drasil action set.

**Architecture:** Host MCP and its OAuth issuer in the existing Next.js app. Reuse direct web operations and deliver bot-only work through the existing durable queue. Persist connection grants, exact confirmation intents and execution bindings; shared application operations retain authority, policy and domain orchestration.

**Tech stack:** TypeScript, Next.js 16.3, Postgres, Prisma migrations, existing pg/Prisma adapters, official MCP SDK v2, mcp-handler v2, Better Auth OAuth Provider/JWT/CIMD, Jest, Vitest and Playwright.

**Spec:** [Approved Drasil MCP design](../specs/2026-10-20-drasil-mcp-design.md). Read it together with this plan. Baseline is merged `6edfbd3`; the spec is committed in `d5461a4`. The user's written-spec approval is recorded in this conversation.

## Global constraints

- Deliver the initial MCP implementation as one merge-ready PR; implementation tasks can proceed by family inside that PR.
- The shared library stays directly callable. Do not add a bot HTTP listener or authenticated bot RPC.
- Native Discord operations keep their existing direct path. Existing website cookies and callback behavior remain intact.
- Expose one HTTPS Streamable HTTP endpoint at `/api/mcp` in the existing Next.js app, using its Node runtime.
- Support the adapter's 2026 protocol and 2025 Streamable HTTP compatibility path. Do not require the old 2024 HTTP+SSE transport, Redis, process affinity or proprietary client extensions.
- Keep the canonical Zod 3 validators. Any Zod 4 dependency required by the transport stays at the web boundary.
- Set access-token lifetime to 15 minutes and refresh-token lifetime to 30 days.
- Pending intents expire after ten minutes or the underlying preview's expiry, whichever comes first.
- Default list size is 25 and maximum 100. MCP waits up to five seconds within the hosting request budget.
- Settings coverage includes all 73 currently mutable fields represented by the canonical setup schemas, across all 11 sections.
- A `confirmationId` is not cryptographic evidence of human presence. Native/client-mediated confirmation is the default; authenticated Discord/site approval is an alternative.
- Preserve existing fencing, partial outcomes and enforcement-free committed report-ban recovery. Never promise exactly-once external Discord effects.
- Exclude system CAPTCHA actions, internal recovery, global administration and general Discord passthrough tools.
- Follow `AGENTS.md`, applicable child guidance and local privacy rules. Read installed Next.js documentation before writing route/UI code. Use the existing isolated worktree; do not create another nested worktree.

Run `npm run application:build` before consumer tests that read the built application package, and repeat it after application edits. Run all database commands only against the task's disposable `TEST_DATABASE_URL`. New migrations and fixtures must not reset a shared or production database. Each task's green verification repeats its listed red commands after implementation.

## Review focus

1. Two OAuth browser tabs authorize different clients or server sets; each issued token must retain its own selection. Task 4 tests flow isolation and Task 5 tests the browser interaction.
2. Optional, nullable and defaulted inputs cross the schema bridge; preserve canonical parser semantics and large Discord IDs as strings. Task 1 tests schema parity and Task 9 checks selected-message bindings.
3. Response size limits clip a page before its requested row count; the next cursor must resume after the last emitted row without skipping records. Task 6 tests this.
4. A domain deduplication key finds another interface's or actor's request; preserve its provenance and never expose that connection's private receipt. Task 8 tests the conflict.
5. Message text, display names and reasons contain instructions, HTML or mentions; treat them as data in tools, approval pages and Discord replies. Tasks 13 and 14 test rendering and allowed mentions.

## File and interface map

New files are proposals, not existing APIs. Keep SDK/auth imports out of `@drasil/application`. Add exports deliberately to its root and postgres entry points; preserve the browser-safe setup leaf.

| Location                                                                                                    | Ownership                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/application/src/delegation/{types,commands,access,confirmationPolicy,intents,execution}.ts`       | SDK-independent commands, grant/read policies, intent lifecycle and dispatch service       |
| `packages/application/src/postgres/delegation.ts`                                                           | Shared parameterized persistence and atomic intent/execution/queue binding                 |
| `apps/web/lib/mcp/{schemas,manifest,access,queries,intents,delivery,results,server,config,limits,audit}.ts` | MCP adapter, query composition, delivery, result projection and operations                 |
| `apps/web/lib/mcp/auth/{issuer,principal,flows}.ts`                                                         | Maintained OAuth integration and trusted connection mapping                                |
| `apps/web/lib/mcp/tools/{reads,cases,reports,setup,containment,approvals}.ts`                               | Focused public tool definitions and canonical command translation                          |
| `apps/web/lib/mcp/adapters/{database,queries,visibility,setup}.ts`                                          | pg composition, authorized repository reads, Discord visibility and settings preconditions |
| `src/application/adapters/delegation.ts`                                                                    | Bot persistence adapter and delegated worker admission                                     |
| Existing `requests/*`, dispatchers and runtime adapters                                                     | Typed queue expansion, preserving existing representations and domain behavior             |
| `apps/web/app/api/mcp/route.ts`, `apps/web/app/api/mcp-auth/[...all]/route.ts`, well-known routes           | One MCP endpoint and a separately mounted OAuth issuer                                     |
| `apps/web/app/mcp/{connect,select-servers,consent,connections}/`                                            | Login, guild selection, consent and connection management                                  |
| `apps/web/app/mcp/confirm/[confirmationId]/`, `src/controllers/McpCommandHandler.ts`                        | Explicit alternative approval flows                                                        |

Use these shared contracts. Define their supporting record types in `delegation/types.ts` when the owning task lands; later tasks consume those names rather than inventing parallel shapes.

- `DelegatedScope = 'drasil:read' | 'drasil:moderate' | 'drasil:configure'`.
- `GuildSelection = { mode: 'selected'; guildIds: readonly string[] } | { mode: 'all_eligible' }`.
- `DelegatedPrincipal` has `userId`, `clientId`, `connectionId`, `grantVersion` and `scopes`. Only verified auth/runtime code constructs it.
- `ConnectionGrant` has that identity binding, `selection`, `scopes`, `version`, `createdAt` and `revokedAt`. Store immutable Discord user IDs, not labels.
- `HumanCommand` is the union of existing case, detection, report, operation, setup, quarantine, cleanup and moderator CAPTCHA commands, plus explicit `close_submitted_report`, `open_submitted_report_case` and `acknowledge_attention` wrappers. The latter hold report closure choice/report ID or item IDs. Exclude system commands from this union.
- `WorkflowId` identifies a human command plus a semantic variant where required. `WorkflowDefinition` holds its public tool name, canonical parser/translator, scope, confirmation rule and `direct | queued` delivery. It never holds client-supplied authority facts.
- `ResolvedIntent` has `workflowId`, `guildId`, `command`, `commandDigest`, `authorizedDelivery`, typed `preconditions`, `stateFingerprint`, `summary` and nullable `previewExpiresAt`. Delivery is either direct or a frozen canonical `QueuedCommand` with its own digest. Preconditions contain the bound resource revision/preview or approved setup state needed for execution checks. Fingerprints cover the relevant state and policy/options, not unrelated guild changes.
- `ConfirmationMethod = 'elicitation' | 'client_confirmation' | 'website' | 'discord' | 'not_required'`. Only the runtime can select `not_required`, after the shared policy says so.
- `IntentRecord` adds the principal binding, random `confirmationId`, idempotency key, timestamps, `pending | consumed | cancelled | expired | denied` state and nullable execution link to `ResolvedIntent`.
- `ExecutionRecord` has its immutable actor/client/connection/grant/workflow/command binding, UUID execution ID, nullable queue request ID, start/completion timestamps and terminal outcome. Its public projection is `PublicActionResult` with the states in the spec and an allowlisted family outcome.
- `DelegatedDeliveryBinding` has `executionId`, `connectionId`, `grantVersion` and `commandDigest`, where this digest identifies the approved queue payload. It is trusted persistence provenance, not part of public command schemas. If a workflow derives a queue command, retain both the original intent digest and frozen delivery digest rather than comparing different command shapes or accepting any child command.

Public mutations require an `idempotencyKey` string of 1–128 characters and a guild ID. Approval tools accept only a `confirmationId`. No public schema accepts an actor, source, system purpose, grant version, confirmation method or raw internal command.

Define `McpToolDefinition` in the web manifest module in Task 1. It carries manifest identity, schema, annotations and a handler receiving a trusted principal. Define SDK-independent `DirectActionExecutor.execute(context, command, preconditions): Promise<HumanOutcome>` in the shared delegation contracts; `HumanOutcome` is the explicit union of existing family outcomes. Task 8 composes it for the web, and Task 14 composes it for Discord. Neither implementation gets a generic database-write escape hatch.

## Task 1: Executable workflow inventory and schema bridge

**Files:** Create `packages/application/src/delegation/{types,commands}.ts`, their colocated `.test.ts` files and `apps/web/lib/mcp/{manifest,schemas}.ts` with `.test.ts` files. Modify application exports, `apps/web/package.json` and `package-lock.json`.

**Interfaces:** Produce `humanCommandSchema`, `HumanCommand`, `WorkflowId`, SDK-independent `workflowDefinitions` in the shared command module, and `toMcpSchema<T>(schema: z.ZodType<T>): StandardSchemaWithJSON` in the web adapter. The web manifest binds those records to `McpToolDefinition`; no application policy imports it. The bridge's validation runs the supplied canonical parser; JSON Schema generation describes its input. Manifest entries identify every spec workflow, semantic variant, delivery and explicit internal exclusion. Public tool inputs have object roots; bounded choices can be nested discriminated objects rather than a root union incompatible with a client.

- [ ] Write failing manifest/schema tests. Derive the canonical kind inventory from the schemas with an independent caller-inventory checklist; require report-review/attention methods and all 73 settings fields too. Test defaults, nullability, strict unknown-field rejection and string snowflakes. Name the bridge case `it('preserves canonical defaults and rejects authority injection')`; the assertions below belong to that case.

  ```ts
  const result = await bridge['~standard'].validate(inputWithOmittedDefaults);
  expect(result).toEqual({ value: canonicalSchema.parse(inputWithOmittedDefaults) });
  expect(
    await bridge['~standard'].validate({ ...validInput, actor: { userId: 'forged' } })
  ).toHaveProperty('issues');
  expect(publicTools).not.toContain('drasil_apply_captcha_pass');
  expect(settingsFieldCoverage.size).toBe(73);
  ```

- [ ] Run `npm run application:test -- delegation/commands --runInBand` and `npm run web:test -- lib/mcp/schemas.test.ts lib/mcp/manifest.test.ts`. Expect missing new contracts, then real semantic failures once imports exist.
- [ ] Implement the contracts, manifest and bridge. Pin compatible researched lines: `mcp-handler@2.3.0`, `@modelcontextprotocol/server@2.3.1`, `better-auth@1.7.12`, `@better-auth/oauth-provider@1.7.12`, `@better-auth/cimd@1.7.12`; add matching official SDK client as a test dependency. Keep Zod 3 canonical. Use a dependency alias for transport-required Zod 4 if necessary, and a maintained Zod-3 JSON Schema converter rather than hand-maintained parallel schemas. Compile and exercise a real SDK registration with the bridge before continuing.
- [ ] Repeat the tests and `npm run web:typecheck`; expect PASS with SDK/schema imports resolved. Add one negative fixture per exclusion/authority-injection class, not snapshots of the implementation itself.
- [ ] Commit `feat: define MCP workflow contracts and canonical schema bridge`.

Manifest naming defaults to `drasil_<command kind>`. Name the non-command wrappers `drasil_close_submitted_report`, `drasil_open_submitted_report_case` and `drasil_acknowledge_attention`. Use distinct named workflows for moderator/admin case opening and repair, guild-audit/administrator thread sweeps, and provision/verification setup modes. MCP maps ordinary ban to `native_action`; retain `slash_command` reason-default compatibility in queue and native regression tests rather than exposing a transport selector. Source is always `mcp` for MCP-origin commands.

## Task 2: Connection persistence shared by web and worker

**Files:** Create `packages/application/src/postgres/delegation.ts`, `apps/web/lib/mcp/adapters/database.ts`, `src/application/adapters/delegation.ts` and `src/__tests__/integration/McpConnections.integration.test.ts`. Modify `prisma/schema.prisma`, application exports and `src/__tests__/testDb.ts`. Create `prisma/migrations/20261020210000_add_mcp_connections/migration.sql`.

**Interfaces:** Produce `DelegationDatabase` with `query` and `transaction` methods over a small driver-neutral SQL interface, and `createDelegationStore(database): DelegationStore`. Initially the store exposes `createConnection(input)`, `findConnection(id)`, `updateSelection(principal, selection, expectedVersion)` and `revokeConnection(principal, expectedVersion)`. Mutations compare actor/client/version and return a new grant or a typed conflict/denial.

- [ ] Write real Postgres tests for selected/all-eligible storage, concurrent grant edits, revocation and another user's/client's attempted edit. Assert version increments once and no row changes on denial. Include `it('allows only one concurrent grant update')` with `expect(successes).toHaveLength(1)` and `expect(stored.version).toBe(2)`.
- [ ] Run `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern=McpConnections.integration.test.ts` against a disposable test database; expect missing schema/store failures.
- [ ] Add `mcp_connections` and selected-guild rows with indexes, unique bindings and additive migrations. Implement the shared SQL store; adapt existing pg pool and Prisma transactions without importing pg/Prisma into application core. Extend test cleanup for new tables. Enable RLS and revoke `anon`/`authenticated` privileges like the existing private tables.
- [ ] Repeat integration tests, then `npm run db:check:rls`, `npm run application:build` and `node scripts/check-application-imports.mjs`. Expect both runtimes to observe immediate revocation through the same stored grant.
- [ ] Commit `feat: persist delegated MCP connection grants`.

## Task 3: Guild eligibility, capability scopes and read policies

**Files:** Create `packages/application/src/delegation/access.ts`, `access.test.ts`, `apps/web/lib/mcp/access.ts` and `access.test.ts`. Modify `packages/application/src/authorization.ts`, family authority helpers only where needed, and application exports.

**Interfaces:** Produce `createDelegatedAccess(deps)` with `authorizeGuild(principal, guildId, scope): Promise<AccessDecision>`, `authorizeRead(principal, query): Promise<AccessDecision>`, `authorizeWorkflow(principal, guildId, command): Promise<AccessDecision>` and `listEligibleGuilds(principal, page): Promise<GuildPage>`. `AccessDecision` is an authorized grant/fresh-facts binding or a typed denial. `ReadKind` covers cases, detections, reports/intakes, member context, attention, setup, diagnostics and own execution status. Workflow admission reuses family authority predicates and never replaces the operation's execution-time checks.

- [ ] Write failing tests for owner/Admin/Manage Server/Moderate/Ban/Kick-only users, case-responder-only users, departed members and inactive Drasil installations. Assert selected grants exclude newly eligible guilds, all-eligible grants include them, and staff-role eligibility does not grant case opening or banning. Name the role-only case `it('does not turn staff eligibility into enforcement authority')`.

  ```ts
  expect(await access.authorizeRead(roleOnly, caseQuery)).toMatchObject({ kind: 'allowed' });
  expect(await access.authorizeWorkflow(roleOnly, guildId, banCommand)).toMatchObject({
    kind: 'denied',
  });
  expect(await access.authorizeGuild(revoked, guildId, 'drasil:read')).toMatchObject({
    kind: 'denied',
  });
  ```

- [ ] Run `npm run application:test -- delegation/access --runInBand` and `npm run web:test -- lib/mcp/access.test.ts`; expect policy failures.
- [ ] Implement the spec's read matrix using fresh `AuthorityPort` facts and the existing configured staff-role resolver. Extract reusable permission predicates from their current owners when necessary; do not copy divergent authority lists. Member-context requests declare `report | case | ban | kick | configure` purpose and check that workflow authority. Discover active bot guilds in bounded pages with at most four concurrent membership requests; a 60-second discovery cache supplies hints only. Reads/admission always refresh relevant authority. Keep `SetupDashboardService`'s existing Manage Server gate unchanged.
- [ ] Repeat tests, with injected Discord failure and changed-role facts; expect fail-closed results and no unauthorized resource query.
- [ ] Commit `feat: authorize delegated guild access and Drasil reads`.

## Task 4: Maintained OAuth issuer and verified MCP principals

**Files:** Create `apps/web/lib/mcp/auth/{issuer,principal,flows}.ts`, `config.ts`, corresponding `.test.ts`/`.integration.test.ts` files, `apps/web/app/api/mcp-auth/[...all]/route.ts` and `apps/web/app/.well-known/oauth-authorization-server/api/mcp-auth/route.ts`. Add provider-owned namespaced models/migration `20261020211000_add_mcp_oauth/migration.sql`. Modify root/web `package.json`, `apps/web/vitest.config.ts`, `.env.example` and `prisma/schema.prisma`; create `apps/web/vitest.integration.config.ts`.

**Interfaces:** Produce `createMcpIssuer(deps)`, `verifyMcpPrincipal(request: Request): Promise<DelegatedPrincipal>` and `createAuthorizationFlow(session, providerRequest): Promise<AuthorizationFlow>`. A flow binds the issuer session, client, requested scopes and opaque flow nonce to one pending connection selection. No shared mutable session field can select another tab's grant.

- [ ] Write issuer integration tests using the actual library and a controlled Discord identity endpoint. Exercise discovery, S256 PKCE, wrong redirect/code verifier, scope/audience rejection, 900-second access expiry, 30-day refresh expiry, rotation/replay, DCR, CIMD public-address validation and connection revocation. Interleave two clients and two grant selections in one browser session; assert each token's grant is correct. Include a phone-only Discord account with no email, and a provider-internal user UUID different from its Discord ID. Test disabled module/route imports without new secrets so existing builds remain usable. Include `it('isolates concurrent OAuth grant references')` with `expect(tokenA.delegation_grant_id).toBe(grantA.id)` and `expect(tokenB.delegation_grant_id).toBe(grantB.id)` after interleaved flows and refreshes.
- [ ] Run `npm run web:test:integration -- lib/mcp/auth` after deploying migrations to the disposable DB. This root script must forward to the new web `test:integration` script. Expect missing issuer/schema failures; ordinary web tests must exclude `*.integration.test.ts`.
- [ ] Compose Better Auth with the existing pg pool, separate base path/cookies, Discord `identify` sign-in, JWT, OAuth Provider and CIMD Node transport. Its user model requires email, so follow the documented no-email mapping with an internal `<Discord ID>@discord.placeholder.invalid` value, never a contact address. Disable email login and automatic email-based account linking. Derive the principal's Discord user ID from the verified provider-account relation, not the issuer's user UUID or email. Use the provider's post-login consent-reference mechanism and signed `delegation_grant_id`/`delegation_grant_version` claims; validate their binding through refresh as well as initial issuance. Keep client identity separate from grant ownership and require connection lookup on every call. Use trusted configured origins, explicit resource scopes, public PKCE clients, rate-limited DCR and CIMD; disable unused grants and consent bypass. Generate/review provider schema with its documented CLI, namespace every table/model and add private-table ACL/RLS.
- [ ] Repeat issuer integration tests and `npm run web:test -- lib/session.test.ts lib/oauthState.test.ts lib/mcp/config.test.ts`. Expect old website cookies/callbacks unchanged, no Discord token in MCP output, and no fallback from an unbound token to a user/client-wide grant.
- [ ] Commit `feat: add Discord-backed OAuth authorization for MCP`.

Configuration uses `DRASIL_MCP_ENABLED`, `DRASIL_MCP_AUTH_SECRET` and `DRASIL_MCP_CURSOR_SECRET`, with the canonical public app origin already configured by Drasil. Default MCP to disabled. Derive issuer `/api/mcp-auth` and resource `/api/mcp` from that trusted origin. Require HTTPS in production, allowing loopback HTTP only in development. Document the extra Discord callback URI; register it only when rollout is authorized. Do not provision another hosted auth service.

## Task 5: Server selection, consent and connection management UI

**Files:** Create pages/actions under `apps/web/app/mcp/{connect,select-servers,consent,connections}/`, focused components under `apps/web/components/mcp/`, action tests and `apps/web/e2e/mcp-connections.spec.ts`. Extend existing fixture composition only where required.

**Interfaces:** Produce server actions `selectMcpServers(flowId, selection)`, `consentMcpConnection(flowId, grantedScopes)` and `revokeMcpConnection(connectionId, expectedVersion)`, using the authenticated issuer session and Tasks 2–4. No form supplies actor/client identity or a trusted continuation URL.

- [ ] Write failing action/browser tests for selected servers, all eligible including future servers, reduced scopes, consent decline, revocation and CSRF/session/flow substitution. Interleave two browser tabs and verify the client/server summary in each remains bound to its own flow. Include `test('keeps each consent tab bound to its selected client and guilds')` and assert each page's client label/server selection before accepting, then `expect(connectionA.selection).toEqual(selectionA)` and the equivalent assertion for B.
- [ ] Run `npm run web:test -- app/mcp` and `npm run web:e2e -- mcp-connections.spec.ts`; expect missing UI/actions.
- [ ] Implement login, selection and consent through the provider's continuation API. Display client metadata as escaped untrusted text, exact capability scopes and explicit future-server inclusion. Management shows only the actor's own grants, allows versioned selection changes and revocation, and invalidates pending intents on grant changes. Keep UI flat and product-focused. Fixture auth must be injected in test composition, with no production bearer/cookie bypass.
- [ ] Repeat tests plus accessibility/keyboard checks in the browser journey. Expect edits to require renewed consent/version binding rather than silently expanding existing tokens.
- [ ] Commit `feat: add MCP connection consent and management`.

## Task 6: Authorized queries, channel visibility and pagination

**Files:** Create `apps/web/lib/mcp/{queries,results}.ts`, `adapters/{queries,visibility}.ts`, `tools/reads.ts` and their tests; add narrowly required Discord channel/thread-member API methods in `apps/web/lib/discordApi.ts`. Reuse `discordPermissions.ts` and existing case/report/member/setup query adapters where their returned fields are suitable.

**Interfaces:** Produce strict `querySchema`, `createMcpQueries(deps).execute(principal, query): Promise<QueryResult>` and `authorizeDiscordContent(principal, guildId, channelId): Promise<AccessDecision>`. Query discriminants are `list_cases`, `get_case`, `list_case_history`, `list_detections`, `get_detection`, `list_reports`, `get_report`, `list_report_evidence`, `get_intake`, `get_member_context`, `list_attention`, `get_setup`, `get_diagnostics` and `get_message_context`. `list_guilds`/`get_capabilities` delegate to Task 3. History/evidence detail uses the same pagination contract; clipping a detail response must not make its remaining records inaccessible.

- [ ] Write query tests asserting authorization precedes data access, guild binding is in SQL, global/null-guild rows stay inaccessible and reporter-only queries cannot return staff records. Test overwrite changes, private-thread membership, administrator/Manage Threads behavior, missing visibility and bot denial. Test tampered/cross-connection/filter cursors and a page of large records clipped by byte budget. Name the clipping case `it('resumes after the last emitted row')`; use the page/cursor assertions below.

  ```ts
  expect(queryWithoutLimit.limit).toBe(25);
  expect(querySchema.safeParse({ ...validListQuery, limit: 101 }).success).toBe(false);
  expect(secondPage.items[0].id).toBe(firstOmittedRow.id);
  expect(await readHiddenThread()).toMatchObject({ kind: 'denied' });
  ```

- [ ] Run `npm run web:test -- lib/mcp/queries.test.ts lib/mcp/adapters/visibility.test.ts`; expect query/visibility failures.
- [ ] Implement parameterized, guild-scoped list/detail queries with Task 3 policy, stable timestamp/ID ordering and signed opaque cursors bound to principal/guild/filters. Use the actor's effective View Channel/Read Message History and private-thread rules as well as bot access. Separate stored staff evidence from raw Discord reads. Limit each text field to 4,000 characters, attachment metadata to 10 entries and the serialized result to 65,536 bytes; mark truncation and advance after the last emitted row. Return attachment metadata, not signed credential URLs or automatic remote downloads.
- [ ] Repeat tests and existing Discord-permission/content-query regressions. Expect no row loss, cross-guild leakage, raw content through bot-only visibility or caller-supplied URL fetching.
- [ ] Commit `feat: expose authorized Drasil queries for MCP`.

## Task 7: Exact-intent lifecycle and shared confirmation policy

**Files:** Create `packages/application/src/delegation/{confirmationPolicy,intents}.ts` with tests, `apps/web/lib/mcp/intents.ts` with tests, and `McpIntents.integration.test.ts` under bot integration tests. Extend the shared postgres store and Prisma schema; add `20261020212000_add_mcp_intents_and_executions/migration.sql`.

**Interfaces:** Produce `confirmationRequirement(command: HumanCommand): 'none' | 'confirm' | 'preview_confirm'`, `prepareIntent(principal, invocation): Promise<IntentRecord>`, and store methods `saveIntent`, `loadIntent`, `denyIntent`, `cancelIntent` and `acceptIntent(principal, confirmationId, method, delivery): Promise<ExecutionRecord>`. `delivery` is a resolved direct descriptor or canonical `EnqueueInput`; the SQL store performs consumption plus queue linking atomically. The runtime resolves and validates current state before accepting.

- [ ] Write lifecycle tests for every existing confirmation requirement plus MCP settings diffs; reads/audits/previews/ordinary attention need no extra modal. Assert changed options/reason/target/grant, stale fingerprints and expired previews fail. Concurrent acceptance must return one execution; cancelled/expired/denied approvals cannot execute. Inject queue insertion failure and assert both consumption and insertion roll back. Name the concurrency case `it('links one execution for concurrent confirmation')`; use the expiry and execution-count assertions below.

  ```ts
  expect(expiryWithLongPreview - createdAt).toBe(10 * 60_000);
  expect(expiryWithShortPreview).toBe(previewExpiresAt);
  expect(new Set(concurrentResults.map((r) => r.executionId)).size).toBe(1);
  expect(enforcementCallsAfterPrepare).toBe(0);
  ```

- [ ] Run `npm run application:test -- delegation --runInBand`, `npm run web:test -- lib/mcp/intents.test.ts` and `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern=McpIntents.integration.test.ts`; expect missing lifecycle/storage behavior.
- [ ] Implement canonical versioned JSON digests, state/policy fingerprints, random 32-byte opaque confirmation IDs and immutable principal bindings. Bound pending intents to 128 per connection and 1,024 per actor, rejecting new creation at capacity. Share policy decisions with existing issuers where they currently own the requirement. Keep cleanup/quarantine/CAPTCHA protocols intact. `not_required` is an internal runtime decision; a client cannot supply it. Store public execution UUIDs separately from worker/private fencing tokens.
- [ ] Repeat tests, real DB concurrency and `npm run db:check:rls`; expect exact idempotent retries, changed-argument conflicts and no executable pending intent.
- [ ] Commit `feat: persist exact action intents and one-use approval`.

## Task 8: Direct/queued execution and worker grant checks

**Files:** Create `packages/application/src/delegation/execution.ts`, its tests, `apps/web/lib/mcp/delivery.ts`, `delivery.test.ts`, `src/__tests__/integration/McpDelivery.integration.test.ts`; extend `results.ts`, shared delegation store, `requests/{encode,decode}.ts`, `src/application/{requestRuntime,createBotApplication}.ts`, the bot delegation adapter and DI composition. Modify `ModerationActionRequestService.ts` only for typed delegated result/failure integration.

**Interfaces:** Produce SDK-independent `createDelegatedActionService(deps)` with `submit(principal, invocation)`, `confirm(principal, confirmationId, method)` and `status(principal, executionId)`, all returning `Promise<PublicActionResult>`. Dependencies are the shared store, fresh access, an intent resolver, typed queue admission and `DirectActionExecutor`. Web exports `submitMcpAction`, `confirmMcpAction` and `getMcpActionStatus` as its composition of those methods. Produce `authorizeDelegatedRequest(request, recovery): Promise<WorkerAdmission>` for the bot. Extend `encodeQueuedAction(context, command, binding?: DelegatedDeliveryBinding)` without changing existing two-argument representations. `WorkerAdmission` distinguishes new execution, denied, already-bound/uncertain and committed reconciliation.

- [ ] Write tests for direct attention/report review/setup without queue insertion, atomic queued acceptance, duplicates and a global domain key colliding with another actor/interface. Revoke a grant before a worker starts; expect a denied outcome and zero workflow calls. Expire only the access token after acceptance; expect work can finish. Reject forged binding metadata and digest/actor mismatches. Recover a committed report ban after revocation without new enforcement. Include `it('denies revoked queued work before effects')` with `expect(result.state).toBe('denied')` and `expect(workflow.execute).not.toHaveBeenCalled()` after revocation and actual worker admission.
- [ ] Run `npm run web:test -- lib/mcp/delivery.test.ts`, `npx jest --runInBand --testPathPattern='src/__tests__/unit/ModerationActionRequest'` and `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern=McpDelivery.integration.test.ts`; expect execution/admission failures.
- [ ] Implement the direct execution record and queue path using Task 7, existing `buildEnqueueStatement` and request-bound confirmation ports. Validate stored grant, execution link, exact command and source before issuing evidence. Apply fresh grant checks before starting effects; after start preserve required reconciliation. Existing rows without delegated provenance retain behavior. Preserve setup advisory-lock serialization in the same acceptance transaction. Keep original conflicting requests immutable and expose only an authorized already-handled/conflict result, never their private receipt. Project all eight public states and family-specific outcomes without changing stored worker status enums.
- [ ] Repeat tests, including direct process interruption. Expect a durable uncertain receipt rather than automatic non-idempotent replay. Enforce the five-second response deadline with an injected clock and authorized polling with retry guidance.
- [ ] Commit `feat: dispatch approved MCP actions through existing runtimes`.

## Task 9: Complete case delivery and safe native enforcement

**Files:** Modify `packages/application/src/requests/{commands,encode,decode,receipt}.ts`, `packages/application/src/cases/commands.ts` only if required for canonical typing, `src/application/{requestDispatch,requestRuntime}.ts`, `src/application/adapters/cases.ts` and `src/repositories/types.ts`. Create `apps/web/lib/mcp/tools/cases.ts`, tests and `src/__tests__/integration/McpNativeEnforcement.integration.test.ts`. Extend `src/__tests__/integration/ActionRequestEnqueue.integration.test.ts` with independent new-kind fixtures. Add queue discriminants through `prisma/migrations/20261020213000_expand_mcp_case_delivery/migration.sql`.

**Interfaces:** Produce `createCaseTools(deps): readonly McpToolDefinition[]`, typed queue support for `ban_user`/`kick_user`, both case-open and repair intents, and `reconcileNativeEnforcement(executionId): Promise<PublicActionResult>`. Consume Task 1's tool definition contract.

- [ ] Write codec and actual-worker parity tests for all case kinds and semantic variants. Assert native case opening needs Moderate Members, dashboard semantics need Manage Server, admin repair remains admin-only and optional reasons preserve native/slash defaults. Reject selected-message fields belonging to another guild or invisible channel, changed after intent creation, or encoded as numeric snowflakes. Include `it('does not repeat enforcement after a lost provider acknowledgement')` with `expect(discordBan).toHaveBeenCalledTimes(1)` and `expect(receipt.state).toBe('uncertain')` after a second worker attempt.
- [ ] Run `npm run application:test -- 'cases|requests' --runInBand`, `npx jest --runInBand --testPathPattern=ActionBoundaryParity` and `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern='McpNativeEnforcement|ActionRequestEnqueue'`; expect unsupported delivery/receipt and interruption behavior.
- [ ] Extend canonical codecs/registry and implement tool translation through existing case actions. Persist a fenced native enforcement start before invoking ban/kick; a second worker must never invoke that started execution again. Timeout, transport reset or process loss after this marker is uncertain. Reconciliation observes current Discord/domain state without repeating enforcement or claiming causality from membership absence/current ban alone. Definitive pre-effect denial may be recorded as denied; an intentional retry after uncertainty requires a fresh intent/key and a clear warning that historical outcome is unknown. Native Discord calls remain direct.
- [ ] Repeat tests with two worker attempts, a thrown timeout after a simulated successful Discord call and interruption before outcome persistence. Expect at most one enforcement invocation for that execution and faithful uncertain/no-op results. Verify the existing forty-kind storage fixtures remain unchanged while adding independently supplied new fixtures.
- [ ] Commit `feat: deliver native case moderation safely over the action queue`.

## Task 10: Reports, intake choices and uncertain-ban review

**Files:** Modify `packages/application/src/{reports/commands,reports/review,detections/commands}.ts`, `packages/application/src/requests/{reports,detections,commands,encode,decode}.ts`, `src/application/{reportDispatch,detectionDispatch,requestDispatch}.ts`, `src/application/adapters/{reports,detections}.ts`, `src/repositories/types.ts` and `apps/web/lib/application/adapters/reportReview.ts`. Create `apps/web/lib/mcp/tools/reports.ts` and tests. Add `prisma/migrations/20261020214000_expand_mcp_report_delivery/migration.sql`.

**Interfaces:** Produce `createReportTools(deps)` and bot delivery for `submit_message_report`, `confirm_intake_candidate`, `reject_intake_candidates`, `prepare_report_ban_review` and `review_uncertain_report_ban`. Extract read-only `prepareSubmittedReportCaseOpen(context, { reportId }): Promise<ReportCasePreparation>` from the existing review action; it returns its current no-op/denial outcomes or a ready, bound `open_case_from_observed_detection` command and candidate precondition. Existing `reportReview.openCase` reuses it. Provide `resolveIntakeChoice(principal, reference): Promise<ResolvedIntakeChoice>` and connection-bound opaque review references. They resolve trusted prompt/thread/token fields; public callers never send prompt secrets or attempt tokens.

- [ ] Write tests for user/message reports, start/close intake, reporter-versus-staff ownership, candidate confirm/reject, prompt rotation, claimed intake and submitted status bookkeeping failure. Cover observed/report bans, dismissal/undo/accounting, report close's three dispositions and open-case handoff. Test uncertain-ban review after fresh ban authority and stale review references. Include `it('preserves a submitted report when final intake bookkeeping fails')` with `expect(confirmedSubmission).toHaveBeenCalledTimes(1)` and `expect(outcome).toMatchObject({ status: 'submitted', statusRecorded: false })` through the new delivery/tool path.
- [ ] Run `npm run application:test -- 'reports|detections|requests' --runInBand`, `npx jest --runInBand --testPathPattern=ModerationActionRequestDispatch` and `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern='ReportBanRecovery|ActionRequestEnqueue'`; expect missing delivery branches before implementation. Extend the real-DB independent fixture set with this task's new kinds.
- [ ] Add typed codecs and handler entries, safe outcome projections and tools using existing application actions. Message-report input must pass Task 6's actor/channel visibility check before bot message retrieval. Submitted-report closure stays direct. MCP report-case preparation uses the shared read-only helper and freezes its derived case command in `authorizedDelivery` before confirmation; Task 8 atomically enqueues that exact payload. Recheck the report/candidate precondition in the worker before case effects. Do not call the existing effectful queue opener while preparing an intent or compare its derived command against the wrapper digest. Existing website `reportReview.openCase` keeps its direct orchestration and queue handoff through the same helper. Preserve reporter ownership and internal report-ban runtime envelopes. Do not turn uncertain review into a second ban attempt.
- [ ] Repeat tests and existing report-ban persistence/recovery tests serially. Expect no leaked prompt tokens, no duplicate confirmed submission and enforcement-free committed recovery.
- [ ] Commit `feat: expose report triage and intake workflows through MCP`.

## Task 11: Configuration, setup and guild operations

**Files:** Modify `packages/application/src/requests/{setup,operations,commands,encode,decode}.ts`, `packages/application/src/{setup,operations}/commands.ts`, `src/application/{setupDispatch,operationsDispatch,requestDispatch}.ts`, `src/application/adapters/{setup,operations}.ts` and `src/repositories/types.ts`. Create `apps/web/lib/mcp/tools/setup.ts`, `apps/web/lib/mcp/adapters/setup.ts`, their tests and `src/__tests__/integration/McpSetupPreconditions.integration.test.ts`. Modify `apps/web/lib/setupDataAdapter.ts`, `src/config/ConfigService.ts` and `src/repositories/ServerRepository.ts` for atomic expected-state writes. Add `prisma/migrations/20261020215000_expand_mcp_setup_operations/migration.sql`.

**Interfaces:** Produce `createSetupTools(deps)` and delivery for integrity audit, guild-audit thread closure, `update_settings`, heuristics/reset, lockdown allow/disable, setup verification mode and report-panel clearing. Existing `update_setup` stays direct; `SetupUpdateActions` currently supports only that command. Define `SetupWritePrecondition` containing the approved `SetupServerRecord`, compared through the canonical 73 mutable-field mapping. Add `updateGuildSetup(update, precondition?: SetupWritePrecondition)` to the web adapter contract and `updateSetupIfUnchanged(guildId, precondition, change): Promise<Server | null>` through the bot config/repository boundary. The request-bound MCP adapters supply the approved state; existing callers retain their current signatures/behavior. Do not use the narrower `SetupConfigurationState` alone as the precondition, because it omits mutable channel columns.

- [ ] Write field-coverage and policy tests for all 11 sections/73 fields, owner-only full analytics, provider prerequisites, fresh reason/enforcement policy changes, panel repair/repost/clear and both setup modes. Test queue sync/clear, lockdown audit/apply, intake preview/execute, both thread-sweep variants and integrity audit. Race two settings writes after the same approved diff, including an admin-channel change rather than only JSON settings; the stale write must fail before persistence. Include `it('rejects a confirmed write after the admin channel changes')` with `expect(result).toMatchObject({ state: 'denied', code: 'stale_state' })` and `expect(stored.admin_channel_id).toBe(otherWritersChannelId)`.
- [ ] Run `npm run application:test -- 'setup|operations|requests' --runInBand`, `npm run web:test -- lib/mcp/tools/setup.test.ts lib/mcp/adapters/setup.test.ts` and `JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern='McpSetupPreconditions|ActionRequestEnqueue'`; expect missing coverage/precondition behavior. Add independent real-DB fixtures for the new kinds.
- [ ] Implement bot delivery and strict section patches with the existing workflows. For direct and queued configuration writes, compare approved state and persist under the same row transaction; do not check on one connection and write on another. Inject the precondition into the request-bound configuration port, preserve ConfigService cache invalidation and reuse the current adapter's writes/CAPTCHA cancellation. Reject a stale diff and request a new intent. Provisioning retains its guild serialization, partial outcomes and panel behavior. Verification-mode inputs come from the MCP form, not a fabricated Discord interaction. Do not add throwing stub methods to make the narrower web application look like the full bot runtime.
- [ ] Repeat tests and existing setup browser/config command regressions. Expect native command provenance unchanged and audits/previews to request no unused confirmation.
- [ ] Commit `feat: expose Drasil configuration and guild operations through MCP`.

## Task 12: CAPTCHA, quarantine, cleanup and attention tools

**Files:** Create `apps/web/lib/mcp/tools/containment.ts`, `containment.test.ts`; extend query/reference adapters and manifest. Modify existing containment/cleanup runtime composition only for delegated provenance and status projection.

**Interfaces:** Produce `createContainmentTools(deps)` and `resolvePreviewReference(principal, reference): Promise<ResolvedPreview>`. The result includes the canonical persisted quarantine preview or cleanup job/generation and its expiry. Attention tools reuse Task 8's direct execution path, including per-item batch results.

- [ ] Write tests for moderator CAPTCHA challenge/retry/bypass, expected challenge generation and stale case revision. Exercise quarantine preview/confirm/execute and cleanup source/hour/day/seven-day scopes in delete-only and ban-with-cleanup modes. Assert a different actor/connection/case/job/generation cannot reuse a preview, and acknowledgement batches preserve individual denials/no-ops. Include `it('rejects reuse of another connections cleanup preview')` with `expect(result.state).toBe('denied')` and `expect(cleanupEffects).not.toHaveBeenCalled()`.
- [ ] Run `npm run application:test -- 'containment|messageCleanup|operations/attention' --runInBand` and `npm run web:test -- lib/mcp/tools/containment.test.ts`; expect missing public tools/reference resolution.
- [ ] Implement tool definitions and trusted reference resolution using existing job creation, persisted snapshots and domain effects. Preview summaries must honor raw-content visibility. Preserve frozen scope, fingerprints, CAPTCHA credentials and completion-hook ordering. Register no CAPTCHA pass/attention system tool and no generic member/role/message mutation.
- [ ] Repeat targeted tests, transactional CAPTCHA integration and existing cleanup/quarantine browser journeys. Expect internal tokens absent from JSON/text results and cleanup partial/uncertain states preserved.
- [ ] Commit `feat: expose existing containment and cleanup workflows through MCP`.

## Task 13: Authenticated MCP endpoint, elicitation and receipts

**Files:** Create `apps/web/lib/mcp/server.ts`, `tools/approvals.ts`, tests and `apps/web/app/api/mcp/route.ts`. Add `apps/web/app/.well-known/oauth-protected-resource/route.ts` and `apps/web/app/.well-known/oauth-protected-resource/api/mcp/route.ts` as aliases of the same configured resource metadata handler. Extend schema/result/manifest wiring; update `scripts/check-action-boundary.mjs` and its fixture tests for new public mutation entry points.

**Interfaces:** Produce `createMcpHandler(deps): (request: Request) => Promise<Response>` in Drasil's adapter, registering Tasks 6 and 9–12. `confirm_action` and `cancel_action` accept only `{ confirmationId }`; `get_action_status` accepts only `{ executionId }`. Approvals use Task 8's `confirmMcpAction` with a runtime-selected method.

- [ ] Write real SDK client/HTTP tests for discovery, unauthorized challenges, scopes, reads, full tool inventory and a controlled mutation. Exercise native elicitation accept/decline/cancel and a client without elicitation. Test 2026 per-request capability/continuation binding separately from 2025 Streamable HTTP and its stateless GET/DELETE behavior. Reject website-cookie-only authentication and invalid origin/host requests through the maintained adapter's security controls. A different principal or modified command in a continuation must fail. Render hostile message/name/reason text as data; no instruction text can select a new action or bypass confirmation. Include `it('returns a saved confirmation before any mutation')` with `expect(result.structuredContent).toMatchObject({ state: 'confirmation_required' })` and `expect(enforcement).not.toHaveBeenCalled()` for a client without elicitation.
- [ ] Run `npm run web:test -- lib/mcp/server.test.ts app/api/mcp/route.test.ts` and `npm run action:boundary`; expect missing endpoint/protocol wiring.
- [ ] Compose the maintained handler, verified principal, required scopes and one metadata owner. Save the intent before prompting; never count initial host tool approval as approval of an unseen generated summary. If elicitation is unavailable in the negotiated SDK/adapter path, return `confirmation_required` and the saved summary/ID. Use that two-step path for 2025 fallback unless the maintained adapter supports native elicitation without session affinity; do not add a stateful shim. Let the SDK implement 2026 continuation semantics. Keep annotations accurate, results bounded and all command effects behind existing shared operations. Return queued receipts at five seconds and enforce receipt ownership on polling.
- [ ] Repeat SDK/route tests, production Next build and boundary guard. Expect no SDK imports in bot/application core, no secrets in serialized output, no session affinity and no browser hop for the standard two-step flow.
- [ ] Commit `feat: serve the authenticated Drasil MCP endpoint`.

## Task 14: Website and Discord approval alternatives

**Files:** Create `apps/web/app/mcp/confirm/[confirmationId]/page.tsx`, `apps/web/app/mcp/confirm/[confirmationId]/actions.ts`, `src/controllers/McpCommandHandler.ts`, `src/application/adapters/reportReview.ts`, unit/browser tests and `apps/web/e2e/mcp-confirmation.spec.ts`. Modify `src/controllers/{CommandHandler,commandDefinitions}.ts`, `src/application/{createBotApplication,adapters/delegation}.ts` and DI bindings; keep the new controller focused.

**Interfaces:** Produce `approveMcpIntentFromWebsite(session, confirmationId)` and `approveMcpIntentFromDiscord(interaction, confirmationId)`. Both load the original intent/grant and derive the actor from their authenticated runtime; they call Task 8's shared action service. Add `createBotDirectActionExecutor(deps): DirectActionExecutor` for the direct workflow subset, including `createBotReportReviewActions(deps): ReportReviewActions` using the existing shared factory and bot repository/message ports. Add `/mcp confirm <confirmation-id>` and `/mcp cancel <confirmation-id>` with ephemeral responses and no unsolicited message delivery.

- [ ] Write tests for the originating actor, a different Discord identity, another guild, revoked grant, expired intent and concurrent native/site/Discord approvals. Test tampered hidden fields, HTML in summaries and `@everyone` in labels/reasons. Assert no dispatch on page GET or slash invocation before the saved summary's explicit approval interaction. Include `it('shares one execution across simultaneous approval methods')` with `expect(new Set(receipts.map((r) => r.executionId)).size).toBe(1)` and `expect(enforcement).toHaveBeenCalledTimes(1)`.
- [ ] Run `npx jest --runInBand --testPathPattern=McpCommandHandler`, `npm run web:test -- app/mcp/confirm` and `npm run web:e2e -- mcp-confirmation.spec.ts`; expect missing alternatives.
- [ ] Implement the saved-summary page with CSRF-protected approve/cancel actions and a Discord confirmation button flow bound to the initiating actor. Use `allowedMentions: { parse: [] }`, escaped text and ephemeral replies. Preserve original client/connection provenance; approving in another interface does not transfer the execution to a different grant. Compose Task 8's SDK-independent service in both runtimes. The bot can execute the direct subset through equivalent shared setup/attention/report-review adapters; bot-delivered workflows still enqueue. Preserve Task 11's settings precondition on this path. Do not make status polling dispatch a pending mutation, import web modules into the bot, or add authenticated RPC.
- [ ] Repeat tests. Expect all three approval methods to return the same execution under concurrency and cancelled intents to remain inert.
- [ ] Commit `feat: support website and Discord confirmation of MCP intents`.

## Task 15: Limits, retention, audit and rollout controls

**Files:** Create `apps/web/lib/mcp/{limits,audit}.ts` with tests, extend shared delegation persistence for limits/cleanup, bot worker admission and `.env.example`. Create `docs/dev/mcp.md` and `docs/deploy/mcp.md`; extend deployment configuration only for necessary disabled-by-default settings. Add `20261020220000_add_mcp_operational_limits/migration.sql` if persistence needs another table.

**Interfaces:** Produce `checkMcpLimit(subject, category): Promise<LimitDecision>`, `recordMcpAudit(event): Promise<void>` and `pruneExpiredMcpData(now, limit): Promise<number>`. `LimitDecision` is `{ kind: 'allowed' }` or `{ kind: 'limited'; retryAfterSeconds: number }`. `LimitSubject` is a trusted principal with optional guild ID or an unauthenticated registration bucket with a hosting-verified IP hash. Never trust an arbitrary caller-supplied forwarding header. Use shared persisted limits for multi-instance deployments; provider metadata/DCR limits stay with the maintained issuer wherever supported.

- [ ] Write tests for disabled MCP, multiple web instances sharing limits, expired intent capacity cleanup, log redaction and flag changes while queued/after effects started. Reject registration abuse without allocating unlimited clients; never prune protected execution or report-ban outcomes. Include `it('shares read limits across web instances')` with `expect(lastDecision.kind).toBe('limited')` on the 121st per-connection read in one minute, split across two independently composed adapters.
- [ ] Run `npm run web:test -- lib/mcp/limits.test.ts lib/mcp/audit.test.ts lib/mcp/config.test.ts` and `npx jest --runInBand --testPathPattern=ModerationActionRequestService`; expect missing operational controls.
- [ ] Implement per-minute budgets of 120 reads/30 submissions/20 new intents per connection, 240/60/40 per user and 600/60/40 per guild. Limit unauthenticated registration to 10 per IP/hour and 100 globally/hour; use provider metadata defaults capped at 16 concurrent fetches, 120/minute globally and 30/minute per origin. Keep the provider's public-metadata transport defenses. Record original actor/guild/client/grant/workflow/method/execution/outcome and queue delay; redact credentials/private tokens. Prune cancelled/expired unconsumed intents after seven days and expired rate buckets after one day, in batches of at most 500 through bot polling maintenance. Never prune consumed execution/audit links or protected moderation outcomes. Gate new admission and not-yet-started delegated effects with `DRASIL_MCP_ENABLED`; allow committed bookkeeping/reconciliation to finish.
- [ ] Repeat tests and inspect actual serialized logs. Document key rotation, callback registration, consent trust model, client setup, queue delay, rate-limit guidance and worker-before-submitter rollout. Production enabling/deployment is a separate explicit action after review.
- [ ] Commit `feat: add MCP operational controls and rollout documentation`.

## Task 16: End-to-end acceptance and one merge-ready PR

**Files:** Extend `.github/workflows/ci.yml` or the root `check:ci` script to run new web issuer/DB integration tests serially with bot DB suites. Add `apps/web/e2e/mcp-flow.spec.ts`, SDK integration cases and `docs/dev/mcp-client-compatibility.md`. Update the caller inventory, action-boundary reference and workflow manifest with final names/paths.

**Interfaces:** The acceptance contract is the approved spec. No implementation-only stub, bypass token or unobserved client behavior counts as compatibility evidence.

- [ ] Add the complete controlled flow: connect using real issuer endpoints, select two guilds, read permitted context, prepare/decline then prepare/confirm a mutation, observe queued status, run the actual worker, poll the result and revoke before a second queued mutation starts. Repeat key paths with all-eligible selection and role-only staff. Assert old Discord/web flows still pass. Name the journey `test('completes approved work and denies queued work after revocation')`; assert the first receipt is completed and `expect(secondReceipt.state).toBe('denied')` with no second workflow effect.
- [ ] Run the journey and SDK/issuer integration tests, then `npm run check:ci`, with an isolated disposable Postgres database and Playwright browsers. Add the new web DB suite to the canonical gate, not a parallel job that truncates the same database. Verify production bot imports and Next route dependency packaging.
- [ ] Complete a real-client matrix for ChatGPT, Codex and Claude, recording exact product surface/version, protocol, OAuth connect/refresh, read, confirmation method, controlled mutation, status polling and revocation. Include a standard SDK client without elicitation and the 2025 compatibility path. Use a controlled Discord server/disposable targets. A missing credential, unavailable client or untested OAuth callback is an explicit unresolved launch requirement; do not mark that row passed. Prepare any required manual steps only after all independent verification is done.
- [ ] Self-review spec coverage and diff, then obtain a fresh whole-branch code/security review. Reconcile required CI and repository AI reviews, resolve validated findings, and repeat only affected checks before the final gate. Verify every workflow/variant and 73-field setup mapping in the executable manifest; no system commands or passthrough tools may appear.
- [ ] Commit acceptance evidence, push the feature branch and open one PR linked to #89. Prefix public PR prose with `[AGENT]`, describe final behavior and only non-required verification evidence, attach the PR to the task, and report actual remaining limitations. Keep it draft if a required client/manual acceptance item remains unresolved; mark ready only when the spec's merge-ready criteria are satisfied. Keep issue #89 open unless its entire agreed scope is fulfilled. Do not merge or enable production automatically.

## Execution order and handoff

Tasks 1–8 establish shared contracts, authorization and delivery. Tasks 9–12 complete the existing action families against those contracts. Task 13 connects the protocol; Tasks 14–16 finish alternative approval, operations and acceptance. There is no intermediate public release with an incomplete action set.

The recommended execution method is subagent-driven development, consistent with the user's earlier preference: one implementer per task, task review before proceeding and a fresh whole-branch review at the end. Do not parallelize edits to shared codec registries, migrations or the central manifest. Independent research/reviews can run in parallel when authorized, with a single owner integrating shared changes.

Each task includes its own red/green cycle and commit. Keep all implementation on the same feature branch/PR. When a package API or existing domain behavior invalidates a planned interface, verify the evidence and update the plan before downstream tasks rely on it; do not add a compatibility wrapper that hides a broken assumption.

This plan is for review. Product dependency installation, migrations, endpoint scaffolding and implementation begin only after plan approval. Preserve the user's selected execution method at that handoff.
