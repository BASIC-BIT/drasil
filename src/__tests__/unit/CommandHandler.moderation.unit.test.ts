import { MessageFlags, PermissionFlagsBits, User } from 'discord.js';
import { MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY } from '../../utils/detectionResponseSettings';
import { handleSlashCommandConfirmationButton } from '../../utils/slashCommandConfirmations';
import { buildHandler } from './commandHandlerTestHarness';
import {
  BAN_USER_CONTEXT_COMMAND_NAME,
  KICK_USER_CONTEXT_COMMAND_NAME,
} from '../../controllers/commandDefinitions';
import { MODERATION_ACTION_REASON_FIELD_ID } from '../../utils/moderationActionCustomIds';

const confirmLastSlashCommand = async (interaction: any): Promise<void> => {
  const reply = interaction.reply.mock.calls.at(-1)?.[0];
  const confirmButton = reply.components[0].components[0];
  const customId = confirmButton.toJSON().custom_id;
  await handleSlashCommandConfirmationButton({
    customId,
    user: interaction.user,
    guildId: interaction.guildId ?? null,
    reply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    editReply: interaction.editReply,
  } as any);
};

describe('CommandHandler moderation commands (unit)', () => {
  it('handles /audit integrity as a read-only ephemeral report', async () => {
    const auditGuild = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      scope: 'all',
      days: 30,
      limit: 50,
      candidateCounts: {
        pendingCases: 1,
        recentResolvedCases: 1,
        caseRoleMembers: 0,
        activeRoleQuarantines: 0,
        queueItems: 0,
      },
      findings: [
        {
          severity: 'error',
          code: 'resolved_case_missing_admin_action',
          subject: 'case ver-1',
          detail: 'Resolved case has no durable admin action row.',
          userId: 'user-1',
          verificationEventId: 'ver-1',
        },
      ],
    });
    const { handler } = buildHandler({ integrityAuditService: { auditGuild } });

    const guild = { id: 'guild-1' } as any;
    const interaction = {
      commandName: 'audit',
      guild,
      channelId: 'channel-1',
      user: { id: 'admin-1' },
      memberPermissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ManageGuild),
      },
      options: {
        getSubcommand: jest.fn().mockReturnValue('integrity'),
        getString: jest.fn((name: string) => (name === 'scope' ? 'all' : null)),
        getInteger: jest.fn((name: string) => (name === 'days' ? 30 : null)),
        getUser: jest.fn().mockReturnValue(null),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(auditGuild).toHaveBeenCalledWith(guild, {
      scope: 'all',
      days: 30,
      limit: null,
      userId: undefined,
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderation integrity audit complete'),
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('resolved_case_missing_admin_action'),
    });
  });

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
      reply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.excludeDetectionFromAccounting).not.toHaveBeenCalled();
    await confirmLastSlashCommand(interaction);

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
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(permissionsIn).toHaveBeenCalledWith('channel-1');
    expect(userModerationService.banUser).not.toHaveBeenCalled();
    await confirmLastSlashCommand(interaction);

    expect(userModerationService.banUser).toHaveBeenCalledWith(targetMember, 'reason', invoker);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: `User ${targetUser.tag} has been banned.`,
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
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).toHaveBeenCalledWith(targetUser.id);
    expect(userModerationService.banUser).not.toHaveBeenCalled();
    await confirmLastSlashCommand(interaction);

    expect(userModerationService.banUser).toHaveBeenCalledWith(targetMember, 'reason', invoker);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: `User ${targetUser.tag} has been banned.`,
    });
  });

  it('shows a native Ban User reason modal for Ban Members moderators', async () => {
    const { handler } = buildHandler();
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const interaction = {
      commandName: BAN_USER_CONTEXT_COMMAND_NAME,
      user: { id: 'ban-mod-1' },
      targetUser,
      guild: {
        id: 'guild-1',
        members: {
          me: { permissions: { has: jest.fn().mockReturnValue(true) } },
        },
      },
      memberPermissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.BanMembers),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleUserContextMenuCommand(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('moderation_action_reason:ban:user-2');
    expect(modalJson.components[0].components[0]).toMatchObject({
      custom_id: MODERATION_ACTION_REASON_FIELD_ID,
      required: false,
    });
  });

  it('shows a native Kick User message reason modal for Kick Members moderators', async () => {
    const { handler } = buildHandler();
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const targetMessage = {
      id: 'message-1',
      channelId: 'channel-1',
      author: targetUser,
    } as any;
    const interaction = {
      commandName: KICK_USER_CONTEXT_COMMAND_NAME,
      user: { id: 'kick-mod-1' },
      targetMessage,
      guild: {
        id: 'guild-1',
        members: {
          me: { permissions: { has: jest.fn().mockReturnValue(true) } },
          fetch: jest.fn().mockResolvedValue(targetMember),
        },
      },
      memberPermissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.KickMembers),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleMessageContextMenuCommand(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modalJson = interaction.showModal.mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('moderation_action_reason:kick:user-2:channel-1:message-1');
    expect(modalJson.components[0].components[0]).toMatchObject({
      custom_id: MODERATION_ACTION_REASON_FIELD_ID,
      required: false,
    });
  });
});
