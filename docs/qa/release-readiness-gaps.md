# Release Readiness Gaps

This is the confidence checklist for enabling Drasil on a large public server. It focuses on the gaps that matter before trusting anti-spam, reports, and moderator actions on a real community.

Use this with:

- `docs/qa/manual-qa-cards.md`
- `docs/qa/faceless-rollout-plan.md`
- `docs/manual-qa.md`
- `docs/release-checklist.md`

## Current Confidence

Ready for staged testing:

- Guild `/report`, `Report User`, and `Report Message` create review-only report signals.
- External DM/GDM reports are opt-in per managed server.
- Report-only intake does not automatically restrict or ban.
- Report alerts use the observed-alert surface with moderator buttons.
- `Restrict` creates a user-visible verification thread.
- `Ban` does not create a user-visible verification thread first.
- Recent production deploys stabilized on ECS with no known recurring TLS or `Missing Access` errors.

Not ready for broad unattended enforcement:

- Large-server rollout still needs a full card-based staging pass.
- Cross-server external reports need at least two managed test guilds for high confidence.
- Cost and abuse controls around AI-backed analysis need an operator-facing review before high-volume exposure.
- Moderator trust still depends on clear screenshots/evidence from real Discord flows, not just unit tests.

## P0 Gaps

Fix or explicitly accept these before enabling disruptive actions on a large server.

1. Real Discord permission matrix not fully exercised on a staging guild.

   Risk: Drasil can pass unit tests but fail to create threads, assign roles, post alerts, or ban because of Discord role hierarchy and channel overrides.

   Required evidence:
   - Bot role is above the restricted role.
   - Bot can post in the admin/observed channel.
   - Bot can create private verification threads.
   - Bot can add the flagged user to their verification thread.
   - Bot can ban only accounts intentionally placed below its highest role.

2. Ban/restrict testing must use sacrificial accounts.

   Risk: Testing with a real personal account is not repeatable and can create account/server damage.

   Required evidence:
   - One reporter account.
   - One reported-user account.
   - One moderator account.
   - Ban tests run only against the sacrificial reported-user account in staging until production has a final approval.

3. External reports need trust-boundary validation.

   Risk: A DM/GDM report could appear to cross server boundaries silently or notify a server that did not opt in.

   Required evidence:
   - Opted-out server receives no visible alert.
   - Opted-in server receives a moderator-facing observed alert.
   - No external report applies automatic restriction.
   - Reporter confirmation does not over-promise server action.

4. Fail-closed report alert delivery must be observed.

   Risk: A report submission can appear accepted while moderators never receive an alert.

   Required evidence:
   - If the admin/observed channel is unavailable, the command fails visibly or logs a clear failure.
   - No silent success is recorded for a missing moderator alert.

5. Rollback path must be rehearsed before production expansion.

   Risk: A bad moderation behavior can remain active while operators search for the correct rollback steps.

   Required evidence:
   - Known previous commit SHA or ECS task definition revision.
   - Deploy workflow rollback steps from `docs/deploy/aws.md` are understood.
   - Server-side feature switches are known: detection mode and report external-response mode.

## P1 Gaps

These should be closed before inviting a large moderator group to rely on Drasil.

1. Observability checklist is mostly manual.

   Current state:
   - CloudWatch logs and alarms exist for production infrastructure.
   - Operators can query `/ecs/drasil-prod` for errors.

   Gap:
   - There is no single runbook for post-deploy moderation-specific signals.

   Minimum useful signals:
   - Discord `Missing Access`, `Missing Permissions`, and role hierarchy failures.
   - Report delivery failures.
   - Thread creation failures.
   - Ban/restrict failures.
   - OpenAI request failures and rate-limit errors.

2. Cost controls need a moderation-volume review.

   Current state:
   - AWS budget and cost anomaly notifications can be configured.
   - GPT-backed analysis is available.

   Gap:
   - High-volume public servers can produce unexpected OpenAI usage if suspicious-message analysis or verification-thread analysis is noisy.

   Minimum rollout guardrail:
   - Keep automatic detection in observe-only until moderators understand volume.
   - Enable verification-thread analysis only for a limited cohort during early rollout.
   - Review OpenAI dashboard usage after the first production day and first busy period.

3. Moderator explainability needs real screenshots.

   Current state:
   - Alerts include report context, GPT analysis fields when available, and action buttons.

   Gap:
   - We need moderator-readable evidence that the embed explains why the alert exists and what each action does.

   Required evidence:
   - Screenshot of report-only alert.
   - Screenshot after `Dismiss...`.
   - Screenshot after `Open Case`.
   - Screenshot after `Restrict`.
   - Screenshot after `Ban`.

4. Repeated-report behavior needs a human noise check.

   Current state:
   - Reports can update an existing active case/notification instead of creating duplicate state.

   Gap:
   - The moderator-facing UX still needs review for whether repeat reports are readable or noisy.

   Required evidence:
   - Two reports against the same user inside one notification window.
   - One report after a case is resolved.

5. Production server settings need a preflight snapshot.

   Required evidence:
   - Detection mode.
   - Notification window.
   - Report settings.
   - External report mode.
   - Restricted role.
   - Admin/observed channel.
   - Verification channel.

## P2 Gaps

These improve confidence but should not block a careful staged rollout.

1. External `open_case` is currently equivalent to `notify_only`.

   Impact: Safe but potentially surprising for admins who expect automatic case workspace creation.

   Mitigation: Docs state the current behavior clearly. Keep the separate config value for future UX polish.

2. Reporter confirmation copy may need product polish.

   Impact: Reporters might not understand that external reports are recorded but may not notify any server.

   Mitigation: Keep server delivery intentionally opaque unless the product boundary changes.

3. Manual QA remains partly operator-driven.

   Impact: Discord UI and permission behavior are hard to fully automate.

   Mitigation: Use card-based QA with screenshots and log snippets as evidence.

## Go/No-Go Rule

Go for a limited production pilot only when all P0 cards in `docs/qa/manual-qa-cards.md` pass and the rollout starts in review-only/observe-only mode.

No-go for disruptive production automation if any of these are true:

- Reports can restrict or ban without moderator action.
- External reports notify an opted-out server.
- `Restrict` fails to create a user-visible verification thread.
- Permission failures are present and unexplained in production logs.
- Moderators cannot tell from the alert why a user was reported or flagged.
