# Server onboarding

Drasil is not ready to take restrictive automatic action immediately after it is invited. A server
owner or administrator must finish core setup and pass live Discord diagnostics first.

## Recommended guided setup

1. Install Drasil with the standard invite from the web dashboard. Discord requires the installer
   to have permission to add applications to the target server.
2. Drasil attempts one private welcome DM to the installer recorded in the Discord bot-add audit
   log. If that user cannot be resolved, it tries the server owner. The DM links directly to
   `/admin/guild/<guild-id>/onboarding` when `DRASIL_WEB_PUBLIC_URL` (or `NEXT_PUBLIC_APP_URL`) is
   configured. Drasil does not post a public fallback message if the DM fails.
3. Sign in to the dashboard with Discord. The guild selector shows live readiness as **Install
   Drasil**, **Needs setup**, **Setup blocked**, or **Ready**. Completing setup requires server
   ownership or Discord Administrator permission.
4. The wizard asks for:
   - an existing text channel for private moderator alerts;
   - an existing case role, or permission to reuse/create `Drasil Case`;
   - an existing verification text channel, or permission to safely reuse/create `#verification`;
   - an optional channel for public report instructions;
   - an automatic response mode. **Notify only** is the recommended first-run default. **Restrict**
     must be selected explicitly.
5. Review and apply. The web request is durable: the page shows queued, processing, completed, or
   failed status while the bot worker performs Discord changes and final validation.

The Discord-native equivalent is:

```text
/config setup admin-channel:<moderator-channel>
/config validate
```

`case-role`, `case-role-name`, `verification-channel`, `report-channel`, and `protection-mode` are
optional `/config setup` choices. When a first setup omits `protection-mode`, Drasil uses notify-only.

## What Drasil automates

- creates the persisted guild configuration when the bot joins;
- resolves a unique configured/default case role and `#verification` channel when safe;
- creates a missing case role and verification channel when requested;
- applies the required Drasil, case-role, everyone, and administrator-role permissions to the
  verification channel while preserving unrelated channel overwrites;
- removes newly created artifacts or restores updated overwrites when later setup validation or the
  configuration save fails;
- stores the chosen core IDs and protection mode together;
- creates or updates report instructions when an optional report channel is selected;
- runs candidate and final live diagnostics before reporting setup complete;
- sends deduplicated private setup reminders when a detection exposes broken setup.

Drasil does **not** move its bot role in the Discord role hierarchy, choose a private moderator
channel, grant itself missing server permissions, or bypass Discord's application-install rules.
It also does not perform an initial full-server member scan during onboarding.

## Required Discord permissions and hierarchy

Core readiness requires:

- Drasil is installed and visible as a guild member;
- **Manage Roles**, with the Drasil bot role above the selected case role;
- an assignable, non-managed, permission-free case role with no allow overwrites outside the
  verification channel;
- an admin alert text channel where Drasil can View Channel, Send Messages, and Embed Links;
- a verification text channel where Drasil can also Read Message History, Create Private Threads,
  and Send Messages in Threads;
- **Manage Channels** when Drasil must create a verification channel or synchronize permissions on
  an existing one.

Ban Members, Kick Members, Manage Messages, and Manage Threads are reported as warnings when the
corresponding optional actions may not work. Advanced features can add their own role/channel
requirements, visible on the full setup page and through `/config validate`.

## Runtime safety

Until live setup readiness is **Ready**, suspicious automatic message and join detections are
downgraded to record-only. Drasil will not open a case, apply the case role, notify a public/admin
surface, or kick based on the configured automatic response. This safety gate does not disable
explicit administrator moderation actions.

## Troubleshooting

- **Install Drasil:** the bot API cannot load the guild. Reinstall it or check that the running bot
  uses the expected Discord application.
- **Needs setup:** one or more required role/channel IDs have not been saved. Resume the wizard or
  run `/config setup`.
- **Setup blocked:** core IDs exist, but a resource is missing, the role hierarchy is wrong, or a
  required permission is denied. The wizard and `/config validate` show the exact blocking checks.
- **Multiple matching roles/channels:** choose the intended resource explicitly. Drasil will not
  guess between duplicate `Drasil Case` roles or `#verification` channels.
- **Queued setup does not complete:** keep the page open to see the durable request status, then use
  the Operations page for the request error. Confirm the bot worker and database are available.
- **Welcome DM did not arrive:** Discord privacy settings may block DMs. Open the dashboard directly
  or use `/config setup`; Drasil intentionally does not announce setup publicly.

After core setup is ready, use the full Setup page for detection thresholds, report policy, role
gate, quarantine, lockdown, staff routing, verification analysis, and message-deletion options.
