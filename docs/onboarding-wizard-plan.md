# Onboarding Wizard Implementation Plan

Status: Approved direction; implementation not started

Tracking issue: [#84](https://github.com/BASIC-BIT/drasil/issues/84)

Delivery shape: One implementation pull request

## Outcome

After Drasil is installed in a Discord server, the likely installer receives a polished welcome DM
that links to a guided web wizard for that server. The wizard explains the required setup, lets an
administrator create or select the core Discord role and channels, applies the choices through the
logged-in bot, validates the result, and ends on a truthful ready or blocked state.

The existing `/config setup` and `/config validate` commands remain supported as the Discord-native
fallback. The wizard and commands must use the same provisioning and diagnostic behavior.

This work ships as one PR because readiness, provisioning, web UX, and the install DM form one
user-visible workflow. Inside the branch, implement and verify the slices in dependency order so the
final review remains understandable.

## Product decisions

- The install DM is the entry and recovery surface, not the role/channel picker.
- The primary guided experience lives at `/admin/guild/[guildId]/onboarding`.
- The setup URL contains only a guild ID. Every page load, mutation, and status read revalidates the
  Discord session and guild authority.
- Viewing diagnostics may use the existing manageable-guild authorization. Applying setup requires
  server ownership or Discord `Administrator`, matching bot-side setup repair.
- Readiness is `not_installed`, `needs_setup`, `blocked`, or `ready`; an active database row is not
  evidence that setup works.
- Missing or blocked core setup makes automatic message/join response effectively `record_only`.
  It may record detections and warn about setup, but it must not apply roles, open case threads, or
  kick. Manual moderator actions keep their existing authorization and validation.
- First-run setup recommends `notify_only`. Choosing `restrict` is an explicit administrator action.
- The wizard does not persist a separate step counter. It resumes from saved configuration, live
  Discord resources, the durable setup action request, and current diagnostics.
- The wizard does not expose the full settings dashboard. Advanced policy remains on the existing
  setup page after core onboarding.
- The MVP does not post an unsolicited public setup message when DMs are closed. It records the DM
  failure and keeps `/config setup`, the website, and documentation as recovery paths.
- Existing guild behavior is preserved once a guild is ready.

## Current implementation to reuse

- `src/controllers/EventHandler.ts` creates the default server configuration on `GuildCreate`,
  resolves the audit-log installer with owner fallback, sends a best-effort setup nudge, and stores
  suppression metadata.
- `src/controllers/SetupCommandHandler.ts` provides typed `/config setup` role/channel options and
  already resolves configured, matching, or newly created setup artifacts.
- `src/services/SetupDiagnosticsService.ts` validates bot membership, permissions, channel access,
  thread capabilities, role hierarchy, and optional settings.
- `src/services/SetupWorkflowService.ts` performs candidate validation, verification-channel setup,
  final validation, persistence, analytics, and rollback of newly created artifacts.
- `src/services/ModerationActionRequestService.ts` executes the web-queued
  `complete_setup_verification` action through the logged-in bot.
- `apps/web/lib/setupDashboardService.ts` loads the server record and Discord-backed roles,
  channels, permissions, and checklist.
- `apps/web/app/admin/guild/[guildId]/setup/` provides authenticated configuration and queues bot
  repair, but mixes core setup with advanced moderation policy.
- `src/utils/publicWebLinks.ts` already creates guild-specific dashboard URLs from the configured
  public web base URL.

## Single-PR implementation sequence

### 1. Establish shared readiness and the automatic-action safety gate

Add a shared readiness contract near `packages/contracts/src/setup.ts`:

```text
not_installed  Bot is not available in the selected guild.
needs_setup    One or more required core IDs are absent.
blocked        Core IDs exist, but a blocking live diagnostic fails.
ready          All blocking core diagnostics pass; warnings may remain.
```

Implementation requirements:

- Replace `SetupDashboard.configured: boolean` with a readiness value and any concise counts needed
  by the guild selector, onboarding page, and advanced setup page.
- Derive `needs_setup` from the case role, admin channel, and verification channel IDs.
- Derive `blocked` and `ready` from live blocking diagnostics. Missing optional reporting and staff
  settings remain warnings.
- Add a bot-side readiness service that uses the same status semantics around
  `SetupDiagnosticsService`.
- Check readiness before routing automatic message and join detections. Preserve detection/event
  persistence, but force incomplete automatic responses to record-only behavior.
- Continue using the existing setup-warning fingerprint and suppression window; do not send a DM
  for every detection.
- Make guild cards and setup headers say `Not installed`, `Needs setup`, `Fix required`, or `Ready`.

Safety invariant:

> No automatic moderation side effect begins unless core setup is ready at the time of routing.

### 2. Unify create-or-reuse provisioning across Discord and web

The web worker currently requires an existing case role, while `/config setup` can create or reuse a
default. Extract one provisioning service from the command handler's private candidate-resolution
logic and use it from both surfaces.

The shared request must represent these choices explicitly:

```text
admin channel        existing text-channel ID (required)
case role             existing role ID | create-or-reuse name
verification channel existing text-channel ID | create-or-reuse default
report channel        existing text-channel ID | skipped
protection mode       notify_only | restrict
```

Implementation requirements:

- Validate mutually exclusive existing/create choices at the contract boundary.
- For create-or-reuse, prefer the configured artifact, then one unambiguous matching artifact, then
  create. Report ambiguous matches instead of guessing.
- Use `Drasil Case` and `verification` as the recommended defaults.
- Keep the admin alert channel administrator-selected; do not invent or expose a potentially public
  channel.
- Route both `/config setup` and `complete_setup_verification` through the same provisioner and
  `SetupWorkflowService`.
- Add an optional typed protection-mode choice to `/config setup` for surface parity. For a first
  setup with no explicit choice, save `notify_only`; do not rewrite modes on already configured
  guilds.
- Extend queued action metadata with the choice modes and selected IDs/names. No database schema
  migration is expected because the action already stores JSON metadata.
- Return a durable action-request receipt to the web caller so the wizard can follow the exact job.
- Keep report-instructions upsert idempotent.

#### Non-destructive verification-channel synchronization

Do not replace the channel's complete permission-overwrite collection.

- Modify only the overwrites Drasil owns for the bot, case role, and required base visibility.
- Preserve unrelated member and role overwrites.
- Snapshot each targeted overwrite before mutation.
- If final validation or persistence fails, restore an existing overwrite to its prior allow/deny
  values or remove an overwrite that Drasil created during the failed attempt.
- Include the planned overwrite changes in the wizard review step.

### 3. Build the guided web onboarding route

Create `/admin/guild/[guildId]/onboarding` and extract reusable core-setup fields/components instead
of copying the large advanced setup form.

The visual direction is one flat, focused surface with a compact step indicator. Avoid nested card
stacks and keep the page headline short.

#### Wizard steps

1. **Welcome**
   - Show the guild name and current readiness.
   - Explain what Drasil will configure and that setup takes about two minutes.
   - Surface install or permission blockers before asking for choices.
2. **Moderator alerts**
   - Select a text channel.
   - Explain that alerts and case summaries are posted there.
3. **Case access**
   - Recommended: create or reuse `Drasil Case`.
   - Alternate: select an existing assignable role.
   - Explain that the role is applied while a member has an active case.
4. **Verification**
   - Recommended: create or reuse `#verification`.
   - Alternate: select an existing text channel.
   - Preview only the permission overwrites Drasil will add or change.
5. **Reporting**
   - Optionally select a report-instructions channel.
   - Provide a clear `Skip for now` action.
6. **Protection**
   - Select `Notify only` by default and label it recommended.
   - Offer `Restrict members` with a concise description of the role and case effects.
7. **Review and apply**
   - List every artifact to create, reuse, modify, or skip.
   - Prevent repeated submission while the durable request is queued or processing.
8. **Verify**
   - Follow the returned request ID.
   - Re-run live readiness after completion.
   - Show `Ready` only after blocking diagnostics pass.
   - On failure, keep selections and show exact remediation plus `Try again`.

Implementation requirements:

- Use the existing Discord OAuth return-to behavior for the onboarding URL.
- Recheck guild authorization on load, apply, and request-status reads.
- Poll only the submitted request ID and verify it belongs to the guild and setup action.
- Make reload/resume deterministic from durable state; no browser-only completion claim.
- Link ready guilds to the moderation inbox and advanced setup.
- Link incomplete guilds from the admin guild selector directly to onboarding.

### 4. Replace the install nudge with the welcome embed

Add `buildAdminGuildOnboardingUrl(guildId)` beside the existing public web link helpers. Upgrade the
plain DM to an embed with link buttons.

Proposed copy contract:

```text
Title: Welcome to Drasil
Description: Drasil has joined {guild}. Finish a safe setup in about two minutes.

Required
1. Choose where moderators receive alerts
2. Create or select the case role
3. Create or select the verification channel

Optional
Add member reporting when you are ready.

Footer: Setup incomplete - 0 of 3 required steps complete
```

Buttons:

- `Start guided setup` links to the guild onboarding route when a valid public web URL exists.
- `Setup guide` links to the canonical public onboarding documentation when configured.

The body must also name `/config setup` and `/config validate` so the DM remains useful without the
web button.

Implementation requirements:

- Preserve installer audit-log attribution, owner fallback, bot-recipient rejection, DM-failure
  handling, recipient-change behavior, fingerprint deduplication, and the seven-day suppression
  window.
- Keep the embed free of member data, detection evidence, and private server context beyond the
  recipient's guild name.
- If the public web URL is absent or invalid, omit the button instead of emitting a broken URL.
- Capture only bounded product events: wizard opened, setup apply queued, setup completed, and setup
  blocked. Use diagnostic codes, never channel/role names or message content.

### 5. Documentation and recovery guidance

Add `docs/onboarding.md` as the canonical server-owner guide and link to it instead of duplicating
the complete procedure.

It must document:

- the canonical install surface and required Discord scopes/intents;
- what the wizard creates or modifies;
- administrator and bot permission requirements;
- role hierarchy and channel access;
- the difference between notify-only and restrict modes;
- the web wizard and `/config setup` fallback;
- readiness meanings and how to resume blocked setup;
- DM delivery limitations;
- `/config validate` and a controlled `/flaguser` smoke test;
- the separate Developer Portal mention-permission limitation tracked by issue #106.

Update links and concise summaries in:

- `README.md`
- `docs/release-checklist.md`
- `docs/manual-qa.md`
- `docs/deploy/discord.md`
- `docs/web-dashboard.md`

## Expected code map

The exact split may adjust during implementation, but the PR should remain centered on these files:

- `packages/contracts/src/setup.ts`
- `src/services/SetupDiagnosticsService.ts`
- a new shared setup readiness service
- a new shared setup provisioning service
- `src/services/SetupWorkflowService.ts`
- `src/services/ModerationActionRequestService.ts`
- `src/services/NotificationManager.ts`
- `src/controllers/EventHandler.ts`
- `src/controllers/SetupCommandHandler.ts`
- `src/controllers/commandDefinitions.ts`
- `src/utils/publicWebLinks.ts`
- `apps/web/lib/setupDashboardService.ts`
- `apps/web/lib/setupArtifactActionQueue.ts`
- `apps/web/lib/moderationActionRequestQueue.ts`
- `apps/web/app/admin/guild/[guildId]/onboarding/`
- shared web setup components under `apps/web/components/setup/`
- the existing setup page and admin guild selector
- focused unit, integration, Playwright, and documentation updates

## Verification plan

### Unit and contract tests

- Readiness: not installed, missing IDs, blocking diagnostics, warning-only ready state.
- Automatic safety gate: incomplete guild records but performs no automatic moderation side effect.
- Ready guilds preserve all current response modes.
- Provisioning: existing, configured, matching, created, ambiguous, inaccessible, and hierarchy
  cases.
- Rerunning setup creates no duplicate role, verification channel, or report-instructions message.
- Verification synchronization preserves unrelated overwrites and restores targeted overwrites on
  failure.
- Web queue metadata round-trips every setup choice and returns a durable receipt.
- DM embed includes the correct guild-specific URL, omits invalid URLs, and preserves suppression
  behavior.
- Public URL and OAuth return-to builders reject unsafe schemes and encode guild IDs.

### Web tests

- A blank active server is `Needs setup`, never `Configured` or `Ready`.
- Full wizard flow queues setup and reaches ready after the worker completes.
- Partial setup reload resumes at the correct step.
- Unauthorized and Manage-Guild-only users cannot apply setup.
- Double submission does not queue duplicate work.
- Worker failure and diagnostic failure remain visible and retryable.
- Ready completion links to the inbox and advanced setup.
- Desktop and mobile visual snapshots cover welcome, review, blocked, pending, and ready states.

### Integration and staging QA

Use a controlled staging Discord server and a test member. Do not use production as the first proof.

1. Invite Drasil with the canonical install flow.
2. Confirm installer DM attribution, owner fallback, and closed-DM recording.
3. Complete setup using create defaults.
4. Remove and repeat using existing artifacts; verify no duplicates.
5. Repeat against a channel with unrelated overwrites; verify they are preserved.
6. Break role hierarchy and channel access separately; confirm the wizard blocks with exact fixes.
7. Reload during queued work and confirm durable resume.
8. Run `/config validate` and fix all blocking errors.
9. Run a controlled `/flaguser` smoke test and close the resulting case.
10. Confirm an incomplete guild records a suspicious detection without restricting or opening a
    case.
11. Confirm a ready notify-only guild alerts without applying the case role.
12. Explicitly select restrict and confirm the normal case role/thread flow.

### Repository gates

- Focused tests while developing each internal slice.
- `npm run format:check`
- `npm run lint`
- `npm run build`
- `npm test`
- relevant web unit and Playwright suites
- `npm run test:integration` with an isolated database when repository changes exercise persistence
- `npm run check:ci` before the PR is declared merge-ready
- `git diff --check`

## Single-PR review and rollout strategy

- Keep the work in one branch and one PR linked to #84.
- Organize commits by the numbered implementation sequence so reviewers can inspect the foundation,
  provisioning, web flow, and DM independently without splitting delivery.
- Add no feature flag unless implementation uncovers a concrete rollback problem. Incomplete guilds
  are made safer by the readiness gate, and the DM only links to a deployed authenticated route.
- Require bot and web CI plus the normal AI/human review recycle loop on the same head SHA.
- Before merge, verify the web preview and the controlled Discord staging flow against that SHA.
- Merge once. Verify the bot production deployment, web production deployment, database migration
  status even when no migration is expected, the public onboarding route, and sanitized runtime
  telemetry separately.
- Do not perform the Developer Portal change from #106 as an implicit part of deployment; verify or
  execute it only with separate live-state authorization.

## Definition of done

- A fresh install produces one useful, polished installer-or-owner DM when Discord permits it.
- The DM opens the correct guild's authenticated guided setup.
- An administrator can create or select core artifacts without copying Discord IDs.
- Setup is idempotent and does not destroy unrelated channel overwrites.
- The wizard survives refresh and reports durable pending, blocked, and ready states truthfully.
- Automatic moderation cannot restrict or open a case while core setup is incomplete.
- Ready guilds retain their existing moderation behavior unless the administrator changes it.
- Discord commands and web onboarding use the same provisioning and diagnostics.
- Documentation describes the actual install-to-smoke-test workflow and recovery paths.
- All required CI, review, preview, and controlled staging checks pass on the final PR head.

## Out of scope

- Moving advanced moderation policy into the wizard.
- Persisting arbitrary per-step wizard state.
- Posting unsolicited setup messages to public guild channels.
- Building a general notification-preferences center for owner DMs.
- Changing live Discord Developer Portal settings.
- Redesigning the moderation inbox, case workflow, or report intake beyond onboarding links.
- Initial synchronization of every historical member or channel unrelated to setup validation.
