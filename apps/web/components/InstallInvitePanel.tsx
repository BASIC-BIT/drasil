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
      <div className="section-heading compact-heading">
        <h2>Install Drasil</h2>
        <p className="muted">
          Invite Drasil with the standard permission set for setup diagnostics, case roles,
          evidence threads, reports, and moderator ban actions.
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
        A hidden Administrator shortcut can be enabled for controlled test servers. Normal installs
        should use the standard invite above.
        {administratorEnabled && !administratorInviteUrl
          ? ' Set DISCORD_CLIENT_ID before using the Administrator shortcut.'
          : ''}
      </p>
    </section>
  );
}
