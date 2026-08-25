import {
  deriveSetupReadiness,
  type GuildSetupUpdate,
  type SetupChecklistItem,
  type SetupDashboard,
  type SetupDiagnosticSeverity,
  type SetupReadinessStatus,
  type SetupServerRecord,
} from '@drasil/contracts';
import {
  type DiscordChannel,
  DiscordApiError,
  type DiscordGuildResources,
  type DiscordGuildSummary,
  type DiscordRole,
  type DiscordUser,
  fetchDiscordBotUser,
  fetchDiscordGuilds,
  fetchGuildResources,
} from './discordApi';
import {
  DISCORD_PERMISSIONS,
  canManageGuild,
  computeChannelPermissions,
  computeGuildPermissions,
  hasPermission,
  parsePermissions,
} from './discordPermissions';
import { fixtureTimestampIso, isWebE2eFixtureMode } from './e2eFixtures';
import { createSetupDataAdapter, type SetupDataAdapter } from './setupDataAdapter';

export interface ManageableGuild {
  readonly id: string;
  readonly name: string;
  readonly readiness: SetupReadinessStatus;
  readonly icon: string | null;
}

export interface SetupDashboardContext {
  readonly dashboard: SetupDashboard;
  readonly channels: readonly DiscordChannel[];
  readonly roles: readonly DiscordRole[];
  readonly botRoleIds: readonly string[];
  readonly canApplySetup: boolean;
}

type Clock = () => Date;

interface ChannelPermissionCheckArgs {
  readonly guildId: string;
  readonly botUserId: string;
  readonly botRoleIds: readonly string[];
  readonly roles: readonly DiscordRole[];
  readonly channel: DiscordChannel;
  readonly required: readonly bigint[];
}

interface CoreChannelChecklistArgs extends Omit<ChannelPermissionCheckArgs, 'channel'> {
  readonly checklist: SetupChecklistItem[];
  readonly channel: DiscordChannel | null;
  readonly key: string;
  readonly label: string;
  readonly missingDetail: string;
  readonly successDetail: string;
  readonly permissionErrorDetail: string;
  readonly requirePrivate?: boolean;
}

interface BuildChecklistArgs {
  readonly guild: DiscordGuildSummary;
  readonly server: SetupServerRecord | null;
  readonly resources: DiscordGuildResources | null;
  readonly resourcesError: string | null;
}

interface LoadDashboardOptions {
  readonly knownBotUser?: DiscordUser;
  readonly botIdentityError?: string;
}

interface GuildPermissionChecklistArgs {
  readonly checklist: SetupChecklistItem[];
  readonly guildPermissions: bigint;
}

const GUILD_TEXT_CHANNEL_TYPE = 0;
const TEXT_CHANNEL_TYPES = new Set([GUILD_TEXT_CHANNEL_TYPE, 5, 15]);
const GUILD_READINESS_CONCURRENCY = 3;

export function filterAssignableCaseRoles(
  roles: readonly DiscordRole[],
  botRoleIds: readonly string[],
  guildId: string,
  channels: readonly DiscordChannel[] = [],
  verificationChannelId?: string | null
): DiscordRole[] {
  const botRoleIdSet = new Set(botRoleIds);
  const highestBotRolePosition = roles
    .filter((role) => botRoleIdSet.has(role.id))
    .reduce((highest, role) => Math.max(highest, role.position), -1);

  return roles.filter(
    (role) =>
      role.id !== guildId &&
      !role.managed &&
      !botRoleIdSet.has(role.id) &&
      parsePermissions(role.permissions) === 0n &&
      !hasUnrelatedCaseRoleChannelAllows(role.id, channels, verificationChannelId) &&
      role.position < highestBotRolePosition
  );
}

function hasUnrelatedCaseRoleChannelAllows(
  roleId: string,
  channels: readonly DiscordChannel[],
  verificationChannelId?: string | null
): boolean {
  return channels.some(
    (channel) =>
      channel.id !== verificationChannelId &&
      (channel.permission_overwrites ?? []).some(
        (overwrite) =>
          overwrite.type === 0 &&
          overwrite.id === roleId &&
          parsePermissions(overwrite.allow) !== 0n
      )
  );
}

export function filterPrivateAdminChannels(
  channels: readonly DiscordChannel[],
  roles: readonly DiscordRole[],
  guildId: string
): DiscordChannel[] {
  return channels.filter(
    (channel) =>
      channel.type === GUILD_TEXT_CHANNEL_TYPE &&
      !isChannelVisibleToEveryone(channel, roles, guildId)
  );
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

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

function isChannelVisibleToEveryone(
  channel: DiscordChannel,
  roles: readonly DiscordRole[],
  guildId: string
): boolean {
  const everyonePermissions = computeGuildPermissions({ guildId, roles, memberRoleIds: [] });
  const channelPermissions = computeChannelPermissions({
    guildId,
    userId: '',
    guildPermissions: everyonePermissions,
    memberRoleIds: [],
    overwrites: channel.permission_overwrites ?? [],
  });
  return hasPermission(channelPermissions, DISCORD_PERMISSIONS.ViewChannel);
}

function addCoreChannelChecklistItem(args: CoreChannelChecklistArgs) {
  const { channel, checklist, key, label } = args;
  if (!channel) {
    checklist.push(item(key, label, 'error', args.missingDetail));
    return;
  }
  if (channel.type !== GUILD_TEXT_CHANNEL_TYPE) {
    checklist.push(
      item(key, label, 'error', `${formatChannelName(channel)} must be a standard text channel.`)
    );
    return;
  }
  if (args.requirePrivate && isChannelVisibleToEveryone(channel, args.roles, args.guildId)) {
    checklist.push(
      item(
        key,
        label,
        'error',
        `${formatChannelName(channel)} is visible to @everyone. Choose a private moderator channel.`
      )
    );
    return;
  }

  checklist.push(
    hasRequiredChannelPermissions({
      guildId: args.guildId,
      botUserId: args.botUserId,
      botRoleIds: args.botRoleIds,
      roles: args.roles,
      channel,
      required: args.required,
    })
      ? item(key, label, 'ok', `${formatChannelName(channel)} ${args.successDetail}`)
      : item(key, label, 'error', `${formatChannelName(channel)} ${args.permissionErrorDetail}`)
  );
}

function addGuildPermissionChecklistItems(args: GuildPermissionChecklistArgs) {
  const { checklist, guildPermissions } = args;

  checklist.push(
    hasPermission(guildPermissions, DISCORD_PERMISSIONS.ManageRoles)
      ? item('manage-roles', 'Manage roles permission', 'ok', 'Drasil can assign the case role.')
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

  checklist.push(
    hasPermission(guildPermissions, DISCORD_PERMISSIONS.KickMembers)
      ? item(
          'kick-members',
          'Kick members permission',
          'ok',
          'Moderator kick actions can be executed.'
        )
      : item(
          'kick-members',
          'Kick members permission',
          'warning',
          'Kick actions will fail until Drasil has Kick Members.'
        )
  );

  checklist.push(
    hasPermission(guildPermissions, DISCORD_PERMISSIONS.ManageMessages)
      ? item(
          'manage-messages',
          'Manage messages permission',
          'ok',
          'Configured source-message deletion can run where channel permissions allow it.'
        )
      : item(
          'manage-messages',
          'Manage messages permission',
          'warning',
          'Message deletion will fail until Drasil has Manage Messages in the source channel.'
        )
  );
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

  addGuildPermissionChecklistItems({ checklist, guildPermissions });

  const caseRole = findRole(resources.roles, server?.case_role_id);
  const highestBotRolePosition = Math.max(
    -1,
    ...resources.roles.filter((role) => botRoleIds.includes(role.id)).map((role) => role.position)
  );
  if (!server?.case_role_id) {
    checklist.push(
      item(
        'case-role',
        'Case role',
        'error',
        'Choose the role Drasil applies while a user is under review.'
      )
    );
  } else if (!caseRole) {
    checklist.push(
      item('case-role', 'Case role', 'error', 'The configured case role no longer exists.')
    );
  } else if (caseRole.id === guild.id) {
    checklist.push(
      item('case-role', 'Case role', 'error', 'The @everyone role cannot be used as a case role.')
    );
  } else if (caseRole.managed) {
    checklist.push(
      item(
        'case-role',
        'Case role',
        'error',
        `${formatRoleName(caseRole)} is managed by an integration.`
      )
    );
  } else if (parsePermissions(caseRole.permissions) !== 0n) {
    checklist.push(
      item(
        'case-role',
        'Case role',
        'error',
        `${formatRoleName(caseRole)} grants server permissions. Use a dedicated permission-free role.`
      )
    );
  } else if (
    hasUnrelatedCaseRoleChannelAllows(
      caseRole.id,
      resources.channels,
      server?.verification_channel_id
    )
  ) {
    checklist.push(
      item(
        'case-role',
        'Case role',
        'error',
        `${formatRoleName(caseRole)} grants access outside the verification channel.`
      )
    );
  } else if (highestBotRolePosition <= caseRole.position) {
    checklist.push(
      item(
        'case-role',
        'Case role',
        'error',
        `Move Drasil's bot role above ${formatRoleName(caseRole)}.`
      )
    );
  } else {
    checklist.push(
      item('case-role', 'Case role', 'ok', `${formatRoleName(caseRole)} can be assigned by Drasil.`)
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

  addCoreChannelChecklistItem({
    checklist,
    guildId: guild.id,
    botUserId: resources.botUser.id,
    botRoleIds,
    roles: resources.roles,
    channel: adminChannel,
    required: adminRequired,
    key: 'admin-channel',
    label: 'Admin alert channel',
    missingDetail: 'Choose a channel for moderator notifications.',
    successDetail: 'is reachable.',
    permissionErrorDetail: 'is missing required bot permissions.',
    requirePrivate: true,
  });

  addCoreChannelChecklistItem({
    checklist,
    guildId: guild.id,
    botUserId: resources.botUser.id,
    botRoleIds,
    roles: resources.roles,
    channel: verificationChannel,
    required: verificationRequired,
    key: 'verification-channel',
    label: 'Verification channel',
    missingDetail: 'Choose a channel where private verification threads can be opened.',
    successDetail: 'can host case threads.',
    permissionErrorDetail: 'is missing thread or message permissions.',
  });

  checklist.push(
    reportChannel &&
      hasRequiredChannelPermissions({
        guildId: guild.id,
        botUserId: resources.botUser.id,
        botRoleIds,
        roles: resources.roles,
        channel: reportChannel,
        required: adminRequired,
      })
      ? isChannelVisibleToEveryone(reportChannel, resources.roles, guild.id)
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
            `${formatChannelName(reportChannel)} is not visible to @everyone.`
          )
      : reportChannel
        ? item(
            'report-channel',
            'Report instructions channel',
            'warning',
            `${formatChannelName(reportChannel)} is missing required bot permissions.`
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
          'One or more configured responder roles no longer exist.'
        )
  );

  const aiAction = server?.settings.report_ai_max_action ?? 'hints';
  checklist.push(
    aiAction === 'open_case'
      ? item(
          'report-ai-policy',
          'Report AI policy',
          'warning',
          'Report AI can recommend opening cases, but it can never auto-ban.'
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

function hasCoreConfiguration(server: SetupServerRecord | null, guildId: string): boolean {
  return Boolean(
    server?.is_active &&
    server.case_role_id &&
    server.case_role_id !== guildId &&
    server.admin_channel_id &&
    server.verification_channel_id
  );
}

export class SetupDashboardService {
  public constructor(
    private readonly adapter: SetupDataAdapter = createSetupDataAdapter(),
    private readonly clock: Clock = () => new Date()
  ) {}

  public async listManageableGuilds(accessToken: string): Promise<ManageableGuild[]> {
    const guilds = (await fetchDiscordGuilds(accessToken)).filter((guild) => {
      return canManageGuild(guild.permissions, guild.owner);
    });
    let botUser: DiscordUser | undefined;
    let botIdentityError: string | undefined;
    try {
      botUser = await fetchDiscordBotUser();
    } catch (error) {
      botIdentityError =
        error instanceof Error ? error.message : 'Unable to load Drasil bot identity.';
    }
    return mapWithConcurrency(guilds, GUILD_READINESS_CONCURRENCY, async (guild) => {
      const { dashboard } = await this.loadDashboard(guild, {
        botIdentityError,
        knownBotUser: botUser,
      });
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        readiness: dashboard.readiness,
      };
    });
  }

  public async assertCanManageGuild(
    guildId: string,
    accessToken: string
  ): Promise<DiscordGuildSummary> {
    const manageableGuild = (await fetchDiscordGuilds(accessToken)).find((guild) => {
      return guild.id === guildId && canManageGuild(guild.permissions, guild.owner);
    });
    if (!manageableGuild) {
      throw new Error('You do not have permission to manage this guild.');
    }
    return manageableGuild;
  }

  public async getDashboard(guildId: string, accessToken: string): Promise<SetupDashboardContext> {
    const manageableGuild = await this.assertCanManageGuild(guildId, accessToken);

    return this.loadDashboard(manageableGuild);
  }

  private async loadDashboard(
    manageableGuild: DiscordGuildSummary,
    options: LoadDashboardOptions = {}
  ): Promise<SetupDashboardContext> {
    const guildId = manageableGuild.id;

    const server = await this.adapter.getServer(guildId);
    let resources: DiscordGuildResources | null = null;
    let resourcesError: string | null = options.botIdentityError ?? null;
    let installed = true;
    if (!resourcesError) {
      try {
        resources = await fetchGuildResources(guildId, options.knownBotUser);
      } catch (error) {
        resourcesError =
          error instanceof Error ? error.message : 'Unable to load Discord resources.';
        installed =
          !(error instanceof DiscordApiError) || (error.status !== 403 && error.status !== 404);
      }
    }

    const checklist = buildChecklist({
      guild: manageableGuild,
      server,
      resources,
      resourcesError,
    });

    return {
      canApplySetup:
        manageableGuild.owner ||
        hasPermission(
          parsePermissions(manageableGuild.permissions),
          DISCORD_PERMISSIONS.Administrator
        ),
      dashboard: {
        guildId,
        guildName: manageableGuild.name,
        readiness: deriveSetupReadiness({
          installed,
          coreConfigured: hasCoreConfiguration(server, guildId),
          blockingErrorCount: checklist.filter((entry) => entry.status === 'error').length,
        }),
        dataProvider: this.adapter.provider,
        checkedAt: this.clock().toISOString(),
        checklist,
        server,
      },
      channels: (resources?.channels ?? []).filter((channel) =>
        TEXT_CHANNEL_TYPES.has(channel.type)
      ),
      roles: resources?.roles ?? [],
      botRoleIds: resources?.botMember.roles ?? [],
    };
  }

  public async updateGuildSetup(update: GuildSetupUpdate): Promise<SetupServerRecord> {
    return this.adapter.updateGuildSetup(update);
  }
}

export function createSetupDashboardService(): SetupDashboardService {
  const clock = isWebE2eFixtureMode() ? () => new Date(fixtureTimestampIso) : undefined;
  return new SetupDashboardService(createSetupDataAdapter(), clock);
}
