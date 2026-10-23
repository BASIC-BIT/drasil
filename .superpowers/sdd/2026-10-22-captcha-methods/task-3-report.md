# Task 3 implementation report

Implemented shared guarded CAPTCHA attempt/completion transactions from base `14728dd`. Native image answer generation, verification, rendering, and Discord presentation remain Task 5. No production resources, members, cases, settings, MCP configuration, tools, or scopes were changed. Database tests used the owned disposable loopback database exclusively and ran serially.

## Public interfaces and downstream contract

`@drasil/application/postgres` exports:

```ts
createCaptchaCompletionStore(database: DelegationDatabase): CaptchaCompletionStore
```

`CaptchaCompletionStore` is exported as a type from both the application root and Postgres entrypoint. It has these methods:

```ts
beginAttempt(context: ActionContext, input: CaptchaBoundAttemptInput): Promise<CaptchaAttemptStart>
completeAttempt(context: ActionContext, input: CaptchaCompletionInput): Promise<CaptchaAttemptCompletion>
recordIdentityMismatch(context: ActionContext, input: CaptchaBoundAttemptInput): Promise<void>
requeuePassEffect(context: ActionContext, input: CaptchaPassReference): Promise<void>
```

`CaptchaBoundAttemptInput` is exported from the application root. It requires `{ challengeId, generation, idempotencyKey, provider: 'turnstile' | 'discord_image' }`. `CaptchaCompletionInput` now requires the same provider discriminator alongside its existing challenge/generation, attempt ID, and server-verified outcome. The shared key accepts 1..200 ASCII alphanumeric/colon/underscore/hyphen characters, supporting server-derived native namespaces. The web adapter retains its stricter UUID-v4 nonce requirement. OAuth mismatch keys retain their existing server-derived namespace.

No member-facing generic command accepting a verified result was added. Future native runtime code must verify the answer internally before invoking completion. Task 3's image-provider integration fixtures represent trusted adapter outcomes and do not test image answer validation.

## Behavior and locking

- Moved attempt insertion, limits, abandoned-attempt retirement, result acceptance, failure attention, and pass requeue transactions from web-only SQL into the shared Postgres store.
- Preserved ten attempts per authenticated user per 60 seconds, 100 service attempts per 60 seconds, 100 generation attempts, and retirement of abandoned started attempts after 60 seconds. Provider errors do not charge answer submissions; authenticated identity mismatches retain their distinct state and service-budget exclusion. Existing generation-cap terminal behavior is preserved.
- Unlocked challenge lookup discovers only server/case IDs. Separate statements lock server, case, challenge, then attempt. Fresh joined bindings are read after the parent locks; wall-clock expiry is checked after subsequent attempt/budget lock waits. Issuance/retry already use the Task 2 parent order. Setup mode-off cancellation now locks affected cases before mutating their challenges.
- Current selected method, method revision, active mode, standard pending case, actor, server/case relationship, challenge, current generation, expiry, and remaining answer budget fence acceptance. A completed old generation cannot disclose its old result after replacement.
- Global idempotency-key conflicts return a duplicate only for the exact actor/challenge/generation binding after case/provider authorization. Reuse for another case returns `unavailable` without exposing the first attempt's ID or validation state.
- Passed evidence retains `case_revision_at_issue`. Later case evidence can still receive a check, but the queued operation carries the issued revision and leaves resolution to the existing revision/join-only policy fence. The store does not resolve cases or modify roles directly.
- Queue insertion uses the existing `encodeQueuedAction` and `buildEnqueueStatement`, requires a returned durable receipt row, and runs in the same transaction as acceptance. Stable receipt keys and existing retry protections are preserved. No second queue was added.
- Web token hashing/lookup, OAuth decoding/identity checks, origin/CSRF checks, and Turnstile hostname/action/cdata validation remain in their existing transport locations. Public token lookup filters for persisted Turnstile provider, so CAPTCHA page, OAuth entry/callback, and completion cannot load image challenges. Completion fixes the provider to Turnstile in runtime code. The unused web-only queue encoder was deleted after migrating its caller.

## TDD evidence

Initial factory contract RED:

```sh
npm run application:test -- --runInBand --runTestsByPath src/postgres/captchaCompletion.test.ts
```

```text
Expected path: "createCaptchaCompletionStore"
Received path: []
Tests: 1 failed, 1 total
```

After the initial mechanical extraction the same command passed 1/1. That temporary export check was replaced by nine behavioral shared-store tests.

The following exact command was used for the shared-store integration RED/GREEN cycles:

```sh
JEST_INTEGRATION=1 TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' POSTGRES_DB_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' npx jest --runInBand --runTestsByPath src/__tests__/integration/CaptchaCompletionStore.integration.test.ts
```

Before adding binding/method fences, the mechanically extracted logic produced the expected RED:

```text
wrong provider: Expected "stale", Received "passed"
cross-case key reuse: Expected {state:"unavailable"}, Received {state:"duplicate", attemptId: ...}
method changed: Expected "stale", Received "invalid"
method revision changed: Expected "stale", Received "invalid"
case/server relationship changed: Expected "stale", Received "invalid"
waiting method update: Expected "stale", Received "passed"
Tests: 6 failed, 7 passed, 13 total
```

After those fences, GREEN was 13/13.

Additional completed-generation disclosure and setup lock-order RED, before their fixes:

```text
old completed generation after replacement: Expected "stale", Received "passed"
setup cancellation case-lock index: Expected > -1, Received -1
Tests: 2 failed, 17 passed, 19 total
```

Additional wall-clock expiry RED, before the post-budget-lock checks:

```text
begin lock wait: Expected state "stale" / status "expired", Received state "ready" / status "pending"
identity_mismatch lock wait: Expected persisted attempts 0, Received 1
Tests: 2 failed, 19 passed, 21 total
```

The final expanded suite has 26 store integration tests, including persisted rate accounting and duplicate-start concurrency. All pass as part of the 103-test owned-DB run below. A final run of the single-store command above, after isolating method mismatch at revision zero from revision mismatch with the image method unchanged, also reports `Test Suites: 1 passed, 1 total` and `Tests: 26 passed, 26 total`.

The existing web SQL-mock suite was run during extraction:

```sh
npm run web:test -- lib/captchaCompletion.test.ts
```

It initially reported `11 failed | 3 passed (14)` because transactions and queue insertion moved out of the web module. Transaction behavior coverage now resides in the real shared-store integration tests and shared-store unit tests; web tests cover transport binding and delegation. The migrated web file passes 17/17, and the complete CAPTCHA/Turnstile selection passes 35/35.

Test-authoring/environment corrections were made before treating results as behavior evidence: an initial application run used a root-relative path from the workspace script and found no tests; the corrected workspace-relative command is above. The restrictive sandbox first rejected loopback access with `connect EPERM 127.0.0.1:55433`; all owned-DB evidence above was rerun with the execution tool's additional network permission. Early case-binding and private-image rollback fixtures were corrected to satisfy their existing foreign-key and byte-length/PNG constraints. The focused application test helper also received its required explicit return type after lint reported it.

## Final verification

Full native suite, with additional network permission for the repository's child-process smoke tests:

```sh
npm test -- --runInBand
```

```text
Test Suites: 102 passed, 102 total
Tests:       1834 passed, 1834 total
Snapshots:   96 passed, 96 total
```

Full application suite:

```sh
npm run application:test -- --runInBand
```

```text
Test Suites: 40 passed, 40 total
Tests:       526 passed, 526 total
```

Owned-DB completion, repository concurrency, private-image lifecycle, and setup precondition suites:

```sh
JEST_INTEGRATION=1 TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' POSTGRES_DB_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' npx jest --runInBand --runTestsByPath src/__tests__/integration/CaptchaCompletionStore.integration.test.ts src/__tests__/integration/CaptchaChallengeRepository.integration.test.ts src/__tests__/integration/CaptchaImagePersistence.integration.test.ts src/__tests__/integration/McpSetupPreconditions.integration.test.ts
```

```text
44 migrations found in prisma/migrations
No pending migrations to apply.
Test Suites: 4 passed, 4 total
Tests:       103 passed, 103 total
```

The standard harness performed migrations and table truncation with identical guarded URLs. No other DB consumers ran concurrently. Store tests impose a three-second local lock timeout. Tests prove one pass receipt under simultaneous passes for each provider, serialized duplicate starts, method-update waits without deadlock/lock timeout, old-generation rejection, expiry after budget-lock waits, fifth-invalid failure, infrastructure-error non-consumption, actor/server/case/provider authorization, lowered current submission budget, and rollback restoring pending attempt/challenge/private material if durable queue insertion fails.

Web checks:

```sh
npm run web:test -- captcha turnstile
npm run web:lint
npm run web:typecheck
```

```text
Test Files 5 passed (5)
Tests      35 passed (35)
```

Both web lint and TypeScript checks exit 0. Application lint and root build also exit 0:

```sh
npm run application:lint
npm run build
```

Prettier checked every changed source/test file and reported `All matched files use Prettier code style!`. `git diff --check` exits 0. The native suite retains expected diagnostic logging from negative-path tests; no test failures remain.

Two dependency fixture cardinalities were corrected with controller approval, preserving their coverage assertions:

- `McpSetupPreconditions.integration.test.ts` expected 82 editable/section fields, but Task 2's new method adds the 83rd. Its original failure was `Expected length: 82 / Received length: 83`; the final owned-DB run above passes with 83.
- `scripts/check-action-boundary.test.mjs` expected 73 editable setup input fields; Task 2 adds the 74th. Its CommonJS/ES-import equality and schema assertions remain intact. Initial gate RED was `74 !== 73`. The final `npm run action:boundary` passes all 16 script tests and reports `Action boundary: 55 enum kinds have codecs, handlers and caller coverage; dependency checks passed.`

## Files changed

- New shared transaction implementation and nine behavioral tests in `packages/application/src/postgres/captchaCompletion.ts` and `.test.ts`.
- Application root/Postgres exports and CAPTCHA browser input types/contract fixture.
- `packages/application/src/postgres/setup.ts` cancellation lock order.
- Web CAPTCHA completion adapter and its transport tests, completion route/provider contract fixture, and deletion of the unused web-only effect encoder.
- New 26-test `src/__tests__/integration/CaptchaCompletionStore.integration.test.ts`.
- The two narrowly corrected dependency fixture cardinalities described above.
- This report.

## Self-review and limits

Read the complete shared implementation, web transport diff, public exports, setup cancellation, and new tests. Verified that no old web transaction implementation/encoder remains, queue keys and expected case revision retain their prior values, all internal completion callers supply provider explicitly, and no provider/Discord work occurs in the shared transactions. No unresolved implementation concerns were identified. Native answer proof and live browser/Discord/provider validation are outside this task; the automated results do not claim those journeys were exercised. Final clean-container validation remains Task 8 as directed by the controller.

## Review fix round 1

Fix base: `0097f7d`. Read `task-3-review.md` and the controller's ledger ruling in `progress.md`. The controller classified the simultaneous-pass replay assumption as an Important verification defect. Either provider completion can acquire the server lock first, so an unordered result assertion cannot establish that the first submitted attempt won.

Changed only that test assertion: retain `Promise.all` outcomes in input order, sort a copy when asserting one `passed` and one `stale`, then identify and replay the actual passed attempt. The one-receipt and pending-case assertions remain intact. Product behavior and acceptance code are unchanged.

Covering verification used the exclusively owned disposable DB, with identical guarded URLs and additional loopback network permission:

```sh
JEST_INTEGRATION=1 TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' POSTGRES_DB_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public' npx jest --runInBand --runTestsByPath src/__tests__/integration/CaptchaCompletionStore.integration.test.ts
```

```text
44 migrations found in prisma/migrations
No pending migrations to apply.
PASS src/__tests__/integration/CaptchaCompletionStore.integration.test.ts (17.13 s)
Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total
Snapshots:   0 total
Time:        17.47 s, estimated 19 s
```

```sh
npx prettier --check src/__tests__/integration/CaptchaCompletionStore.integration.test.ts
git diff --check
```

Prettier reports `All matched files use Prettier code style!`; the diff check exits 0. Self-review confirms that winner selection uses the ordered result associated with each attempt and no first-winner assumption remains. No unresolved concerns in this fix.
