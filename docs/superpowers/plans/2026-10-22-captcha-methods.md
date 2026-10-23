# Server-selected CAPTCHA methods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators select None, Discord image CAPTCHA, or Turnstile while preserving case protections and current moderation policies.

**Architecture:** Keep one challenge lifecycle and one transactional completion store, with browser Turnstile and native Discord adapters. Persist the selected method and its configuration revision on each generation. Image rendering and answer cryptography stay behind a bot-only adapter; only the moderation queue applies case and Discord effects.

**Tech Stack:** TypeScript, Node 24 bot container, discord.js, Prisma/Postgres, the application workspace, Next.js, Jest/Vitest, and candidate `captcha-canvas@3.4.0` with its locked `skia-canvas` dependency.

**Spec:** [Approved design](../specs/2026-10-22-captcha-methods-design.md). Tracking: [#261](https://github.com/BASIC-BIT/drasil/issues/261).

## Global Constraints

- Server administrators choose exactly one method: None, Discord image CAPTCHA, or Cloudflare Turnstile. Members cannot choose the method. Drasil never substitutes another method during an outage.
- No existing server changes method automatically. No deployment enables CAPTCHA fleet-wide.
- Mandatory actor, case, generation, and revision checks remain enforced outside configurable rules.
- Drasil generates the answer with a cryptographic random source, using six uppercase characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`.
- Matching trims surrounding whitespace and ignores ASCII letter case. Reject other normalization or fuzzy matching.
- `DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET` is separate from Turnstile secrets. Answers must not appear in filenames, attachment descriptions, alt text, component IDs, analytics, audit records, URLs, or logs.
- Current default lifetime is 24 hours, invalid-submission allowance is five, and pass action is `evidence_only`. Preserve the configured bounds and existing join-only restrictions.
- Image rendering, persistence, and Discord delivery errors do not consume answer attempts. Private reopens do not rotate the answer or reset limits.
- Tests use only the owned loopback `55433/drasil_mcp_test` or CI `5432/drasil_test` database, with identical `TEST_DATABASE_URL`, `DATABASE_URL`, and `POSTGRES_DB_URL`. Consumers run serially.
- All-new-case issuance, a broader rules engine, defaults changes, production setup, and the public-origin deployment fix are follow-up work. No MCP configuration/actions, production settings, members, or cases are mutated by this plan.

## Review Focus

1. Switch Turnstile to image and back while a pass is queued: the old pass must remain held. Task 2 adds a monotonic method revision and Task 7 tests the queue fence.
2. Two bot instances open the image simultaneously or restart between open and submit: both must present and verify the same stored image. Task 5 tests the issuance race and restart.
3. Replayed interaction IDs or idempotency keys belong to a different actor/case/generation: they must not disclose another result or spend the target's answer budget. Tasks 3 and 6 test exact bindings.
4. Administrator writes race with completion, retry, and expiry: there must be no stale acceptance, lost settings, or lock cycle. Tasks 3 and 4 use real Postgres concurrency tests.
5. Mobile modal obscures the image, or a member cannot read it: assistance must remain usable without another CAPTCHA method. Tasks 6 and 8 test assistance and require disposable live UX evidence.

---

## File and responsibility map

| Area                | Files                                                                                                      | Responsibility                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Method model        | `packages/application/src/setup/settings.ts`, `src/utils/captchaSettings.ts`                               | Canonical method schema, legacy normalization, prospective setup values |
| Storage             | `prisma/schema.prisma`, new migration, `src/repositories/CaptchaChallengeRepository.ts`                    | Method/revision per generation, private image material and cleanup      |
| Shared completion   | New `packages/application/src/postgres/captchaCompletion.ts`, existing `containment/captchaBrowser.ts`     | Attempt limits, authorization, single acceptance, durable queue receipt |
| Answer verification | New `src/services/captcha/imageAnswer.ts`, `imageRenderer.ts`, `CaptchaImageService.ts`                    | Keyed digest, bounded renderer, private opening and submissions         |
| Runtime adapter     | New `src/application/adapters/captchaImage.ts`, existing bot application composition                       | Authenticated member operations, not moderator impersonation            |
| Discord UI          | New `src/controllers/captchaImageInteractions.ts`, existing `InteractionHandler.ts` and `ThreadManager.ts` | Entry button, private image, answer modal, assistance                   |
| Setup               | Application setup policy/ports/persistence, native and web adapters, setup page/actions                    | Admin choice, method readiness, atomic cancellation                     |
| Summaries           | Contracts, repository history, web active-case adapter and case detail                                     | Method-specific audit and readable status                               |

The new shared Postgres code uses existing `DelegationDatabase` and
`DelegationQueryClient` interfaces from `@drasil/application/postgres`; it does not
create an MCP dependency. Encode PNG bytes to base64 at the query boundary and store
them as `bytea` using SQL `decode`, so the common query value type need not change.
No native renderer imports enter the application or contracts browser bundles.

After Task 8 prepares the owned database, the targeted native DB command is
`JEST_INTEGRATION=1 npx jest --runInBand --testPathPattern=<test-name>`.
The existing test setup applies migrations and truncates fixtures. Generate Prisma
first after schema edits. The general integration script does not forward a test
filter; do not assume extra arguments narrow its database scope.

### Task 1: Evaluate and isolate the image renderer

**Files:** Create `src/services/captcha/imageRenderer.ts`, `scripts/probe-captcha-image.mjs`, `src/__tests__/unit/captchaImageRenderer.unit.test.ts`, and `docs/captcha-image-evaluation.md`; modify `package.json`, `package-lock.json`, and `Dockerfile` only if measured runtime requirements demand it.

**Interfaces:** Produce `CaptchaImageRenderer.render(answer: string): Promise<Buffer>` and `createCaptchaImageRenderer(): CaptchaImageRenderer`. The answer is an input; the renderer never generates or verifies it. No application-package dependency on the renderer.

- [ ] Install dependencies in this worktree with `npm ci`; inspect `AGENTS.local.md` again if present. Use task-owned npm cache if the default cache is unwritable. Confirm the approved spec and this plan before product edits.
- [ ] In a throwaway directory under `/tmp`, install the exact candidate and generate a 300-by-100 PNG with an explicit sample answer. Run the same probe inside `node:24-bookworm-slim` as an unprivileged user. Record install/font failures before adding a product dependency. If the candidate cannot meet runtime requirements, stop this task and revise the renderer choice rather than swapping libraries silently.
- [ ] Write `renders a bounded PNG without embedding the answer as metadata` and `bounds simultaneous renders and rejects oversized output`. Assert PNG signature, dimensions 300 by 100, maximum 256 KiB, no answer in PNG text chunks, maximum two simultaneous renders per process, queue depth 20, and a typed busy error when full. The two-worker execution wrapper belongs to the renderer; render jobs have a five-second deadline and a timed-out worker is replaced.
- [ ] Run `npm test -- --runInBand --testPathPattern=captchaImageRenderer.unit.test`; expect failure because the renderer is absent.
- [ ] Implement the renderer using `captcha-canvas@3.4.0`, explicit text, trace/decoy configuration captured in the evaluation report, and the bounded worker pool. Use the actual production dependency and packaged font availability. Add only proven runtime OS packages, not a compiler toolchain to the final image.
- [ ] Rerun the targeted test, then `docker build --target runtime -t drasil-captcha-image-eval .`. Run the standalone render probe with `docker run --rm --entrypoint node drasil-captcha-image-eval scripts/probe-captcha-image.mjs`. Expect a PNG summary and no answer printed. Record platform, lockfile versions, latency distribution, memory, and dependency/license review. No Discord connection or database is needed for this container probe.
- [ ] Record separate sample counts/configurations for human readability and available local OCR/vision evaluation. If human or OCR tooling is unavailable, mark that evidence unverified; do not claim bot resistance. Commit the renderer and evaluation artifact with `feat: add bounded CAPTCHA image renderer`.

### Task 2: Persist methods, configuration revisions, and image material

**Files:** Modify `prisma/schema.prisma`, `src/repositories/types.ts`, `src/repositories/CaptchaChallengeRepository.ts`, `src/__tests__/fakes/inMemoryRepositories.ts`, `packages/application/src/setup/settings.ts`, and `src/utils/captchaSettings.ts`. Create `prisma/migrations/<timestamp>_captcha_image_method/migration.sql` and `src/__tests__/integration/CaptchaImagePersistence.integration.test.ts`. Extend existing settings unit tests.

**Interfaces:** Export `captchaMethodSchema = z.enum(['none', 'discord_image', 'turnstile'])`, `CaptchaMethod`, and `getEffectiveCaptchaMethod(settings: unknown): CaptchaMethod` from setup settings. Add `method: CaptchaMethod` to normalized bot settings. Add non-editable `captcha_method_revision` server JSON metadata, default zero, and persisted `method_revision` on challenges/requests. Repository issue input gains `provider: 'turnstile' | 'discord_image'` and `methodRevision: number`; callers cannot issue `none`.

- [ ] Write assertions that missing method plus legacy active mode maps to Turnstile, legacy off/absent mode maps to None, explicit None suppresses issuance, and malformed explicit values fail closed to None. Assert existing 24-hour/five-attempt/evidence-only defaults remain unchanged. New saves explicitly include `captcha_method`; unrelated settings saves do not rewrite legacy data.

```ts
expect(getEffectiveCaptchaMethod({ captcha_mode: 'manual' })).toBe('turnstile');
expect(getEffectiveCaptchaMethod({ captcha_mode: 'off' })).toBe('none');
expect(getEffectiveCaptchaMethod({ captcha_method: 'none', captcha_mode: 'manual' })).toBe('none');
expect(getEffectiveCaptchaMethod({ captcha_method: 'unknown', captcha_mode: 'manual' })).toBe(
  'none'
);
```

- [ ] Write an owned-DB test that migrates an existing Turnstile challenge and request history without changing its state, then round-trips an image generation and its revision. Assert uniqueness by challenge/generation and no answer in the history projection.
- [ ] Run `npm test -- --runInBand --testPathPattern=captchaSettings.unit.test` and the owned integration runner for the new persistence test; expect failures for the missing model/API. Use the database setup block in Task 8 first, never another database URL.
- [ ] Add `discord_image` to `captcha_provider`, provider defaults to historical request rows, and integer `method_revision` defaults of zero. Add `captcha_challenge_images` keyed by challenge ID plus generation with `png bytea`, 32-byte `answer_digest`, `key_version`, and creation time. Add length/PNG-size/generation constraints, cascading foreign key, and the same RLS posture as other CAPTCHA tables. Reuse the existing challenge link hash column with an unused random hash for image generations; do not introduce public image links or reveal that token.
- [ ] Implement the settings helper once; bot parser consumes it. Update request/history writes to persist method and revision. Add `deleteImageMaterial(challengeId: string, generation: number): Promise<void>` within lifecycle transactions and a bounded terminal/expired cleanup sweep. It must remove material on pass, failure, cancellation, bypass, expiry, and generation replacement, including existing terminal cleanup paths in `VerificationEventRepository`.
- [ ] Regenerate Prisma with `npm run prisma:generate`, apply only to the owned DB, and rerun the settings and persistence tests. Verify a pre-migration legacy fixture remains readable and the RLS check sees the new table. Commit with `feat: persist CAPTCHA methods and private image material`.

### Task 3: Share attempt and completion transactions across methods

**Files:** Create `packages/application/src/postgres/captchaCompletion.ts`, `packages/application/src/postgres/captchaCompletion.test.ts`, and `src/__tests__/integration/CaptchaCompletionStore.integration.test.ts`. Modify `packages/application/src/postgres/index.ts`, `packages/application/src/containment/captchaBrowser.ts`, `apps/web/lib/captchaCompletion.ts`, and its existing tests. Update browser route tests where bindings change.

**Interfaces:** Produce `createCaptchaCompletionStore(database: DelegationDatabase): CaptchaCompletionStore`. Its `beginAttempt(context: ActionContext, input: CaptchaBoundAttemptInput): Promise<CaptchaAttemptStart>` accepts `{ challengeId: string; generation: number; idempotencyKey: string; provider: 'turnstile' | 'discord_image' }`. Its `completeAttempt(context: ActionContext, input: CaptchaCompletionInput): Promise<CaptchaAttemptCompletion>` owns the final transaction. Add the same provider discriminator to completion input alongside existing attempt ID, reference, and verified outcome. Export the new bound input and store interface from the application package. Keep browser token lookup and OAuth decoding in the web adapter. Native callers never receive a generic command that accepts a client-supplied verified result.

- [ ] Add integration tests for a passed attempt producing exactly one existing `apply_captcha_pass` queue receipt; duplicate delivery; fifth invalid answer failing; expired generation; actor/server mismatch; cross-case idempotency-key reuse; and a method switch between provider request and completion. Assert errors do not consume submissions and mismatches cannot read another attempt's result.
- [ ] Run the owned-DB targeted tests and `npm run web:test -- lib/captchaCompletion.test.ts`; expect failures for the shared store or new fences while existing Turnstile tests establish extraction parity.
- [ ] Move attempt limits, attempt creation, result acceptance, and pass requeue transactions out of web-only SQL into the shared store. Preserve the current rate constants: ten attempts per user per 60 seconds, 100 service attempts per 60 seconds, 100 generation attempts, and 60-second abandoned-attempt retirement. Preserve distinct invalid, identity mismatch, provider error, duplicate, stale, and rate-limited states.
- [ ] Use an unlocked lookup only to discover IDs; then acquire explicit row locks in server, case, challenge, attempt order and reread bindings. Apply this order to touched issuance, retry, setup cancellation, and completion paths. Do not hold a DB transaction during rendering, provider HTTP calls, or Discord sends. Idempotency lookup includes actor, case, challenge, generation, and provider bindings, not just the key.
- [ ] Final acceptance requires current server method and method revision equal the issued values, standard pending case, matching generation, unexpired challenge, and remaining budget. Preserve the existing policy where changed case evidence may still record a check but cannot auto-resolve the changed case. Use the existing queue encoder/receipt insertion inside the same transaction; do not introduce a second queue or direct role updates.
- [ ] Adapt web completion to call the store, preserving token-hash lookup, OAuth identity/session checks, CSRF/origin checks, and Turnstile hostname/action/cdata validation. Reject image challenges from all public CAPTCHA page/auth/complete routes. Keep the existing application action boundary; migrate shared internal callers together rather than leaving a duplicated legacy implementation.
- [ ] Rerun shared application tests, web CAPTCHA completion/OAuth/route tests, and the integration concurrency suite. Expect one receipt under simultaneous passes and no PostgreSQL lock timeout under a concurrent method update. Commit with `refactor: share guarded CAPTCHA completion transactions`.

### Task 4: Save method choices and cancellation atomically

**Files:** Modify `packages/application/src/setup/settings.ts`, `policy.ts`, `ports.ts`, `actions.ts`, `persistence.ts`, `packages/application/src/postgres/setup.ts`, `src/application/adapters/setup.ts`, `apps/web/lib/application/adapters/setup.ts`, `apps/web/lib/setupDataAdapter.ts`, `src/repositories/ServerRepository.ts`, and `src/config/ConfigService.ts`. Extend `setup/actions.test.ts`, `setup/resolution.test.ts`, both adapter test suites, `apps/web/lib/setupDataAdapter.test.ts`, and add `src/__tests__/integration/CaptchaMethodConfiguration.integration.test.ts`.

**Interfaces:** Replace `SetupDependencies.provider.isConfigured(): boolean` with `isConfigured(method: Exclude<CaptchaMethod, 'none'>): boolean`. Keep `setupCaptchaProviderIssues` as the Turnstile requirement checker; add `setupCaptchaMethodIssues(method: CaptchaMethod, readiness: CaptchaMethodReadiness): readonly string[]`. `CaptchaMethodReadiness` contains the existing Turnstile configuration and an `imageReady: boolean`. Web image readiness checks the deployment's server-side image key configuration without importing the renderer; bot readiness also checks renderer initialization. Both deployments need the readiness secret configuration, but only the bot verifies image answers.

- [ ] Write tests that None saves without any secrets, image can save without Turnstile/public-origin configuration, Turnstile requires all four existing provider variables and public origin, and changing unrelated settings is allowed during a provider outage. Invalid method values must be rejected at setup command boundaries.
- [ ] Add DB tests that a method change increments revision once, cancels pending checks and deletes material in the same transaction, preserves unrelated settings, and creates no replacements. Re-saving the same method does not increment revision or cancel. Turnstile to image to Turnstile must yield revision two and keep a revision-zero pass ineligible. An invalid readiness change does not save or cancel anything.
- [ ] Run `npm run application:test -- --runInBand --testPathPattern='setup/(actions|resolution)'`, targeted native adapter tests, and owned-DB configuration tests; expect failures for the absent method-aware port and transactional behavior.
- [ ] Evaluate readiness against the merged prospective settings. Route native method changes through `updateSetupIfUnchanged`, including direct native settings paths; avoid the current fast JSON-merge path for method writes. Extend `persistSetupChange` to compare normalized old/new methods under the server lock, increment private revision metadata, cancel pending rows, clear material, and retain cancellation history atomically. Reject user-supplied revision metadata in editable setup schemas.
- [ ] Preserve `captcha_method_revision` in trusted stored-server parsing and approved-state fingerprints, while excluding it from editable settings/commands. Add a regression test that method changes after revision one read and increment the stored revision rather than repeatedly writing one.
- [ ] Extract `applyCaptchaMethodChange(client: DelegationQueryClient, guildId: string, previousSettings: unknown, nextSettings: unknown): Promise<number>` in the shared Postgres CAPTCHA module. The caller holds the server row lock and owns the transaction. Return the unchanged or incremented method revision; cancellation/history/material updates occur inside this helper. Both `persistSetupChange` and web `updateGuildSetup` use it, replacing web's separate mode-off cancellation block. The web path must not silently drop `captcha_method` when mapping shared changes to setup columns.
- [ ] Persist method changes through existing admin authorization and confirmation mechanisms. Update all consumers of the changed readiness port, including test fixtures and shared setup composition, without adding MCP tools/scopes or changing MCP live configuration. Recheck startup/sweep cleanup for out-of-band method mismatches.
- [ ] Rerun the focused suites, with parallel completions, retries, expiry, and unrelated settings writes on the owned database. Expect the configuration and completion to linearize without stale acceptance. Commit with `feat: save CAPTCHA method choices with atomic cancellation`.

### Task 5: Generate, persist, and verify native image answers

**Files:** Create `src/services/captcha/imageAnswer.ts`, `src/services/CaptchaImageService.ts`, `src/application/adapters/captchaImage.ts`, `src/__tests__/unit/captchaImageAnswer.unit.test.ts`, `src/__tests__/unit/CaptchaImageService.unit.test.ts`, and `src/__tests__/integration/CaptchaImageService.integration.test.ts`. Modify `CaptchaChallengeService.ts`, `CaptchaChallengeRepository.ts`, bot application composition, and DI registration.

**Interfaces:** `ImageChallengeReference` is `{ challengeId: string; generation: number }`; authenticated actor and server come from `ActionContext`. `CaptchaImageService.open(context, reference): Promise<ImageOpenOutcome>` returns ready PNG data or denied/stale/unavailable; `submit(context, reference & { interactionId: string; answer: string }): Promise<ImageSubmitOutcome>` returns structured pass/invalid/failed/stale/rate-limit/unavailable outcomes with remaining attempts where relevant. `createBotCaptchaImageActions` exposes these authenticated operations. `imageAnswer.ts` produces `generateImageAnswer(): string`, `normalizeImageAnswer(input: string): string | null`, `digestImageAnswer(binding: ImageAnswerBinding, answer: string, key: Buffer): Buffer`, and constant-time verification.

Define `ImageAnswerBinding` with string serverId/userId/caseId/challengeId and integer
generation. `ImageOpenOutcome` is `{ kind: 'ready'; png: Buffer }` or
`{ kind: 'denied' | 'stale' | 'unavailable' }`. `ImageSubmitOutcome` is
`{ kind: 'invalid'; remainingAttempts: number }` or
`{ kind: 'passed' | 'failed' | 'denied' | 'stale' | 'rate_limited' | 'unavailable' }`.
`BotCaptchaImageActions` defines `open` and `submit` with the same context/input
signatures and `requestAssistance(context: ActionContext, reference: ImageChallengeReference): Promise<'queued' | 'duplicate' | 'denied' | 'stale'>`.
The application-facing result wrappers must use the existing `ActionResult` pattern;
Discord presenters unwrap it at the transport boundary.

- [ ] Write answer tests asserting length six and the exact alphabet; ASCII lower-case plus surrounding whitespace accepted; internal whitespace, Unicode lookalikes, extra symbols, and wrong lengths rejected. A digest changes for every server/user/case/challenge/generation change. Use a versioned JSON-array encoding of binding fields, not ambiguous string concatenation. Assert missing/short secret rejects readiness without logging its value.

```ts
expect(generateImageAnswer()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
expect(normalizeImageAnswer('  ab2cde  ')).toBe('AB2CDE');
expect(normalizeImageAnswer('AB CDE')).toBeNull();
expect(normalizeImageAnswer('ＡB2CDE')).toBeNull();
expect(normalizeImageAnswer('ſB2CDE')).toBeNull();
```

Reject non-ASCII answer characters after trimming and before case conversion so
Unicode case expansion cannot turn an invalid answer into an accepted ASCII one.

- [ ] Write service/DB tests for two concurrent opens selecting the same persisted PNG/digest; discarded losing render material; restart between open and submit; wrong actor/guild; old generation; cross-method submission; repeated interaction ID; five wrong answers; renderer failure; key rotation; and terminal cleanup. Assert the final transaction produces exactly one pass receipt and no plaintext answer is stored.
- [ ] Run the new targeted unit/integration tests; expect failure for absent service/crypto modules.
- [ ] Implement cryptographic generation with `crypto.randomInt` over the exact alphabet. Derive key version as the SHA-256 fingerprint of a decoded secret of at least 32 random bytes. Load only the active `DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET`; rotating it explicitly invalidates image material with another key version and marks pending checks for moderator reissue, never as failed member answers. Document this single-key rotation strategy rather than inventing an unused keyring.
- [ ] At open, authorize before rendering; lazily generate a candidate outside the transaction and insert PNG plus bound digest atomically after locking/rechecking the generation. On conflict return the winner's stored image. An image insert must reject terminal/expired/method-mismatched state. Bind all submit operations to the authenticated actor and derive a namespaced idempotency key from the Discord interaction ID. Verify the digest server-side, then call the shared completion transaction. Revalidate the image issuance inside final acceptance so a replaced/cleaned image cannot pass.
- [ ] Update `requestChallenge` delivery dispatch from persisted provider. Turnstile keeps its website link. Image posts a generation-bound native entry button and needs no public origin. Retry stays moderator-controlled and rotates generation through the existing request limits; None cannot issue. Reopen loads the stored image and never rotates or resets limits.
- [ ] Rerun unit tests, real-DB races, and `npm run action:boundary`. Ensure member completion reaches the application adapter and queue, without going through moderator authority or delegated commands. Commit with `feat: add case-bound native CAPTCHA verification`.

### Task 6: Deliver the private Discord image and answer modal

**Files:** Create `src/controllers/captchaImageInteractions.ts` and `src/__tests__/unit/captchaImageInteractions.unit.test.ts`. Modify `src/controllers/InteractionHandler.ts`, `src/services/ThreadManager.ts`, `src/services/NotificationManager.ts`, and relevant existing handler/service tests.

**Interfaces:** Export `handleCaptchaImageInteraction(interaction: ButtonInteraction | ModalSubmitInteraction, actions: BotCaptchaImageActions): Promise<boolean>`. It returns false for unrelated controls. The handler derives actor/server/request context from the actual Discord interaction, not from component data. IDs use the prefix `captcha:image:<open|answer|help>:<challenge UUID>:<generation>` and contain no answer, digest, provider secret, or link token. Reject malformed values and enforce Discord's 100-character custom-ID limit.

- [ ] Write tests for public entry to private PNG response, Enter answer to text modal, answer submission, stale controls, malformed IDs, actor/guild mismatch, deleted thread, deferred-response errors, repeated assistance clicks, and modal interactions after a restart. Assert unauthorized actors receive no PNG and consume no answer attempts. Assert no member method picker, browser link, or Refresh image action exists in the image flow.
- [ ] Run `npm test -- --runInBand --testPathPattern=captchaImageInteractions.unit.test`; expect failure because the handler is absent.
- [ ] Implement the handler before general moderator-button routing. Open responds ephemerally using fixed filename `security-check.png`, generic description, Enter answer and Ask for help buttons. Modal contains one text field limited to 32 input characters; normalization and correct length remain server-owned. The answer-button path must show the modal immediately, without deferring first; fresh authorization happens on submit.
- [ ] Help records a generation-bound assistance request and uses the existing CAPTCHA attention queue through `createBotCaptchaImageActions`. Add an explicit `member_assistance` attention reason to the shared schema and all exhaustive presenters; its idempotency key is challenge/generation/reason so repeated clicks do not notify repeatedly. It does not bypass, fail, or resolve the check. Keep the help route available when image rendering is unavailable.
- [ ] Use member copy that distinguishes check completion from verification. Wrong answers show remaining attempts; render/storage/delivery failures offer retry or assistance; exhausted/expired cases explain moderator review. Case notifications retain the selected method in admin diagnostics without publishing answer material.
- [ ] Rerun handler/service/application attention-schema tests and `npm run action:boundary`. Add a fake Discord adapter test that restarts the service instance between open and submit with the same database. Commit with `feat: deliver native Discord CAPTCHA interactions`.

### Task 7: Expose admin controls and preserve method-specific policy evidence

**Files:** Modify `packages/contracts/src/setup.ts`, `cases.ts` and their tests; `apps/web/app/admin/guild/[guildId]/setup/page.tsx` and `actions.ts`; `apps/web/lib/setupDataAdapter.ts`; `apps/web/lib/activeCaseDataAdapter.ts`; `apps/web/lib/casePresentation.ts`; `apps/web/components/cases/CaseDetailView.tsx`; `src/repositories/VerificationEventRepository.ts`; `src/services/CaptchaChallengePolicy.ts`; `packages/application/src/postgres/containment.ts`; `packages/application/src/setup/fieldFixtures.testData.ts`; and relevant existing tests/stories. Preserve existing native admin entry points and permissions; method selection is added to the dashboard and shared setup command model, without a new slash-command group in this deliverable.

**Interfaces:** Shared setup command adds `captchaMethod`; persisted editable settings add `captcha_method`. Case summaries/history add `method: 'turnstile' | 'discord_image'`. Internal challenge and SQL resolution checks compare `method_revision` with the current server metadata; do not add editable revision fields or alter shipped queue-command identities.

- [ ] Write setup action tests that admin choice maps None/image/Turnstile correctly, unauthorized members cannot save, and new selection from an off state uses manual issuance unless the admin explicitly chooses suspicious join. Existing legacy active servers display Turnstile. Method None hides issuance controls while retaining saved issuance preferences. There is no new all-cases/default-on control in this deliverable.
- [ ] Write policy/DB tests that an explicitly configured image method plus join-only pass action can resolve the same eligible automatic suspicious-join case, while moderator-issued and non-join cases remain evidence-only. Changes in evidence revision, other pending cases, method or method revision, and pass policy must hold automatic resolution. Test a method switched away and back before the queued pass runs.
- [ ] Run the focused setup, policy, contract, and case-data tests; expect failure for new fields and method-revision fences.
- [ ] Implement the admin method select with the exact labels None, Discord image CAPTCHA, and Cloudflare Turnstile. Rename lifetime copy to Challenge lifetime hours so it applies to both methods. Keep issuance and pass behavior separate and explain provider readiness in admin setup only. Update shared field-coverage fixtures and preserve existing native config summaries. Do not register commands against a live Discord application during local verification.
- [ ] Replace enabled-state checks that inspect only `captcha_mode` in native handler controls, `CaptchaChallengePolicy`, shared containment, and the web active-case adapter with the canonical normalized method plus issuance mode. Add SQL method/revision predicates to repository issue, retry, delivery, expiry, and disabled-server sweeps. Test explicit None with a retained active issuance preference across every path. Keep bypass available for authorized moderators even after disablement.
- [ ] Add provider/revision to history query projections and summary schemas, preserving old history as Turnstile with revision zero. Render method in case diagnostics, not a raw database enum. Update Turnstile member page status for script-load failure so it offers retry and moderator assistance instead of indefinitely waiting; do not offer image fallback. Keep browser identity and origin checks intact.
- [ ] Add current method/revision checks to service policy and the final `completeCaptchaVerification` SQL predicate. Preserve exact-case queue finalization and role restoration protections. Test that a passed check can be recorded as held evidence without claiming the member was verified.
- [ ] Rerun contract/application/native/web targeted tests, `npm run web:typecheck`, and the touched Storybook/browser visual tests. Commit with `feat: expose server-selected CAPTCHA methods and audit evidence`.

### Task 8: Verify integration, document operations, and prepare controlled rollout

**Files:** Modify `.env.example`, `docs/workflow.md`, `docs/deploy/aws.md`, the image evaluation report, and add `docs/captcha-methods-rollout.md`. Extend relevant test fixtures and browser stories. Update issue #261 and prepare a PR only after branch validation.

**Interfaces:** No new runtime API. Deliver a validation report that separates package tests, container measurements, local browser tests, user-supplied Activity evidence, and actual Discord/provider observations.

- [ ] Provision the owned disposable database and copy the guard's exact configuration. These are disposable local fixture credentials, never production credentials:

```bash
docker run -d --name drasil-test -p 127.0.0.1:55433:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=drasil_mcp_test postgres:16
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public'
export DATABASE_URL="$TEST_DATABASE_URL"
export POSTGRES_DB_URL="$TEST_DATABASE_URL"
npm run test:db:prepare
```

Reuse a matching task-owned instance after checking identity rather than starting a duplicate. Wait for readiness with short polls. Never run `db:reset:local` or point these suites at a development/community database.

- [ ] Run the new integration tests serially, then the repository's `npm run check:ci` once after targeted suites pass. Expected result is all required gates passing; investigate failures rather than skipping guards or weakening checks. Required existing MCP tests may run against the owned local fixture DB without any production MCP actions or configuration changes.
- [ ] Build the runtime container and run the renderer probe after pruning dependencies. Verify that web builds and browser bundles do not pull in native rendering assets. Record final tested Node/platform/package versions and renderer resource limits.
- [ ] Document image key creation and secret-manager delivery, setup readiness on bot and web, key-rotation invalidation/reissue, method-change cancellation, pending-generation cleanup, and None rollback. Explain Turnstile site key versus secret, expected hostname, binding secret, separate OAuth redirect, and production/dev application separation. Do not provision or reveal secrets during this plan.
- [ ] Prepare a disposable live test checklist covering the image under a mobile answer modal, desktop private delivery, actor mismatch, attempt exhaustion, restart, assistance, duplicate submits, queue-held evidence, and eligible join-only resolution. Identify the target application/server/member/case and requested setting changes before a live run. Run only after the owner supplies the disposable target and scope; otherwise label live observations unverified and leave the checklist ready.
- [ ] Preserve Activity findings accurately: the user-supplied desktop probe failed at Cloudflare script CSP after SDK readiness; web/mobile and real validation remain unverified. Coordinate cleanup of the temporary development Activity mapping separately. Do not toggle it or delete its deployment as part of image rollout.
- [ ] Recheck source changes for private names and secret/answer leakage. Perform a fresh branch review, address findings, and create a draft PR linked to #261. Attach every created PR to this task. PR text describes the final methods/migration and relevant container/live evidence, not routine required CI gates. No merge or production rollout is part of this plan.

## Plan self-review and execution boundary

Coverage: Tasks 1/5 implement image generation and secret handling; 2/3 implement
durable binding and single acceptance; 4 implements readiness and atomic settings
changes; 6 implements member UX and assistance; 7 implements admin UX, history, and
resolution fences; 8 covers real artifacts, documentation, and controlled rollout.
The five Review Focus conditions each have an owning automated or live test step.
Independent operational fixes and rules/default decisions remain outside this plan.

Execution starts after the user reviews this plan and selects an execution method.
The recommended method is native execution because the storage, setup, and completion
tasks share transaction and type contracts that are easier to keep aligned in one
session. A fresh final branch review is still required.
