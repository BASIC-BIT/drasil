import { ChannelType, InteractionContextType, MessageFlags } from 'discord.js';
import { USER_REPORT_REASON_REQUIRED_SETTING_KEY } from '../../utils/userReportSettings';
import { buildHandler, restoreUserInstallReportingEnvAfterEach } from './commandHandlerTestHarness';

describe('CommandHandler report commands (unit)', () => {
  restoreUserInstallReportingEnvAfterEach();

  it('handles /report with Discord user picker target', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const { handler, securityActionService } = buildHandler({ handleUserReport });

    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue(targetMember),
      },
    } as any;

    const interaction = {
      commandName: 'report',
      user: { id: 'reporter-1' },
      guild,
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('reported reason'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      targetMember,
      interaction.user,
      'reported reason'
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Thank you for your report regarding <@user-2>. It has been submitted for review.',
      allowedMentions: { parse: [] },
    });
  });

  it('keeps /report usable when report settings cannot be loaded', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockRejectedValue(new Error('config unavailable'));
    const { handler, securityActionService } = buildHandler({ handleUserReport, getServerConfig });

    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue(targetMember),
      },
    } as any;

    const interaction = {
      commandName: 'report',
      user: { id: 'reporter-1' },
      guild,
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('   '),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      targetMember,
      interaction.user,
      undefined
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Thank you for your report regarding <@user-2>. It has been submitted for review.',
      allowedMentions: { parse: [] },
    });
    consoleError.mockRestore();
  });

  it('requires /report reason when configured', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    });
    const { handler, securityActionService } = buildHandler({ handleUserReport, getServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(),
      },
    } as any;

    const interaction = {
      commandName: 'report',
      user: { id: 'reporter-1' },
      guild,
      options: {
        getUser: jest.fn().mockReturnValue({ id: 'user-2', tag: 'target#0001' }),
        getString: jest.fn().mockReturnValue('   '),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Please include a reason for this report.',
    });
  });

  it('rejects /report self-reports', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn();
    const { handler, securityActionService } = buildHandler({ handleUserReport, getServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(),
      },
    } as any;

    const interaction = {
      commandName: 'report',
      user: { id: 'reporter-1' },
      guild,
      options: {
        getUser: jest.fn().mockReturnValue({ id: 'reporter-1', tag: 'reporter#0001' }),
        getString: jest.fn().mockReturnValue('self report'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(getServerConfig).not.toHaveBeenCalled();
    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'You cannot report yourself.',
    });
  });

  it('handles Report User context command in a guild', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const { handler, securityActionService } = buildHandler({ handleUserReport });

    const targetUser = {
      id: 'user-2',
      username: 'target',
      globalName: 'Target User',
    } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue(targetMember),
      },
    } as any;

    const interaction = {
      commandName: 'Report User',
      user: { id: 'reporter-1' },
      targetUser,
      guild,
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleUserContextMenuCommand(interaction);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      targetMember,
      interaction.user
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Thank you for your report regarding <@user-2>. It has been submitted for review.',
      allowedMentions: { parse: [] },
    });
  });

  it('rejects Report User context command when a report reason is required', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    });
    const { handler, securityActionService } = buildHandler({ handleUserReport, getServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(),
      },
    } as any;

    const interaction = {
      commandName: 'Report User',
      user: { id: 'reporter-1' },
      targetUser: { id: 'user-2', username: 'target' },
      guild,
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleUserContextMenuCommand(interaction);

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'This server requires a report reason. Please use `/report` instead.',
    });
  });

  it('opens a Report Message modal when user-install reporting is enabled', async () => {
    process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED = 'true';
    const handleMessageReport = jest.fn().mockResolvedValue(true);
    const { handler, securityActionService } = buildHandler({ handleMessageReport });

    const targetUser = { id: 'user-2', username: 'target' } as any;
    const interaction = {
      commandName: 'Report Message',
      user: { id: 'reporter-1' },
      targetMessage: {
        id: 'message-1',
        author: targetUser,
        content: 'suspicious DM',
      },
      channelId: 'channel-1',
      guildId: null,
      context: InteractionContextType.PrivateChannel,
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleMessageContextMenuCommand(interaction);

    expect(securityActionService.handleMessageReport).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);

    const modalJson = (interaction.showModal as jest.Mock).mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('rmm:message-1:channel-1:user-2:0:2');
    expect(modalJson.components[0].components[0]).toMatchObject({
      custom_id: 'report_message_reason',
      required: false,
    });
  });

  it('requires the modal reason for guild Report Message when report reasons are required', async () => {
    process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED = 'true';
    const handleMessageReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    });
    const { handler, securityActionService } = buildHandler({
      getServerConfig,
      handleMessageReport,
    });

    const interaction = {
      commandName: 'Report Message',
      user: { id: 'reporter-1' },
      targetMessage: {
        id: 'message-1',
        author: { id: 'user-2', username: 'target' },
        content: 'suspicious server message',
      },
      channelId: 'channel-1',
      guildId: 'guild-1',
      context: InteractionContextType.Guild,
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleMessageContextMenuCommand(interaction);

    expect(getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(securityActionService.handleMessageReport).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);

    const modalJson = (interaction.showModal as jest.Mock).mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('rmm:message-1:channel-1:user-2:guild-1:0');
    expect(modalJson.components[0].components[0]).toMatchObject({
      custom_id: 'report_message_reason',
      required: true,
    });
  });

  it('rejects Report Message context command when user-install reporting is disabled', async () => {
    delete process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED;
    const handleMessageReport = jest.fn().mockResolvedValue(true);
    const { handler, securityActionService } = buildHandler({ handleMessageReport });

    const interaction = {
      commandName: 'Report Message',
      user: { id: 'reporter-1' },
      targetMessage: {
        id: 'message-1',
        author: { id: 'user-2', username: 'target' },
        content: 'suspicious DM',
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleMessageContextMenuCommand(interaction);

    expect(securityActionService.handleMessageReport).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'User-installable message reporting is not enabled for this Drasil deployment.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('updates the existing report instructions message instead of sending a duplicate', async () => {
    const existingMessage = {
      id: 'message-1',
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const targetChannel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn().mockResolvedValue(existingMessage),
      },
      send: jest.fn().mockResolvedValue({ id: 'message-2' }),
      toString: () => '<#channel-1>',
    } as any;
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        report_instructions_channel_id: 'channel-1',
        report_instructions_message_id: 'message-1',
      },
    });
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerSettings });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'setupreportbutton',
      user: { id: 'admin-1' },
      guild,
      options: {
        getChannel: jest.fn().mockReturnValue(targetChannel),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(targetChannel.messages.fetch).toHaveBeenCalledWith('message-1');
    expect(existingMessage.edit).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    const messagePayload = (existingMessage.edit as jest.Mock).mock.calls[0][0] as any;
    const embedJson = messagePayload.embeds[0].toJSON();
    expect(embedJson.title).toBe('Report a User');
    expect(embedJson.description).toContain('open a private report thread');
    expect(embedJson.description).not.toContain('picker');
    const buttonJson = messagePayload.components[0].toJSON().components[0];
    expect(buttonJson).toMatchObject({
      custom_id: 'report_user_initiate',
      label: 'Report a user',
    });
    expect(targetChannel.send).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'channel-1',
      report_instructions_message_id: 'message-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Report instructions updated successfully in <#channel-1>.',
    });
  });

  it('recreates report instructions when the stored message no longer exists', async () => {
    const targetChannel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn().mockRejectedValue(new Error('missing')),
      },
      send: jest.fn().mockResolvedValue({ id: 'message-2' }),
      toString: () => '<#channel-1>',
    } as any;
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        report_instructions_channel_id: 'channel-1',
        report_instructions_message_id: 'message-1',
      },
    });
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerSettings });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'setupreportbutton',
      user: { id: 'admin-1' },
      guild,
      options: {
        getChannel: jest.fn().mockReturnValue(targetChannel),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(targetChannel.send).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'channel-1',
      report_instructions_message_id: 'message-2',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Report instructions recreated successfully in <#channel-1>.',
    });
  });

  it('reuses an existing bot-authored report instructions message without stored metadata', async () => {
    const existingMessage = {
      id: 'message-1',
      author: { id: 'client-1' },
      embeds: [{ title: 'Report a User' }],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const targetChannel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn().mockResolvedValue([existingMessage]),
      },
      send: jest.fn().mockResolvedValue({ id: 'message-2' }),
      toString: () => '<#channel-1>',
    } as any;
    const getServerConfig = jest.fn().mockResolvedValue({ settings: {} });
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerSettings });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'setupreportbutton',
      user: { id: 'admin-1' },
      guild,
      options: {
        getChannel: jest.fn().mockReturnValue(targetChannel),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(targetChannel.messages.fetch).toHaveBeenCalledWith({ limit: 50 });
    expect(existingMessage.edit).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    expect(targetChannel.send).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'channel-1',
      report_instructions_message_id: 'message-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Report instructions updated successfully in <#channel-1>.',
    });
  });

  it('deletes old report instructions when moving them to a new channel', async () => {
    const oldMessage = {
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const oldChannel = {
      messages: {
        fetch: jest.fn().mockResolvedValue(oldMessage),
      },
    };
    const targetChannel = {
      id: 'new-channel-1',
      type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn(),
      },
      send: jest.fn().mockResolvedValue({ id: 'new-message-1' }),
      toString: () => '<#new-channel-1>',
    } as any;
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        report_instructions_channel_id: 'old-channel-1',
        report_instructions_message_id: 'old-message-1',
      },
    });
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService, client } = buildHandler({
      getServerConfig,
      updateServerSettings,
    });
    client.channels = {
      fetch: jest.fn().mockResolvedValue(oldChannel),
    };

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'setupreportbutton',
      user: { id: 'admin-1' },
      guild,
      options: {
        getChannel: jest.fn().mockReturnValue(targetChannel),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(client.channels.fetch).toHaveBeenCalledWith('old-channel-1');
    expect(oldChannel.messages.fetch).toHaveBeenCalledWith('old-message-1');
    expect(oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(targetChannel.send).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'new-channel-1',
      report_instructions_message_id: 'new-message-1',
    });
  });
});
