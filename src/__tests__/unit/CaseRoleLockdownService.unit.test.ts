import { ChannelType, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { CaseRoleLockdownService } from '../../services/CaseRoleLockdownService';

describe('CaseRoleLockdownService (unit)', () => {
  const caseRoleId = 'case-role-1';
  const lockdownDenyPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
  ];

  const createOverwrite = (
    options: {
      id?: string;
      type?: OverwriteType;
      allow?: readonly bigint[];
      deny?: readonly bigint[];
    } = {}
  ) => {
    const allowFlags = new Set(options.allow ?? []);
    const denyFlags = new Set(options.deny ?? []);
    return {
      id: options.id ?? caseRoleId,
      type: options.type ?? OverwriteType.Role,
      allow: { has: jest.fn((permission: bigint) => allowFlags.has(permission)), bitfield: 0n },
      deny: { has: jest.fn((permission: bigint) => denyFlags.has(permission)), bitfield: 0n },
      setDeny(permission: bigint): void {
        denyFlags.add(permission);
      },
    };
  };

  const createChannel = (options: {
    id: string;
    name: string;
    type: ChannelType;
    parentId?: string | null;
    permissionsLocked?: boolean | null;
    caseRoleOverwrite?: ReturnType<typeof createOverwrite>;
    extraOverwrites?: readonly ReturnType<typeof createOverwrite>[];
    keepPermissionsLockedAfterSet?: boolean;
    overwriteSetError?: Error;
  }) => {
    const caseRoleOverwrite = options.caseRoleOverwrite ?? createOverwrite();
    const cache = new Map([
      [caseRoleId, caseRoleOverwrite],
      ...(options.extraOverwrites ?? []).map((overwrite) => [overwrite.id, overwrite] as const),
    ]);
    const channel = {
      id: options.id,
      name: options.name,
      type: options.type,
      parentId: options.parentId ?? null,
      permissionsLocked: options.permissionsLocked ?? null,
      permissionOverwrites: {
        cache,
        edit: jest.fn().mockImplementation((targetRoleId: string) => {
          const overwrite = cache.get(targetRoleId) ?? createOverwrite();
          for (const permission of lockdownDenyPermissions) {
            overwrite.setDeny(permission);
          }
          cache.set(targetRoleId, overwrite);
          return Promise.resolve(undefined);
        }),
        set: jest.fn().mockImplementation(() => {
          if (options.overwriteSetError) {
            return Promise.reject(options.overwriteSetError);
          }
          if (!options.keepPermissionsLockedAfterSet) {
            channel.permissionsLocked = false;
          }
          return Promise.resolve(undefined);
        }),
      },
      permissionsFor: jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) }),
    };

    return channel;
  };

  const createGuild = (channels: readonly ReturnType<typeof createChannel>[]) => {
    const botMember = {
      permissions: {
        has: jest.fn().mockReturnValue(true),
      },
      roles: {
        highest: {
          comparePositionTo: jest.fn().mockReturnValue(1),
        },
      },
    };
    const caseRole = {
      id: caseRoleId,
      managed: false,
      permissions: {
        has: jest.fn().mockReturnValue(false),
      },
    };
    return {
      id: 'guild-1',
      members: {
        me: botMember,
        fetchMe: jest.fn(),
      },
      roles: {
        everyone: { id: 'everyone-role' },
        cache: new Map(),
        fetch: jest.fn().mockResolvedValue(caseRole),
      },
      channels: {
        fetch: jest
          .fn()
          .mockResolvedValue(new Map(channels.map((channel) => [channel.id, channel]))),
      },
    } as any;
  };

  const createConfigService = (settings: Record<string, unknown> = {}) => ({
    getServerConfig: jest.fn().mockResolvedValue({
      guild_id: 'guild-1',
      case_role_id: caseRoleId,
      verification_channel_id: 'verification-channel-1',
      settings,
    }),
    updateServerSettings: jest.fn().mockResolvedValue({}),
  });

  it('plans category denies and unsynced channel denies while skipping synced children', async () => {
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
    });
    const unsyncedChannel = createChannel({
      id: 'channel-1',
      name: 'general',
      type: ChannelType.GuildText,
      parentId: 'category-1',
      permissionsLocked: false,
    });
    const syncedChannel = createChannel({
      id: 'channel-2',
      name: 'memes',
      type: ChannelType.GuildText,
      parentId: 'category-1',
      permissionsLocked: true,
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([category, unsyncedChannel, syncedChannel, verificationChannel]);
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const report = await service.auditGuild(guild);

    expect(report.plannedActions.map((action) => action.channelId)).toEqual([
      'category-1',
      'channel-1',
    ]);
    expect(report.plannedActions.map((action) => action.channelId)).not.toContain('channel-2');
    expect(report.plannedActions.map((action) => action.channelId)).not.toContain(
      'verification-channel-1'
    );
  });

  it('blocks apply when an allowed channel is synced under a denied category', async () => {
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      parentId: 'category-1',
      permissionsLocked: true,
    });
    const guild = createGuild([category, verificationChannel]);
    const configService = createConfigService();
    const service = new CaseRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1');

    expect(report.errorCount).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toContain(
      'lockdown-allowed-channel-synced-under-denied-category'
    );
    expect(category.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
  });

  it('unsyncs allowed channels only when explicitly confirmed', async () => {
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      parentId: 'category-1',
      permissionsLocked: true,
    });
    const guild = createGuild([category, verificationChannel]);
    const configService = createConfigService();
    const service = new CaseRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1', { unsyncAllowedChannels: true });

    expect(verificationChannel.permissionOverwrites.set).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: caseRoleId, ViewChannel: true, SendMessages: true }),
      ]),
      expect.stringContaining('admin-1')
    );
    expect(category.permissionOverwrites.edit).toHaveBeenCalledWith(
      caseRoleId,
      expect.objectContaining({ ViewChannel: false, SendMessages: false }),
      expect.any(Object)
    );
    expect(report.errorCount).toBe(0);
    expect(report.unsyncedAllowedChannels.map((action) => action.channelId)).toEqual([
      'verification-channel-1',
    ]);
    expect(report.appliedActions.map((action) => action.channelId)).toEqual(['category-1']);
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      case_role_lockdown_enabled: true,
    });
  });

  it('continues apply when the immediate re-audit still marks a just-unsynced channel locked', async () => {
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      parentId: 'category-1',
      permissionsLocked: true,
      keepPermissionsLockedAfterSet: true,
    });
    const guild = createGuild([category, verificationChannel]);
    const configService = createConfigService();
    const service = new CaseRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1', { unsyncAllowedChannels: true });

    expect(verificationChannel.permissionOverwrites.set).toHaveBeenCalled();
    expect(category.permissionOverwrites.edit).toHaveBeenCalledWith(
      caseRoleId,
      expect.objectContaining({ ViewChannel: false, SendMessages: false }),
      expect.any(Object)
    );
    expect(report.errorCount).toBe(0);
    expect(report.syncedAllowedChannels).toEqual([]);
    expect(report.unsyncedAllowedChannels.map((action) => action.channelId)).toEqual([
      'verification-channel-1',
    ]);
    expect(report.appliedActions.map((action) => action.channelId)).toEqual(['category-1']);
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      case_role_lockdown_enabled: true,
    });
  });

  it('does not report successfully unsynced channels as synced when another unsync fails', async () => {
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
    });
    const successfulAllowedChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      parentId: 'category-1',
      permissionsLocked: true,
      keepPermissionsLockedAfterSet: true,
    });
    const failedAllowedChannel = createChannel({
      id: 'report-channel-1',
      name: 'reports',
      type: ChannelType.GuildText,
      parentId: 'category-1',
      permissionsLocked: true,
      overwriteSetError: new Error('Missing Permissions'),
    });
    const guild = createGuild([category, successfulAllowedChannel, failedAllowedChannel]);
    const configService = createConfigService({
      report_instructions_channel_id: 'report-channel-1',
    });
    const service = new CaseRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1', { unsyncAllowedChannels: true });

    expect(successfulAllowedChannel.permissionOverwrites.set).toHaveBeenCalled();
    expect(failedAllowedChannel.permissionOverwrites.set).toHaveBeenCalled();
    expect(report.unsyncedAllowedChannels.map((action) => action.channelId)).toEqual([
      'verification-channel-1',
    ]);
    expect(report.syncedAllowedChannels.map((action) => action.channelId)).toEqual([
      'report-channel-1',
    ]);
    expect(report.failedActions.map((action) => action.channelId)).toEqual(['report-channel-1']);
    expect(category.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
  });

  it('applies missing lockdown denies and marks lockdown enabled', async () => {
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
    });
    const unsyncedChannel = createChannel({
      id: 'channel-1',
      name: 'general',
      type: ChannelType.GuildText,
      parentId: 'category-1',
      permissionsLocked: false,
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([category, unsyncedChannel, verificationChannel]);
    const configService = createConfigService();
    const service = new CaseRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1');

    expect(report.appliedActions.map((action) => action.channelId)).toEqual([
      'category-1',
      'channel-1',
    ]);
    expect(category.permissionOverwrites.edit).toHaveBeenCalledWith(
      caseRoleId,
      expect.objectContaining({ ViewChannel: false, SendMessages: false }),
      expect.objectContaining({ reason: expect.stringContaining('admin-1') })
    );
    expect(unsyncedChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      caseRoleId,
      expect.objectContaining({ ViewChannel: false, SendMessages: false }),
      expect.any(Object)
    );
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      case_role_lockdown_enabled: true,
    });
  });

  it('marks lockdown enabled when no overwrite writes are needed', async () => {
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
      caseRoleOverwrite: createOverwrite({ deny: lockdownDenyPermissions }),
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([category, verificationChannel]);
    const configService = createConfigService();
    const service = new CaseRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1');

    expect(report.enabled).toBe(true);
    expect(report.appliedActions).toEqual([]);
    expect(category.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      case_role_lockdown_enabled: true,
    });
  });

  it('formats member overwrite conflicts as user mentions', async () => {
    const memberOverwrite = {
      ...createOverwrite({ allow: [PermissionFlagsBits.ViewChannel] }),
      id: 'user-1',
      type: OverwriteType.Member,
    };
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
      extraOverwrites: [memberOverwrite],
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([category, verificationChannel]);
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const report = await service.auditGuild(guild);

    expect(report.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'explicit View Channel allow for <@user-1>. That user may still see it despite the case-role deny, but no explicit posting allow was detected.'
        ),
      ])
    );
  });

  it('reports posting-bypass warnings when another role can send despite case-role denies', async () => {
    const humanRoleOverwrite = createOverwrite({
      id: 'human-role-1',
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
      caseRoleOverwrite: createOverwrite({ deny: lockdownDenyPermissions }),
      extraOverwrites: [humanRoleOverwrite],
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([category, verificationChannel]);
    guild.roles.cache = new Map([['human-role-1', { id: 'human-role-1', managed: false }]]);
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const report = await service.auditGuild(guild);

    expect(report.plannedActions).toEqual([]);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'lockdown-conflicting-send-allow',
          message: expect.stringContaining(
            'explicit Send Messages allow for <@&human-role-1>. Users with that role may still post there despite the case-role deny'
          ),
        }),
      ])
    );
    expect(report.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'lockdown-conflicting-view-allow' })])
    );
  });

  it('suppresses noisy allow warnings for everyone and managed bot roles', async () => {
    const everyoneOverwrite = createOverwrite({
      id: 'everyone-role',
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel],
    });
    const managedBotOverwrite = createOverwrite({
      id: 'bot-role-1',
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel],
    });
    const humanRoleOverwrite = createOverwrite({
      id: 'human-role-1',
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel],
    });
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
      extraOverwrites: [everyoneOverwrite, managedBotOverwrite, humanRoleOverwrite],
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([category, verificationChannel]);
    guild.roles.cache = new Map([
      ['bot-role-1', { id: 'bot-role-1', managed: true }],
      ['human-role-1', { id: 'human-role-1', managed: false }],
    ]);
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const report = await service.auditGuild(guild);

    const messages = report.issues.map((issue) => issue.message);
    expect(messages).not.toEqual(
      expect.arrayContaining([expect.stringContaining('@&everyone-role')])
    );
    expect(messages).not.toEqual(expect.arrayContaining([expect.stringContaining('@&bot-role-1')]));
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'explicit View Channel allow for <@&human-role-1>. Users with that role may still see it despite the case-role deny, but no explicit posting allow was detected.'
        ),
      ])
    );
  });
});
