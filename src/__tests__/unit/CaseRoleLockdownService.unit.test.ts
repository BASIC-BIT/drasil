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
  const recoveryParentDeniedPermissions = [
    PermissionFlagsBits.CreateInstantInvite,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
  ];
  const recoveryParentAllowedPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessagesInThreads,
  ];
  const permissionFlagsByOption = {
    CreateInstantInvite: PermissionFlagsBits.CreateInstantInvite,
    ViewChannel: PermissionFlagsBits.ViewChannel,
    ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
    SendMessages: PermissionFlagsBits.SendMessages,
    SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads,
    CreatePublicThreads: PermissionFlagsBits.CreatePublicThreads,
    CreatePrivateThreads: PermissionFlagsBits.CreatePrivateThreads,
    Connect: PermissionFlagsBits.Connect,
    Speak: PermissionFlagsBits.Speak,
  } as const;

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
        allowFlags.delete(permission);
      },
      setAllow(permission: bigint): void {
        allowFlags.add(permission);
        denyFlags.delete(permission);
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
    effectiveMemberPermissions?: readonly bigint[];
    keepPermissionsLockedAfterSet?: boolean;
    overwriteSetError?: Error;
  }) => {
    const caseRoleOverwrite =
      options.caseRoleOverwrite ??
      createOverwrite({
        allow:
          options.id === 'verification-channel-1' ? recoveryParentAllowedPermissions : undefined,
        deny: options.id === 'verification-channel-1' ? recoveryParentDeniedPermissions : undefined,
      });
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
        edit: jest.fn().mockImplementation((targetRoleId: string, permissionOptions: object) => {
          const overwrite = cache.get(targetRoleId) ?? createOverwrite();
          for (const [option, value] of Object.entries(permissionOptions)) {
            const permission =
              permissionFlagsByOption[option as keyof typeof permissionFlagsByOption];
            if (value === true) {
              overwrite.setAllow(permission);
            } else if (value === false) {
              overwrite.setDeny(permission);
            }
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
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn((permission: bigint) =>
          (
            options.effectiveMemberPermissions ??
            (options.id === 'verification-channel-1' ? recoveryParentAllowedPermissions : [])
          ).includes(permission)
        ),
      }),
      threads: {
        fetchArchived: jest.fn().mockResolvedValue({ threads: new Map() }),
      },
    };

    return channel;
  };

  const createGuild = (channels: readonly ReturnType<typeof createChannel>[]) => {
    const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
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
        fetch: jest.fn().mockImplementation((channelId?: string) =>
          Promise.resolve(
            channelId
              ? channelId === 'recovery-thread-1'
                ? {
                    id: channelId,
                    parentId: 'verification-channel-1',
                    name: 'recovery-thread',
                    type: ChannelType.PrivateThread,
                    archived: false,
                    locked: false,
                    isThread: () => true,
                    permissionsFor: jest.fn().mockReturnValue({
                      has: jest.fn((permission: bigint) =>
                        [
                          PermissionFlagsBits.ViewChannel,
                          PermissionFlagsBits.SendMessagesInThreads,
                        ].includes(permission)
                      ),
                    }),
                    members: {
                      cache: new Map([['user-1', {}]]),
                      fetch: jest.fn().mockResolvedValue(new Map([['user-1', {}]])),
                    },
                  }
                : (channelMap.get(channelId) ?? null)
              : channelMap
          )
        ),
        fetchActiveThreads: jest.fn().mockResolvedValue({ threads: new Map() }),
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

  it('repairs a writable recovery parent while preserving private-thread replies', async () => {
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      caseRoleOverwrite: createOverwrite(),
    });
    const guild = createGuild([verificationChannel]);
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const preview = await service.auditGuild(guild);
    expect(preview.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'lockdown-recovery-parent-permissions-invalid' }),
      ])
    );
    expect(preview.plannedActions.map((action) => action.channelId)).toEqual([
      'verification-channel-1',
    ]);

    const applied = await service.applyGuild(guild, 'admin-1');
    expect(verificationChannel.permissionOverwrites.edit).toHaveBeenCalledWith(
      caseRoleId,
      expect.objectContaining({
        CreateInstantInvite: false,
        ViewChannel: true,
        SendMessages: false,
        SendMessagesInThreads: true,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
      }),
      expect.any(Object)
    );
    expect(applied.plannedActions).toEqual([]);
  });

  it('repairs a recovery parent that blocks posting but cannot support recovery-thread replies', async () => {
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      caseRoleOverwrite: createOverwrite({ deny: recoveryParentDeniedPermissions }),
    });
    const guild = createGuild([verificationChannel]);
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const preview = await service.auditGuild(guild);

    expect(preview.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'lockdown-recovery-parent-permissions-invalid',
          message: expect.stringContaining(
            'allow View Channel, Read Message History, Send Messages in Threads'
          ),
        }),
      ])
    );
    expect(preview.plannedActions.map((action) => action.channelId)).toEqual([
      'verification-channel-1',
    ]);
  });

  it('reports effective member posting access in the recovery parent as a bypass', async () => {
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      effectiveMemberPermissions: [
        ...recoveryParentAllowedPermissions,
        PermissionFlagsBits.SendMessages,
      ],
    });
    const guild = createGuild([verificationChannel]);
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map([[caseRoleId, { id: caseRoleId }]]) },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const audit = await service.auditMemberBypasses(member);

    expect(audit.bypasses).toEqual([
      expect.objectContaining({
        channelId: 'verification-channel-1',
        subjectId: 'user-1',
        permissions: ['Send Messages'],
      }),
    ]);
  });

  it('audits a persisted quarantine role after the configured role changes', async () => {
    const persistedRoleId = 'persisted-case-role';
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([verificationChannel]);
    const persistedRole = {
      id: persistedRoleId,
      managed: false,
      permissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.Administrator),
      },
    };
    guild.roles.fetch.mockImplementation((roleId: string) =>
      Promise.resolve(roleId === persistedRoleId ? persistedRole : null)
    );
    guild.roles.cache.set(persistedRoleId, persistedRole);
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map([[persistedRoleId, persistedRole]]) },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const report = await service.auditGuild(guild, null, persistedRoleId);
    const memberAudit = await service.auditMemberBypasses(member, new Set(), null, persistedRoleId);

    expect(guild.roles.fetch).toHaveBeenCalledWith(persistedRoleId);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'lockdown-case-role-global-permissions' }),
      ])
    );
    expect(memberAudit.retainedAdministratorRoleIds).toEqual([]);
    expect(memberAudit.retainedPrivilegedRoleIds).toEqual([]);
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

  it('warns when the case role has a compromised-account privilege', async () => {
    const guild = createGuild([]);
    guild.roles.fetch.mockResolvedValue({
      id: caseRoleId,
      managed: false,
      permissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ManageThreads),
      },
    });
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const report = await service.auditGuild(guild);

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'lockdown-case-role-global-permissions',
          message: expect.stringContaining('Manage Threads'),
        }),
      ])
    );
  });

  it('blocks containment when the auto-allowed report surface remains writable', async () => {
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const reportChannel = createChannel({
      id: 'report-channel-1',
      name: 'report',
      type: ChannelType.GuildText,
      effectiveMemberPermissions: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
      ],
    });
    const guild = createGuild([verificationChannel, reportChannel]);
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map([[caseRoleId, { id: caseRoleId }]]) },
    } as any;
    const service = new CaseRoleLockdownService(
      createConfigService({ report_instructions_channel_id: 'report-channel-1' }) as any
    );

    const audit = await service.auditMemberBypasses(member, new Set(), 'recovery-thread-1');

    expect(audit.bypasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: 'report-channel-1',
          permissions: ['Send Messages', 'Send Messages in Threads'],
        }),
      ])
    );
  });

  it('blocks containment when effective recovery permissions are missing', async () => {
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      effectiveMemberPermissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessagesInThreads,
      ],
    });
    const guild = createGuild([verificationChannel]);
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map([[caseRoleId, { id: caseRoleId }]]) },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const context = { siblingThreadsByParentId: new Map() };
    const audit = await service.auditMemberBypasses(
      member,
      new Set(),
      'recovery-thread-1',
      undefined,
      context
    );
    await service.auditMemberBypasses(member, new Set(), 'recovery-thread-1', undefined, context);

    expect(audit.bypasses).toEqual([
      expect.objectContaining({
        channelId: 'verification-channel-1',
        permissions: ['Missing Read Message History'],
      }),
    ]);
  });

  it('blocks containment when the persisted private recovery thread is unusable', async () => {
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([verificationChannel]);
    const originalFetch = guild.channels.fetch.getMockImplementation();
    guild.channels.fetch.mockImplementation((channelId?: string) => {
      if (channelId !== 'recovery-thread-1') {
        return originalFetch?.(channelId);
      }
      return Promise.resolve({
        id: channelId,
        parentId: verificationChannel.id,
        name: 'recovery-thread',
        type: ChannelType.PrivateThread,
        archived: false,
        locked: true,
        isThread: () => true,
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ViewChannel),
        }),
        members: {
          cache: new Map(),
          fetch: jest.fn().mockResolvedValue(new Map()),
        },
      });
    });
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map([[caseRoleId, { id: caseRoleId }]]) },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const audit = await service.auditMemberBypasses(member, new Set(), 'recovery-thread-1');

    expect(audit.bypasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: 'recovery-thread-1',
          permissions: expect.arrayContaining([
            'Recovery thread locked',
            'Missing Send Messages in Threads',
            'Missing private thread membership',
          ]),
        }),
      ])
    );
  });

  it('audits the persisted recovery thread parent instead of the current configured channel', async () => {
    const configuredChannel = createChannel({
      id: 'verification-channel-1',
      name: 'new-verification',
      type: ChannelType.GuildText,
    });
    const actualParent = createChannel({
      id: 'admin-fallback-channel',
      name: 'admin-fallback',
      type: ChannelType.GuildText,
      effectiveMemberPermissions: [PermissionFlagsBits.ViewChannel],
    });
    const guild = createGuild([configuredChannel, actualParent]);
    guild.channels.fetch.mockImplementation((channelId?: string) => {
      if (!channelId) {
        return Promise.resolve(
          new Map([
            [configuredChannel.id, configuredChannel],
            [actualParent.id, actualParent],
          ])
        );
      }
      if (channelId === 'recovery-thread-1') {
        return Promise.resolve({
          id: channelId,
          parentId: actualParent.id,
          name: 'recovery-thread',
          type: ChannelType.PrivateThread,
          archived: false,
          locked: false,
          isThread: () => true,
          permissionsFor: jest.fn().mockReturnValue({
            has: jest.fn((permission: bigint) =>
              [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads].includes(
                permission
              )
            ),
          }),
          members: {
            cache: new Map([['user-1', {}]]),
            fetch: jest.fn().mockResolvedValue(new Map([['user-1', {}]])),
          },
        });
      }
      return Promise.resolve(channelId === actualParent.id ? actualParent : configuredChannel);
    });
    guild.channels.fetchActiveThreads.mockResolvedValue({
      threads: new Map([
        [
          'configured-parent-sibling',
          {
            id: 'configured-parent-sibling',
            name: 'configured-parent-sibling',
            parentId: configuredChannel.id,
            type: ChannelType.PublicThread,
          },
        ],
      ]),
    });
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map([[caseRoleId, { id: caseRoleId }]]) },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const [guildAudit, memberAudit] = await Promise.all([
      service.auditGuild(guild, 'recovery-thread-1'),
      service.auditMemberBypasses(member, new Set(), 'recovery-thread-1'),
    ]);

    expect(guildAudit.autoAllowedChannelIds).toContain(actualParent.id);
    expect(guildAudit.plannedActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ channelId: actualParent.id })])
    );
    expect(memberAudit.bypasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: actualParent.id,
          permissions: expect.arrayContaining([
            'Missing Read Message History',
            'Missing Send Messages in Threads',
          ]),
        }),
        expect.objectContaining({
          channelId: 'configured-parent-sibling',
          permissions: ['Send Messages in Threads'],
        }),
      ])
    );
  });

  it('blocks containment when the recovery parent has an active public sibling thread', async () => {
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([verificationChannel]);
    guild.channels.fetchActiveThreads.mockResolvedValue({
      threads: new Map<string, any>([
        [
          'recovery-thread-1',
          {
            id: 'recovery-thread-1',
            name: 'recovery',
            parentId: 'verification-channel-1',
            type: ChannelType.PrivateThread,
          },
        ],
        [
          'public-sibling-thread',
          {
            id: 'public-sibling-thread',
            name: 'public-sibling',
            parentId: 'verification-channel-1',
            type: ChannelType.PublicThread,
          },
        ],
        [
          'private-sibling-thread',
          {
            id: 'private-sibling-thread',
            name: 'private-sibling',
            parentId: 'verification-channel-1',
            type: ChannelType.PrivateThread,
            members: {
              cache: new Map([['user-1', { id: 'user-1' }]]),
              fetch: jest.fn(),
            },
          },
        ],
      ]),
    });
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map([[caseRoleId, { id: caseRoleId }]]) },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const audit = await service.auditMemberBypasses(member, new Set(), 'recovery-thread-1');

    expect(audit.bypasses).toEqual([
      expect.objectContaining({
        channelId: 'public-sibling-thread',
        subjectId: 'user-1',
        permissions: ['Send Messages in Threads'],
      }),
      expect.objectContaining({
        channelId: 'private-sibling-thread',
        subjectId: 'user-1',
        permissions: ['Send Messages in Threads'],
      }),
    ]);
  });

  it('blocks containment when the recovery parent has archived sibling threads', async () => {
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const privateMembers = new Map([['user-1', { id: 'user-1' }]]);
    verificationChannel.threads.fetchArchived.mockImplementation(({ type }) =>
      Promise.resolve({
        threads:
          type === 'public'
            ? new Map([
                [
                  'archived-public-sibling',
                  {
                    id: 'archived-public-sibling',
                    name: 'archived-public',
                    parentId: 'verification-channel-1',
                    type: ChannelType.PublicThread,
                    archived: true,
                    locked: false,
                  },
                ],
                [
                  'locked-archived-public-sibling',
                  {
                    id: 'locked-archived-public-sibling',
                    name: 'locked-archived-public',
                    parentId: 'verification-channel-1',
                    type: ChannelType.PublicThread,
                    archived: true,
                    locked: true,
                  },
                ],
              ])
            : new Map([
                [
                  'archived-private-sibling',
                  {
                    id: 'archived-private-sibling',
                    name: 'archived-private',
                    parentId: 'verification-channel-1',
                    type: ChannelType.PrivateThread,
                    archived: true,
                    locked: false,
                    members: { cache: privateMembers, fetch: jest.fn() },
                  },
                ],
                [
                  'locked-archived-private-sibling',
                  {
                    id: 'locked-archived-private-sibling',
                    name: 'locked-archived-private',
                    parentId: 'verification-channel-1',
                    type: ChannelType.PrivateThread,
                    archived: true,
                    locked: true,
                    members: { cache: privateMembers, fetch: jest.fn() },
                  },
                ],
              ]),
      })
    );
    const guild = createGuild([verificationChannel]);
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map([[caseRoleId, { id: caseRoleId }]]) },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const audit = await service.auditMemberBypasses(member, new Set(), 'recovery-thread-1');

    expect(verificationChannel.threads.fetchArchived).toHaveBeenCalledWith({
      type: 'public',
      fetchAll: true,
    });
    expect(verificationChannel.threads.fetchArchived).toHaveBeenCalledWith({
      type: 'private',
      fetchAll: true,
    });
    expect(verificationChannel.threads.fetchArchived).toHaveBeenCalledTimes(2);
    expect(guild.channels.fetchActiveThreads).toHaveBeenCalledTimes(1);
    expect(audit.bypasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channelId: 'archived-public-sibling' }),
        expect.objectContaining({ channelId: 'archived-private-sibling' }),
      ])
    );
    expect(audit.bypasses).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channelId: 'locked-archived-public-sibling' }),
        expect.objectContaining({ channelId: 'locked-archived-private-sibling' }),
      ])
    );
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
        expect.objectContaining({
          id: caseRoleId,
          ViewChannel: true,
          SendMessages: false,
          SendMessagesInThreads: true,
        }),
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

  it('reports posting-bypass warnings when another role can send in threads', async () => {
    const humanRoleOverwrite = createOverwrite({
      id: 'human-role-1',
      type: OverwriteType.Role,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads],
    });
    const forumChannel = createChannel({
      id: 'forum-channel-1',
      name: 'introductions',
      type: ChannelType.GuildForum,
      caseRoleOverwrite: createOverwrite({ deny: lockdownDenyPermissions }),
      extraOverwrites: [humanRoleOverwrite],
    });
    const verificationChannel = createChannel({
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
    });
    const guild = createGuild([forumChannel, verificationChannel]);
    guild.roles.cache = new Map([['human-role-1', { id: 'human-role-1', managed: false }]]);
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const report = await service.auditGuild(guild);

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'lockdown-conflicting-send-allow',
          message: expect.stringContaining(
            'explicit Send Messages in Threads allow for <@&human-role-1>. Users with that role may still post there despite the case-role deny'
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

  it('reports guild ownership and everyone Administrator as unremovable privilege blockers', async () => {
    const guild = createGuild([]);
    guild.ownerId = 'user-1';
    guild.roles.cache.set('guild-1', {
      id: 'guild-1',
      permissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.Administrator),
      },
    });
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map() },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const audit = await service.auditMemberBypasses(member);

    expect(audit.unremovablePrivilegeReasons).toEqual([
      'guild_owner',
      'everyone_privileged_permissions:Administrator',
    ]);
  });

  it('reports non-Administrator dangerous everyone permissions as containment blockers', async () => {
    const guild = createGuild([]);
    guild.roles.cache.set('guild-1', {
      id: 'guild-1',
      permissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ManageWebhooks),
      },
    });
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map() },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const audit = await service.auditMemberBypasses(member);

    expect(audit.unremovablePrivilegeReasons).toEqual([
      'everyone_privileged_permissions:Manage Webhooks',
    ]);
  });

  it('reports granular expression and event creation permissions as containment blockers', async () => {
    const guild = createGuild([]);
    guild.roles.cache.set('guild-1', {
      id: 'guild-1',
      permissions: {
        has: jest.fn(
          (permission: bigint) =>
            permission === PermissionFlagsBits.CreateGuildExpressions ||
            permission === PermissionFlagsBits.CreateEvents
        ),
      },
    });
    const member = {
      id: 'user-1',
      guild,
      roles: { cache: new Map() },
    } as any;
    const service = new CaseRoleLockdownService(createConfigService() as any);

    const audit = await service.auditMemberBypasses(member);

    expect(audit.unremovablePrivilegeReasons).toEqual([
      'everyone_privileged_permissions:Create Expressions, Create Events',
    ]);
  });
});
