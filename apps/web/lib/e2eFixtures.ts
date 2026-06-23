import type {
  CaseDetail,
  CaseSummary,
  GuildSetupUpdate,
  SetupServerRecord,
} from '@drasil/contracts';
import { DISCORD_PERMISSIONS } from './discordPermissions';
import { readOptionalEnv, isProduction } from './env';
import { fixtureCaseDetails, fixtureCaseSummaries } from './caseFixtures';
import type { AdminSession, DiscordTokenSession } from './session';
import type { DiscordGuildResources, DiscordGuildSummary } from './discordApi';

export const fixtureGuildId = 'guild-1';
export const fixtureGuildName = 'Fixture Guild';
export const fixtureSecondGuildId = 'guild-2';
export const fixtureSecondGuildName = 'Quiet Guild';
export const fixtureTimestampIso = '2026-06-08T01:16:02.000Z';

export function isWebE2eFixtureMode(): boolean {
  const enabled = readOptionalEnv('DRASIL_WEB_E2E_FIXTURE_MODE') === 'true';
  if (enabled && isProduction()) {
    throw new Error('DRASIL_WEB_E2E_FIXTURE_MODE must not be enabled in production.');
  }
  return enabled;
}

export function fixtureAdminSession(): AdminSession {
  const issuedAt = Date.now();
  return {
    userId: 'fixture-admin',
    username: 'Fixture Admin',
    avatarUrl: null,
    issuedAt,
    expiresAt: issuedAt + 60 * 60 * 1000,
  };
}

export function fixtureDiscordToken(): DiscordTokenSession {
  return {
    accessToken: 'fixture-access-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

export function fixtureGuilds(): DiscordGuildSummary[] {
  return [
    {
      id: fixtureGuildId,
      name: fixtureGuildName,
      icon: null,
      owner: true,
      permissions: String(DISCORD_PERMISSIONS.ManageGuild),
    },
    {
      id: fixtureSecondGuildId,
      name: fixtureSecondGuildName,
      icon: null,
      owner: false,
      permissions: String(DISCORD_PERMISSIONS.ManageGuild),
    },
  ];
}

export function fixtureGuildResources(): DiscordGuildResources {
  const botPermissions = String(
    DISCORD_PERMISSIONS.ManageRoles |
      DISCORD_PERMISSIONS.BanMembers |
      DISCORD_PERMISSIONS.ViewAuditLog |
      DISCORD_PERMISSIONS.ManageChannels |
      DISCORD_PERMISSIONS.ViewChannel |
      DISCORD_PERMISSIONS.SendMessages |
      DISCORD_PERMISSIONS.EmbedLinks |
      DISCORD_PERMISSIONS.ReadMessageHistory |
      DISCORD_PERMISSIONS.ManageThreads |
      DISCORD_PERMISSIONS.CreatePrivateThreads |
      DISCORD_PERMISSIONS.SendMessagesInThreads
  );
  return {
    botUser: { id: 'bot-1', username: 'Drasil', avatar: null },
    botMember: { roles: ['bot-role'] },
    roles: [
      { id: fixtureGuildId, name: '@everyone', permissions: '0', position: 0, managed: false },
      { id: 'case-role', name: 'Case Role', permissions: '0', position: 1, managed: false },
      {
        id: 'admin-role',
        name: 'Moderators',
        permissions: botPermissions,
        position: 2,
        managed: false,
      },
      { id: 'bot-role', name: 'Drasil', permissions: botPermissions, position: 3, managed: false },
    ],
    channels: [
      { id: 'admin-channel-1', name: 'drasil-admin', type: 0 },
      { id: 'verification-channel-1', name: 'verification', type: 0 },
      { id: 'report-channel-1', name: 'report-scam', type: 0 },
    ],
  };
}

export function fixtureServerRecord(): SetupServerRecord {
  return {
    guild_id: fixtureGuildId,
    case_role_id: 'case-role',
    admin_channel_id: 'admin-channel-1',
    verification_channel_id: 'verification-channel-1',
    admin_notification_role_id: 'admin-role',
    heuristic_message_threshold: 5,
    heuristic_message_timeframe_seconds: 10,
    heuristic_suspicious_keywords: ['free nitro', 'airdrop'],
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-03T00:00:00.000Z',
    updated_by: 'fixture-admin',
    settings: {
      detection_response_mode: 'restrict',
      report_instructions_channel_id: 'report-channel-1',
      report_ai_triage_enabled: true,
      report_ai_max_action: 'open_case',
    },
    is_active: true,
  };
}

export function updateFixtureServerRecord(update: GuildSetupUpdate): SetupServerRecord {
  return {
    ...fixtureServerRecord(),
    case_role_id: update.caseRoleId ?? fixtureServerRecord().case_role_id,
    admin_channel_id: update.adminChannelId ?? fixtureServerRecord().admin_channel_id,
    verification_channel_id:
      update.verificationChannelId ?? fixtureServerRecord().verification_channel_id,
    admin_notification_role_id:
      update.adminNotificationRoleId ?? fixtureServerRecord().admin_notification_role_id,
    updated_by: update.updatedBy ?? fixtureServerRecord().updated_by,
    updated_at: fixtureTimestampIso,
  };
}

export function fixtureActiveCaseSummaries(): CaseSummary[] {
  return fixtureCaseSummaries();
}

export function fixtureResolvedCaseCount(): number {
  return 18;
}

export function fixtureActiveCaseDetail(caseId: string): CaseDetail | null {
  return fixtureCaseDetails.find((item) => item.id === caseId) ?? null;
}
