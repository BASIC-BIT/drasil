import { MessageFlags, PermissionFlagsBits, User } from 'discord.js';
import { MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY } from '../../utils/detectionResponseSettings';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler moderation commands (unit)', () => {
  it('handles /audit ignore-detection for users with Manage Server permission', async () => {
    const excludeDetectionFromAccounting = jest.fn().mockResolvedValue({ id: 'det-1' });
    const { handler, securityActionService } = buildHandler({ excludeDetectionFromAccounting });

    const interaction = {
      commandName: 'audit',
      guild: { id: 'guild-1' },
      channelId: 'channel-1',
      user: { id: 'admin-1' },
      memberPermissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ManageGuild),
      },
      options: {
        getSubcommand: jest.fn().mockReturnValue('ignore-detection'),
        getString: jest.fn((name: string) =>
          name === 'detection-id' ? 'det-1' : 'testing false positive'
        ),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.excludeDetectionFromAccounting).toHaveBeenCalledWith(
      'guild-1',
      'det-1',
      interaction.user,
      'testing false positive'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Detection det-1 is now ignored for future accounting.',
    });
  });

  it('denies /ban when user lacks BanMembers permission', async () => {
    const banUser = jest.fn().mockResolvedValue(true);
    const { handler, userModerationService } = buildHandler({ banUser });

    const invoker: User = { id: 'user-1' } as User;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;

    const guild = {
      members: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const interaction = {
      commandName: 'ban',
      user: invoker,
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(false),
      },
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(userModerationService.banUser).not.toHaveBeenCalled();
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You need Ban Members permission to use this command.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('falls back to permissionsIn when memberPermissions is null', async () => {
    const banUser = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: { [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: true },
    });
    const { handler, userModerationService } = buildHandler({ banUser, getServerConfig });

    const invoker: User = { id: 'user-1' } as User;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;

    const permissionsIn = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true),
    });
    const invokingMember = {
      permissionsIn,
    } as any;

    const guild = {
      id: 'guild-1',
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
        fetch: jest.fn().mockImplementation(async (id: string) => {
          if (id === invoker.id) return invokingMember;
          if (id === targetUser.id) return targetMember;
          return null;
        }),
      },
    } as any;

    const interaction = {
      commandName: 'ban',
      user: invoker,
      guild,
      channelId: 'channel-1',
      memberPermissions: null,
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('reason'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(permissionsIn).toHaveBeenCalledWith('channel-1');
    expect(userModerationService.banUser).toHaveBeenCalledWith(targetMember, 'reason', invoker);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: `User ${targetUser.tag} has been banned.`,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('allows /ban for users with BanMembers permission', async () => {
    const banUser = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: { [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: true },
    });
    const { handler, userModerationService } = buildHandler({ banUser, getServerConfig });

    const invoker: User = { id: 'user-1' } as User;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;

    const guild = {
      id: 'guild-1',
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
        fetch: jest.fn().mockResolvedValue(targetMember),
      },
    } as any;

    const interaction = {
      commandName: 'ban',
      user: invoker,
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('reason'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).toHaveBeenCalledWith(targetUser.id);
    expect(userModerationService.banUser).toHaveBeenCalledWith(targetMember, 'reason', invoker);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: `User ${targetUser.tag} has been banned.`,
      flags: MessageFlags.Ephemeral,
    });
  });
});
