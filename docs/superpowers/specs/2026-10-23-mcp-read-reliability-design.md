# Reliable concurrent MCP reads

Status: proposed for approval. Scope: one focused follow-up PR.

## Intent

Make normal parallel MCP reads reliable while preserving fresh authorization. The user prefers a brief automatic wait for temporary failures, followed by a clear retryable response if recovery cannot finish promptly. The website should benefit from the same shared Discord read handling.

## Evidence and investigation gate

Live testing exercised all 16 core query tools. Several calls in concurrent batches returned `unavailable`; one message-context read returned `permission_denied`. Identical sequential calls subsequently succeeded. Lists, details, pagination, and cursor binding worked on successful calls. The runtime error summary contained no corresponding error clusters.

Each authorization loads fresh Discord guild, member, and role facts. The web Discord GET helper has no retry or throttling handling. Application authorization and query boundaries collapse exceptions into `unavailable`; channel visibility collapses exceptions into `permission_denied`. These are established diagnostic gaps, not proof that Discord throttling caused the failures. Database contention and other dependencies remain candidates.

Before selecting a behavioral fix, reproduce a small concurrent read batch and identify the failing dependency using sanitized diagnostics. If live evidence needs additional instrumentation, ship that independently reviewable part first. Do not claim the production failure is fixed from a synthetic 429 test alone. If another dependency is responsible, revise the recovery portion of this design around that evidence.

## Approaches

1. Return temporary errors immediately. Simple and preserves availability signals, but makes the client recover from brief interruptions. This does not match the user's preferred experience.
2. Diagnose the failure and recover safe reads within a short budget. Recommended and selected direction: small shared changes, fresh authority, and useful failure responses.
3. Add caching, distributed request scheduling, or in-flight request coalescing immediately. These require additional lifecycle and cross-instance reasoning before we have evidence they are necessary. Defer them; completed authorization results must remain uncached.

## Proposed behavior

- Distinguish an authoritative denial from an inability to check. Preserve existing grant, scope, guild, actor, and resource checks. A temporary visibility lookup failure returns `unavailable`, not a claim that permission was denied. Genuine denied checks remain immediate denials.
- Keep HTTP-specific classification in the web adapter. Carry dependency-neutral failure information through the application ports and existing query envelopes rather than importing Discord HTTP errors into the application package.
- If Discord throttling or transient read failures are confirmed, recover at the shared web Discord GET boundary. Limit each GET to two total attempts and share a three-second recovery budget across one logical MCP read. This is an additional recovery budget, not a claim that the entire read always completes within three seconds. Attempts have explicit timeouts; nested helpers cannot each obtain a new budget. These numerical limits are proposed engineering defaults.
- Honor a valid Discord retry delay. If it exceeds the remaining budget, return retry guidance without sending an early retry. Permit one jittered retry for a classified transient network failure or selected 5xx responses. Do not retry authentication failures, genuine permission denials, missing resources, invalid inputs, caller cancellation, or unknown failures automatically.
- Recover only idempotent GET requests. Never replay an action, moderation command, OAuth exchange, or mutating HTTP call. Exhausted retries fail closed; incomplete facts never authorize a read or action.
- Preserve `rate_limited` for existing application admission limits. Use `unavailable` with the existing `retryAfterSeconds` field when a known temporary upstream failure warrants retry advice. Unknown internal failures remain unavailable without invented retry timing. Keep the same result in text and structured MCP content.
- Emit bounded structured diagnostics at the failing boundary: correlation ID, operation category, dependency, safe status/error category, latency, and attempt count. Never log tokens, authorization headers, response bodies, messages, report evidence, or raw SQL/connection strings. Existing audit records remain separate from dependency diagnostics.

## Verification

Use controlled HTTP/database fixtures and deterministic clocks to reproduce the observed concurrent failure and test the identified fix. Cover simultaneous independent reads, a 429 followed by success, a retry delay exceeding the budget, exhausted transient failures, immediate genuine denials, and cancellations. Assert bounded attempts and a shared recovery budget. Verify successful and denied authority checks remain fresh after role changes and connection revocation. If no retry is warranted for the identified cause, replace the synthetic recovery cases with tests for that cause.

Repeat a small live concurrent read sample after deployment with the owner's existing read-test authorization. Record tool outcomes and sanitized correlation IDs. Make no moderation or configuration calls. Empty report evidence remains valid coverage of empty results, not proof of populated evidence behavior.

## Scope and rollout

Implement in the existing TypeScript web/application boundaries with regression tests and concise operations notes. Reuse existing logging, ports, and failure envelopes. No new queue, cache service, OAuth permissions, or moderation behavior is part of this change. Code follows the repository's issue/PR workflow; deployment and live verification are recorded separately from local test results. Do not broaden production access or enable worker-side MCP actions as part of this follow-up.

The investigation may reveal a different cause. That changes the proposed remedy, not the requirement to make temporary failures diagnosable and preserve authorization correctness.
