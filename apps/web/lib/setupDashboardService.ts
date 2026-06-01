import {
  type GuildSetupUpdate,
  type SetupChecklistItem,
  type SetupDashboard,
  type SetupDiagnosticSeverity,
  type SetupServerRecord,
} from '@drasil/contracts';
import {
  type DiscordChannel,
  type DiscordGuildResources,
  type DiscordGuildSummary,
  type DiscordRole,
  fetchDiscordGuilds,
  fetchGuildResources,
} from './discordApi';
import {
  DISCORD_PERMISSIONS,
  canManageGuild,
  computeChannelPermissions,
  computeGuildPermissions,
  hasPermission,
} from './discordPermissions';
import { createSetupDataAdapter, type SetupDataAdapter } from './setupDataAdapter';

export interface ManageableGuild {
  readonly id: string;
  readonly name: string;
  readonly configured: boolean;
  readonly icon: string | null;
}

export interface SetupDashboardContext {
  readonly dashboard: SetupDashboard;
  readonly channels: readonly DiscordChannel[];
  readonly roles: readonly DiscordRole[];
}

interface ChannelPermissionCheckArgs {
  readonly guildId: string;
  readonly botUserId: string;
  readonly botRoleIds: readonly string[];
  readonly roles: readonly DiscordRole[];
  readonly channel: DiscordChannel;
  readonly required: readonly bigint[];
}

interface BuildChecklistArgs {
  readonly guild: DiscordGuildSummary;
  readonly server: SetupServerRecord | null;
  readonly resources: DiscordGuildResources | null;
  readonly resourcesError: string | null;
}

const TEXT_CHANNEL_TYPES = new Set([0, 5, 15]);

const item = (
  key: string,
  label: string,
  status: SetupDiagnosticSeverity,
  detail: string
): SetupChecklistItem => ({ key, label, status, detail });

function findRole(roles: readonly DiscordRole[], roleId: string | null | undefined) {
  if (!roleId) {
    return null;
  }
  return roles.find((role) => role.id === roleId) ?? null;
}

function findChannel(channels: readonly DiscordChannel[], channelId: string | null | undefined) {
  if (!channelId) {
    return null;
  }
  return channels.find((channel) => channel.id === channelId) ?? null;
}

function formatChannelName(channel: DiscordChannel) {
  return `#${channel.name}`;
}

function formatRoleName(role: DiscordRole) {
  return `@${role.name}`;
}

function hasRequiredChannelPermissions(args: ChannelPermissionCheckArgs) {
  const guildPermissions = computeGuildPermissions({
    guildId: args.guildId,
    roles: args.roles,
    memberRoleIds: args.botRoleIds,
  });
  const channelPermissions = computeChannelPermissions({
    guildId: args.guildId,
    userId: args.botUserId,
    guildPermissions,
    memberRoleIds: args.botRoleIds,
    overwrites: args.channel.permission_overwrites ?? [],
  });
  return args.required.every((permission) => hasPermission(channelPermissions, permission));
}

function buildChecklist(args: BuildChecklistArgs) {
  const checklist: SetupChecklistItem[] = [];
  const { guild, server, resources } = args;

  checklist.push(
    server
      ? item(
          'server-config',
          'Server configuration',
          'ok',
          'A Drasil configuration exists for this guild.'
        )
      : item(
          'server-config',
          'Server configuration',
          'warning',
          'No persisted configuration exists yet. Saving this page will create one.'
        )
  );

  if (!resources) {
    checklist.push(
      item(
        'bot-installed',
        'Bot installation',
        'error',
        args.resourcesError ?? 'Drasil could not load live guild diagnostics with the bot token.'
      )
    );
    return checklist;
  }

  checklist.push(item('bot-installed', 'Bot installation', 'ok', 'Drasil can access this guild.'));

  const botRoleIds = resources.botMember.roles;
  const guildPermissions = computeGuildPermissions({
    guildId: guild.id,
    roles: resources.roles,
    memberRoleIds: botRoleIds,
  });

  checklist.push(
    hasPermission(guildPermissions, DISCORD_PERMISSIONS.ManageRoles)
      ? item(
          'manage-roles',
          'Manage roles permission',
          'ok',
          'Drasil can assign the restricted role.'
        )
      : item('manage-roles', 'Manage roles permission', 'error', 'Drasil is missing Manage Roles.')
  );

  checklist.push(
    hasPermission(guildPermissions, DISCORD_PERMISSIONS.BanMembers)
      ? item(
          'ban-members',
          'Ban members permission',
          'ok',
          'Moderator ban actions can be executed.'
        )
      : item(
          'ban-members',
          'Ban members permission',
          'warning',
          'Ban actions will fail until Drasil has Ban Members.'
        )
  );

  const restrictedRole = findRole(resources.roles, server?.restricted_role_id);
  const highestBotRolePosition = Math.max(
    -1,
    ...resources.roles.filter((role) => botRoleIds.includes(role.id)).map((role) => role.position)
  );
  if (!server?.restricted_role_id) {
    checklist.push(
      item(
        'restricted-role',
        'Restricted role',
        'error',
        'Choose the role Drasil applies while a user is under review.'
      )
    );
  } else if (!restrictedRole) {
    checklist.push(
      item(
        'restricted-role',
        'Restricted role',
        'error',
        'The configured restricted role no longer exists.'
      )
    );
  } else if (restrictedRole.managed) {
    checklist.push(
      item(
        'restricted-role',
        'Restricted role',
        'error',
        `${formatRoleName(restrictedRole)} is managed by an integration.`
      )
    );
  } else if (highestBotRolePosition <= restrictedRole.position) {
    checklist.push(
      item(
        'restricted-role',
        'Restricted role',
        'error',
        `Move Drasil's bot role above ${formatRoleName(restrictedRole)}.`
      )
    );
  } else {
    checklist.push(
      item(
        'restricted-role',
        'Restricted role',
        'ok',
        `${formatRoleName(restrictedRole)} can be assigned by Drasil.`
      )
    );
  }

  const adminChannel = findChannel(resources.channels, server?.admin_channel_id);
  const verificationChannel = findChannel(resources.channels, server?.verification_channel_id);
  const reportChannel = findChannel(
    resources.channels,
    server?.settings.report_instructions_channel_id
  );
  const observedChannel = findChannel(
    resources.channels,
    server?.settings.observed_detection_notification_channel_id
  );

  const adminRequired = [
    DISCORD_PERMISSIONS.ViewChannel,
    DISCORD_PERMISSIONS.SendMessages,
    DISCORD_PERMISSIONS.EmbedLinks,
  ];
  const verificationRequired = [
    ...adminRequired,
    DISCORD_PERMISSIONS.ReadMessageHistory,
    DISCORD_PERMISSIONS.CreatePrivateThreads,
    DISCORD_PERMISSIONS.SendMessagesInThreads,
  ];

  if (!adminChannel) {
    checklist.push(
      item(
        'admin-channel',
        'Admin alert channel',
        'error',
        'Choose a channel for moderator notifications.'
      )
    );
  } else if (
    hasRequiredChannelPermissions({
      guildId: guild.id,
      botUserId: resources.botUser.id,
      botRoleIds,
      roles: resources.roles,
      channel: adminChannel,
      required: adminRequired,
    })
  ) {
    checklist.push(
      item(
        'admin-channel',
        'Admin alert channel',
        'ok',
        `${formatChannelName(adminChannel)} is reachable.`
      )
    );
  } else {
    checklist.push(
      item(
        'admin-channel',
        'Admin alert channel',
        'error',
        `${formatChannelName(adminChannel)} is missing required bot permissions.`
      )
    );
  }

  if (!verificationChannel) {
    checklist.push(
      item(
        'verification-channel',
        'Verification channel',
        'error',
        'Choose a channel where private verification threads can be opened.'
      )
    );
  } else if (
    hasRequiredChannelPermissions({
      guildId: guild.id,
      botUserId: resources.botUser.id,
      botRoleIds,
      roles: resources.roles,
      channel: verificationChannel,
      required: verificationRequired,
    })
  ) {
    checklist.push(
      item(
        'verification-channel',
        'Verification channel',
        'ok',
        `${formatChannelName(verificationChannel)} can host case threads.`
      )
    );
  } else {
    checklist.push(
      item(
        'verification-channel',
        'Verification channel',
        'error',
        `${formatChannelName(verificationChannel)} is missing thread or message permissions.`
      )
    );
  }

  checklist.push(
    reportChannel
      ? item(
          'report-channel',
          'Report instructions channel',
          'ok',
          `${formatChannelName(reportChannel)} is configured for public report instructions.`
        )
      : item(
          'report-channel',
          'Report instructions channel',
          'warning',
          'No report instructions channel is configured yet.'
        )
  );

  checklist.push(
    observedChannel
      ? item(
          'observed-channel',
          'Observed detection alerts',
          'ok',
          `${formatChannelName(observedChannel)} receives observe-only alerts.`
        )
      : item(
          'observed-channel',
          'Observed detection alerts',
          'warning',
          'Observe-only alerts will use the admin channel unless configured separately.'
        )
  );

  const responderRoleIds = server?.settings.case_responder_role_ids ?? [];
  const missingResponderRoles = responderRoleIds.filter(
    (roleId) => !findRole(resources.roles, roleId)
  );
  checklist.push(
    missingResponderRoles.length === 0
      ? item(
          'case-responders',
          'Case responder roles',
          'ok',
          responderRoleIds.length > 0
            ? 'Configured responder roles exist.'
            : 'No responder roles are required.'
        )
      : item(
          'case-responders',
          'Case responder roles',
          'warning',
          'One or more configured responder roles no longer exists.'
        )
  );

  const aiAction = server?.settings.report_ai_max_action ?? 'hints';
  checklist.push(
    aiAction === 'restrict'
      ? item(
          'report-ai-policy',
          'Report AI policy',
          'warning',
          'Report AI can restrict pending review, but it can never auto-ban.'
        )
      : item(
          'report-ai-policy',
          'Report AI policy',
          'ok',
          `Report AI authority is capped at ${aiAction}.`
        )
  );

  return checklist;
}

export class SetupDashboardService {
  public constructor(private readonly adapter: SetupDataAdapter = createSetupDataAdapter()) {}

  public async listManageableGuilds(accessToken: string): Promise<ManageableGuild[]> {
    const guilds = (await fetchDiscordGuilds(accessToken)).filter((guild) => {
      return canManageGuild(guild.permissions, guild.owner);
    });
    const configured = await this.adapter.listConfiguredGuildIds(guilds.map((guild) => guild.id));
    return guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      configured: configured.has(guild.id),
    }));
  }

  public async getDashboard(guildId: string, accessToken: string): Promise<SetupDashboardContext> {
    const manageableGuild = (await fetchDiscordGuilds(accessToken)).find((guild) => {
      return guild.id === guildId && canManageGuild(guild.permissions, guild.owner);
    });
    if (!manageableGuild) {
      throw new Error('You do not have permission to manage this guild.');
    }

    const server = await this.adapter.getServer(guildId);
    let resources: DiscordGuildResources | null = null;
    let resourcesError: string | null = null;
    try {
      resources = await fetchGuildResources(guildId);
    } catch (error) {
      resourcesError = error instanceof Error ? error.message : 'Unable to load Discord resources.';
    }

    return {
      dashboard: {
        guildId,
        guildName: manageableGuild.name,
        configured: Boolean(server?.is_active),
        dataProvider: this.adapter.provider,
        checkedAt: new Date().toISOString(),
        checklist: buildChecklist({ guild: manageableGuild, server, resources, resourcesError }),
        server,
      },
      channels: (resources?.channels ?? []).filter((channel) =>
        TEXT_CHANNEL_TYPES.has(channel.type)
      ),
      roles: resources?.roles ?? [],
    };
  }

  public async updateGuildSetup(update: GuildSetupUpdate): Promise<SetupServerRecord> {
    return this.adapter.updateGuildSetup(update);
  }
}

export function createSetupDashboardService(): SetupDashboardService {
  return new SetupDashboardService();
}
