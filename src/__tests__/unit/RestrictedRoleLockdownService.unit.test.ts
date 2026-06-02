import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { RestrictedRoleLockdownService } from '../../services/RestrictedRoleLockdownService';

describe('RestrictedRoleLockdownService (unit)', () => {
  const restrictedRoleId = 'restricted-role-1';
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
    options: { allow?: readonly bigint[]; deny?: readonly bigint[] } = {}
  ) => {
    const allowFlags = new Set(options.allow ?? []);
    const denyFlags = new Set(options.deny ?? []);
    return {
      id: restrictedRoleId,
      allow: { has: jest.fn((permission: bigint) => allowFlags.has(permission)) },
      deny: { has: jest.fn((permission: bigint) => denyFlags.has(permission)) },
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
    restrictedOverwrite?: ReturnType<typeof createOverwrite>;
  }) => {
    const restrictedOverwrite = options.restrictedOverwrite ?? createOverwrite();
    const cache = new Map([[restrictedRoleId, restrictedOverwrite]]);
    return {
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
      },
      permissionsFor: jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) }),
    };
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
    const restrictedRole = {
      id: restrictedRoleId,
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
        fetch: jest.fn().mockResolvedValue(restrictedRole),
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
      restricted_role_id: restrictedRoleId,
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
    const service = new RestrictedRoleLockdownService(createConfigService() as any);

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
    const service = new RestrictedRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1');

    expect(report.errorCount).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toContain(
      'lockdown-allowed-channel-synced-under-denied-category'
    );
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
    const service = new RestrictedRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1');

    expect(report.appliedActions.map((action) => action.channelId)).toEqual([
      'category-1',
      'channel-1',
    ]);
    expect(category.permissionOverwrites.edit).toHaveBeenCalledWith(
      restrictedRoleId,
      expect.objectContaining({ ViewChannel: false, SendMessages: false }),
      expect.objectContaining({ reason: expect.stringContaining('admin-1') })
    );
    expect(unsyncedChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      restrictedRoleId,
      expect.objectContaining({ ViewChannel: false, SendMessages: false }),
      expect.any(Object)
    );
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      restricted_lockdown_enabled: true,
    });
  });

  it('marks lockdown enabled when no overwrite writes are needed', async () => {
    const category = createChannel({
      id: 'category-1',
      name: 'public',
      type: ChannelType.GuildCategory,
      restrictedOverwrite: createOverwrite({ deny: lockdownDenyPermissions }),
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([category, verificationChannel]);
    const configService = createConfigService();
    const service = new RestrictedRoleLockdownService(configService as any);

    const report = await service.applyGuild(guild, 'admin-1');

    expect(report.enabled).toBe(true);
    expect(report.appliedActions).toEqual([]);
    expect(category.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      restricted_lockdown_enabled: true,
    });
  });
});
