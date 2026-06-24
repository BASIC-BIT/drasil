import Link from 'next/link';
import { redirect } from 'next/navigation';
import { saveGuildSetup } from './actions';
import { AccountControl } from '@/components/AccountControl';
import { InstallInvitePanel } from '@/components/InstallInvitePanel';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import type { DiscordChannel, DiscordRole } from '@/lib/discordApi';

const MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES = [
  {
    id: 'wickedproxy-video-link',
    label: 'WickedProxy video/link campaign',
    detail: 'Matches wickedproxy indicators only when the message also contains a link or video.',
  },
] as const;

type PageProps = {
  readonly params: Promise<{ readonly guildId: string }>;
};

function channelOptions(
  channels: readonly DiscordChannel[],
  savedChannelId: string | null | undefined
) {
  const savedChannel = savedChannelId
    ? channels.find((channel) => channel.id === savedChannelId)
    : null;
  return [
    savedChannelId && !savedChannel ? (
      <option key={`saved-channel-${savedChannelId}`} value={savedChannelId}>
        Saved channel ({savedChannelId})
      </option>
    ) : null,
    ...channels.map((channel) => (
      <option key={channel.id} value={channel.id}>
        #{channel.name}
      </option>
    )),
  ];
}

function roleOptions(roles: readonly DiscordRole[], savedRoleId: string | null | undefined) {
  const selectableRoles = roles
    .filter((role) => !role.managed)
    .sort((left, right) => right.position - left.position);
  const savedRole = savedRoleId ? selectableRoles.find((role) => role.id === savedRoleId) : null;
  return [
    savedRoleId && !savedRole ? (
      <option key={`saved-role-${savedRoleId}`} value={savedRoleId}>
        Saved role ({savedRoleId})
      </option>
    ) : null,
    ...selectableRoles.map((role) => (
      <option key={role.id} value={role.id}>
        @{role.name}
      </option>
    )),
  ];
}

export default async function GuildSetupPage({ params }: PageProps) {
  const { guildId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/setup`);
  }

  const service = createSetupDashboardService();
  const { dashboard, channels, roles } = await service.getDashboard(guildId, token.accessToken);
  const server = dashboard.server;
  const saveAction = saveGuildSetup.bind(null, guildId);
  const reportAiMaxAction =
    server?.settings.report_ai_max_action === 'restrict'
      ? 'open_case'
      : (server?.settings.report_ai_max_action ?? 'hints');
  const disabledWatchlistDefaultIds = new Set(
    server?.settings.message_deletion_watchlist_disabled_default_ids ?? []
  );
  const customWatchlistTerms = server?.settings.message_deletion_watchlist_custom_terms ?? [];

  return (
    <main className="shell stack">
      <nav className="topbar">
        <Link className="brand" href="/admin">
          <span className="brand-mark" />
          <span>Drasil</span>
        </Link>
        <div className="nav-cluster">
          <Link className="button secondary" href={`/admin/guild/${guildId}/cases`}>
            Active Cases
          </Link>
          <Link className="button secondary" href="/admin">
            All Servers
          </Link>
          <ThemeToggle />
          <AccountControl username={session.username} />
        </div>
      </nav>

      <section className="panel stack">
        <div className="section-heading">
          <span className={dashboard.configured ? 'status ok' : 'status warning'}>
            {dashboard.configured ? 'Configured' : 'First setup'}
          </span>
          <h1 className="page-title">{dashboard.guildName}</h1>
          <p className="lede">
            Live setup diagnostics from Discord and the {dashboard.dataProvider} configuration. Last
            checked: {new Date(dashboard.checkedAt).toLocaleString('en-US', { timeZone: 'UTC' })}{' '}
            UTC.
          </p>
        </div>
        <div className="setup-check-grid">
          {dashboard.checklist.map((check) => (
            <article className="card setup-check-card" key={check.key}>
              <span className={`status ${check.status}`}>{check.status}</span>
              <div>
                <h2>{check.label}</h2>
                <p className="muted">{check.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <InstallInvitePanel guildId={guildId} />

      <form action={saveAction} className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Core Setup</h2>
          <p className="muted">
            These settings are saved to the same server configuration used by the bot. Channel and
            role dropdowns are loaded live from Discord when the bot token can access the guild.
          </p>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="caseRoleId">Case role</label>
            <select
              id="caseRoleId"
              name="caseRoleId"
              defaultValue={server?.case_role_id ?? ''}
            >
              <option value="">Choose a role</option>
              {roleOptions(roles, server?.case_role_id)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="adminChannelId">Admin alert channel</label>
            <select
              id="adminChannelId"
              name="adminChannelId"
              defaultValue={server?.admin_channel_id ?? ''}
            >
              <option value="">Choose a channel</option>
              {channelOptions(channels, server?.admin_channel_id)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="verificationChannelId">Verification channel</label>
            <select
              id="verificationChannelId"
              name="verificationChannelId"
              defaultValue={server?.verification_channel_id ?? ''}
            >
              <option value="">Choose a channel</option>
              {channelOptions(channels, server?.verification_channel_id)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="reportInstructionsChannelId">Report instructions channel</label>
            <select
              id="reportInstructionsChannelId"
              name="reportInstructionsChannelId"
              defaultValue={server?.settings.report_instructions_channel_id ?? ''}
            >
              <option value="">Use admin channel</option>
              {channelOptions(channels, server?.settings.report_instructions_channel_id)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="observedNotificationChannelId">Observed alert channel</label>
            <select
              id="observedNotificationChannelId"
              name="observedNotificationChannelId"
              defaultValue={server?.settings.observed_detection_notification_channel_id ?? ''}
            >
              <option value="">Use admin channel</option>
              {channelOptions(
                channels,
                server?.settings.observed_detection_notification_channel_id
              )}
            </select>
          </div>
          <div className="field">
            <label htmlFor="adminNotificationRoleId">Admin notification role</label>
            <select
              id="adminNotificationRoleId"
              name="adminNotificationRoleId"
              defaultValue={server?.admin_notification_role_id ?? ''}
            >
              <option value="">No role ping</option>
              {roleOptions(roles, server?.admin_notification_role_id)}
            </select>
          </div>
        </div>

        <div>
          <h2>Moderation Policy</h2>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="detectionResponseMode">Default detection response</label>
            <select
              id="detectionResponseMode"
              name="detectionResponseMode"
              defaultValue={server?.settings.detection_response_mode ?? 'restrict'}
            >
              <option value="off">Off</option>
              <option value="record_only">Record only</option>
              <option value="notify_only">Notify only</option>
              <option value="restrict">Restrict pending review</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="messageDetectionResponseMode">Message detections</label>
            <select
              id="messageDetectionResponseMode"
              name="messageDetectionResponseMode"
              defaultValue={server?.settings.message_detection_response_mode ?? ''}
            >
              <option value="">Use default</option>
              <option value="off">Off</option>
              <option value="record_only">Record only</option>
              <option value="notify_only">Notify only</option>
              <option value="restrict">Restrict pending review</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="joinDetectionResponseMode">Join detections</label>
            <select
              id="joinDetectionResponseMode"
              name="joinDetectionResponseMode"
              defaultValue={server?.settings.join_detection_response_mode ?? ''}
            >
              <option value="">Use default</option>
              <option value="off">Off</option>
              <option value="record_only">Record only</option>
              <option value="notify_only">Notify only</option>
              <option value="restrict">Restrict pending review</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="userReportExternalResponseMode">External report response</label>
            <select
              id="userReportExternalResponseMode"
              name="userReportExternalResponseMode"
              defaultValue={server?.settings.user_report_external_response_mode ?? 'off'}
            >
              <option value="off">Off</option>
              <option value="notify_only">Notify only</option>
              <option value="open_case">Open case</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="analyticsConsentLevel">Product analytics</label>
            <select
              id="analyticsConsentLevel"
              name="analyticsConsentLevel"
              defaultValue={server?.settings.analytics_consent_level ?? 'anonymous'}
            >
              <option value="off">Off</option>
              <option value="anonymous">Anonymous</option>
              <option value="full">Full identifiers</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="reportAiMaxAction">Report AI authority</label>
            <select
              id="reportAiMaxAction"
              name="reportAiMaxAction"
              defaultValue={reportAiMaxAction}
            >
              <option value="off">Off</option>
              <option value="hints">Hints only</option>
              <option value="open_case">Open case</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <label>
            <input
              defaultChecked={server?.settings.user_report_reason_required ?? false}
              name="userReportReasonRequired"
              type="checkbox"
            />{' '}
            Require report reasons
          </label>
          <label>
            <input
              defaultChecked={server?.settings.report_ai_triage_enabled ?? true}
              name="reportAiTriageEnabled"
              type="checkbox"
            />{' '}
            Enable report AI triage
          </label>
        </div>

        <div>
          <h2>Message Deletion</h2>
          <p className="muted">
            High-confidence watchlist deletion preserves moderator evidence, then removes the source
            message when Drasil has Manage Messages. Staff/admin posters are routed for review rather
            than automatically deleted.
          </p>
        </div>
        <div className="actions">
          <label>
            <input
              defaultChecked={server?.settings.message_deletion_enabled ?? true}
              name="messageDeletionEnabled"
              type="checkbox"
            />{' '}
            Enable message deletion policy
          </label>
          <label>
            <input
              defaultChecked={server?.settings.message_deletion_source_message_enabled ?? true}
              name="messageDeletionSourceMessageEnabled"
              type="checkbox"
            />{' '}
            Delete matched source messages
          </label>
          <label>
            <input
              defaultChecked={server?.settings.message_deletion_watchlist_enabled ?? true}
              name="messageDeletionWatchlistEnabled"
              type="checkbox"
            />{' '}
            Enable high-confidence watchlist
          </label>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Code-defined watchlist defaults</label>
            <div className="stack compact-heading">
              {MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES.map((entry) => (
                <label key={entry.id}>
                  <input
                    defaultChecked={!disabledWatchlistDefaultIds.has(entry.id)}
                    name="messageDeletionDefaultWatchlistIds"
                    type="checkbox"
                    value={entry.id}
                  />{' '}
                  {entry.label}
                  <span className="muted"> {entry.detail}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="messageDeletionWatchlistCustomTerms">
              Custom high-confidence watchlist terms
            </label>
            <textarea
              defaultValue={customWatchlistTerms.join('\n')}
              id="messageDeletionWatchlistCustomTerms"
              name="messageDeletionWatchlistCustomTerms"
              placeholder="one exact campaign/domain term per line"
              rows={4}
            />
            <p className="muted">
              Custom terms also require a link or video before automatic deletion is considered.
            </p>
          </div>
        </div>
        <div className="actions">
          <button className="button" type="submit">
            Save setup
          </button>
          <p className="muted">
            Signed in as {session.username}. Drasil still never auto-bans from report AI.
          </p>
        </div>
      </form>
    </main>
  );
}
