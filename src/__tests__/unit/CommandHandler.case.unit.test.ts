import { MessageFlags } from 'discord.js';
import { buildHandler } from './commandHandlerTestHarness';
import { handleSlashCommandConfirmationButton } from '../../utils/slashCommandConfirmations';

const confirmLastSlashCommand = async (interaction: any): Promise<any> => {
  const reply = interaction.reply.mock.calls.at(-1)?.[0];
  const confirmButton = reply.components[0].components[0];
  const customId = confirmButton.toJSON().custom_id;
  const buttonInteraction = {
    customId,
    user: interaction.user,
    guildId: interaction.guildId ?? null,
    reply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    editReply: interaction.editReply,
  } as any;

  await handleSlashCommandConfirmationButton(buttonInteraction);
  return buttonInteraction;
};

describe('CommandHandler case commands (unit)', () => {
  it('opens an admin case and applies the case role via /case open', async () => {
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: true,
      restricted: true,
    });
    const { handler, securityActionService } = buildHandler({ openAdminCase });
    const invoker = { id: 'admin-1' } as any;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockImplementation(async (id: string) => {
          if (id === targetUser.id) return targetMember;
          return null;
        }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      memberPermissions: { has: jest.fn().mockReturnValue(true) },
      options: {
        getSubcommand: jest.fn().mockReturnValue('open'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getBoolean: jest.fn().mockReturnValue(undefined),
        getString: jest.fn().mockReturnValue('manual review'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).toHaveBeenCalledWith(targetUser.id);
    expect(guild.members.fetch).not.toHaveBeenCalledWith(invoker.id);
    expect(securityActionService.openAdminCase).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Open a case for target#0001 and apply the case role?',
      })
    );

    await confirmLastSlashCommand(interaction);

    expect(securityActionService.openAdminCase).toHaveBeenCalledWith(targetMember, invoker, {
      action: 'open_case',
      reason: 'manual review',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Opened a case for target#0001 and applied the case role.',
      allowedMentions: { parse: [] },
    });
  });

  it('surfaces case role failure via /case open', async () => {
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: true,
      restricted: false,
    });
    const { handler, securityActionService } = buildHandler({ openAdminCase });
    const invoker = { id: 'admin-1' } as any;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest
          .fn()
          .mockImplementation(async (id: string) =>
            id === invoker.id
              ? { permissions: { has: jest.fn().mockReturnValue(true) } }
              : targetMember
          ),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('open'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getBoolean: jest.fn().mockReturnValue(false),
        getString: jest.fn().mockReturnValue('manual review'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.openAdminCase).not.toHaveBeenCalled();
    await confirmLastSlashCommand(interaction);

    expect(securityActionService.openAdminCase).toHaveBeenCalledWith(targetMember, invoker, {
      action: 'open_case',
      reason: 'manual review',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Opened a case for target#0001, but I could not apply the case role. Check bot permissions and role hierarchy.',
      allowedMentions: { parse: [] },
    });
  });

  it('surfaces partial restriction failure via default /case open', async () => {
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: true,
      restricted: false,
    });
    const { handler } = buildHandler({ openAdminCase });
    const invoker = { id: 'admin-1' } as any;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest
          .fn()
          .mockImplementation(async (id: string) =>
            id === invoker.id
              ? { permissions: { has: jest.fn().mockReturnValue(true) } }
              : targetMember
          ),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('open'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getBoolean: jest.fn().mockReturnValue(undefined),
        getString: jest.fn().mockReturnValue('restricted review'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    await confirmLastSlashCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Opened a case for target#0001, but I could not apply the case role. Check bot permissions and role hierarchy.',
      allowedMentions: { parse: [] },
    });
  });

  it('repairs an active verification case via /case repair', async () => {
    const repairActiveCase = jest.fn().mockResolvedValue({
      repaired: true,
      message: 'Repaired active verification case for target#0001.',
      verificationEventId: 'ver-1',
      threadId: 'thread-1',
      threadCreated: false,
      userAdded: true,
      promptSent: true,
      promptAlreadyPresent: false,
    });
    const { handler, securityActionService } = buildHandler({ repairActiveCase });
    const invoker = { id: 'admin-1' } as any;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest
          .fn()
          .mockImplementation(async (id: string) =>
            id === invoker.id
              ? { permissions: { has: jest.fn().mockReturnValue(true) } }
              : targetMember
          ),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('repair'),
        getUser: jest.fn().mockReturnValue(targetUser),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.repairActiveCase).toHaveBeenCalledWith(targetMember);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Prompt sent: `yes`'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'https://discord.com/channels/guild-1/thread-1'
    );
  });

  it('refreshes the latest case notification via /case refresh', async () => {
    const refreshCaseNotification = jest.fn().mockResolvedValue({
      refreshed: true,
      message: 'Refreshed verified case notification for target#0001.',
      verificationEventId: 'ver-1',
      status: 'verified',
      notificationChannelId: 'channel-1',
      notificationMessageId: 'message-1',
    });
    const { handler, securityActionService } = buildHandler({ refreshCaseNotification });
    const invoker = { id: 'admin-1' } as any;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest
          .fn()
          .mockResolvedValue({ permissions: { has: jest.fn().mockReturnValue(true) } }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      memberPermissions: { has: jest.fn().mockReturnValue(true) },
      options: {
        getSubcommand: jest.fn().mockReturnValue('refresh'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue(undefined),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(securityActionService.refreshCaseNotification).toHaveBeenCalledWith(
      'guild-1',
      targetUser,
      undefined
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Refreshed verified case notification'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'https://discord.com/channels/guild-1/channel-1/message-1'
    );
  });

  it('refreshes a specific case notification via /case refresh case-id', async () => {
    const refreshCaseNotification = jest.fn().mockResolvedValue({
      refreshed: false,
      message: 'Case ver-older has no stored notification message to refresh.',
      verificationEventId: 'ver-older',
      status: 'verified',
      notificationChannelId: null,
      notificationMessageId: null,
    });
    const { handler, securityActionService } = buildHandler({ refreshCaseNotification });
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest
          .fn()
          .mockResolvedValue({ permissions: { has: jest.fn().mockReturnValue(true) } }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: { id: 'admin-1' } as any,
      guild,
      memberPermissions: { has: jest.fn().mockReturnValue(true) },
      options: {
        getSubcommand: jest.fn().mockReturnValue('refresh'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('ver-older'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.refreshCaseNotification).toHaveBeenCalledWith(
      'guild-1',
      targetUser,
      'ver-older'
    );
    expect(interaction.editReply.mock.calls[0][0].content).toContain('Case: `ver-older`');
    expect(interaction.editReply.mock.calls[0][0].content).not.toContain(
      'https://discord.com/channels/'
    );
  });

  it('returns a failure reply when /case refresh fails after deferring', async () => {
    const refreshCaseNotification = jest
      .fn()
      .mockRejectedValue(new Error('notification channel fetch failed'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handler } = buildHandler({ refreshCaseNotification });
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest
          .fn()
          .mockResolvedValue({ permissions: { has: jest.fn().mockReturnValue(true) } }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: { id: 'admin-1' } as any,
      guild,
      memberPermissions: { has: jest.fn().mockReturnValue(true) },
      options: {
        getSubcommand: jest.fn().mockReturnValue('refresh'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('ver-1'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Failed to refresh case notification for target#0001: notification channel fetch failed',
      allowedMentions: { parse: [] },
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to refresh case notification:',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it('dry-runs restricted role intake via /case intake-role', async () => {
    const intakeRoleMembers = jest.fn().mockResolvedValue({
      batchId: 'role-intake-1',
      roleId: 'role-1',
      roleName: 'restricted',
      action: 'open_case',
      execute: false,
      totalMembers: 3,
      eligibleMembers: 2,
      processed: 2,
      opened: 0,
      skippedBots: 1,
      skippedActiveCases: 0,
      skippedOverLimit: 0,
      failed: 0,
      failures: [],
    });
    const { handler, securityActionService } = buildHandler({ intakeRoleMembers });
    const invoker = { id: 'admin-1' } as any;
    const role = { id: 'role-1', name: 'restricted' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(true) },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('intake-role'),
        getRole: jest.fn().mockReturnValue(role),
        getBoolean: jest.fn().mockReturnValue(false),
        getInteger: jest.fn().mockReturnValue(2),
        getString: jest.fn((name: string) =>
          name === 'action' ? 'open_case' : 'restricted role cleanup'
        ),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(securityActionService.intakeRoleMembers).toHaveBeenCalledWith({
      role,
      moderator: invoker,
      reason: 'restricted role cleanup',
      action: 'open_case',
      execute: false,
      limit: 2,
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain('Role intake dry run');
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Re-run with `execute: true` to open cases.'
    );
  });

  it('falls back to opening cases for invalid role intake actions', async () => {
    const intakeRoleMembers = jest.fn().mockResolvedValue({
      batchId: 'role-intake-1',
      roleId: 'role-1',
      roleName: 'restricted',
      action: 'open_case',
      execute: false,
      totalMembers: 1,
      eligibleMembers: 1,
      processed: 1,
      opened: 0,
      skippedBots: 0,
      skippedActiveCases: 0,
      skippedOverLimit: 0,
      failed: 0,
      failures: [],
    });
    const { handler, securityActionService } = buildHandler({ intakeRoleMembers });
    const invoker = { id: 'admin-1' } as any;
    const role = { id: 'role-1', name: 'restricted' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(true) },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('intake-role'),
        getRole: jest.fn().mockReturnValue(role),
        getBoolean: jest.fn().mockReturnValue(false),
        getInteger: jest.fn().mockReturnValue(undefined),
        getString: jest.fn((name: string) => (name === 'action' ? 'ban_everyone' : undefined)),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.intakeRoleMembers).toHaveBeenCalledWith({
      role,
      moderator: invoker,
      reason: undefined,
      action: 'open_case',
      execute: false,
      limit: undefined,
    });
  });

  it('denies /case commands for non-admin members', async () => {
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: false,
      restricted: false,
    });
    const { handler, securityActionService } = buildHandler({ openAdminCase });
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(false) },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: { id: 'user-1' },
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('open'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.openAdminCase).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You need administrator permissions to use this command.',
      flags: MessageFlags.Ephemeral,
    });
  });
});
