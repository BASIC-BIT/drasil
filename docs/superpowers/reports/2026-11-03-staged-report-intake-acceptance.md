# Staged report intake acceptance

Local implementation is ready for acceptance checks. The staged selector still defaults to `false`. No paid provider evaluation, live Discord exercise, deployment, feature enablement, publication, or merge has run. A failed submission after a target claim has a known recovery limitation described below.

## What the local journey proves

`ReportIntakeStagedFlow.integration.test.ts` connects the real intake service, Postgres repositories, worker, extraction request/response validation, member directory, resolver, handoff service, and shared application actions. Discord transport and OpenAI responses are synthetic. The submission adapter is a spy at the existing application port, so these tests prove one dispatch after human confirmation, not a real moderation submission or Discord effect.

| Scenario                         | Local assertion                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global-name-only account         | Username and nickname differ; a complete directory plus fresh member lookup resolves the account's global name.                                                                                    |
| Multiple people and server title | Target, reporter, and bystander remain distinct; the server title is context.                                                                                                                      |
| Uncertain reading                | Two durably reserved extraction attempts maximum, then admin review.                                                                                                                               |
| Evidence over budget             | No provider request for an oversized-only source; handoff retains the excluded evidence.                                                                                                           |
| Unavailable directory            | Lookup failure reaches admin review without claiming complete coverage.                                                                                                                            |
| Restart boundaries               | Rebuilt service/repository objects resume saved evidence, claimed analysis before/after request reservation, outcome, presentation lease, confirmation timeout, delivered and acknowledged review. |
| Delivery recovery                | A failed delivery stays pending, records an attempt, and succeeds after the persisted retry delay.                                                                                                 |
| Voluntary evidence               | Acknowledgement and original handoff reason survive a later clear candidate; reporter confirmation does not restart and the receipt is not repeated.                                               |
| Human confirmation               | Two competing confirmations dispatch the existing submission port once. Investigation and handoff call no role, kick, ban, or submission port.                                                     |

These are local restart simulations with a real database and replacement service instances. They do not prove recovery after an actual process crash or Discord acceptance. Existing queue tests cover role-ping deduplication and destination authorization; the journey's queue transport is mocked.

## Local results

- Focused extraction, directory, candidate, agent, worker, handoff and tooling: initially 8 suites, 171 tests passed. The final evaluator added one association assertion; its 5 tests and the 7 fixture-entry tests passed together after that change.
- Focused application: 4 suites, 54 tests passed.
- Report contracts: 1 file, 18 tests passed.
- Web report actions and MCP reports: 2 files, 29 tests passed.
- Owned Postgres journey, processing, resolution and repository: 4 suites, 77 tests passed. The combined run also included 5 evaluator tests, for 82 tests total.
- `npm run check:ci`: pending on the exact committed source in the isolated Linux container.
- Provider tool dry run: 3 synthetic PNGs validated, maximum 3 requests printed, actual requests 0, provider elapsed time 0 ms, directory lookup not run.

The fresh disposable database is guarded by `scripts/owned-test-database.js`. `TEST_DATABASE_URL`, `DATABASE_URL` and `POSTGRES_DB_URL` must be identical and select the owned loopback `55433/drasil_mcp_test` target. The older stopped test database remains preserved.

## Known recovery limitation

After staff confirm a target, a failing underlying submission leaves `confirmed_target_user_id` set and the review open. `resolve_review` rejects that state as stale, and another selection cannot re-claim the target. The journey regression reproduces this behavior and proves the evidence and attention item remain. No automatic retry or policy expansion was added. A supported recovery decision is still required before enabling staged intake. Acknowledgement or reporter thread closure does not resolve the failed submission.

## Synthetic provider evaluation

The three checked-in PNGs are drawn synthetic messages, with labels for readable names, subject roles, uncertainty, server context, and permitted identity outcome. They contain no real screenshots, community names, account IDs, or production evidence. The evaluator imports extraction only, creates no Discord client, and performs no directory lookup or moderation.

Run the default validation without credentials or network calls:

```sh
node -r ts-node/register src/scripts/evaluateReportIntake.ts
```

After separate explicit approval for paid execution, run:

```sh
node -r ts-node/register src/scripts/evaluateReportIntake.ts --execute-paid
```

The opt-in run requires `OPENAI_API_KEY`, prints a maximum of three requests before execution, uses one request per fixture with no SDK retry, and applies a 45-second timeout per request. It reports request attempts, elapsed time, label failures, and `lookupCoverage: "not_run"`. An aborted request has an unknown provider outcome. A successful extraction does not establish a Discord identity or measure the wrong-candidate rate.

The fixture-only concrete `GPTService` entry accepts bounded PNG bytes and an image reference. It delegates to the same private extraction schema, prompt, output limit, and response validation. The live `IGPTService` API and Discord CDN authorization remain unchanged. Ordinary live calls still reject data URLs and non-Discord URLs.

| Paid evidence                                     | Status                                                    |
| ------------------------------------------------- | --------------------------------------------------------- |
| Actual request count                              | 0, not executed                                           |
| Provider elapsed time                             | Not measured                                              |
| Subject association / OCR quality                 | Pending                                                   |
| 4096-token output budget on representative images | Pending                                                   |
| Wrong-candidate rate                              | Not measured; extraction tool does not resolve identities |

## Controlled Discord acceptance, pending approval

Use synthetic evidence and controlled accounts in one approved server. Record exact source commit, approved server privately, start/end time, actual provider request attempts per revision, elapsed investigation time, directory coverage/member count, persisted outcome, delivery artifact, acknowledgement, and final resolution. Keep server/account identifiers out of public notes.

- [ ] Clean match: use a global display name distinct from username and nickname. Confirm only the intended account, then verify one existing submission and its normal policy.
- [ ] Forced unresolved handoff: use an unreadable or missing account. Verify the exact saved-evidence receipt, one accessible staff item, no required reporter step, and no moderation effect.
- [ ] Restart: interrupt after evidence save, request reservation, saved outcome, and delivery reservation. Restart the actual worker and verify unchanged deadlines, budgets, and no duplicate ping/receipt/submission.
- [ ] Delivery failure and recovery: remove access to the intended destination, verify saved pending failure and authorized fallback behavior, restore access, then verify recovery and the 30-second, two-minute, ten-minute retry progression where exercised.
- [ ] Staff resolution: acknowledge without closing, append voluntary evidence, then resolve an unclaimed review with a reason. Separately confirm an identity and verify the existing submission policy. Exercise the failed-submission limitation only with an approved recovery procedure.
- [ ] Permission revocation: remove staff authority after controls appear, then attempt selection/resolution through Discord and web. Verify fresh authorization rejects the action. Restore permission only as separately approved.

No live check above is complete. Local mocks do not satisfy these checks.

## Deployment and rollback preparation

1. Obtain deployment approval for the reviewed exact commit. Apply the additive migrations before code through the existing release workflow. Retain old rows and their evidence. Existing rows without a due time remain idle.
2. Deploy with `report_intake_staged_enabled` still false. Verify the schema and code version separately from worker/provider/Discord behavior.
3. After controlled-server approval and a decision on failed-submission recovery, enable the selector for that server only. Run the controlled checklist and record actual outcomes.
4. Review wrong-candidate rate, request and time budgets, directory coverage, delivery recovery and acknowledgement before proposing broader enablement. A small synthetic set cannot establish a production error rate.
5. Historical re-enqueue requires an approved exact-ID list. Do not add startup backfill.
6. Roll back by disabling staged processing. Preserve evidence, processing metadata and pending reviews; retain the additive migrations. Verify saved reviews remain accessible and no new staged controls are published. Do not drop the migration as rollback.

## Evidence appendix

Implementation base for Task 9: `a305ec1d63f0f4d3aead8c1f76040e1bdb171c09`. Branch fork: `46b2b053060e19b35beccf23f7cf6756490cbe5f`. Exact acceptance commit and full local CI result will be appended after execution. GitHub CI, delayed review feedback, merge readiness and deployment remain unverified.
