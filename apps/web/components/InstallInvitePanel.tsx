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
        <span className="status ok">Least privilege first</span>
        <h2>Install Drasil</h2>
        <p className="muted">
          Use the standard invite for normal servers. It requests the specific permissions Drasil
          needs for setup diagnostics, role restriction, thread handling, reports, and moderator ban
          actions.
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
            Administrator experimental invite
          </a>
        ) : (
          <span className="pill">
            Administrator shortcut {administratorEnabled ? 'unavailable' : 'disabled by default'}
          </span>
        )}
      </div>
      <p className="muted">
        Administrator mode is only for controlled testing or servers that explicitly choose the
        broader permission path. It is not the default install recommendation.
      </p>
    </section>
  );
}
