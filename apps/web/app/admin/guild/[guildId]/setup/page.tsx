import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CASE_RESPONDER_DEFAULT_THREAD_MEMBER_CAP,
  CASE_RESPONDER_MAX_THREAD_MEMBER_CAP,
  CASE_RESPONDER_MIN_THREAD_MEMBER_CAP,
  CASE_REVIEW_REMINDER_DEFAULT_REPEAT_HOURS,
  CASE_REVIEW_REMINDER_DEFAULT_STALE_HOURS,
  CASE_REVIEW_REMINDER_DEFAULT_VERY_STALE_DAYS,
  CASE_REVIEW_REMINDER_MAX_HOURS,
  CASE_REVIEW_REMINDER_MAX_VERY_STALE_DAYS,
  CASE_REVIEW_REMINDER_MIN_HOURS,
  CASE_REVIEW_REMINDER_MIN_VERY_STALE_DAYS,
  HEURISTIC_DEFAULT_MESSAGE_THRESHOLD,
  HEURISTIC_DEFAULT_TIMEFRAME_SECONDS,
  HEURISTIC_KEYWORDS_INPUT_MAX_LENGTH,
  HEURISTIC_MAX_MESSAGE_THRESHOLD,
  HEURISTIC_MAX_TIMEFRAME_SECONDS,
  HEURISTIC_MIN_MESSAGE_THRESHOLD,
  HEURISTIC_MIN_TIMEFRAME_SECONDS,
  ADMIN_CASE_OPEN_DEFAULT_REQUIRES_REASON,
  AUTO_KICK_DEFAULT_MIN_CONFIDENCE_THRESHOLD,
  AUTO_KICK_MAX_CONFIDENCE_THRESHOLD,
  AUTO_KICK_MIN_CONFIDENCE_THRESHOLD,
  AUTOMATIC_DETECTION_DEFAULT_EXEMPT_MODERATORS,
  CASE_ROLE_LOCKDOWN_DEFAULT_ENABLED,
  JOIN_DETECTION_AUTO_KICK_DEFAULT_ENABLED,
  MANUAL_INTAKE_DEFAULT_ENABLED,
  MANUAL_INTAKE_DEFAULT_GRACE_PERIOD_SECONDS,
  MANUAL_INTAKE_MAX_GRACE_PERIOD_SECONDS,
  MANUAL_INTAKE_MIN_GRACE_PERIOD_SECONDS,
  MESSAGE_DETECTION_AUTO_KICK_DEFAULT_ENABLED,
  MODERATOR_BAN_ACTION_DEFAULT_ENABLED,
  MODERATOR_BAN_ACTION_DEFAULT_REQUIRES_REASON,
  MODERATOR_KICK_ACTION_DEFAULT_ENABLED,
  MODERATOR_KICK_ACTION_DEFAULT_REQUIRES_REASON,
  OBSERVED_ACTION_KICK_DEFAULT_ENABLED,
  OBSERVED_DETECTION_DEFAULT_MIN_CONFIDENCE_THRESHOLD,
  OBSERVED_DETECTION_DEFAULT_NOTIFICATION_WINDOW_MINUTES,
  OBSERVED_DETECTION_MAX_CONFIDENCE_THRESHOLD,
  OBSERVED_DETECTION_MAX_NOTIFICATION_WINDOW_MINUTES,
  OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD,
  OBSERVED_DETECTION_MIN_NOTIFICATION_WINDOW_MINUTES,
  REPORT_AI_DEFAULT_MAX_IMAGE_BYTES,
  REPORT_AI_DEFAULT_MAX_IMAGES,
  REPORT_AI_DEFAULT_OPEN_CASE_THRESHOLD,
  REPORT_AI_MAX_MAX_IMAGE_BYTES,
  REPORT_AI_MAX_MAX_IMAGES,
  REPORT_AI_MAX_OPEN_CASE_THRESHOLD,
  REPORT_AI_MIN_MAX_IMAGE_BYTES,
  REPORT_AI_MIN_MAX_IMAGES,
  REPORT_AI_MIN_OPEN_CASE_THRESHOLD,
  REPORT_INTAKE_AUTO_KICK_DEFAULT_ENABLED,
  ROLE_GATE_DEFAULT_ENABLED,
  EXPECTED_TOPICS_INPUT_MAX_LENGTH,
  SERVER_ABOUT_MAX_LENGTH,
  VERIFICATION_ANALYSIS_DEFAULT_ENABLED,
  VERIFICATION_ANALYSIS_DEFAULT_MAX_ACTION,
  VERIFICATION_ANALYSIS_DEFAULT_MESSAGE_LIMIT,
  VERIFICATION_ANALYSIS_DEFAULT_RESTRICT_THRESHOLD,
  VERIFICATION_ANALYSIS_MAX_MESSAGE_LIMIT,
  VERIFICATION_ANALYSIS_MAX_RESTRICT_THRESHOLD,
  VERIFICATION_ANALYSIS_MIN_MESSAGE_LIMIT,
  VERIFICATION_ANALYSIS_MIN_RESTRICT_THRESHOLD,
  VERIFICATION_CONTEXT_MAX_LENGTH,
  VERIFICATION_PROMPT_TEMPLATE_MAX_LENGTH,
} from '@drasil/contracts';
import {
  queueCompleteSetupVerification,
  queueReportInstructionsRepair,
  saveGuildSetup,
} from './actions';
import { AccountControl } from '@/components/AccountControl';
import { InstallInvitePanel } from '@/components/InstallInvitePanel';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import type { DiscordChannel, DiscordRole } from '@/lib/discordApi';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string }>;
};

const DISCORD_CATEGORY_CHANNEL_TYPE = 4;

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

function channelMultiOptions(
  channels: readonly DiscordChannel[],
  savedChannelIds: readonly string[],
  kind: 'channel' | 'category'
) {
  const selectableChannels = channels
    .filter((channel) =>
      kind === 'category'
        ? channel.type === DISCORD_CATEGORY_CHANNEL_TYPE
        : channel.type !== DISCORD_CATEGORY_CHANNEL_TYPE
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const selectableChannelIds = new Set(selectableChannels.map((channel) => channel.id));
  const missingSavedChannelIds = savedChannelIds.filter(
    (channelId) => !selectableChannelIds.has(channelId)
  );
  return [
    ...missingSavedChannelIds.map((channelId) => (
      <option key={`saved-channel-${channelId}`} value={channelId}>
        Saved {kind} ({channelId})
      </option>
    )),
    ...selectableChannels.map((channel) => (
      <option key={channel.id} value={channel.id}>
        {kind === 'category' ? channel.name : `#${channel.name}`}
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

function roleMultiOptions(
  guildId: string,
  roles: readonly DiscordRole[],
  savedRoleIds: readonly string[]
) {
  const selectableRoles = roles
    .filter((role) => !role.managed && role.id !== guildId)
    .sort((left, right) => right.position - left.position);
  const selectableRoleIds = new Set(selectableRoles.map((role) => role.id));
  const missingSavedRoleIds = savedRoleIds.filter((roleId) => !selectableRoleIds.has(roleId));
  return [
    ...missingSavedRoleIds.map((roleId) => (
      <option key={`saved-role-${roleId}`} value={roleId}>
        Saved role ({roleId})
      </option>
    )),
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
  const completeSetupVerificationAction = queueCompleteSetupVerification.bind(null, guildId);
  const repairReportInstructionsAction = queueReportInstructionsRepair.bind(null, guildId);
  const reportAiMaxAction = server?.settings.report_ai_max_action ?? 'hints';
  const reportAiAnalyzeText = server?.settings.report_ai_analyze_text ?? true;
  const reportAiAnalyzeImages = server?.settings.report_ai_analyze_images ?? true;
  const reportAiOpenCaseThreshold =
    server?.settings.report_ai_open_case_threshold ?? REPORT_AI_DEFAULT_OPEN_CASE_THRESHOLD;
  const reportAiMaxImages = server?.settings.report_ai_max_images ?? REPORT_AI_DEFAULT_MAX_IMAGES;
  const reportAiMaxImageMb = Math.round(
    (server?.settings.report_ai_max_image_bytes ?? REPORT_AI_DEFAULT_MAX_IMAGE_BYTES) /
      (1024 * 1024)
  );
  const reportIntakeConfirmedResponseMode =
    server?.settings.report_intake_confirmed_response_mode ?? 'observed_alert';
  const roleGateEnabled = server?.settings.role_gate_enabled ?? ROLE_GATE_DEFAULT_ENABLED;
  const honeypotRoleId = server?.settings.honeypot_role_id ?? null;
  const memberAccessRoleId = server?.settings.member_access_role_id ?? null;
  const honeypotRoleResponseMode = server?.settings.honeypot_role_response_mode ?? 'restrict';
  const roleQuarantineMode = server?.settings.role_quarantine_mode ?? 'off';
  const roleQuarantineExemptRoleIds = server?.settings.role_quarantine_exempt_role_ids ?? [];
  const caseResponderRoleIds = server?.settings.case_responder_role_ids ?? [];
  const caseResponderRoutingMode = server?.settings.case_responder_routing_mode ?? 'off';
  const caseResponderThreadMemberCap =
    server?.settings.case_responder_thread_member_cap ?? CASE_RESPONDER_DEFAULT_THREAD_MEMBER_CAP;
  const caseReviewRemindersEnabled = server?.settings.case_review_reminders_enabled ?? true;
  const caseReviewReminderStaleHours =
    server?.settings.case_review_reminder_stale_hours ?? CASE_REVIEW_REMINDER_DEFAULT_STALE_HOURS;
  const caseReviewReminderRepeatHours =
    server?.settings.case_review_reminder_repeat_hours ?? CASE_REVIEW_REMINDER_DEFAULT_REPEAT_HOURS;
  const caseReviewVeryStaleDays =
    server?.settings.case_review_very_stale_days ?? CASE_REVIEW_REMINDER_DEFAULT_VERY_STALE_DAYS;
  const verificationAnalysisEnabled =
    server?.settings.verification_ai_thread_analysis_enabled ??
    VERIFICATION_ANALYSIS_DEFAULT_ENABLED;
  const verificationAnalysisMessageLimit =
    server?.settings.verification_ai_thread_analysis_message_limit ??
    VERIFICATION_ANALYSIS_DEFAULT_MESSAGE_LIMIT;
  const verificationAnalysisMaxAction =
    server?.settings.verification_ai_max_action ?? VERIFICATION_ANALYSIS_DEFAULT_MAX_ACTION;
  const verificationAnalysisRestrictThreshold =
    server?.settings.verification_ai_restrict_threshold ??
    VERIFICATION_ANALYSIS_DEFAULT_RESTRICT_THRESHOLD;
  const verificationPromptTemplate = server?.settings.verification_prompt_template ?? '';
  const serverAbout = server?.settings.server_about ?? '';
  const verificationContext = server?.settings.verification_context ?? '';
  const expectedTopics = server?.settings.expected_topics ?? [];
  const heuristicMessageThreshold =
    server?.heuristic_message_threshold ?? HEURISTIC_DEFAULT_MESSAGE_THRESHOLD;
  const heuristicMessageTimeframeSeconds =
    server?.heuristic_message_timeframe_seconds ?? HEURISTIC_DEFAULT_TIMEFRAME_SECONDS;
  const heuristicSuspiciousKeywords = server?.heuristic_suspicious_keywords ?? [];
  const observedDetectionMinConfidenceThreshold =
    server?.settings.observed_detection_min_confidence_threshold ??
    OBSERVED_DETECTION_DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  const observedDetectionNotificationWindowMinutes =
    server?.settings.observed_detection_notification_window_minutes ??
    OBSERVED_DETECTION_DEFAULT_NOTIFICATION_WINDOW_MINUTES;
  const automaticDetectionExemptModerators =
    server?.settings.automatic_detection_exempt_moderators ??
    AUTOMATIC_DETECTION_DEFAULT_EXEMPT_MODERATORS;
  const adminCaseOpenRequiresReason =
    server?.settings.admin_case_open_requires_reason ?? ADMIN_CASE_OPEN_DEFAULT_REQUIRES_REASON;
  const moderatorBanActionRequiresReason =
    server?.settings.moderator_ban_action_requires_reason ??
    MODERATOR_BAN_ACTION_DEFAULT_REQUIRES_REASON;
  const moderatorKickActionRequiresReason =
    server?.settings.moderator_kick_action_requires_reason ??
    MODERATOR_KICK_ACTION_DEFAULT_REQUIRES_REASON;
  const moderatorBanActionEnabled =
    server?.settings.moderator_ban_action_enabled ?? MODERATOR_BAN_ACTION_DEFAULT_ENABLED;
  const moderatorKickActionEnabled =
    server?.settings.moderator_kick_action_enabled ?? MODERATOR_KICK_ACTION_DEFAULT_ENABLED;
  const observedActionKickEnabled =
    server?.settings.observed_action_kick_enabled ?? OBSERVED_ACTION_KICK_DEFAULT_ENABLED;
  const messageDetectionAutoKickEnabled =
    server?.settings.message_detection_auto_kick_enabled ??
    MESSAGE_DETECTION_AUTO_KICK_DEFAULT_ENABLED;
  const joinDetectionAutoKickEnabled =
    server?.settings.join_detection_auto_kick_enabled ?? JOIN_DETECTION_AUTO_KICK_DEFAULT_ENABLED;
  const reportIntakeAutoKickEnabled =
    server?.settings.report_intake_auto_kick_enabled ?? REPORT_INTAKE_AUTO_KICK_DEFAULT_ENABLED;
  const autoKickMinConfidenceThreshold =
    server?.settings.auto_kick_min_confidence_threshold ??
    AUTO_KICK_DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  const manualIntakeEnabled =
    server?.settings.manual_intake_enabled ?? MANUAL_INTAKE_DEFAULT_ENABLED;
  const manualIntakeRoleId = server?.settings.manual_intake_role_id ?? null;
  const manualIntakeGracePeriodSeconds =
    server?.settings.manual_intake_grace_period_seconds ??
    MANUAL_INTAKE_DEFAULT_GRACE_PERIOD_SECONDS;
  const caseRoleLockdownEnabled =
    server?.settings.case_role_lockdown_enabled ?? CASE_ROLE_LOCKDOWN_DEFAULT_ENABLED;
  const caseRoleLockdownAllowedChannelIds =
    server?.settings.case_role_lockdown_allowed_channel_ids ?? [];
  const caseRoleLockdownAllowedCategoryIds =
    server?.settings.case_role_lockdown_allowed_category_ids ?? [];
  const customWatchlistTerms = server?.settings.message_deletion_watchlist_custom_terms ?? [];
  const moderationQueueChannelId = server?.settings.moderation_queue_channel_id ?? null;

  return (
    <main className="shell stack">
      <nav className="topbar">
        <Link className="brand" href="/admin">
          <span className="brand-mark" />
          <span>Drasil</span>
        </Link>
        <div className="nav-cluster">
          <Link className="button secondary" href={`/admin/guild/${guildId}/inbox`}>
            Inbox
          </Link>
          <Link className="button secondary" href={`/admin/guild/${guildId}/cases`}>
            Active Cases
          </Link>
          <Link className="button secondary" href={`/admin/guild/${guildId}/reports`}>
            Reports
          </Link>
          <Link className="button secondary" href={`/admin/guild/${guildId}/history`}>
            History
          </Link>
          <Link className="button secondary" href={`/admin/guild/${guildId}/operations`}>
            Operations
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
            <select id="caseRoleId" name="caseRoleId" defaultValue={server?.case_role_id ?? ''}>
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
            <label htmlFor="moderationQueueChannelId">Live queue channel</label>
            <select
              id="moderationQueueChannelId"
              name="moderationQueueChannelId"
              defaultValue={moderationQueueChannelId ?? ''}
            >
              <option value="">Disabled</option>
              {channelOptions(channels, moderationQueueChannelId)}
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
        <div className="actions">
          <button
            className="button secondary"
            formAction={completeSetupVerificationAction}
            type="submit"
          >
            Queue core setup repair
          </button>
          <button
            className="button secondary"
            formAction={repairReportInstructionsAction}
            type="submit"
          >
            Queue report button repair
          </button>
          <p className="muted">
            Core setup uses the selected case role and admin channel, creating the verification
            channel when none is selected. Report button repair only posts or updates report
            instructions, falling back to the admin alert channel.
          </p>
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
            <label htmlFor="heuristicMessageThreshold">Message burst threshold</label>
            <input
              defaultValue={heuristicMessageThreshold}
              id="heuristicMessageThreshold"
              max={HEURISTIC_MAX_MESSAGE_THRESHOLD}
              min={HEURISTIC_MIN_MESSAGE_THRESHOLD}
              name="heuristicMessageThreshold"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="heuristicMessageTimeframeSeconds">Message burst seconds</label>
            <input
              defaultValue={heuristicMessageTimeframeSeconds}
              id="heuristicMessageTimeframeSeconds"
              max={HEURISTIC_MAX_TIMEFRAME_SECONDS}
              min={HEURISTIC_MIN_TIMEFRAME_SECONDS}
              name="heuristicMessageTimeframeSeconds"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="observedDetectionMinConfidenceThreshold">
              Observed alert threshold
            </label>
            <input
              defaultValue={observedDetectionMinConfidenceThreshold}
              id="observedDetectionMinConfidenceThreshold"
              max={OBSERVED_DETECTION_MAX_CONFIDENCE_THRESHOLD}
              min={OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD}
              name="observedDetectionMinConfidenceThreshold"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="observedDetectionNotificationWindowMinutes">
              Observed alert window minutes
            </label>
            <input
              defaultValue={observedDetectionNotificationWindowMinutes}
              id="observedDetectionNotificationWindowMinutes"
              max={OBSERVED_DETECTION_MAX_NOTIFICATION_WINDOW_MINUTES}
              min={OBSERVED_DETECTION_MIN_NOTIFICATION_WINDOW_MINUTES}
              name="observedDetectionNotificationWindowMinutes"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="autoKickMinConfidenceThreshold">Auto-kick threshold</label>
            <input
              defaultValue={autoKickMinConfidenceThreshold}
              id="autoKickMinConfidenceThreshold"
              max={AUTO_KICK_MAX_CONFIDENCE_THRESHOLD}
              min={AUTO_KICK_MIN_CONFIDENCE_THRESHOLD}
              name="autoKickMinConfidenceThreshold"
              type="number"
            />
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
            <label htmlFor="reportAiMaxAction">Report analysis authority</label>
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
          <div className="field">
            <label htmlFor="reportIntakeConfirmedResponseMode">Confirmed report intake</label>
            <select
              defaultValue={reportIntakeConfirmedResponseMode}
              id="reportIntakeConfirmedResponseMode"
              name="reportIntakeConfirmedResponseMode"
            >
              <option value="observed_alert">Observed alert</option>
              <option value="open_case">Open case</option>
              <option value="kick">Kick high-confidence compromise</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="reportAiOpenCaseThreshold">Open-case threshold</label>
            <input
              defaultValue={reportAiOpenCaseThreshold}
              id="reportAiOpenCaseThreshold"
              max={REPORT_AI_MAX_OPEN_CASE_THRESHOLD}
              min={REPORT_AI_MIN_OPEN_CASE_THRESHOLD}
              name="reportAiOpenCaseThreshold"
              step="0.01"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="reportAiMaxImages">Report image limit</label>
            <input
              defaultValue={reportAiMaxImages}
              id="reportAiMaxImages"
              max={REPORT_AI_MAX_MAX_IMAGES}
              min={REPORT_AI_MIN_MAX_IMAGES}
              name="reportAiMaxImages"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="reportAiMaxImageMb">Report image MB limit</label>
            <input
              defaultValue={reportAiMaxImageMb}
              id="reportAiMaxImageMb"
              max={REPORT_AI_MAX_MAX_IMAGE_BYTES / (1024 * 1024)}
              min={Math.ceil(REPORT_AI_MIN_MAX_IMAGE_BYTES / (1024 * 1024))}
              name="reportAiMaxImageMb"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="heuristicSuspiciousKeywords">Heuristic watch terms</label>
            <textarea
              defaultValue={heuristicSuspiciousKeywords.join('\n')}
              id="heuristicSuspiciousKeywords"
              maxLength={HEURISTIC_KEYWORDS_INPUT_MAX_LENGTH}
              name="heuristicSuspiciousKeywords"
              placeholder="one operator-managed term per line"
              rows={4}
            />
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
            Enable report evidence analysis
          </label>
          <label>
            <input
              defaultChecked={reportAiAnalyzeText}
              name="reportAiAnalyzeText"
              type="checkbox"
            />{' '}
            Analyze report text
          </label>
          <label>
            <input
              defaultChecked={reportAiAnalyzeImages}
              name="reportAiAnalyzeImages"
              type="checkbox"
            />{' '}
            Analyze report images
          </label>
          <label>
            <input
              defaultChecked={automaticDetectionExemptModerators}
              name="automaticDetectionExemptModerators"
              type="checkbox"
            />{' '}
            Exempt moderators from automatic detection
          </label>
          <label>
            <input
              defaultChecked={adminCaseOpenRequiresReason}
              name="adminCaseOpenRequiresReason"
              type="checkbox"
            />{' '}
            Require staff case-open reasons
          </label>
          <label>
            <input
              defaultChecked={moderatorBanActionRequiresReason}
              name="moderatorBanActionRequiresReason"
              type="checkbox"
            />{' '}
            Require ban reasons
          </label>
          <label>
            <input
              defaultChecked={moderatorKickActionRequiresReason}
              name="moderatorKickActionRequiresReason"
              type="checkbox"
            />{' '}
            Require kick reasons
          </label>
          <label>
            <input
              defaultChecked={moderatorBanActionEnabled}
              name="moderatorBanActionEnabled"
              type="checkbox"
            />{' '}
            Enable moderator ban actions
          </label>
          <label>
            <input
              defaultChecked={moderatorKickActionEnabled}
              name="moderatorKickActionEnabled"
              type="checkbox"
            />{' '}
            Enable moderator kick actions
          </label>
          <label>
            <input
              defaultChecked={observedActionKickEnabled}
              name="observedActionKickEnabled"
              type="checkbox"
            />{' '}
            Enable observed-alert kick action
          </label>
          <label>
            <input
              defaultChecked={messageDetectionAutoKickEnabled}
              name="messageDetectionAutoKickEnabled"
              type="checkbox"
            />{' '}
            Allow message auto-kick
          </label>
          <label>
            <input
              defaultChecked={joinDetectionAutoKickEnabled}
              name="joinDetectionAutoKickEnabled"
              type="checkbox"
            />{' '}
            Allow join auto-kick
          </label>
          <label>
            <input
              defaultChecked={reportIntakeAutoKickEnabled}
              name="reportIntakeAutoKickEnabled"
              type="checkbox"
            />{' '}
            Allow report-intake auto-kick
          </label>
        </div>

        <div>
          <h2>Role Gate</h2>
          <p className="muted">
            Honeypot and member-access roles affect future verification and cleanup decisions.
          </p>
        </div>
        <div className="actions">
          <label>
            <input defaultChecked={roleGateEnabled} name="roleGateEnabled" type="checkbox" /> Enable
            role gate handling
          </label>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="honeypotRoleId">Honeypot role</label>
            <select id="honeypotRoleId" name="honeypotRoleId" defaultValue={honeypotRoleId ?? ''}>
              <option value="">No honeypot role</option>
              {roleOptions(roles, honeypotRoleId)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="memberAccessRoleId">Member access role</label>
            <select
              id="memberAccessRoleId"
              name="memberAccessRoleId"
              defaultValue={memberAccessRoleId ?? ''}
            >
              <option value="">No member access role</option>
              {roleOptions(roles, memberAccessRoleId)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="honeypotRoleResponseMode">Honeypot response</label>
            <select
              defaultValue={honeypotRoleResponseMode}
              id="honeypotRoleResponseMode"
              name="honeypotRoleResponseMode"
            >
              <option value="off">Off</option>
              <option value="record_only">Record only</option>
              <option value="notify_only">Notify only</option>
              <option value="restrict">Restrict pending review</option>
            </select>
          </div>
        </div>

        <div>
          <h2>Role Quarantine</h2>
          <p className="muted">
            Role quarantine removes non-exempt roles while a user is under case review and restores
            them when the case resolves.
          </p>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="roleQuarantineMode">Quarantine mode</label>
            <select
              defaultValue={roleQuarantineMode}
              id="roleQuarantineMode"
              name="roleQuarantineMode"
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="roleQuarantineExemptRoleIds">Exempt roles</label>
            <select
              defaultValue={roleQuarantineExemptRoleIds}
              id="roleQuarantineExemptRoleIds"
              multiple
              name="roleQuarantineExemptRoleIds"
              size={Math.min(Math.max(roles.length - 1, 3), 6)}
            >
              {roleMultiOptions(guildId, roles, roleQuarantineExemptRoleIds)}
            </select>
          </div>
        </div>

        <div>
          <h2>Manual Intake</h2>
          <p className="muted">
            A separate trigger role lets staff open moderation cases from role assignment.
          </p>
        </div>
        <div className="actions">
          <label>
            <input
              defaultChecked={manualIntakeEnabled}
              name="manualIntakeEnabled"
              type="checkbox"
            />{' '}
            Enable manual intake
          </label>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="manualIntakeRoleId">Manual intake trigger role</label>
            <select
              defaultValue={manualIntakeRoleId ?? ''}
              id="manualIntakeRoleId"
              name="manualIntakeRoleId"
            >
              <option value="">No manual intake role</option>
              {roleOptions(roles, manualIntakeRoleId)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="manualIntakeGracePeriodSeconds">Grace period seconds</label>
            <input
              defaultValue={manualIntakeGracePeriodSeconds}
              id="manualIntakeGracePeriodSeconds"
              max={MANUAL_INTAKE_MAX_GRACE_PERIOD_SECONDS}
              min={MANUAL_INTAKE_MIN_GRACE_PERIOD_SECONDS}
              name="manualIntakeGracePeriodSeconds"
              type="number"
            />
          </div>
        </div>

        <div>
          <h2>Case Role Lockdown</h2>
          <p className="muted">
            Lockdown is {caseRoleLockdownEnabled ? 'marked applied' : 'not marked applied'}. Allowed
            channels and categories are saved here; audit and apply remain operational actions.
          </p>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="caseRoleLockdownAllowedChannelIds">Allowed lockdown channels</label>
            <select
              defaultValue={caseRoleLockdownAllowedChannelIds}
              id="caseRoleLockdownAllowedChannelIds"
              multiple
              name="caseRoleLockdownAllowedChannelIds"
              size={Math.min(Math.max(channels.length - 1, 3), 6)}
            >
              {channelMultiOptions(channels, caseRoleLockdownAllowedChannelIds, 'channel')}
            </select>
          </div>
          <div className="field">
            <label htmlFor="caseRoleLockdownAllowedCategoryIds">Allowed lockdown categories</label>
            <select
              defaultValue={caseRoleLockdownAllowedCategoryIds}
              id="caseRoleLockdownAllowedCategoryIds"
              multiple
              name="caseRoleLockdownAllowedCategoryIds"
              size={Math.min(Math.max(channels.length - 1, 3), 6)}
            >
              {channelMultiOptions(channels, caseRoleLockdownAllowedCategoryIds, 'category')}
            </select>
          </div>
        </div>

        <div>
          <h2>Case Staff</h2>
          <p className="muted">
            Case responder roles are used for admin reminders and private report-review routing.
          </p>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="caseResponderRoleIds">Case responder roles</label>
            <select
              defaultValue={caseResponderRoleIds}
              id="caseResponderRoleIds"
              multiple
              name="caseResponderRoleIds"
              size={Math.min(Math.max(roles.length - 1, 3), 6)}
            >
              {roleMultiOptions(guildId, roles, caseResponderRoleIds)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="caseResponderRoutingMode">Responder routing</label>
            <select
              defaultValue={caseResponderRoutingMode}
              id="caseResponderRoutingMode"
              name="caseResponderRoutingMode"
            >
              <option value="off">Off</option>
              <option value="ping_only">Ping only</option>
              <option value="ping_and_add_members">Ping and add members</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="caseResponderThreadMemberCap">Thread member cap</label>
            <input
              defaultValue={caseResponderThreadMemberCap}
              id="caseResponderThreadMemberCap"
              max={CASE_RESPONDER_MAX_THREAD_MEMBER_CAP}
              min={CASE_RESPONDER_MIN_THREAD_MEMBER_CAP}
              name="caseResponderThreadMemberCap"
              type="number"
            />
          </div>
        </div>

        <div>
          <h2>Case Review</h2>
          <p className="muted">
            Stale-case and long-pending membership-screening notices share this rolling admin
            reminder cadence. Disabling case review does not disable screening notices.
          </p>
        </div>
        <div className="actions">
          <label>
            <input
              defaultChecked={caseReviewRemindersEnabled}
              name="caseReviewRemindersEnabled"
              type="checkbox"
            />{' '}
            Enable stale case reminders
          </label>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="caseReviewReminderStaleHours">Stale after hours</label>
            <input
              defaultValue={caseReviewReminderStaleHours}
              id="caseReviewReminderStaleHours"
              max={CASE_REVIEW_REMINDER_MAX_HOURS}
              min={CASE_REVIEW_REMINDER_MIN_HOURS}
              name="caseReviewReminderStaleHours"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="caseReviewReminderRepeatHours">Admin reminder repeat hours</label>
            <input
              defaultValue={caseReviewReminderRepeatHours}
              id="caseReviewReminderRepeatHours"
              max={CASE_REVIEW_REMINDER_MAX_HOURS}
              min={CASE_REVIEW_REMINDER_MIN_HOURS}
              name="caseReviewReminderRepeatHours"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="caseReviewVeryStaleDays">Very stale after days</label>
            <input
              defaultValue={caseReviewVeryStaleDays}
              id="caseReviewVeryStaleDays"
              max={CASE_REVIEW_REMINDER_MAX_VERY_STALE_DAYS}
              min={CASE_REVIEW_REMINDER_MIN_VERY_STALE_DAYS}
              name="caseReviewVeryStaleDays"
              type="number"
            />
          </div>
        </div>

        <div>
          <h2>Verification Prompt And Context</h2>
          <p className="muted">
            These fields guide the verification thread prompt and the checks applied to member
            replies.
          </p>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="verificationPromptTemplate">Verification prompt template</label>
            <textarea
              defaultValue={verificationPromptTemplate}
              id="verificationPromptTemplate"
              maxLength={VERIFICATION_PROMPT_TEMPLATE_MAX_LENGTH}
              name="verificationPromptTemplate"
              placeholder="Leave blank to use Drasil's default prompt. Supports {user_mention} and {server_name}."
              rows={6}
            />
          </div>
          <div className="field">
            <label htmlFor="serverAbout">Server description</label>
            <textarea
              defaultValue={serverAbout}
              id="serverAbout"
              maxLength={SERVER_ABOUT_MAX_LENGTH}
              name="serverAbout"
              placeholder="Short description of what this server is for"
              rows={4}
            />
          </div>
          <div className="field">
            <label htmlFor="verificationContext">Legitimate member context</label>
            <textarea
              defaultValue={verificationContext}
              id="verificationContext"
              maxLength={VERIFICATION_CONTEXT_MAX_LENGTH}
              name="verificationContext"
              placeholder="What real members are likely to know, mention, or ask about"
              rows={4}
            />
          </div>
          <div className="field">
            <label htmlFor="expectedTopics">Expected topics</label>
            <textarea
              defaultValue={expectedTopics.join('\n')}
              id="expectedTopics"
              maxLength={EXPECTED_TOPICS_INPUT_MAX_LENGTH}
              name="expectedTopics"
              placeholder="one topic, link, or keyword per line"
              rows={4}
            />
          </div>
        </div>

        <div>
          <h2>Verification Reply Analysis</h2>
          <p className="muted">
            Drasil can analyze verification replies and suggest whether a case needs review.
          </p>
        </div>
        <div className="actions">
          <label>
            <input
              defaultChecked={verificationAnalysisEnabled}
              name="verificationAnalysisEnabled"
              type="checkbox"
            />{' '}
            Analyze verification replies
          </label>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="verificationAnalysisMessageLimit">Reply limit</label>
            <input
              defaultValue={verificationAnalysisMessageLimit}
              id="verificationAnalysisMessageLimit"
              max={VERIFICATION_ANALYSIS_MAX_MESSAGE_LIMIT}
              min={VERIFICATION_ANALYSIS_MIN_MESSAGE_LIMIT}
              name="verificationAnalysisMessageLimit"
              type="number"
            />
          </div>
          <div className="field">
            <label htmlFor="verificationAnalysisMaxAction">Maximum recommendation</label>
            <select
              defaultValue={verificationAnalysisMaxAction}
              id="verificationAnalysisMaxAction"
              name="verificationAnalysisMaxAction"
            >
              <option value="off">Off</option>
              <option value="hints">Hints only</option>
              <option value="restrict">Restrict pending review</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="verificationAnalysisRestrictThreshold">Restrict threshold</label>
            <input
              defaultValue={verificationAnalysisRestrictThreshold}
              id="verificationAnalysisRestrictThreshold"
              max={VERIFICATION_ANALYSIS_MAX_RESTRICT_THRESHOLD}
              min={VERIFICATION_ANALYSIS_MIN_RESTRICT_THRESHOLD}
              name="verificationAnalysisRestrictThreshold"
              step="0.01"
              type="number"
            />
          </div>
        </div>

        <div>
          <h2>Message Deletion</h2>
          <p className="muted">
            High-confidence watchlist deletion preserves moderator evidence, then removes the source
            message when Drasil has Manage Messages. Staff/admin posters are routed for review
            rather than automatically deleted.
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
              Custom terms require a link or video before automatic deletion is considered. Global
              watchlist terms are managed centrally in the database, not in bot source code.
            </p>
          </div>
        </div>
        <div className="actions">
          <button className="button" type="submit">
            Save setup
          </button>
          <p className="muted">
            Signed in as {session.username}. Drasil still never auto-bans from report analysis.
          </p>
        </div>
      </form>
    </main>
  );
}
