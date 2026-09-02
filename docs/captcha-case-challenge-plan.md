# CAPTCHA Case Challenge Implementation Plan

Status: Implemented

Tracking issue: [#218](https://github.com/BASIC-BIT/drasil/issues/218)

Delivery shape: One implementation pull request

## Outcome

Drasil can add a browser CAPTCHA challenge to a normal moderation case. A challenge can be added
automatically when a suspicious-join case is created and the server enables that policy, or a
moderator can add one to any pending standard case. The result becomes durable case evidence.

A CAPTCHA pass does not create a global trusted state and does not prove that all evidence in a case
is harmless. It can close a case automatically only for the narrow suspicious-join flow described
below. Every other pass leaves the case pending for a moderator.

This work ships as one PR because the database state, bot workflow, browser identity check, provider
validation, moderator controls, and case presentation form one security boundary. The branch should
still be built and reviewed in dependency-ordered slices.

## Product decisions

- CAPTCHA is an optional component of a normal case, not a separate case type.
- A server may automatically add CAPTCHA only when a case is opened by suspicious join detection.
  Eligibility is based on that concrete detection source, not a broad automation, spam, or scam
  label.
- A moderator may select `Challenge user` on any pending `standard` case, regardless of how the
  case began.
- Compromised-account recovery cases cannot use CAPTCHA.
- A pass belongs only to the case that issued the challenge. It does not exempt the user from future
  challenges or affect other cases.
- A moderator-requested pass is evidence only. The case remains pending.
- An automatically included suspicious-join pass may verify the case only when the server has
  explicitly enabled that effect and the case still contains only the original join evidence.
- A timed-out or exhausted challenge leaves the user restricted and alerts moderators. The first
  release does not kick on timeout and never bans from a CAPTCHA result.
- Once a challenge has passed for a case, that case cannot issue another challenge.
- A case has one CAPTCHA challenge aggregate. Retry creates a new generation inside that aggregate
  and invalidates older links.
- Cloudflare Turnstile is the first provider.
- The default challenge lifetime is 24 hours.
- Each generation allows at most five server-validated user submissions. Provider or Drasil service
  failures do not consume the user's allowance.
- The implementation lands as one PR.

## User-facing copy contract

Challenge instructions:

> Complete this browser check to confirm access to your Discord account.

Successful completion:

> Security check completed.

Do not add policy explanations to the success message. In particular, do not tell the user whether
the pass resolved the case or whether moderators still have other evidence to review.

Failure pages may state the immediate problem and recovery action, such as an expired link, an
identity mismatch, an unsuccessful browser check, or temporary service unavailability. They should
not expose risk signals, provider response internals, or moderation policy.

## Case behavior

### Challenge states

Absence of a challenge record means CAPTCHA has not been requested for that case.

| State       | Meaning                                            | Available next action              |
| ----------- | -------------------------------------------------- | ---------------------------------- |
| `pending`   | The current generation can still be completed      | Wait or bypass                     |
| `passed`    | The bound Discord user completed the current check | No further challenge               |
| `failed`    | The submission allowance was exhausted             | Moderator retry or bypass          |
| `expired`   | The generation reached its expiry                  | Moderator retry or bypass          |
| `bypassed`  | A moderator continued without a browser pass       | Challenge again or continue review |
| `cancelled` | The case ended while a challenge was pending       | None                               |

`bypassed` is not equivalent to `passed`. A bypass requires a moderator reason and leaves the case
pending. Because the user has not passed, a moderator may issue a later generation if needed.

### Creation rules

Automatic inclusion requires all of the following:

- The suspicious join detection caused creation of this case. Linking another join event to an
  already active case does not add CAPTCHA automatically.
- The case kind is `standard`.
- The server's `captcha_mode` is `suspicious_join`.
- No CAPTCHA has passed for the case.
- No challenge generation is currently pending.

Moderator inclusion requires all of the following:

- The case is pending.
- The case kind is `standard`.
- The moderator is authorized for the case's server.
- No CAPTCHA has passed for the case.
- No challenge generation is currently pending.

`captcha_mode=off` disables new automatic and moderator challenges. `captcha_mode=manual` enables
moderator challenges only. Disabling the mode does not erase audit history. Pending challenges
should stop accepting new completions and move to `cancelled` so the operator has a clear cutoff.
Already-passed challenges must also stop applying or replaying automatic case-resolution effects.

### Retry and bypass

- `Retry challenge` is available only for `failed`, `expired`, or `bypassed` challenges on a pending
  case.
- The retry confirmation carries the displayed challenge ID and generation. If either changed before
  execution, refuse the stale action instead of retrying the newer generation.
- Retry increments the generation, creates a new opaque link and 24-hour expiry, resets the
  generation submission count, and invalidates every previous link.
- `Continue without browser check` requires confirmation and a concise reason.
- Bypass records the moderator identity, reason, timestamp, and challenge generation.
- Bypass never resolves the case and never removes the case role.

### Case resolution rules

Every valid pass records durable evidence against the exact `verification_event_id` before any
resolution decision is attempted.

A moderator-requested challenge always has `evidence_only` effect.

An automatically requested challenge may resolve its bound case only if all of these conditions are
true at pass time:

- The request source is `automatic_suspicious_join`.
- The server currently has `captcha_pass_action=verify_join_only`.
- The case is still pending and is still `standard`.
- The authenticated Discord user matches the case subject.
- The case evidence revision matches the revision captured when the challenge generation began.
- Every detection linked to the case is suspicious-join evidence. No message, report, manual flag,
  or other evidence has been linked since issuance.
- There is no other pending case for the same server member.

If any condition fails, the pass remains recorded as evidence and the case remains pending. This is
a safe stale-policy outcome, not a failed CAPTCHA.

Current moderation resolution can operate on multiple pending cases for one server member. This
feature must not silently replace that broader behavior with a database uniqueness constraint.
Normal case routing should continue to reuse an active case where it already does today. The
CAPTCHA path must bind to one exact case and refuse automatic resolution when another pending case
exists, because releasing the shared case role could weaken the other case. Reconciling broader
multi-case resolution semantics is outside issue #218.

## Configuration

Add typed server settings:

```text
captcha_mode                     off | manual | suspicious_join
captcha_pass_action              evidence_only | verify_join_only
captcha_challenge_lifetime_hours positive integer, default 24
captcha_max_submissions          positive integer, default 5
```

Defaults:

```text
captcha_mode=off
captcha_pass_action=evidence_only
captcha_challenge_lifetime_hours=24
captcha_max_submissions=5
```

The setup dashboard should explain that `verify_join_only` applies only to automatically added,
join-only challenges. It must not imply that moderator challenges or mixed-evidence cases will
close automatically.

Turnstile credentials and the canonical public web origin are operator-managed deployment settings,
not per-server values. Startup and setup diagnostics should report missing keys, invalid public URL,
and hostname mismatch without exposing secrets.

## Persistence design

### CAPTCHA challenge aggregate

Add `captcha_challenges` with one row per case:

```text
id
verification_event_id           unique foreign key
server_id
user_id
provider                        turnstile
status
request_source                  moderator | automatic_suspicious_join
pass_effect                     evidence_only | verify_join_only
generation
case_revision_at_issue
link_token_hash
expires_at
submission_count
requested_by                    nullable Discord moderator ID
requested_at
passed_at                       nullable
bypassed_by                     nullable Discord moderator ID
bypassed_at                     nullable
bypass_reason                   nullable
cancelled_at                    nullable
created_at
updated_at
```

Store only a hash of the 256-bit random link token. A retry replaces the hash and increments the
generation. Never persist or log the plaintext link token.

Capture `pass_effect` at issuance for audit clarity, but recheck the current server setting at pass
time before automatic resolution. A later policy change may narrow an outstanding challenge but
must not broaden its effect.

Store every issuance and retry in `captcha_challenge_requests`, keyed by challenge and generation,
with the request source, pass effect, case revision, requester, and timestamp. The challenge
aggregate may expose the current generation, but retry must not overwrite prior request provenance.

### Attempts

Add `captcha_challenge_attempts` for bounded security and support history:

```text
id
captcha_challenge_id
generation
submission_number
idempotency_key                 unique
validation_state
provider_success
provider_action                 sanitized
provider_hostname               sanitized
provider_error_codes            bounded allowlisted values
discord_user_id                 nullable until OAuth succeeds
created_at
validated_at                    nullable
```

Do not store Turnstile response tokens, Discord OAuth access tokens, IP addresses, raw user agents,
or provider response bodies. Provider error codes must be allowlisted and bounded before storage or
logs.

Store each moderator bypass in `captcha_challenge_bypasses`, keyed by challenge and generation,
with the moderator ID, bounded reason, and timestamp. Retrying clears the current generation's
display fields but must not erase this durable per-generation audit history.

### Case evidence revision

Add a monotonic evidence revision to `verification_events`, or an equivalent transactional evidence
fingerprint if the schema review finds an existing reliable primitive. Increment it whenever a new
detection is linked to an active case. Challenge issuance captures the current revision. Automatic
resolution uses an expected-revision write so evidence arriving concurrently cannot be overlooked.

### Audit events

Record durable, actor-aware events for:

- challenge requested automatically;
- challenge requested by a moderator;
- generation retried;
- browser check passed;
- submission allowance exhausted;
- challenge expired;
- moderator bypassed with reason;
- pending challenge cancelled;
- pass recorded but automatic resolution held by changed evidence or another active case;
- automatic join-only case resolution completed.

System actor IDs such as `drasil:captcha` must render as product actors. They must never be formatted
as Discord mentions.

## Browser and provider flow

### Link and authentication

1. Drasil creates or reactivates the case's challenge aggregate.
2. Drasil generates a 256-bit opaque token, stores its hash, and creates a link containing the
   plaintext token.
3. The existing user-visible case thread receives the challenge copy and link. Do not create a DM or
   a second case thread.
4. The page validates the token hash, generation, state, and expiry before starting OAuth.
5. A dedicated Discord OAuth flow requests only `identify`.
6. The callback verifies that the Discord identity matches the case subject.
7. The page renders Turnstile with a stable action and HMAC-bound `cdata` covering the challenge ID
   and generation.
8. The server submits the provider token to Siteverify, validates success, action, hostname, and
   `cdata`, then commits the pass idempotently.
9. The page displays exactly `Security check completed.`

Use a separate, short-lived cookie and callback state from the moderator dashboard session. Do not
persist the Discord access token after the identity callback completes.

### Turnstile validation

- Validate every token server-side. Client success is not sufficient.
- Treat provider tokens as single-use and short-lived.
- Send a stable idempotency key to Siteverify and enforce local idempotency as well.
- Validate the configured hostname and action exactly.
- Bind `cdata` to the challenge and generation so a response cannot be moved to another case.
- Mark a pass transactionally before queueing its case effect.
- An invalid or replayed user token consumes a submission. Provider timeout, transport failure, or
  internal Drasil failure does not consume a submission and must not punish the user.
- Provider unavailability leaves the challenge pending and shows a retryable service message.

Turnstile test keys should be used in automated browser tests. Production secrets must never enter
fixtures, logs, screenshots, or repository history.

## Bot and web orchestration

### Domain services

Introduce a CAPTCHA challenge service that owns eligibility, issuance, retry, bypass, expiry, pass
recording, and effect selection. Keep provider verification behind a narrow adapter so the domain
service receives a sanitized result rather than a raw provider response.

The challenge service should be callable from:

- `SecurityActionService` after it creates a suspicious-join case and its thread;
- Discord interaction handling for moderator challenge, retry, and bypass;
- web case actions for the same moderator operations;
- the public completion route after OAuth and provider validation;
- an expiry sweep that transitions overdue pending generations and notifies moderators.

### Durable web-to-bot action

The web process must not mutate Discord roles, threads, or case lifecycle directly. Extend
`moderation_action_requests` with a system-only `apply_captcha_pass` action. The request binds the
challenge ID, case ID, generation, expected case revision, and idempotency key.

The bot worker claims the request and either:

- records evidence only;
- resolves the exact eligible join-only case through a targeted system-actor lifecycle; or
- records a held result when current evidence, case state, policy, or active-case count no longer
  permits automatic resolution.

Do not call the existing moderator `verifyUser` entry point with a fabricated Discord user. Extract
or add a lower-level targeted case transition that accepts a typed actor and expected case ID while
preserving role, thread, notification, and audit invariants.

### Delivery failure

Challenge creation and Discord delivery are separate observable steps. If posting the link fails,
keep the case pending, record a delivery error for moderators, and allow retry. Never resolve a case
because the browser challenge could not be delivered.

## Moderator experience

Expose challenge state in both the Discord case controls and the web case detail.

For an eligible case with no challenge, show `Challenge user`. Require confirmation before issuing
the link.

For a pending challenge, show status and expiry. Do not show another challenge button. Offer
`Continue without browser check` behind confirmation and a reason.

For a failed, expired, or bypassed challenge, show `Retry challenge` when the case is still pending.

For a passed challenge, show the pass as evidence and remove all challenge actions.

For a cancelled challenge or resolved case, show history without controls.

Discord admin notifications, evidence presentation, case threads, the moderation inbox, and web case
detail should all derive labels from the same typed state. Avoid nested cards in the web UI. Add the
status and actions to the existing case surface.

Moderators should receive a concise alert when a challenge expires, exhausts submissions, cannot be
delivered, or passes but is held from automatic resolution. Do not include raw provider errors.

## Expiry processing

Add an idempotent periodic sweep in the bot process for pending rows whose `expires_at` is past.
The sweep should claim rows in bounded batches, transition them to `expired`, update the existing
case presentation, and upsert the moderator notification. Reprocessing the same row must be a no-op.

Expiry does not remove the case role, close the case, kick, or ban the member.

## Security and privacy invariants

- Every public link is unguessable, hashed at rest, scoped to one case and generation, and expires.
- Every state-changing endpoint validates CSRF or equivalent same-site request integrity.
- OAuth state is signed, short-lived, single-use, and bound to the challenge generation.
- The authenticated Discord user must exactly match the challenged case subject.
- Provider validation occurs only on the server.
- Secrets and provider tokens are redacted from structured logs and error reporting.
- Rate limits apply by challenge, generation, authenticated Discord user, and coarse service budget.
- Failure to load or complete Turnstile because of extensions, embedded browsers, accessibility
  tooling, provider outage, or network conditions never creates an automatic punitive action.
- The completion route reveals only the minimum state needed by the bound user. It does not expose
  case evidence, moderator identity, detection source, server configuration, or resolution policy.
- A case pass is not a reusable account credential and is not consulted by later cases.

## Observability

Add aggregate metrics and bounded logs for:

- challenges issued by request source;
- delivery success and failure;
- passes, invalid submissions, expiry, retry, bypass, and cancellation;
- provider service errors separately from user-invalid responses;
- pass-to-completion duration;
- evidence-only passes;
- automatic resolutions;
- automatic-resolution holds by reason;
- duplicate or replayed completion requests.

Do not emit user IDs, link tokens, OAuth tokens, provider tokens, IP addresses, raw user agents, or
raw provider responses into product analytics.

## Single-PR implementation sequence

### 1. Schema, contracts, and repositories

- Add challenge, attempt, state, source, and effect enums and tables.
- Add the case evidence revision or equivalent concurrency primitive.
- Add server settings with safe defaults.
- Add the system moderation action type and typed payload.
- Implement repositories and integration coverage for transitions, generations, idempotency,
  expiry claims, and expected-revision writes.

### 2. Policy and challenge domain services

- Implement automatic and moderator eligibility.
- Implement issuance, retry, bypass, cancellation, expiry, submission accounting, and pass recording.
- Implement the automatic-resolution predicate as a pure, exhaustively tested policy function.
- Add the Turnstile adapter contract and sanitized error mapping.

### 3. Public browser identity and Turnstile flow

- Add the token entry route and dedicated `identify` OAuth flow.
- Add short-lived challenge session state and identity-match enforcement.
- Render Turnstile and validate Siteverify results server-side.
- Add completion idempotency and the exact copy contract.
- Add browser tests with Turnstile test keys for success, mismatch, expiry, invalid response, replay,
  and provider outage.

### 4. Targeted case effect and bot worker

- Extend the durable action worker with `apply_captcha_pass`.
- Refactor case resolution to support a typed system actor and exact case target.
- Enforce expected evidence revision and the additional-pending-case guard.
- Preserve case role, thread, notification, and audit behavior.
- Add actor-aware presentation for `drasil:captcha`.

### 5. Discord and web moderator surfaces

- Add challenge, retry, and bypass controls to pending standard cases.
- Add confirmation and bypass-reason handling.
- Post links to existing user-visible case threads.
- Show challenge history and current state in Discord notifications, evidence, the inbox, and web
  case detail.
- Add typed settings and deployment diagnostics to setup surfaces.

### 6. Expiry, tests, documentation, and rollout controls

- Add the bounded expiry sweep and moderator notification behavior.
- Cover unit, integration, action-worker, presentation, and browser paths.
- Update workflow, setup, environment, deployment, privacy, and manual test documentation.
- Verify mode-off behavior before enabling any controlled rollout.

## Verification matrix

At minimum, automated coverage must prove:

- mode `off`, `manual`, and `suspicious_join` eligibility;
- moderator challenge on join, message, report, and manual standard cases;
- rejection on compromised-account and resolved cases;
- no duplicate pending generation;
- retry invalidates the old URL;
- a pass permanently disables later challenge issuance for that case;
- Discord OAuth identity mismatch cannot complete the challenge;
- token hash, generation, expiry, action, hostname, `cdata`, and replay validation;
- five invalid submissions exhaust the generation;
- provider and internal service failures do not consume submissions;
- manual pass leaves the case pending;
- automatic pass with `evidence_only` leaves the case pending;
- automatic join-only pass with `verify_join_only` resolves the exact case;
- new evidence before completion converts the result to evidence only;
- another pending case prevents automatic resolution and case-role release;
- timeout, failure, bypass, and delivery failure leave the restriction in place;
- no CAPTCHA outcome kicks or bans;
- case closure cancels a pending challenge;
- retries, callbacks, and worker delivery are idempotent;
- system actor labels never render as Discord mentions;
- logs and persisted attempts exclude prohibited tokens and client metadata.

Manual QA should cover Discord desktop, mobile browsers, keyboard-only navigation, a screen reader,
common privacy or content-blocking extensions, an embedded-browser handoff, expired-link recovery,
moderator retry, moderator bypass, and mixed evidence arriving while the browser page is open.

Run the repository's required unit, integration, lint, format, build, and full CI-equivalent checks
before the implementation PR is considered ready for review.

## Rollout and rollback

1. Deploy schema and code with `captcha_mode=off` everywhere.
2. Validate deployment diagnostics, the public callback origin, hostname enforcement, redaction, and
   the expiry sweep in a controlled environment.
3. Enable `manual` with `evidence_only` for one controlled server. Exercise pass, invalid response,
   expiry, retry, bypass, delivery failure, and mixed evidence.
4. Enable `suspicious_join` while keeping `captcha_pass_action=evidence_only` and observe completion,
   failure, provider-error, and moderator-workload metrics.
5. Enable `verify_join_only` only after the evidence revision and additional-case guard have been
   proven under concurrency.

Rollback is `captcha_mode=off`, which cancels outstanding challenges and prevents new ones while
retaining audit history. A provider outage should not require a deploy rollback. Operators can turn
the mode off and continue normal moderator review.

## Acceptance criteria

- Server administrators can leave CAPTCHA off, allow moderator challenges, or automatically include
  it only for suspicious joins.
- Moderators can challenge any pending standard case, retry eligible cases, or bypass with a reason.
- Compromised-account cases never expose CAPTCHA controls.
- Users complete a case-scoped, identity-bound Turnstile flow with the approved copy.
- Passes are durable evidence and never become global user exemptions.
- Manual passes never close cases automatically.
- Automatic closure occurs only for an opted-in, unchanged, join-only case with no other pending
  case for the member.
- Timeout, exhaustion, provider failure, and delivery failure never kick, ban, or release the user.
- Every transition is idempotent, auditable, privacy-bounded, and visible on existing case surfaces.
- The feature can be disabled without data loss or a deployment.

## Non-goals

- Global CAPTCHA pass or trusted-user exemptions.
- CAPTCHA for compromised-account recovery.
- Conversational or model-assisted user interrogation.
- A homegrown CAPTCHA provider.
- Automatic kick or ban from failure or timeout.
- Multiple provider selection in the first release.
- Challenge delivery by DM.
- A separate CAPTCHA case type or a new general cases table.
- A broad redesign of multiple-pending-case moderation semantics.

## Deployment details

There are no unresolved product calls required before implementation. During the schema slice, the
implementation chose a monotonic `verification_events.case_revision` guarded by an exact-case
conditional update. Each deployment must set `TURNSTILE_EXPECTED_HOSTNAME` to the hostname of its
canonical public web origin. These are implementation details constrained by the invariants above,
not new product decisions.
