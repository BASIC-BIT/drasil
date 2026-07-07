# Discord Mention Permissions Runbook

Refs #106.

Drasil sends operational moderation notifications that ping configured admin/report roles (for example admin notification roles and case responder roles). For those pings to actually notify, Drasil must be _allowed_ to mention the target, and Drasil must _request_ the mention in the message payload.

This runbook explains how mention permissions actually work for a bot, what the operator must configure, and how to verify it. It exists because the underlying request in #106 ("enable Drasil mention permissions in the Developer Portal") conflates a few distinct mechanisms. Only some of them live in the Developer Portal.

## What actually controls whether Drasil can ping

A bot ping lands only when all of the following are true:

1. **Guild permission `Mention Everyone`.** In Discord's permission model, one permission bit (`Mention @everyone, @here, and All Roles`, `PermissionFlagsBits.MentionEveryone`) governs a bot's ability to mention `@everyone`, `@here`, and any role that is not itself marked _mentionable_. This is a server-side permission. It is granted through the bot's role and/or channel overwrites, and its default value is seeded from the install-link permission bitfield that you configure in the Developer Portal.
2. **Role mentionability, or the permission above.** A role that is marked **Allow anyone to @mention this role** can be pinged without `Mention Everyone`. A role that is _not_ mentionable can only be pinged by a member (or bot) that holds `Mention Everyone` in that channel. Drasil's setup diagnostics check exactly this condition (`SetupDiagnosticsService.checkAdminNotificationRole`): a role is pingable if `role.mentionable || channel.permissionsFor(bot).has(MentionEveryone)`.
3. **`allowed_mentions` in the payload.** Even with permission, the Discord API suppresses pings unless the message opts in via `allowed_mentions`. Drasil already does this correctly: `NotificationPresentationBuilder.createAdminAllowedMentions` emits `{ parse: [], roles: [...], users: [], repliedUser: false }`, and moderation surfaces such as `ModerationQueueService` and the report intake path pass the configured role IDs through. Drasil never broadcasts `@everyone`/`@here`; it only pings the specific configured role IDs. No code change is required here.

Because step 3 is already handled in code, this issue is purely an **operator configuration** task: grant the permission, or make the target roles mentionable, so steps 1/2 pass.

## Where the Developer Portal fits

The Developer Portal does **not** have a standalone "allow mentions" toggle. What it controls is the **default install-link permissions bitfield**:

- Developer Portal > your application > **Installation** (or **OAuth2 > URL Generator**).
- Under the generated **bot** permissions, enable **Mention @everyone, @here, and All Roles**.
- This only changes the _default_ permissions offered when someone (re)installs the bot with the generated link. It does **not** retroactively change permissions in a server where Drasil is already installed.

For a server where Drasil is already present, changing the portal bitfield alone does nothing until the bot is re-invited with an updated link **or** the permission is granted server-side (next section). In practice the server-side grant is the reliable path for the live org.

## Recommended configuration (do this)

Pick whichever of the two is acceptable to the org. Option A is the least-privilege path and is preferred.

### Option A - Make the pinged roles mentionable (least privilege)

For each role Drasil is configured to ping (admin notification role, case responder roles, report routing roles):

1. Discord server > **Server Settings > Roles > _role_**.
2. Enable **Allow anyone to @mention this role**.

This lets Drasil ping those specific roles without granting the broad `Mention Everyone` permission, and it cannot be used to ping `@everyone`/`@here`. Drasil's `allowed_mentions` still restricts pings to the exact configured role IDs, so making a role mentionable does not let arbitrary members abuse it any more than normal.

### Option B - Grant `Mention Everyone` to Drasil (broader)

If the org prefers not to mark roles mentionable, grant the permission to the Drasil bot role, scoped as tightly as possible:

1. Prefer a **channel-level overwrite** on the admin/report notification channels only, rather than a server-wide grant.
2. Channel > **Edit Channel > Permissions > Drasil role (or bot)** > allow **Mention @everyone, @here, and All Roles**.
3. Grant server-wide (Server Settings > Roles > Drasil > **Mention @everyone, @here, and All Roles**) only if channel overwrites are impractical.

Note the broader risk: `Mention Everyone` also lets Drasil ping `@everyone`/`@here`. Drasil does not do this today (it never puts `everyone`/`here` in `allowed_mentions.parse`), but the capability would exist at the Discord permission layer.

### Portal step (do this too, for future installs)

Update the Developer Portal install-link bitfield as described in [Where the Developer Portal fits](#where-the-developer-portal-fits) so future (re)installs default to the correct permission. This is the specific action #106 names and is the one item an operator with Developer Portal access must complete.

## Verification

After configuring, verify without spamming a live channel:

1. Run `/config validate` (or the setup diagnostics command) in the server. Drasil surfaces a `admin-notification-role-mention` warning when it detects it may be unable to ping the configured role. A clean run means step 1/2 pass for the admin notification role and case responder roles.
2. Trigger a low-noise notification path in a staging or admin-only channel (for example a test case that pings the responder role) and confirm the role members receive the ping, not just see plain text.
3. If the role still does not ping: re-check that the target channel's overwrites do not _deny_ `Mention Everyone` for the Drasil role, and that the role is either mentionable (Option A) or Drasil holds `Mention Everyone` in that channel (Option B). Channel-level denies override role-level allows.

## Notes and caveats

- Server-side lockdown/verification permissions are separate. Drasil still needs explicit role access to any private categories/channels where it must edit overwrites, create threads, or post. That access is not granted by mention permissions.
- Changing the Developer Portal bitfield does not affect the already-installed live server until re-invite; use the server-side grant for the live org.
- No Drasil code change is required for #106. The `allowed_mentions` opt-in and the diagnostics check already exist. This is a Discord configuration task, and the Developer Portal portion must be completed by an operator with portal access.

## References

- Discord permissions (`Mention Everyone`): https://discord.com/developers/docs/topics/permissions
- Allowed mentions object: https://discord.com/developers/docs/resources/message#allowed-mentions-object
- Drasil Discord app configuration: `docs/deploy/discord.md`
