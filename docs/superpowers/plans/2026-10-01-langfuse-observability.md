# Langfuse Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

[AGENT]

**Goal:** Replace Phoenix with complete, correlated GPT/Jev workflow traces in Langfuse Cloud, including content, timing, failures, and accurately labeled cost.

**Architecture:** Explicit observations follow existing service/controller boundaries. One workflow contains parallel provider generations and its immediate lookups/actions; later human activity uses a new trace in the same session. A small runtime module isolates telemetry failures without changing moderation.

**Tech Stack:** TypeScript, Node >=22.22.0, CommonJS, existing OpenAI/HTTP clients, Jest, Langfuse tracing/OTel packages, Node OpenTelemetry SDK, existing AWS Secrets Manager/ECS/Terraform deployment.

**Spec:** [Approved design](../specs/2026-10-01-langfuse-observability-design.md), approved by the maintainer on 2026-10-01.

## Global Constraints

- Worktree: `D:\bench\drasil-wt\langfuse-101`, branch `codex/101-langfuse-plan`; base code is `b5626b2ab1173ba68f75991d55926497e0801c42`.
- Refresh current main and check relevant drift before implementation; keep the protected mirror clean.
- Full model request/output content is authorized, including conversations, staff notes, and image descriptions. Preserve existing prompt limits and transforms.
- Runtime credentials and authorization headers remain excluded. Never serialize clients, environment variables, connection strings, raw provider error bodies, or exception stacks.
- Use native `development` and `production` environments within the project. Traces stay private.
- Each logical provider request should have one generation observation. Preserve current provider retry behavior.
- No database migration, moderation-rule change, new retries, prompt management, evaluation platform, custom dashboard, or generic observability abstraction.
- Limit the telemetry shutdown wait to 3 seconds; preserve the existing application shutdown outcome if telemetry fails or exceeds that limit.
- Public prose starts with `[AGENT]`, uses generic server labels, and contains no em dashes.

## Review Focus

1. Telemetry throws after a callback starts: model calls and moderation actions execute exactly once (Task 1).
2. Concurrent messages, debounce replacements, and nested workflows: no trace/session leakage or dangling observations (Tasks 1, 3, 4).
3. Provider responds but parsing fails: retain available usage and mark fallback distinctly from successful `OK` (Task 2).
4. Report fan-out, reused detections, image-only reports, and action caps: report completed actions per destination without inventing model calls (Task 3).
5. Disabled tracing and newly created AWS secrets: an unconfigured rollout must still start; env hydration must preserve existing optional settings (Task 5).

## File map

| Responsibility                        | Files                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime, failure isolation, shutdown  | Create `src/observability/langfuse.ts`; modify `src/index.ts`; delete `src/observability/phoenix.ts`; reuse `src/observability/hash.ts` unchanged                                                                                                                                                                                                                  |
| Provider observations and usage       | Modify `src/services/GPTService.ts`, `src/services/JevService.ts`                                                                                                                                                                                                                                                                                                  |
| Moderation parent traces and outcomes | Modify `src/controllers/EventHandler.ts`, `src/services/DetectionOrchestrator.ts`, `src/services/ReportAiAnalyzer.ts`, `src/services/VerificationThreadAnalysisService.ts`, `src/services/SecurityActionService.ts`, `src/services/ReportDetectionBuilder.ts`                                                                                                      |
| Intake lifecycle                      | Modify `src/services/ReportIntakeAgentService.ts`, `src/services/ReportIntakeService.ts`; observe existing candidate-service calls without changing their matching logic                                                                                                                                                                                           |
| Configuration and removal             | Modify `package.json`, `package-lock.json`, `.env.example`, `scripts/hydrate-dev-env.js`, `infra/aws/prod/main.tf`, `infra/aws/prod/variables.tf`, `.github/workflows/deploy-prod.yml`, `docs/deploy/aws.md`, `docs/dev/codex.md`, `docs/report-intake-agent-design.md`; create `docs/dev/langfuse.md`; delete `docs/dev/phoenix.md`, `docker-compose.phoenix.yml` |
| Live verification                     | Create `src/scripts/langfuseSmoke.ts`; add one npm script and document it in `docs/dev/langfuse.md`                                                                                                                                                                                                                                                                |
| Focused tests                         | Extend existing provider/workflow unit files; create `src/__tests__/unit/Langfuse.unit.test.ts`, `src/__tests__/unit/hydrate-dev-env.unit.test.ts`; create one recording span-processor helper in `src/__tests__/fakes/recordingTracing.ts`                                                                                                                        |

---

### Task 1: Langfuse runtime that cannot alter application execution

**Files:** Runtime row above, package manifests, `.env.example`, new runtime test and recording helper.

**Interfaces produced in `src/observability/langfuse.ts`:**

```ts
// Use the SDK's LangfuseObservationAttributes and PropagateAttributesParams types.
export type ObservationKind = 'chain' | 'generation' | 'retriever' | 'tool' | 'span';
export function initLangfuseTracing(): boolean;
export function shutdownLangfuseTracing(): Promise<void>;
export function withObservation<T>(
  name: string,
  kind: ObservationKind,
  operation: () => Promise<T>,
  attributes?: LangfuseObservationAttributes,
  traceContext?: PropagateAttributesParams
): Promise<T>;
export function recordObservation(
  kind: ObservationKind,
  attributes: LangfuseObservationAttributes
): void;
```

These are functions around native SDK observations, not a DI service or provider abstraction. All later tasks consume them. Generation updates with `metadata.cost_source = 'unknown'` mark the nearest workflow root's `metadata.cost_coverage = 'partial'` through the existing OTel context. No pricing registry or second async-context system is needed. Without a confirmed price, do not advertise complete cost coverage.

**Test support:** `createTracingRecorder(): { spans: ReadableSpan[]; shutdown(): Promise<void> }` in the test helper. Replace the Langfuse export processor with a recording processor while retaining real SDK context propagation; no network. Reset global tracing state between tests.

- [ ] **Write failing runtime tests**, including the following assertions around the existing operation mock and collected spans:

```ts
expect(operation).toHaveBeenCalledTimes(1);
expect(result).toEqual(expectedResult);
expect(observedApplicationError).toBe(applicationError);
expect(children.map((s) => s.spanContext().traceId)).toEqual([rootTraceId, rootTraceId]);
expect(children.map((s) => s.parentSpanContext?.spanId)).toEqual([rootSpanId, rootSpanId]);
expect(serializedSpans).not.toContain('synthetic-runtime-secret');
```

Exercise failures before callback entry, during update, and during observation ending; a rejected operation must preserve its original rejection, not run again. Also test independent concurrent roots, unknown-cost propagation, merged metadata updates, incomplete config, and shutdown that resolves at 3000 ms when an exporter hangs.

- [ ] **Run failing tests:** `npm test -- --runInBand --testPathPattern=Langfuse.unit.test.ts`. Expected: new runtime assertions fail before implementation.
- [ ] **Implement the interfaces and bootstrap replacement.** Add compatible current Langfuse tracing/OTel and NodeSDK packages, retaining the repo's Node floor/CommonJS. Run `npm ci` in this worktree. Explicit opt-in requires keys, regional URL, and environment; partial config disables export with a sanitized warning. Export only selected Drasil observations. SDK batching handles transport. Avoid automatic exception capture of unsafe messages/stacks; catch application exceptions within the SDK callback, record a safe category, and rethrow the original exception outside telemetry handling. SDK errors must never cause callback re-execution. Propagate correlation only inside the process (`asBaggage: false`), never through provider HTTP headers. In `src/index.ts`, initialize after dotenv/before container import and flush in cleanup independently of bot/analytics failures. Clear the timeout timer after shutdown finishes.
- [ ] **Verify and commit:** rerun the runtime test and `npm run build`; both pass, then commit `feat: initialize failure-isolated Langfuse tracing`.

### Task 2: One generation per provider call, with complete content and usage

**Files:** Both provider services and their existing unit tests.

**Consumes:** Task 1 functions. **Produces:** instrumented existing public provider methods with unchanged moderation result contracts. Keep usage/error details in observations rather than expanding persisted analysis interfaces solely for tracing.

Name GPT generations `gpt.profile`, `gpt.report-triage`, `gpt.verification`, `gpt.profile-images`, `gpt.report-intake-extraction`; use existing corresponding prompt-version constants. Jev generations are `jev.profile`, `jev.report-text`, `jev.verification`; add telemetry-only prompt versions `jev-profile-v1`, `jev-report-text-v1`, `jev-verification-replies-v1`, and schema version `jev-choice-v1`. Pass this operation/version metadata into the shared private `analyze` method.

Generation metadata: `provider`, `requested_model`, `prompt_version`, `schema_version` where applicable, `request_sent`, `request_outcome`, `is_fallback`, `usage_status`, `cost_source`, and optional `http_status`/safe `error_category`. The observation's model is the returned version when available. Cost source is `provider_reported`, `langfuse_model_pricing`, `unknown`, or `not_incurred`; never claim model-priced estimates are invoice charges.

- [ ] **Write failing provider tests** using existing fixtures plus the recorder. Call all five GPT and three Jev public methods. Assert actual supplied instructions/input/questions and model output are captured once, while HTTP headers and client configuration are absent. Include these usage assertions:

```ts
// Responses usage: input=100 (cached=80), output=30 (reasoning=10), total=130.
expect(gptGeneration.usageDetails).toEqual({
  input: 20,
  input_cached_tokens: 80,
  output: 20,
  output_reasoning_tokens: 10,
  total: 130,
});
// Jev usage: input_tokens=296, output_tokens=20.
expect(jevGeneration.usageDetails).toEqual({ input: 296, output: 20, total: 316 });
expect(missingKey.metadata).toMatchObject({ request_sent: false, error_category: 'missing_key' });
expect(fetchMock).not.toHaveBeenCalled();
```

Also assert no image generation when there are no images; a valid Jev verdict survives absent/invalid optional usage; malformed structured answers retain separately validated usage; GPT fallback is labeled as fallback, even when its business result is `OK`; unknown usage stays absent. Test Jev timeout, HTTP 429, malformed JSON/schema, and network failures against the five specified categories. Optional telemetry data must be finite, nonnegative counts; malformed details must not change moderation results.

- [ ] **Run failing tests:** `npm test -- --runInBand --testPathPattern='(GPTService|JevService).unit.test.ts'`.
- [ ] **Instrument the existing request/parsing boundaries.** Build request bodies once and send/trace that same body. Read raw usage/output/model before application parsing; do not replace the public result contracts or prompts. Normalize GPT inclusive counts into the exclusive buckets above, with zero/missing detail handled correctly. Retain existing aggregate token metadata for its current callers. Parse Jev `usage.input_tokens`/`output_tokens` separately from verdict validation, using the official [API contract](https://docs.typesafe.ai/api). Record available usage even if verdict parsing fails. Missing key costs zero with `not_incurred`; dispatched failures without usage have `unknown` cost. For GPT, preserve existing profile trace/span ID metadata using the new active generation. Only capture HTTP status when exposed by the client; do not invent it. Use bounded error-category/status messages, never raw provider exception text.
- [ ] **Verify and commit:** provider/runtime tests and build pass; commit `feat: trace GPT and Jev generations and usage`.

### Task 3: Correlate moderation analyses through completed outcomes

**Files:** Moderation row above and existing `EventHandler`, `DetectionOrchestrator`, `ReportAiAnalyzer`, `VerificationThreadAnalysisService`, `SecurityActionService` unit files.

**Consumes:** Task 1 functions and Task 2 generations. **Produces:** shared parent context, combined verdicts, IDs, and completed outcomes without changed method signatures or business behavior.

Roots: `message-moderation`, `join-moderation`, `report-moderation`, `verification-review`. Children: `collect-context` (retriever), `automatic-detection`/`report-triage` (chain), `combine-verdicts` (span), `apply-outcome` (tool), `persist-result` (span). Keep provider generations as siblings inside the analysis chain. A direct analysis call without a controller still gets its own analysis chain; do not manufacture a completed Discord action.

- [ ] **Write failing workflow tests** covering clean checks, GPT-only/Jev-only flags, and two simultaneous runs:

```ts
expect(gpt.traceId).toBe(jev.traceId);
expect(gpt.parentSpanId).toBe(jev.parentSpanId);
expect(firstRun.traceId).not.toBe(secondRun.traceId);
expect(root.output).toMatchObject({ verdict: 'OK', actual_outcome: 'no_action' });
const rootEnd = BigInt(root.endTime[0]) * 1_000_000_000n + BigInt(root.endTime[1]);
const actionEnd = BigInt(actionSpan.endTime[0]) * 1_000_000_000n + BigInt(actionSpan.endTime[1]);
expect(rootEnd >= actionEnd).toBe(true);
expect(discordAction).toHaveBeenCalledTimes(1);
```

Use recorded OTel fields/attributes rather than mocked wrapper-call counts. Add assertions for image-only Jev `not_applicable`, disabled analyses, configured caps, setup safety falling back to record-only, failures swallowed by existing handlers, reused confirmed-intake detections without new generations, and local/external report fan-out with separate destination outcomes. Provider-level content belongs to generations, not duplicated on roots.

- [ ] **Run failing tests:** `npm test -- --runInBand --testPathPattern='(EventHandler|DetectionOrchestrator|ReportAiAnalyzer|VerificationThreadAnalysisService|SecurityActionService).unit.test.ts'`.
- [ ] **Add roots at the actual orchestration boundaries.** In `EventHandler.handleMessage`, wrap eligible scan/context collection through `handleAutomaticDetection` after ignored/off/exempt paths; leave initial report-thread dispatch outside this root. In `runJoinDetectionForMember`, wrap profile collection through automatic handling after existing skip/rejoin guards. In `DetectionOrchestrator.detectMessage`/`detectNewJoin`, add the analysis chain around existing work, recording heuristic contribution and resulting event ID. Do not duplicate classifier eligibility rules in the controller.
- [ ] **Instrument report and verification boundaries.** Root `SecurityActionService.handleUserReport`, `handleConfirmedReportIntake`, and `handleMessageReport`; use a destination child for `processMessageReportForManagedServer`. `ReportAiAnalyzer.analyzeIfEnabled` creates its analysis chain only after its eligibility checks, encompassing the current parallel calls/combination/cap. `ReportDetectionBuilder` records created detection IDs. Root eligible verification analysis in `handleFlaggedUserThreadMessage` after its skip/message-limit checks, before thread/context fetching, through notification and metadata updates. Record capped recommendation separately from actual notification/persistence completion. Attach case IDs and use session IDs `${environment}:case:${caseId}` or `${environment}:intake:${intakeId}`; bare automatic scans remain standalone. Set session context at entry when an ID is known; a case ID created during a scan is attached to that initial trace as metadata and used as the session for subsequent case runs. Do not rewrite completed children to assign a late session. Use `hashIdentifier` for user/guild correlation metadata.
- [ ] **Record actual outcomes at existing branches.** In `handleAutomaticDetection`, record `no_action`, `record_only`, `observed_alert`, or the downstream case/action result after completion. In `routeConfirmedReportIntake`, `upsertReportObservedAlertOrActiveCase`, `handleSuspiciousMember`, and `autoKickSuspiciousMember`, record real selected/completed outcomes and returned IDs. Null/false delivery, existing-case reuse, and caught failures must not become successful case opening. Trace grouped I/O, not every internal helper. Provider-free branches can record their genuine outcome without invented generations. `sendCaseEvidenceBundle` image descriptions inherit the active workflow; add a small `case-evidence` chain here when invoked without an existing model workflow.
- [ ] **Verify and commit:** workflow/provider tests pass with unchanged existing action assertions, then commit `feat: correlate moderation workflows and outcomes`.

### Task 4: Complete report intake lifecycle and timer correlation

**Files:** Both intake services and their existing unit files. Observe existing calls to `ReportCandidateService` within the intake workflow; no candidate matching changes.

**Consumes:** Task 1 functions and Task 2 extraction generation. **Produces:** one `report-intake` chain per executed eligible run, containing `load-evidence`/`resolve-candidates` retrievers, `send-confirmation` tool, and `persist-result` span. Session format comes from Task 3.

- [ ] **Write failing lifecycle tests** with Jest fake timers and deferred I/O:

```ts
expect(extractEvidence).toHaveBeenCalledTimes(1); // Latest debounce run only.
expect(root.metadata).toMatchObject({ scheduling_delay_ms: expectedDelay });
expect(root.sessionId).toBe('development:intake:intake-1');
expect(rootEndedBeforePersistence).toBe(false);
expect(nextRoot.traceId).not.toBe(root.traceId);
expect(nextRoot.sessionId).toBe(root.sessionId);
```

Cover no candidates, repeated confirmation suppression, candidate lookup/Discord-send/persistence failure, skipped closed intake, two different intake timers, and telemetry ending failure not causing another confirmation send. A false `recordAgentAnalysis` return means no candidates were suggested, not necessarily failed persistence.

- [ ] **Run failing tests:** `npm test -- --runInBand --testPathPattern='ReportIntake(Agent)?Service.unit.test.ts'`.
- [ ] **Instrument scheduling and execution without leaving spans open.** Keep `scheduledRuns` as timers; pass the latest scheduling timestamp/message ID into a private execution path, preserving the public `runAnalysisForThreadMessage(message): Promise<boolean>` signature. Start the trace for eligible work, record actual start/latest schedule/delay, and end after candidate resolution, optional confirmation, and persistence. Use safe count/result metadata for lookups/actions. In `recordAgentAnalysis`/`sendCandidateConfirmationPrompt`, record whether a confirmation was actually sent and whether persistence completed; distinguish intentional suppression/no-candidate outcomes from errors. Direct/manual calls have no invented scheduling delay. Later confirmed intake routing already gets a separate correlated trace from Task 3.
- [ ] **Verify and commit:** intake plus runtime tests pass; commit `feat: trace report intake scheduling and lifecycle`.

### Task 5: Deployable configuration and complete Phoenix removal

**Files:** Configuration/removal row, new hydration test. Runtime/provider files only if removing now-unused Phoenix-specific imports/attributes.

**Consumes:** Task 1 config contract. **Produces:** opt-in Cloud configuration, environment-specific secret wiring, accurate release labels, and setup/runbook documentation.

- [ ] **Write failing hydration tests** by running the existing script with mocked `fs`/`child_process` in a temporary test context, never real AWS. Assert:

```ts
expect(writtenEnv).toContain('LANGFUSE_TRACING_ENVIRONMENT="development"');
expect(writtenEnv).toContain('LANGFUSE_TRACING_ENABLED="true"');
expect(writtenEnv).toContain('LANGFUSE_SECRET_KEY="synthetic-langfuse-secret"');
expect(capturedConsole).not.toContain('synthetic-langfuse-secret');
expect(unconfiguredSecretRequests).not.toContain('drasil/dev/LANGFUSE_SECRET_KEY');
```

Existing optional TypeSafe and Langfuse settings must survive hydration. Missing optional Langfuse config must not trigger a fetch of a nonexistent secret or silently enable tracing.

- [ ] **Run failing test:** `npm test -- --runInBand --testPathPattern=hydrate-dev-env.unit.test.ts`.
- [ ] **Wire optional configuration.** Add Terraform variables `langfuse_tracing_enabled` (default false) and `langfuse_base_url` (default empty). Create metadata-only secrets `${local.secrets_prefix}/LANGFUSE_PUBLIC_KEY` and `/LANGFUSE_SECRET_KEY` with existing KMS/recovery policy. ECS secret references are conditional on opt-in, so disabled deployment does not require populated new secrets. Extend the execution-role secret allowlist. Set native environment `production`, explicit enable flag, and region URL in ECS. Hydration accepts optional `DRASIL_LANGFUSE_PUBLIC_KEY_SECRET`/`DRASIL_LANGFUSE_SECRET_KEY_SECRET`; otherwise preserve process/existing-file values and tracing URL/enable/environment/release settings. Document how to populate and enable them, without running AWS writes in this task.
- [ ] **Inject the resolved release and remove Phoenix.** In deploy task-definition rendering, replace/append `LANGFUSE_RELEASE` with `steps.resolve_image.outputs.image_sha`, including reused-image/rollback deploys. Use the already installed `jq`; preserve all other variables/secrets. Remove both Arize dependencies, compose configuration, old docs/env aliases, and runtime references. Audit `npm ls` before deleting OTel overrides; retain overrides still required by supported dependencies. Update `docs/dev/codex.md` and the active report-intake design's Phoenix reference. Historical planning documents may mention the migration.
- [ ] **Verify and document.** Hydration/runtime tests and `npm run build` pass. Run `terraform -chdir=infra/aws/prod fmt -check`, `terraform -chdir=infra/aws/prod init -backend=false`, `terraform -chdir=infra/aws/prod validate`, and `actionlint .github/workflows/deploy-prod.yml`; obtain missing tools using the existing repo workflow. Expected: successful validation with no new diagnostics. Render the jq expression against a synthetic task definition with an existing release value; assert exactly one new SHA value and unchanged secret references. Run `rg -n 'PHOENIX|@arizeai|docker-compose.phoenix' src .env.example package.json docs/dev .github infra`; expected no active matches. The new runbook covers project selection, regional URL, full content, private access, environment-specific keys, 3-second flush, model prices, unknown/partial costs, and disabled rollback. Commit `feat: configure Langfuse deployment and remove Phoenix`.

### Task 6: Live trace proof and PR handoff

**Files:** Create `src/scripts/langfuseSmoke.ts`, add `trace:smoke` npm script, finish `docs/dev/langfuse.md`.

**Consumes:** Tasks 1-5 runtime/provider/configuration. **Produces:** a repeatable synthetic provider check and evidence of actual Cloud ingestion, graph/timing, and usage/pricing. This is not a Discord moderation test.

- [ ] **Create the smoke command.** `npm run trace:smoke` runs `node -r ts-node/register src/scripts/langfuseSmoke.ts`. Load dotenv before init/provider imports; require tracing config and existing provider keys with sanitized failures. Construct the existing GPT/Jev services directly, use clearly synthetic profiles/report text/verification conversations, and run their real paired calls inside separate `chain` roots. Add an explicitly synthetic no-op `tool` outcome so graph rendering can be inspected. Print trace IDs and configuration presence only, never content or credentials. Include one Jev missing-key observation by temporarily removing/restoring the process value inside a sequential synthetic check. Flush in `finally`; no database, Discord client, moderation action, or new key is required by the script.
- [ ] **Verify locally and review.** Run `npm run build`, focused tracing/provider/workflow tests, and the repo's required CI workflow. Inspect the complete diff against the approved spec. Follow `pr-workflow` for publishing/recycle; issue #101's old redaction proposal must be updated to the explicitly approved full-content policy when publishing this work. Do not describe inferred spend as exact billed spend.
- [ ] **Configure and prove live delivery after the reviewed plan is selected for execution.** Inspect Cloud for an existing dedicated Drasil project; reuse it or create the project in the existing organization. Establish private project access and configure available model definitions: exact returned OpenAI models with cached/reasoning usage keys priced correctly, and exact `jev-1.13.0` matching with input USD 0.000000042/token and output zero, subject to current account pricing. Keep raw token usage authoritative and rate-derived costs labeled estimates. Missing model prices stay absent/unknown; never fill them with zero. Use environment-specific keys through existing secret storage. Run the smoke command and inspect delivered traces in Cloud, including graph/tree, sibling overlap, complete content, failures, usage, costs, environment/session/release, and absence of runtime secrets. Save only synthetic IDs and sanitized evidence in the PR/runbook. If delivery or model pricing is missing, fix it before calling live verification complete.
- [ ] **Complete rollout verification separately from merge readiness.** Respect the exact-head 30-minute feedback gate in AGENTS.md. Once merge/deploy is authorized, populate/apply the opt-in configuration and let the existing deployment adopt it. Verify the running release/config and delivered synthetic trace after rollout. Existing pipelines retain their moderation behavior. To disable tracing, set the opt-in false and deploy that configuration; model analysis continues. Commit the smoke/runbook changes as `test: add live Langfuse trace verification` before the final review window begins.

## Plan self-review and execution boundary

Coverage: runtime/failure isolation/shutdown (Task 1); provider content/failures/usage (Task 2); clean/combined decisions and actual actions (Task 3); intake scheduling/lifecycle (Task 4); secrets/env/release/Phoenix removal (Task 5); Cloud graph/pricing/live proof and rollout (Task 6). All five Review Focus items have explicit checks above.

Native execution is recommended: the six tasks share tracing context and the same large service files. Implement sequentially here, then use one independent whole-branch review plus existing PR reviewers. Subagent-driven execution is available if the maintainer prefers per-task implementation/review. No agents have been dispatched and no implementation has started. Review this plan and select the execution method before product changes.
