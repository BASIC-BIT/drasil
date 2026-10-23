# Server-selected CAPTCHA methods

Status: approved by the user on October 22, 2026. Implementation planning is next;
product implementation has not started.

Tracking: [issue #261](https://github.com/BASIC-BIT/drasil/issues/261).

Source baseline: `599ef8622efd602b0c564d683e4dd227c4c86d85`, confirmed against
`origin/main` while preparing this document. This design extends the existing
[case challenge design](../../captcha-case-challenge-plan.md).

## Intent and agreed direction

Members should be able to complete a security check inside Discord when their
server chooses that experience. Server administrators choose exactly one method:
None, Discord image CAPTCHA, or Cloudflare Turnstile. Members cannot choose the
method. Drasil never substitutes another method during an outage.

Method selection, challenge issuance, and case resolution are distinct decisions.
A successful check is evidence about a particular challenge. It does not establish
that a reported message is acceptable or that the account is uncompromised.

The user also approved automatic issuance for newly opened standard cases,
including message detections, reports, joins, and moderator-opened cases. That
direction excludes compromised-account recovery and existing case backlogs.
The user wants to explore data-driven resolution rules before expanding automatic
verification. No universal rules engine or new automatic-release policy is agreed.

## Scope and sequencing

The first deliverable adds server-selected methods to the existing lifecycle and
preserves existing issuance and resolution behavior. This document specifies that
deliverable. It does not make completion dependent on a product-wide rules engine.

Separate subsequent design work covers issuance across all newly opened standard
cases, structured case-resolution rules, and new-server default recommendations.
The agreed issuance scope above is a requirement for that subsequent design, not
permission to change every server now. The initial method extension preserves the
current effective defaults and existing servers' behavior.

Operational Turnstile setup and the bot public-origin deployment defect remain
separate tracked work. Neither is a prerequisite for using Discord image CAPTCHA.
No MCP settings, MCP actions, production members, or production cases are in scope.

## Current implementation and what it establishes

Current source has modes `off`, `manual`, and `suspicious_join`, with `off` as the
default. Pass actions are `evidence_only` and `verify_join_only`, with
`evidence_only` as the default. Saved settings for individual production servers
have not been inspected, so these defaults do not establish fleet-wide state.

The current journey is:

1. A moderator or automatic suspicious-join policy issues a challenge for a pending
   standard case. The challenge records the server, member, case, case revision,
   and generation. The browser link contains a random token whose hash is stored.
2. The member opens the case-thread link and completes separate Discord OAuth
   identity confirmation. The identity must match the challenged member.
3. Turnstile server verification checks the provider result, expected hostname,
   action `drasil_case_access`, and application-generated challenge binding.
4. A transaction records the result and queues the case-specific pass operation.
   The bot's existing moderation queue owns Discord and case effects.

OAuth establishes access to the expected Discord identity. Turnstile supplies a
provider validation result tied to the issued challenge. Neither alone authorizes
case resolution. Moderator-requested checks remain evidence-only. Automatic
verification currently requires automatic suspicious-join issuance, the configured
join-only pass action, a pending standard case at the issued revision, at least one
linked detection, exclusively new-account or rejoin-after-kick detections, and no
other pending case for that member in that server. Current settings are rechecked.

Current defaults are 24 hours and five invalid submissions. Provider failures do
not consume invalid-submission allowance. Invalid answers, identity mismatches,
rate limits, and infrastructure errors must remain distinct outcomes. Expiration
or failure holds the case for review; neither kicks nor bans a member. Moderator
bypass records actor and reason and does not itself verify the member. Retrying
rotates the link and increments the generation, invalidating old challenge state.

Primary source references:

- [Defaults and settings parser](../../../src/utils/captchaSettings.ts)
- [Lifecycle and delivery](../../../src/services/CaptchaChallengeService.ts)
- [Pass policy](../../../src/services/CaptchaChallengePolicy.ts)
- [Persistence fences](../../../src/repositories/CaptchaChallengeRepository.ts)
- [Completion transaction](../../../src/repositories/VerificationEventRepository.ts)
- [Member page](../../../apps/web/app/captcha/[token]/page.tsx)
- [OAuth entry](../../../apps/web/app/api/captcha/auth/[token]/route.ts)
  and [callback](../../../apps/web/app/api/captcha/auth/callback/route.ts)
- [Browser completion](../../../apps/web/lib/captchaCompletion.ts)
  and [provider validation](../../../apps/web/lib/turnstile.ts)
- [Setup validation](../../../packages/application/src/setup/settings.ts)

## Administrator and member experience

Setup presents one method choice with short descriptions:

| Method                | Member journey                                                   | Readiness                                                    |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| None                  | No new CAPTCHA challenges                                        | No provider requirements                                     |
| Discord image CAPTCHA | Private image, then Discord answer modal                         | Bot renderer, persistence, and answer-verification key ready |
| Cloudflare Turnstile  | Canonical website, Discord identity confirmation, provider check | Website, OAuth, hostname, and provider configuration ready   |

Issuance and resolution controls remain separate from this method choice. Existing
manual and suspicious-join behavior is retained for the first deliverable. Selecting
a method does not turn on automatic verification.

The case thread contains a normal security-check entry button. For image CAPTCHA,
only the challenged member may open the private image response or submit its answer.
The private response contains the PNG, an Enter answer button, and a way to request
moderator assistance. The answer button opens a Discord text-entry modal. Closing
and reopening the image does not create another answer or reset the attempt budget.

The answer modal cannot display the image itself. The disposable UX evaluation must
check that the image remains usable while entering the answer on supported clients.
Unreadable images and accessibility barriers offer moderator assistance. Drasil
does not claim this visual method is independently accessible to blind members.

Wrong answers show remaining attempts. Expired or replaced challenges explain that
the member needs a new check. Rendering, Discord delivery, and persistence failures
offer retry or moderator assistance without consuming answer attempts. A completed
check says it completed; verification is announced only after the moderation queue
successfully applies an eligible resolution.

## Application structure

Add a persisted method discriminator to challenge issuance and expose the method in
case summaries and generation history. Existing stored challenges are Turnstile.
Completion must dispatch using the persisted method, never a member-supplied method.
The database currently has only `turnstile` in `captcha_provider`; adding
`discord_image` requires an additive migration and coordinated reader support.

The lifecycle service owns eligibility, generation, expiry, attempt accounting,
audit, and queuing. Method adapters own presentation and verification:

- Turnstile retains browser-token lookup, separate OAuth/session handling, and
  hostname/action/binding validation.
- Discord image uses authenticated Discord interactions and private attachments.
  It verifies the interaction actor against the stored challenged member and
  checks the stored server, case, challenge, generation, and image issuance.

Both adapters return structured results to a shared completion transaction. That
transaction enforces pending state, current generation, expiry, attempt limits, and
single acceptance before queuing the existing case-specific operation. Duplicate
submissions and queue retries cannot resolve the case twice. Infrastructure errors
never become successful checks. Method-specific evidence remains distinguishable.

The existing join-only resolution policy remains in force in this deliverable.
An administrator who configures image CAPTCHA and explicitly retains the join-only
pass action can use it for the same eligible join cases. This is an explicit
combination of administrator choices, not a hidden method-based policy change.
Future resolution rules must be able to name the accepted method. Mandatory actor,
case, generation, and revision checks remain enforced outside configurable rules.

## Image generation and answer handling

Use `captcha-canvas` as the initial renderer candidate, subject to a disposable
evaluation of the bot container, font availability, rendering cost, and member UX.
The published 3.4.0 package uses `skia-canvas`; installing and drawing with it is not
yet verified in Drasil's runtime. Keep its API behind the image renderer adapter.

Drasil generates the answer with a cryptographic random source, using six uppercase
characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`. Matching trims surrounding
whitespace and ignores ASCII letter case. Reject other normalization or fuzzy
matching. The renderer receives the answer but does not own verification state.

Persist a keyed digest bound to server, member, case, challenge, generation, and
answer, plus a key version. Use a separate server-held image-answer key,
`DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET`, distributed through the deployment's secret
manager. An unkeyed hash is unsuitable for the small
answer space. Compare digests in constant time. Key rotation must retain verification
support for unexpired generations or explicitly invalidate them for reissue.

Generate and persist the PNG and its bound digest as one image issuance before
presentation. Private reopens reuse that image. Generation replacement removes the
usable old image and digest and consumes the same guarded lifecycle as other retries.
Existing challenge-request rate limits also apply to image retries. There is no
unbounded member refresh operation. An old Discord attachment may remain
cached, but its old generation cannot pass verification. Expiry and terminal-state
cleanup remove stored image and digest data; audit history retains only outcomes.

Answers must not appear in filenames, attachment descriptions, alt text, component
IDs, analytics, audit records, URLs, or logs. Discord attachment visibility is not an
authorization boundary. Every interaction is authorized independently.

This is a visual challenge, with lower expected resistance to automated solving than
a managed provider. No success-rate or bot-resistance claim is supported yet. The
evaluation must measure readability and automated solving separately. More noise is
not an acceptable substitute for usable images and a moderator-assisted path.

## Settings, readiness, and migration

Introduce server method values `none`, `discord_image`, and `turnstile`. Preserve
existing issuance and pass-action semantics. Setup may show issuance controls only
when a method is selected. The legacy `captcha_mode=off` state is presented as None;
active legacy modes map to Turnstile. An administrator choosing None cancels pending
checks through the existing lifecycle without resolving cases.

An absent method in shipped persisted settings must preserve the legacy mapping.
New writes use the explicit method. This compatibility mapping exists for deployed
data, not hypothetical formats. Explicit method None suppresses issuance regardless
of stored issuance preferences.

Changing methods cancels pending generations and marks their entry controls stale.
It does not automatically issue replacement checks or backfill existing cases. A
moderator can issue a fresh challenge using the new configured method. Concurrent
completion must recheck the current configured method before acceptance, and queue
processing must hold automatic resolution if the selected method changed afterward.

Readiness validation dispatches by selected method. Image CAPTCHA does not require
Turnstile variables or a public website origin. Turnstile requires all four current
provider variables and the public origin. Setup reports missing requirements before
saving an enabled method, and runtime failures retain the case for review. Choosing
None does not require a working provider.

No existing server changes method automatically. No deployment enables CAPTCHA
fleet-wide. New-server default-on remains a product decision for later review;
this deliverable keeps None as the effective default.

## Observed evidence and outstanding operations

These observations are separate from package tests and are snapshots, not guarantees
of current live state. Recheck provider accounts, hosting identity, service state,
and configuration before any operational changes.

- Earlier read-only hosting inspection found the deployed CAPTCHA code but no
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`,
  `DRASIL_CAPTCHA_BINDING_SECRET`, or `TURNSTILE_EXPECTED_HOSTNAME`. No Cloudflare
  widget was provisioned. Individual servers' saved settings were not inspected.
- The user believes OAuth redirects have been configured; registration has not
  been independently verified. CAPTCHA uses `/api/captcha/auth/callback`, separate
  from dashboard `/api/auth/discord/callback` and MCP `/api/mcp-auth/callback/discord`.
- The running bot task definition lacked the public origin. Terraform declares
  `DRASIL_WEB_PUBLIC_URL`, but the image deployment copies an existing task
  definition and edits only the image and release marker. The IaC workflow validates
  rather than applies Terraform. A successful image deployment does not reconcile
  missing environment configuration. This source-backed mechanism reproduced on a
  synthetic task definition; no production task was changed.
- The user supplied a local agent's October 22 desktop Activity test. The SDK became
  ready at the application's `discordsays.com` origin, then CSP blocked the direct
  Cloudflare script. No widget or dummy token followed. A separate proxy-page read
  corroborated the script restriction. Discord web remained blank for an unresolved
  reason. Mobile, real Siteverify, OAuth, case binding, and moderation effects were
  not verified by that probe. This cloud agent did not inspect the Windows artifacts.
- The disposable development app's Activity mapping and enabled state remain saved.
  Cleanup needs coordination with the owner. Product source and production settings
  were untouched by the probe. Proxy Authentication adds request signatures; it is
  not documented to relax script CSP and was not tested enabled.

Turnstile setup must distinguish its public site key, private provider secret,
hostname restrictions, and separate application-owned binding secret. Production
and development origins and Discord application identities must be verified
independently. Secrets go through provider tools or secret managers, never chat,
source control, issue bodies, or test artifacts. A real browser/OAuth/Turnstile flow
remains unverified until actually completed with server-side validation.

## Validation and controlled rollout

Required automated validation covers legacy settings migration, method readiness,
actor mismatch, wrong answers, attempt exhaustion, expiration, old generations,
method changes, duplicate and concurrent submissions, queue idempotency, case
revision changes, and preservation of join-only restrictions. Real database tests
must use the repository's owned disposable database guard.

A disposable image evaluation precedes accepting the renderer for production. Check
the actual bot container, native dependency installation, fonts, image size, render
latency, memory/concurrency bounds, and metadata leakage. Human usability and OCR or
vision attempts are separate observations, with configurations and sample counts
recorded. They do not establish broad security effectiveness.

Discord live validation requires an owner-designated disposable member and case,
plus approved rollout scope. Verify private delivery, modal usability on desktop
and mobile, restart-safe answers, stale controls, assistance, and queue effects.
Production challenges or server-setting mutations are not authorized by the prior
read-only MCP test authorization. Record actual observations separately from unit,
integration, source-inspection, and browser-baseline results.

Roll out behind explicit administrator selection on a controlled target. Rollback
can choose None and cancel pending challenges without automatically resolving cases.
Deploy additive schema and reader support before enabling image issuance. Verify
the target release and configuration before each live probe. Product-wide issuance,
resolution rules, and default changes require their own reviewed design.

## External references

- [Discord components](https://docs.discord.com/developers/components/reference)
- [Activity networking restrictions](https://docs.discord.com/developers/activities/development-guides/networking)
- [Activity proxy authentication](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)
- [Turnstile rendering requirements](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
- [Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
- [captcha-canvas](https://github.com/Shashank3736/captcha-canvas)
