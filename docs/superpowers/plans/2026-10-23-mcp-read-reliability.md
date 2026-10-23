# MCP read reliability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnose the observed concurrent-read failures and make temporary read failures recover within a short budget without weakening authorization.

**Architecture:** Keep Discord HTTP handling in the web adapter and carry only dependency-neutral failure information through the application layer. Use one request-local recovery budget per logical MCP query, preserving fresh grant and authority checks. Diagnostics and reproduction precede selection of the actual recovery fix.

**Tech Stack:** Existing TypeScript, Node AsyncLocalStorage/AbortSignal, fetch, PostgreSQL, Vitest, Jest, and maintained MCP packages. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-23-mcp-read-reliability-design.md` (approved).

## Global constraints

- Limit each GET to two total attempts and share a three-second recovery budget across one logical MCP read. This is an additional recovery budget, not an end-to-end latency promise.
- Never replay an action, moderation command, OAuth exchange, or mutating HTTP call.
- Completed authorization results must remain uncached. No new queue, cache service, OAuth permissions, or moderation behavior is part of this change.
- Preserve `rate_limited` for existing application admission limits. Known temporary upstream failures use `unavailable` with the existing `retryAfterSeconds` field when justified.
- Keep HTTP classification in the web adapter; do not import Discord HTTP errors into the application package.
- Do not log credentials, provider response bodies, messages, evidence, raw SQL, or connection strings. Public prose and fixtures must not contain private server names or production identifiers.
- One focused follow-up PR. Deployment and live acceptance remain distinct from local checks. Keep production tests read-only and worker-side MCP action enablement unchanged.

## Review focus

- Overlapping logical reads must not share cancellation, correlation IDs, or an exhausted recovery budget (Tasks 1 and 2).
- Malformed, conflicting, negative, or excessive retry delays must not cause early retries or unbounded sleeps (Task 2).
- A caller cancellation must stop pending waits and fetches without starting another attempt (Tasks 1, 2, and 4).
- Role changes, connection revocation, and channel visibility changes must take effect on subsequent checks, including after a recovered request (Tasks 3 and 4).
- Diagnostics and error envelopes must remain useful when a logger fails, without disclosing raw backend errors (Tasks 1 and 3).

## File structure

| File                                                                                                                     | Responsibility                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/readRequestContext.ts` and `.test.ts` (new)                                                                | Request-local correlation, operation name, cancellation, and the single recovery deadline.                                                            |
| `apps/web/lib/readDiagnostics.ts` and `.test.ts` (new)                                                                   | Strict, bounded structured events for dependency attempts; never serialize arbitrary errors.                                                          |
| `apps/web/lib/discordApi.ts` and `.test.ts`                                                                              | Existing provider boundary; instrument GETs and, only after the investigation gate, bounded GET recovery. Keep mutation and OAuth functions separate. |
| `apps/web/lib/discordReadRecovery.ts` and `.test.ts` (new, conditional)                                                  | GET attempt/deadline policy, cancellation, retry delay parsing, and injectable clock/fetch dependencies.                                              |
| `packages/application/src/delegation/readFailures.ts` and `.test.ts` (new)                                               | Transport-neutral temporary-unavailability error and safe denial projection.                                                                          |
| `packages/application/src/delegation/access.ts`, `access.test.ts`, `src/index.ts`                                        | Observe failures before catches discard them, preserve known retry advice through fresh authorization, and export the neutral failure contract.       |
| `apps/web/lib/mcp/access.ts`                                                                                             | Bind the application failure observer to safe web diagnostics.                                                                                        |
| `apps/web/lib/mcp/queries.ts`, `queries.test.ts`, `tools/reads.ts`, `tools/reads.test.ts`, `server.ts`, `server.test.ts` | One context per logical query; preserve typed failures and verify real transport envelopes.                                                           |
| `apps/web/lib/mcp/adapters/visibility.ts` and `.test.ts`                                                                 | Separate genuine access denials from failed visibility lookups.                                                                                       |
| `apps/web/lib/mcp/readReliability.test.ts` (new)                                                                         | Controlled concurrent-read regression across real composition boundaries.                                                                             |
| `docs/dev/mcp-client-compatibility.md`, `docs/deploy/mcp.md`                                                             | Sanitized acceptance evidence, failure interpretation, and operational limits.                                                                        |

### Task 1: Expose the failing dependency and reproduce the problem

**Interfaces:** Create `withReadRequestContext<T>(options: { operation: string; signal?: AbortSignal }, work: () => Promise<T>): Promise<T>` and `currentReadRequestContext(): ReadRequestContext | undefined`. Contexts expose `correlationId`, `operation`, and optional `signal`; recovery state remains private to the context module. Create `recordReadDependency(event: ReadDependencyEvent, sink?: (line: string) => void): void`, with explicit dependency/category/status/latency/attempt fields and no free-form error payload. Add optional `onDependencyFailure?: (error: unknown) => void` to `DelegatedAccessDependencies`; only use it as a best-effort observer before errors are discarded, never as an authorization decision.

- [ ] Add tests `isolates_parallel_read_contexts`, `inherits_request_abort_without_reusing_query_state`, and `diagnostics_do_not_serialize_backend_payloads`. Assert distinct correlation IDs, independent cancellation, and that tokens/body/SQL sentinels never appear in emitted events. A throwing sink must not alter the query result.
      Core assertions, using the events and IDs collected by those tests:

  ```ts
  expect(new Set(correlationIds).size).toBe(2);
  expect(lines.join('\n')).not.toMatch(/TOKEN_SENTINEL|BODY_SENTINEL|SQL_SENTINEL/);
  expect(cancelledSignal.aborted).toBe(true);
  expect(siblingSignal.aborted).toBe(false);
  ```

- [ ] Run `npm run web:test -- lib/readRequestContext.test.ts lib/readDiagnostics.test.ts`; confirm failure because the modules are absent.
- [ ] Implement the two small modules with AsyncLocalStorage and a fixed event allowlist. At the HTTP wrapper in `mcp/server.ts`, bind the actual `Request.signal`; in `tools/reads.ts`, create a child context for each query, inheriting cancellation but receiving fresh operation state. Do not change action handler signatures or public tool schemas.
- [ ] Instrument `fetchBotJson` at its existing Discord boundary and the actual MCP query/authority/visibility failure boundaries. Record safe status categories before existing catches discard the error. Bind the application observer in `mcp/access.ts` so grant-store and authority exceptions are visible without importing web diagnostics into the application package. Classify recognized PostgreSQL failures by an allowlisted category/SQLSTATE, never by logging their messages. Keep existing success, quota, and authorization behavior unchanged in this task.
- [ ] Add `concurrent_read_failure_identifies_its_dependency`: exercise the actual read composition using controlled Discord HTTP responses and repository failures. Assert that an induced provider 429 and an induced database failure produce different sanitized evidence under the correct correlation ID.
- [ ] Rerun the targeted tests, including `lib/mcp/tools/reads.test.ts` and `lib/mcp/adapters/visibility.test.ts`. Commit the independently reviewable diagnostic change as `fix(mcp): preserve read dependency diagnostics`.
- [ ] **Investigation gate:** reproduce a small serial/concurrent sample and attribute the observed production failure. Use existing logs first. If instrumentation must be deployed, finish the concrete diagnostic change and its checks before requesting any missing deployment authorization. Keep the same PR and record the exact deployed commit and sanitized correlation IDs privately. Do not deploy an unreviewed guess or retrieve user tokens to bypass the MCP client.
- [ ] Record whether the evidence supports Discord throttling/transient HTTP failures, database pressure, or another cause. Task 2 applies only to the first category. For another cause, amend the proposed remedy and get agreement before implementing a different fix. If attribution remains unavailable, leave the gate explicitly blocked rather than claiming recovery work fixes the production issue.

### Task 2: Recover safe Discord GETs within a single budget (conditional)

**Consumes:** Task 1's request context, diagnostics, and confirmed provider failure evidence.

**Interfaces:** Create `fetchDiscordRead<T>(input: URL, init: RequestInit, decode: (response: Response) => Promise<T>, deps?: DiscordReadDependencies): Promise<T>` in `discordReadRecovery.ts`; reject non-GET methods at this boundary. `DiscordReadDependencies` provides typed `fetch`, monotonic `now`, cancellable `sleep`, and `random` functions for deterministic tests. Add context operations `remainingReadRecoveryMs(): number` and `startReadRecovery(): void`: the first recoverable failure starts one 3,000 ms deadline; nested helpers reuse it and never reset it.

- [ ] Add tests `retries_429_once_after_server_delay`, `does_not_retry_before_excessive_delay`, `shares_budget_across_nested_gets`, and `parallel_queries_have_independent_budgets`. Assert at most two fetch attempts per GET, no retry before provider timing, and no wait/second attempt scheduled beyond the shared deadline.
- [ ] Add table tests for malformed JSON retry metadata, missing delay, negative/non-finite values, disagreement between usable delay sources, and delay exceeding 3,000 ms. Take the longest valid server delay when sources disagree; without a usable delay, return temporary unavailability rather than guessing a 429 retry time.
- [ ] Add tests `cancellation_stops_wait_and_fetch`, `does_not_retry_4xx_or_unknown_errors`, and `mutation_and_oauth_requests_are_not_replayed`. Include 401, 403, 404, malformed success JSON, caller abort, a stalled response body, and an arbitrary programming error. The attempt timeout must cover body decoding, not just receipt of response headers.
      Core assertions after a controlled 429 with a one-second delay, and a separate delay beyond the budget:

  ```ts
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(attemptStarts[1] - attemptStarts[0]).toBeGreaterThanOrEqual(1000);
  expect(excessiveDelayFetch).toHaveBeenCalledTimes(1);
  expect(recoveryFinishedAt - firstRecoveryFailureAt).toBeLessThanOrEqual(3000);
  ```

- [ ] Run `npm run web:test -- lib/discordReadRecovery.test.ts lib/discordApi.test.ts`; verify the intended failures before implementation.
- [ ] Implement the GET boundary with these proposed engineering defaults: 2,000 ms timeout for an initial attempt, retry timeout limited to the remaining recovery budget, two total attempts per GET, and one 100–250 ms jittered delay for recognized transient network failures or HTTP 502/503/504 without usable provider header timing. Honor the longest usable provider interval for 429 and HTTP 502/503/504, including numeric or HTTP-date `Retry-After`; never guess a 429 delay. If provider timing meets or exceeds the remaining shared budget, return safe advice without another fetch. Final-review clarification: the original selected-5xx jitter instruction omitted this provider-header precedence exception. This correction follows the spec's provider-timing requirement and does not claim a live 503 occurrence. An exhausted budget returns failure without another attempt. Inspect the actual response and request semantics; never retry arbitrary 5xx responses blindly.
- [ ] Route `fetchBotJson` through this boundary. Existing website GET callers reuse the same policy; a standalone GET owns a local budget when no logical-read context exists. Leave OAuth token exchanges and mutating fetch functions on their existing paths. Keep attempt cancellation active until the decoder has consumed the body. Release timeout/abort listeners in `finally`, including when retry bodies cannot be consumed. A request aborted while waiting must never start another fetch.
- [ ] Run the targeted tests and commit as `fix(web): bound recovery for temporary Discord read failures`. Update the private investigation evidence with the exact failure class addressed; synthetic tests do not replace the live acceptance gate.

### Task 3: Preserve temporary failures without misreporting permission denials

**Interfaces:** Export `ReadDependencyUnavailableError extends Error` with constructor `(options: { retryAfterSeconds?: number })` and `toUnavailableReadDenial(error: unknown): AccessDenial` from the application package. Only finite positive retry advice from this known internal error type may enter a result. This type contains no HTTP status, provider body, credentials, or vendor-specific error class.

- [ ] Add application tests `preserves_known_temporary_retry_advice`, `unknown_error_is_unavailable_without_retry_timing`, and `invalid_retry_advice_never_reaches_results`. Add access tests proving no repository read occurs after an upstream authority failure and that grant revocation/role changes are still evaluated on the next call.
- [ ] Add visibility tests `provider_unavailability_is_not_permission_denied` and `authoritative_denial_stays_immediate`. Cover a temporary lookup error, known forbidden access, missing channel/thread membership, absent permission bits, mismatched bindings, and unknown exceptions. Every failure must remain closed.
      Core assertions for the neutral projection:

  ```ts
  expect(
    toUnavailableReadDenial(new ReadDependencyUnavailableError({ retryAfterSeconds: 2 }))
  ).toEqual({ kind: 'denied', reason: 'unavailable', retryAfterSeconds: 2 });
  expect(toUnavailableReadDenial(new Error('PRIVATE_BACKEND'))).toEqual({
    kind: 'denied',
    reason: 'unavailable',
  });
  ```

- [ ] Run `npm run application:test -- --runInBand delegation/readFailures.test.ts delegation/access.test.ts` and `npm run web:test -- lib/mcp/adapters/visibility.test.ts lib/mcp/queries.test.ts`; confirm the new cases fail for the expected reasons.
- [ ] Implement the neutral error/projection and export it from `packages/application/src/index.ts`. Map exhausted known transient provider failures to this type at the web boundary. Preserve this advice in the existing `authorizeGuild`, eligible-guild discovery, query, and visibility exception paths. Retain `permission_denied` for actual failed permission checks; preserve existing actor-not-found semantics. Do not add global catch-and-retry behavior to application actions.
- [ ] Assert that existing admission throttling still returns `rate_limited`, and unknown provider/programming errors return `unavailable` without fabricated retry advice. Extend query-envelope tests so structured content and JSON text are equal and contain no raw error fields.
- [ ] Rerun the same tests and commit as `fix(mcp): distinguish temporary read failures from access denials`.

### Task 4: Prove concurrent behavior and record acceptance

**Consumes:** The confirmed fix from Task 2 or an explicitly revised remedy, Task 3's neutral failure contract, and the existing real MCP server/query composition.

- [ ] Add `parallel_reads_recover_without_changing_authority` in `readReliability.test.ts`. Use the real web authority adapter, delegated-access service, query handlers, and controlled HTTP/repository boundaries. Induce the identified temporary failure during overlapping case, detection, and message reads; assert bounded recovery and correct independent results. Do not replace the authority service with an always-allowed mock.
- [ ] Add `revoked_grant_and_changed_roles_are_not_reused_after_recovery`: after a completed recovered query, revoke the grant/change role or channel permissions and assert the next read is denied with no protected repository/message result. Add `one_cancelled_query_does_not_cancel_its_sibling` using two request signals.
- [ ] Add transport tests in `server.test.ts` for success after recovery, exhausted temporary failure with retry advice, and genuine permission denial. Assert unchanged public tool schemas, read-only annotations, identical text/structured envelopes, and unchanged mutation dispatch counts. Caller cancellation must propagate into the attempt/wait without replaying the tool handler.
      Core transport assertions on the actual returned envelope:

  ```ts
  expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  expect(result.structuredContent).toMatchObject({ kind: 'denied', reason: 'unavailable' });
  expect(mutationHandler).not.toHaveBeenCalled();
  ```

- [ ] Run the new test files first; verify expected failures before adding the missing wiring, then run them again to confirm success. Run `npm run application:test -- --runInBand delegation/access.test.ts delegation/readFailures.test.ts` and `npm run web:test -- lib/readRequestContext.test.ts lib/readDiagnostics.test.ts lib/discordReadRecovery.test.ts lib/discordApi.test.ts lib/mcp/readReliability.test.ts lib/mcp/queries.test.ts lib/mcp/tools/reads.test.ts lib/mcp/adapters/visibility.test.ts lib/mcp/server.test.ts`.
- [ ] Run `npm run check:ci` using the repository's owned disposable database setup. Keep database consumers serial. Resolve failures attributable to the branch; never use production data for destructive fixtures.
- [ ] Update the existing MCP operations and acceptance documents with generic environment labels, observed behavior, remaining gaps, recovery defaults, and how to correlate temporary failures. Keep raw production evidence and private identifiers out of the repository. Commit as `test(mcp): verify concurrent read recovery and fresh authorization`.
- [ ] Complete branch review and the repository's issue/PR workflow. Preserve the approved subagent-driven execution preference unless the user changes it. Keep one PR for this effort and attach its URL to the task when created. Do not merge or change deployment flags without existing authorization for those actions.
- [ ] After an authorized deployment, repeat a bounded owner-approved concurrent read sample on the actual client. Record exact revision, logical tool names, outcomes, timings, and safe correlation IDs. Confirm no moderation/configuration calls were made. Mark production recovery verified only if the original failure is addressed; record a remaining failure plainly.

## Self-review

The tasks cover the diagnostic gap, evidence gate, conditional recovery, failure classification, cancellation, privacy, unchanged authorization, independent concurrent requests, regression tests, and live acceptance. Retry values are fixed above; remaining function bodies follow existing adapter/test patterns. No generic scheduler, result cache, new infrastructure, or mutation retry is hidden in the plan. Receipt polling, nonempty report evidence, refresh, and revoke user journeys remain separate launch-acceptance work unless required to verify authorization freshness for this fix.
