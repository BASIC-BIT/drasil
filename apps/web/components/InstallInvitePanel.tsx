import { buildBotInviteUrl, isAdministratorInviteEnabled } from '@/lib/discordInvite';

interface InstallInvitePanelProps {
  readonly guildId?: string;
}

export function InstallInvitePanel({ guildId }: InstallInvitePanelProps) {
  const standardInviteUrl = buildBotInviteUrl('standard', guildId);
  const administratorInviteUrl = buildBotInviteUrl('administrator', guildId);
  const administratorEnabled = isAdministratorInviteEnabled();

  return (
    <section className="panel stack">
      <div>
        <span className="status info">Discord install</span>
        <h2>Install Drasil</h2>
        <p className="muted">
          Use the standard invite for normal servers. It requests the permissions needed for setup
          diagnostics, role restriction, thread handling, reports, and moderator ban actions.
        </p>
      </div>
      <div className="actions">
        {standardInviteUrl ? (
          <a className="button" href={standardInviteUrl} rel="noreferrer" target="_blank">
            Standard invite
          </a>
        ) : (
          <span className="pill">Set DISCORD_CLIENT_ID to generate invite links</span>
        )}
        {administratorInviteUrl ? (
          <a
            className="button secondary"
            href={administratorInviteUrl}
            rel="noreferrer"
            target="_blank"
          >
            Administrator invite
          </a>
        ) : null}
      </div>
      <p className="muted">
        If a controlled test server needs the broader Administrator shortcut, enable the invite
        feature flag and reload this panel. The standard invite remains the production path.
        {administratorEnabled && !administratorInviteUrl
          ? ' Set DISCORD_CLIENT_ID before using the Administrator shortcut.'
          : ''}
      </p>
    </section>
  );
}
