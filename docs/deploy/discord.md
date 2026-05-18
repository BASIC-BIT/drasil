# Discord App Configuration

Drasil supports both server-installed moderation commands and optional user-installed message reporting.

## Installation Contexts

In the Discord Developer Portal, open the app's **Installation** page.

Set **Installation Contexts** to:

- `Guild Install`
- `User Install` only when rolling out user-installed message reporting

Use the **Discord Provided Link** install link unless a custom OAuth flow is required.

## Default Install Settings

For **Guild Install**, include these scopes:

- `bot`
- `applications.commands`

For **User Install**, include this scope:

- `applications.commands`

User-installed apps do not need server permissions. They are visible only to the installing user and can expose commands in DMs, group DMs, and mutual servers depending on each command's `contexts`.

## Reporting Commands

Drasil registers these report entry points:

- `/report`: guild-only slash command with a Discord user picker and optional reason.
- `Report User`: guild-only user context-menu command under `Apps` when right-clicking a user.
- `Report Message`: optional message context-menu command under `Apps` when right-clicking a message.

`Report Message` is intended for user-installed reporting from DMs/GDMs and is disabled by default. Enable command registration with:

```text
DRASIL_USER_INSTALL_REPORTING_ENABLED=true
```

When disabled, Drasil does not register the `Report Message` command on startup.

## External Report Intake

External reports are DM/GDM reports about a user who is also known to one or more Drasil-managed servers. Drasil records the global report signal, then fans it out only to servers that explicitly opted in.

Configure each server with:

```text
/config report external-reports mode:off
/config report external-reports mode:notify_only
/config report external-reports mode:open_case
```

Modes:

- `off`: default. Store the global report signal only.
- `notify_only`: post an observe-only notification to that server's observed/admin notification channel.
- `open_case`: open a review-only pending case in that server without restricting the user.

External reports never apply automatic restrictions. Moderators must review and choose any action.

## Rollout Notes

- Keep `DRASIL_USER_INSTALL_REPORTING_ENABLED` unset or `false` until at least one test server has opted into external report intake.
- After enabling user install in the Developer Portal, restart Drasil so global commands are re-registered with the new installation contexts.
- Test `Report Message` from a DM with a non-self message and an opted-in server where the target is a known member before announcing user-install support.
- If a server requires report reasons, `Report User` asks the reporter to use `/report` because context-menu user commands cannot collect options directly.
