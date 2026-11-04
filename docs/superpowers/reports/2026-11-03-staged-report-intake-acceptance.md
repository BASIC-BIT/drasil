# Staged report intake acceptance

The final technical review's eight Important findings, two Minor test gaps and later bookkeeping deletion regression are corrected locally and pass the full local gate. Focused N1 rereview remains pending. The staged selector still defaults to `false`. Paid provider evaluation, live Discord acceptance, publication, deployment, activation and merge remain pending.

## What the local journey proves

`ReportIntakeStagedFlow.integration.test.ts` connects the real intake service, Postgres repositories, worker, extraction request/response validation, member directory, resolver, handoff service, and shared application actions. Discord transport and OpenAI responses are synthetic. The submission adapter is a spy at the existing application port, so these tests prove one dispatch after human confirmation, not a real moderation submission or Discord effect.

| Scenario                         | Local assertion                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global-name-only account         | Username and nickname differ; a complete directory plus fresh member lookup resolves the account's global name.                                                                                    |
| Multiple people and server title | Four competing directory accounts represent the target, reporter, bystander and server title; only the target reaches confirmation.                                                                |
| Uncertain reading                | Two durably reserved extraction attempts maximum, then admin review.                                                                                                                               |
| Evidence over budget             | No provider request for an oversized-only source; handoff retains the excluded evidence.                                                                                                           |
| Unavailable directory            | Lookup failure reaches admin review without claiming complete coverage.                                                                                                                            |
| Restart boundaries               | Rebuilt service/repository objects resume saved evidence, claimed analysis before/after request reservation, outcome, presentation lease, confirmation timeout, delivered and acknowledged review. |
| Delivery recovery                | A failed delivery stays pending, records an attempt, and succeeds after the persisted retry delay.                                                                                                 |
| Voluntary evidence               | Acknowledgement and original handoff reason survive a later clear candidate; reporter confirmation does not restart and the receipt is not repeated.                                               |
| Human confirmation               | Two competing confirmations dispatch the existing submission port once. Investigation and handoff call no role, kick, ban, or submission port.                                                     |

These are local restart simulations with a real database and replacement service instances. They do not prove recovery after an actual process crash or Discord acceptance. Existing queue tests cover role-ping deduplication and destination authorization; the journey's queue transport is mocked.

The final correction tests also connect generated queue controls to the actual interaction handler, race identity upserts against resolution and revision replacement in Postgres, and exercise submission recovery through the real application adapter and intake repository. The recovery tests mock Discord and the security-service port. A separate security-service test exercises the actual completion-receipt producer after routing. Staff web and MCP adapter tests preserve source history while checking reporter privacy.

## Final local results

`npm run check:ci` passed with exit 0 on the exact correction source recorded in the appendix, in the isolated Linux container. Focused regression runs preceded the full gate and are recorded in the local correction report. The earlier provider-tool dry run validated three synthetic PNGs, printed a maximum of three requests, and made zero requests. That dry run performed neither directory lookup nor paid execution.

The fresh disposable database is guarded by `scripts/owned-test-database.js`. `TEST_DATABASE_URL`, `DATABASE_URL` and `POSTGRES_DB_URL` must be identical and select the owned loopback `55433/drasil_mcp_test` target. The older stopped test database remains preserved.

| Full local gate stage | Result                             |
| --------------------- | ---------------------------------- |
| Application           | 45 suites, 636 tests passed        |
| Action boundaries     | 17 tests passed                    |
| Bot unit              | 115 suites, 2,159 tests passed     |
| Contracts             | 6 files, 63 tests passed           |
| Owned-database guard  | 8 tests passed                     |
| Web unit              | 118 files, 1,161 tests passed      |
| Workspace browser     | 90 passed                          |
| Legacy browser        | 9 passed, 13 conditional MCP skips |
| Page visuals          | 8 passed                           |
| Storybook             | 165 passed                         |
| Bot integration       | 31 suites, 849 tests passed        |
| Web integration       | 5 files, 69 tests passed           |
| Dedicated MCP browser | 13 passed                          |
| Public RLS            | 44 tables passed                   |

The legacy browser stage skips MCP cases because `DRASIL_MCP_E2E` is not true there. The dedicated stage provides the owned database and controlled Discord fixture and runs all 13. No other tests were skipped. Format, lint, typechecks, builds, package exports, dependency graph and coverage gates passed. Bot lint reported 32 nonblocking warnings and no errors.

## Final review corrections

The current moderation-queue message retains Admin Actions after acknowledgement. Reporter confirmation and moderator review show the distinct names, immutable ID and actual matched fields. Moderator lists show at most five candidates with count and directory coverage.

Persisted staged ownership survives flag disablement. Eligible new evidence, edits and source deletions still advance source history and invalidate stale controls, while both analysis paths remain paused. Unknown-source and duplicate deletions preserve the current evidence revision, saved outcome and usable reporter confirmation. They do not schedule analysis or send another acknowledgement. Submitted reports retain later evidence without changing their target or starting another investigation. Staff web and MCP evidence reads label superseded, deleted and unavailable sources and their analysis coverage. Reporter reads do not expose staff analysis.

The queue's identity metadata and send reservation now share the report lock, revision and presentation lease with resolution. A delayed write cannot recreate resolved attention. The saved-evidence receipt is independent of moderator notification delivery and remains truthful while that delivery is pending.

## Submission recovery

A target claim records whether submission has started. Dispatch saves a moderator-owned recovery handoff. Staff use Admin Actions on that queue item or the report thread's existing entry. Reporter confirmation remains retired. A failed member lookup before dispatch stays known not-dispatched. An error after dispatch is unknown, and the selected target remains fixed.

Reconcile submission checks a durable routing-completion receipt before resolving anything. A created detection alone is not completion proof. Recorded completion marks the intake submitted without dispatching again. For a known not-dispatched attempt, staff may resolve with a reason. For a settled unknown attempt, staff must record a verified outcome and reason, then confirm the decision. The saved actor, time, attempt and outcome remain distinct from automatic submission success.

An in-flight or process-interrupted dispatch with no completion receipt and no durable settlement remains visible and blocked. Time or lease expiry cannot authorize closure. This is the remaining operator reconciliation limit. There is no automatic retry, target clearing, reselection, or new moderation policy.

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
- [ ] Staff resolution: acknowledge without closing, append voluntary evidence, then resolve an unclaimed review with a reason. Separately confirm an identity and verify the existing submission policy. Exercise pre-dispatch failure, settled unknown attestation and accepted-receipt reconciliation. Verify an in-flight attempt cannot be closed without completion proof.
- [ ] Permission revocation: remove staff authority after controls appear, then attempt selection/resolution through Discord and web. Verify fresh authorization rejects the action. Restore permission only as separately approved.

No live check above is complete. Local mocks do not satisfy these checks.

## Deployment and rollback preparation

1. Obtain deployment approval for the reviewed exact commit. Apply the additive migrations before code through the existing release workflow. Retain old rows and their evidence. Existing rows without a due time remain idle.
2. Deploy with `report_intake_staged_enabled` still false. Verify the schema and code version separately from worker/provider/Discord behavior.
3. After controlled-server approval, enable the selector for that server only. Run the controlled checklist and record actual outcomes.
4. Review wrong-candidate rate, request and time budgets, directory coverage, delivery recovery and acknowledgement before proposing broader enablement. A small synthetic set cannot establish a production error rate.
5. Historical re-enqueue requires an approved exact-ID list. Do not add startup backfill.
6. Roll back by disabling staged processing. Preserve evidence, processing metadata and pending reviews; retain the additive migrations. Verify saved reviews remain accessible and no new staged controls are published. Do not drop the migration as rollback.

## Evidence appendix

The latest correction gate passed with exit 0 on `0e494b1039a1a90b59826b28055556425d3abb76`, using Node 24.15.0 and Playwright 1.60.0 on Linux. The final evidence update changes documentation only; the full run tested that source hash. The N1 correction base was `374b14b5b78fce8c7a17f0abbb2b0ab2000edfd7`. GitHub CI, delayed review feedback, merge readiness and deployment remain unverified.

The full run used `NODE_ENV=test`, `CI=true`, `NEXT_TELEMETRY_DISABLED=1` and the three matching guarded database URLs. Its local log is `.superpowers/sdd/2026-11-03-staged-report-intake/n1-ci-0e494b1.log`. The local `n1-fix-report.md` beside it records the N1 behavioral RED/GREEN checks and exact invocation. Four service regressions reproduce unknown/duplicate retirement with processing enabled and disabled; all five focused cases pass after the correction, including real eligible deletion invalidation. The full intake service suite passes all 99 tests. An earlier full-gate invocation mistakenly enabled integration mode globally and was stopped during bot unit tests. Its log remains separate as setup evidence; the successful run explicitly removed that flag before the integration runner enabled it at its own stage.

The earlier review-correction gate passed on `e50cc75f613de0374295408141516de4386c6830`, with `final-fix-ci-e50cc75.log` and `final-fix-report.md` recording I1-I8/M1-M2 and their two earlier gate failures. Those failures were a missing explicit return type in a test and a missing receipt-query method in a complete handler mock. Both were corrected before that successful run. No assertions, skip policy, coverage thresholds, visual baselines or tolerances were weakened.

Before the final review, Task 9 passed its full local gate on `030cd5edab8d7f0f563d40c433d3e62fd5d6fd33`; its log remains `task9-ci-030cd5e-final.log` in the same local workspace. Implementation base for Task 9: `a305ec1d63f0f4d3aead8c1f76040e1bdb171c09`. Branch fork: `46b2b053060e19b35beccf23f7cf6756490cbe5f`.

Task 9 local acceptance exposed and corrected four integration gaps before the final review:

- The contracts package imported the application CommonJS root at runtime, breaking the web development server. The report-analysis schema now uses the existing browser-leaf export pattern, with CommonJS/ESM parity and real development-server checks.
- Eight inbox snapshots needed the intended `Target not confirmed` heading. Only those snapshots changed. Eight unrelated case snapshots passed unchanged after installing the missing DejaVu font in the disposable Linux runtime (`fonts-dejavu-core` version `2.37-8`).
- The setup concurrency fixture expected 83 editable fields. It now checks all 84 and explicitly includes `report_intake_staged_enabled`; the locked-row concurrency assertions remain.
- Storybook's automatic accessibility scans could collide with explicit audits. The explicit-audit entry points now select manual addon mode, retaining every audit assertion. A native-select font repaint race was reproduced with delayed font loading and corrected only in the screenshot helper. Repeated focused audits passed 38 tests and repeated visual baselines passed 9 tests, with unchanged screenshot tolerance and baseline images.

The additive migration inventory is `20261103000000_report_intake_processing`, `20261103001000_report_intake_analysis_failure` and `20261104020000_reserve_attention_cleanup`. These remain in place during rollback.
