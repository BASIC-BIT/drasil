# The Faceless Rollout Plan

This plan is for enabling Drasil on a large public server with many spam bots while keeping operator attention and user risk low.

The default posture is conservative: observe first, review reports, and require humans for disruptive actions.

## Rollout Principles

- Do not test bans on real members.
- Do not enable automatic restrictions on a large server until staging cards pass.
- Do not enable external reports for a server unless its admins explicitly choose that mode.
- Prefer one clear moderator surface over multiple noisy channels.
- Stop and triage if Drasil produces confusing alerts, unexpected role changes, or permission errors.

## Phase 0: Staging Confidence

Goal: prove the mechanics away from the real community.

Required cards:

- Cards 1-3 from `docs/qa/manual-qa-cards.md`.
- Cards 5, 8, 9, 11, 12, and 16 when the needed accounts/guilds exist.

Exit criteria:

- Report-only intake creates alerts and does not restrict.
- `Restrict` creates a user-visible verification thread.
- `Ban` bans only the sacrificial account and does not create a verification thread first.
- External opted-out guild receives no alert.
- External opted-in guild receives an alert and takes no automatic action.

## Phase 1: Production Install, No Disruption

Goal: confirm Drasil can live in The Faceless without affecting members.

Config:

- Detection mode: `notify_only` or equivalent observe-only posture.
- External report mode: `off` until the moderator team explicitly opts in.
- User-installed reporting: enabled only after command registration and staging external-report cards pass.
- Ban/restrict actions: moderator-click only.

Do:

- Install the bot with the minimum practical permissions documented in `docs/release-checklist.md`.
- Configure the admin/observed channel and verification channel.
- Run a harmless command to confirm command registration.
- Watch logs after deploy.

Expect:

- No member gets restricted or banned automatically.
- Moderator-only channels receive any expected test alerts.
- No `Missing Access`, `Missing Permissions`, or role hierarchy errors appear.

Stop if:

- Drasil posts in the wrong channel.
- Drasil cannot create threads.
- Any real member receives a role change unexpectedly.

## Phase 2: Report-Only Pilot

Goal: let a small moderator cohort evaluate report UX without broad server announcement.

Config:

- `/report` and `Report User` enabled in the server.
- `Report Message` enabled only if the team is ready to test that path.
- External report mode remains `off` unless explicitly testing external reports.

Do:

- Have one moderator or test reporter submit a controlled report.
- Review the observed alert as a team.
- Test `Dismiss...` and undo on a non-disruptive report.
- Test `Open Case` only if the team wants a moderator-only workspace.

Expect:

- Reported user is not notified for report-only review.
- Moderators can understand who reported whom and why.
- Dismiss/false-positive behavior is understandable.

Stop if:

- Moderators cannot tell what action each button will take.
- Alerts are too noisy or lack target context.

## Phase 3: Controlled Escalation

Goal: prove that moderator-selected actions work in production without using real victims.

Config:

- Sacrificial reported-user account present in the server.
- Bot role above the restricted role and sacrificial account.
- Moderator team aware of the test window.

Do:

- Submit a controlled report against the sacrificial account.
- Click `Restrict` and verify the private verification thread.
- Resolve the case.
- In a separate run, click `Ban` against the sacrificial account.

Expect:

- Restrict creates a visible path for the target to respond.
- Ban is logged and does not create a needless verification thread.
- No unrelated member is affected.

Stop if:

- The verification thread is not visible to the sacrificial target.
- The thread is visible to unrelated members.
- The ban action fails because of hierarchy or permission problems.

## Phase 4: Limited Moderator Use

Goal: use Drasil for real triage while keeping irreversible action human-controlled.

Config:

- Detection remains observe-only until spam volume and false positives are understood.
- External reports remain `off` or `notify_only` only.
- Moderator cohort is limited to people briefed on the action model.

Do:

- Let moderators process real report-only alerts.
- Prefer dismiss/history/open-case before restrict/ban when uncertain.
- Record examples where the alert is confusing or insufficient.
- Review OpenAI and AWS usage after the first busy period.

Expect:

- Drasil reduces triage time without creating unexplained punishments.
- Moderators trust the difference between report-only review, restriction, and ban.

Stop if:

- False positives are frequent.
- Costs spike unexpectedly.
- Moderators start using `Ban` when the evidence shown in the alert is insufficient.

## Phase 5: Later Automation Review

Goal: decide whether automatic restriction should ever be enabled on The Faceless.

Do not enter this phase until earlier phases produce enough evidence.

Required evidence:

- Representative sample of observed detections.
- False-positive review from moderators.
- Known cost at real traffic volume.
- Clear rollback path.
- Agreement on what signals justify automatic restriction.

Default recommendation:

- Keep large-public-server behavior review-first unless spam pressure and detection quality justify a narrow automatic rule.

## Operator Checklist

Before each production step:

- Know the current detection mode.
- Know the current external report mode.
- Know the admin/observed channel.
- Know the verification channel.
- Know the restricted role.
- Know how to roll back the ECS task definition.
- Know how to disable external reports for the server.

After each production step:

- Check moderator channel behavior.
- Check CloudWatch logs.
- Check for unexpected role changes.
- Record screenshots for the first successful path and the first failure.
