import {
  ButtonInteraction,
  ChannelType,
  Client,
  Guild,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  User,
} from 'discord.js';
import {
  REPORT_USER_INITIATE_CUSTOM_ID,
  REPORT_USER_TYPED_MODAL_ID,
  ReportInteractionHandler,
} from '../../controllers/ReportInteractionHandler';
import { IConfigService } from '../../config/ConfigService';
import { IReportIntakeService } from '../../services/ReportIntakeService';
import { ReportSubmissionService } from '../../services/ReportSubmissionService';
import { ISecurityActionService } from '../../services/SecurityActionService';
import { IThreadManager } from '../../services/ThreadManager';
import {
  REPORT_MESSAGE_MODAL_PREFIX,
  USER_REPORT_REASON_REQUIRED_SETTING_KEY,
} from '../../utils/userReportSettings';

type TextInputValueReader = ModalSubmitInteraction['fields']['getTextInputValue'];

const buildMember = (guildId: string, userId: string): GuildMember =>
  ({
    id: userId,
    guild: { id: guildId } as Guild,
    user: {
      id: userId,
      username: 'test-user',
      tag: 'test-user#0001',
    } as User,
    permissions: { has: jest.fn().mockReturnValue(false) },
  }) as unknown as GuildMember;

const buildInteraction = (customId: string, guildId: string, user: User): ButtonInteraction => {
  const interaction = {
    customId,
    guildId,
    channel: { id: 'channel-1', type: ChannelType.GuildText },
    user,
    deferred: false,
    replied: false,
    deferReply: jest.fn().mockImplementation(async () => {
      interaction.deferred = true;
    }),
    editReply: jest.fn().mockImplementation(async () => {
      interaction.replied = true;
    }),
    followUp: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(async () => {
      interaction.replied = true;
    }),
    showModal: jest.fn().mockResolvedValue(undefined),
  };
  return interaction as unknown as ButtonInteraction;
};

const buildModalInteraction = (
  customId: string,
  guildId: string | null,
  user: User,
  getTextInputValue: TextInputValueReader
): ModalSubmitInteraction =>
  ({
    customId,
    guildId,
    user,
    fields: {
      getTextInputValue: jest.fn(getTextInputValue),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  }) as unknown as ModalSubmitInteraction;

const createReportIntakeService = (): jest.Mocked<IReportIntakeService> => ({
  openIntakeFromThread: jest.fn().mockResolvedValue({} as any),
  findOpenIntakeForReporter: jest.fn().mockResolvedValue(null),
  handleThreadMessage: jest.fn().mockResolvedValue(false),
  confirmCandidate: jest.fn().mockResolvedValue({ confirmed: false, message: '' }),
  markSubmitted: jest.fn().mockResolvedValue(undefined),
  markOpenFailed: jest.fn().mockResolvedValue(undefined),
});

describe('ReportInteractionHandler (unit)', () => {
  let client: Client;
  let securityActionService: jest.Mocked<ISecurityActionService>;
  let configService: jest.Mocked<IConfigService>;
  let threadManager: jest.Mocked<IThreadManager>;

  beforeEach(() => {
    const member = buildMember('guild-1', 'user-1');
    client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            me: { permissions: { has: jest.fn().mockReturnValue(true) } },
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;
    securityActionService = {
      handleUserReport: jest.fn().mockResolvedValue(true),
      handleMessageReport: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ISecurityActionService>;
    configService = {
      getServerConfig: jest.fn().mockResolvedValue({ settings: {} }),
      getAdminChannel: jest.fn(),
    } as unknown as jest.Mocked<IConfigService>;
    threadManager = {
      createReportIntakeThread: jest.fn().mockResolvedValue({
        id: 'report-thread-1',
        url: 'https://discord.com/channels/report-thread-1',
      } as any),
      activateReportIntakeThread: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<IThreadManager>;
  });

  const createHandler = (
    reportIntakeService?: jest.Mocked<IReportIntakeService>
  ): ReportInteractionHandler => {
    const reportSubmissionService = new ReportSubmissionService(
      configService,
      securityActionService
    );
    return new ReportInteractionHandler(
      client,
      reportSubmissionService,
      configService,
      threadManager,
      reportIntakeService
    );
  };

  it('handles report modal submission', async () => {
    const member = buildMember('guild-1', '123456789012345678');
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue(member),
      },
    });
    const handler = createHandler();
    const interaction = buildModalInteraction(
      REPORT_USER_TYPED_MODAL_ID,
      'guild-1',
      { id: 'reporter-1' } as User,
      (id) => (id === 'report_target_user_input' ? '123456789012345678' : 'reported')
    );

    await handler.handleReportUserModalSubmit(interaction);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      member,
      interaction.user,
      'reported'
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (client.guilds.fetch as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Thank you for your report regarding <@123456789012345678>. It has been submitted for review.',
      allowedMentions: { parse: [] },
    });
  });

  it('returns a friendly report modal error when the member leaves before submission completes', async () => {
    const member = buildMember('guild-1', '123456789012345678');
    const membersFetch = jest
      .fn()
      .mockResolvedValueOnce(member)
      .mockRejectedValueOnce(new Error('member left'));
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: membersFetch,
      },
    });
    const handler = createHandler();
    const interaction = buildModalInteraction(
      REPORT_USER_TYPED_MODAL_ID,
      'guild-1',
      { id: 'reporter-1' } as User,
      (id) => (id === 'report_target_user_input' ? '123456789012345678' : 'reported')
    );

    await handler.handleReportUserModalSubmit(interaction);

    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Could not find a user matching "123456789012345678" in this server.',
    });
  });

  it('submits Report Message modal with optional reason', async () => {
    const targetUser = { id: 'user-2', username: 'target' } as User;
    (client as any).users = {
      fetch: jest.fn().mockResolvedValue(targetUser),
    };
    (client as any).channels = {
      fetch: jest.fn().mockResolvedValue({
        messages: {
          fetch: jest.fn().mockResolvedValue({
            content: 'suspicious message',
            attachments: new Map(),
          }),
        },
      }),
    };
    const handler = createHandler();
    const interaction = buildModalInteraction(
      `${REPORT_MESSAGE_MODAL_PREFIX}:message-1:channel-1:user-2:guild-1:0`,
      'guild-1',
      { id: 'reporter-1' } as User,
      () => 'message report reason'
    );

    await handler.handleReportMessageModalSubmit(interaction);

    expect(securityActionService.handleMessageReport).toHaveBeenCalledWith(
      targetUser,
      interaction.user,
      {
        messageId: 'message-1',
        channelId: 'channel-1',
        guildId: 'guild-1',
        content: 'suspicious message',
        reason: 'message report reason',
        interactionContext: 0,
      }
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Thank you for your report regarding <@user-2>. It has been submitted for review.',
      allowedMentions: { parse: [] },
    });
  });

  it('handles report modal submission with a modern username', async () => {
    const member = {
      ...buildMember('guild-1', '123456789012345678'),
      displayName: 'Basic Bit',
      nickname: null,
      user: {
        id: '123456789012345678',
        username: 'basic_bit',
        globalName: 'Basic Bit',
        discriminator: '0',
        tag: 'basic_bit',
      },
    } as unknown as GuildMember;
    const memberCollection = {
      values: jest.fn(() => [member][Symbol.iterator]()),
    };
    const membersFetch = jest.fn().mockImplementation(async (id?: string) => {
      if (id === member.id) {
        return member;
      }
      return null;
    });
    const membersSearch = jest.fn().mockResolvedValue(memberCollection);
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: membersFetch,
        search: membersSearch,
      },
    });
    const handler = createHandler();
    const interaction = buildModalInteraction(
      REPORT_USER_TYPED_MODAL_ID,
      'guild-1',
      { id: 'reporter-1' } as User,
      (id) => (id === 'report_target_user_input' ? 'basic_bit' : 'reported')
    );

    await handler.handleReportUserModalSubmit(interaction);

    expect(membersSearch).toHaveBeenCalledWith({ query: 'basic_bit', limit: 100 });
    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      member,
      interaction.user,
      'reported'
    );
  });

  it('handles report modal submission with an at-prefixed legacy username tag', async () => {
    const member = {
      ...buildMember('guild-1', '123456789012345678'),
      user: {
        id: '123456789012345678',
        username: 'LegacyUser',
        globalName: null,
        discriminator: '1234',
        tag: 'LegacyUser#1234',
      },
    } as unknown as GuildMember;
    const memberCollection = {
      values: jest.fn(() => [member][Symbol.iterator]()),
    };
    const membersFetch = jest.fn().mockImplementation(async (id?: string) => {
      if (id === member.id) {
        return member;
      }
      return null;
    });
    const membersSearch = jest.fn().mockResolvedValue(memberCollection);
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: membersFetch,
        search: membersSearch,
      },
    });
    const handler = createHandler();
    const interaction = buildModalInteraction(
      REPORT_USER_TYPED_MODAL_ID,
      'guild-1',
      { id: 'reporter-1' } as User,
      (id) => (id === 'report_target_user_input' ? '@legacyuser#1234' : 'reported')
    );

    await handler.handleReportUserModalSubmit(interaction);

    expect(membersSearch).toHaveBeenCalledWith({ query: 'legacyuser', limit: 100 });
    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      member,
      interaction.user,
      'reported'
    );
  });

  it('rejects ambiguous report modal name matches', async () => {
    const firstMember = {
      ...buildMember('guild-1', '123456789012345678'),
      displayName: 'Same Name',
      nickname: null,
      user: {
        id: '123456789012345678',
        username: 'first_user',
        globalName: 'Same Name',
        discriminator: '0',
        tag: 'first_user',
      },
    } as unknown as GuildMember;
    const secondMember = {
      ...buildMember('guild-1', '223456789012345678'),
      displayName: 'Same Name',
      nickname: null,
      user: {
        id: '223456789012345678',
        username: 'second_user',
        globalName: 'Same Name',
        discriminator: '0',
        tag: 'second_user',
      },
    } as unknown as GuildMember;
    const memberCollection = {
      values: jest.fn(() => [firstMember, secondMember][Symbol.iterator]()),
    };
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn(),
        search: jest.fn().mockResolvedValue(memberCollection),
      },
    });
    const handler = createHandler();
    const interaction = buildModalInteraction(
      REPORT_USER_TYPED_MODAL_ID,
      'guild-1',
      { id: 'reporter-1' } as User,
      (id) => (id === 'report_target_user_input' ? 'Same Name' : 'reported')
    );

    await handler.handleReportUserModalSubmit(interaction);

    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Multiple users match that name. Please use their ID or @mention instead.',
    });
  });

  it('requires report modal reason when configured', async () => {
    configService.getServerConfig.mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    } as any);
    const handler = createHandler();
    const interaction = buildModalInteraction(
      REPORT_USER_TYPED_MODAL_ID,
      'guild-1',
      { id: 'reporter-1' } as User,
      (id) => (id === 'report_target_user_input' ? '123456789012345678' : '   ')
    );

    await handler.handleReportUserModalSubmit(interaction);

    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Please include a reason for this report.',
    });
  });

  it('rejects report modal self-reports', async () => {
    const member = buildMember('guild-1', '123456789012345678');
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue(member),
      },
    });
    const handler = createHandler();
    const interaction = buildModalInteraction(
      REPORT_USER_TYPED_MODAL_ID,
      'guild-1',
      { id: '123456789012345678' } as User,
      (id) => (id === 'report_target_user_input' ? '123456789012345678' : 'reported')
    );

    await handler.handleReportUserModalSubmit(interaction);

    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'You cannot report yourself.',
    });
  });

  it('opens a private report intake thread from the report button', async () => {
    const reporter = buildMember('guild-1', 'reporter-1');
    const adminChannel = { send: jest.fn().mockResolvedValue(undefined) };
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: {
        fetch: jest.fn().mockResolvedValue(reporter),
      },
    });
    (configService.getAdminChannel as jest.Mock).mockResolvedValueOnce(adminChannel);
    const reportIntakeService = createReportIntakeService();
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction(REPORT_USER_INITIATE_CUSTOM_ID, 'guild-1', {
      id: 'reporter-1',
    } as User);

    await handler.handleReportUserInitiate(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(threadManager.createReportIntakeThread).toHaveBeenCalledWith(
      interaction.channel,
      reporter
    );
    expect(reportIntakeService.findOpenIntakeForReporter).toHaveBeenCalledWith({
      serverId: 'guild-1',
      reporterId: 'reporter-1',
    });
    expect(reportIntakeService.openIntakeFromThread).toHaveBeenCalledWith({
      serverId: 'guild-1',
      reporter,
      threadId: 'report-thread-1',
      channelId: expect.any(String),
    });
    expect(threadManager.activateReportIntakeThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'report-thread-1' }),
      reporter
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Opened a private report thread: https://discord.com/channels/report-thread-1\nPlease put the report context there.',
    });
    expect(adminChannel.send).toHaveBeenCalledWith({
      content:
        'Report intake thread opened by <@reporter-1>: https://discord.com/channels/report-thread-1',
      allowedMentions: { parse: [] },
    });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('does not create a report intake thread when intake tracking is unavailable', async () => {
    const handler = createHandler(undefined);
    const interaction = buildInteraction(REPORT_USER_INITIATE_CUSTOM_ID, 'guild-1', {
      id: 'reporter-1',
    } as User);

    await handler.handleReportUserInitiate(interaction);

    expect(threadManager.createReportIntakeThread).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Report intake tracking is not available.',
    });
  });

  it('reuses an existing open report intake for the same reporter', async () => {
    const reporter = buildMember('guild-1', 'reporter-1');
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: {
        fetch: jest.fn().mockResolvedValue(reporter),
      },
    });
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.findOpenIntakeForReporter.mockResolvedValue({
      id: 'intake-1',
      thread_id: 'existing-thread-1',
    } as any);
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction(REPORT_USER_INITIATE_CUSTOM_ID, 'guild-1', {
      id: 'reporter-1',
    } as User);

    await handler.handleReportUserInitiate(interaction);

    expect(threadManager.createReportIntakeThread).not.toHaveBeenCalled();
    expect(reportIntakeService.openIntakeFromThread).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'You already have an open report thread: https://discord.com/channels/guild-1/existing-thread-1\nPlease continue there, or send `close report` in that thread if it was opened by mistake.',
    });
  });

  it('cleans up the report intake thread when persistence fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = buildMember('guild-1', 'reporter-1');
    const thread = {
      id: 'report-thread-1',
      url: 'https://discord.com/channels/report-thread-1',
      delete: jest.fn().mockResolvedValue(undefined),
    };
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: {
        fetch: jest.fn().mockResolvedValue(reporter),
      },
    });
    threadManager.createReportIntakeThread.mockResolvedValueOnce(thread as any);
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.openIntakeFromThread.mockRejectedValue(new Error('database unavailable'));
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction(REPORT_USER_INITIATE_CUSTOM_ID, 'guild-1', {
      id: 'reporter-1',
    } as User);

    try {
      await handler.handleReportUserInitiate(interaction);
    } finally {
      consoleError.mockRestore();
    }

    expect(thread.delete).toHaveBeenCalledWith(
      'Report intake setup failed before reporter activation.'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'An error occurred while opening the report thread. Please try again later.',
    });
  });

  it('marks the intake failed and deletes the thread when activation fails', async () => {
    const reporter = buildMember('guild-1', 'reporter-1');
    const thread = {
      id: 'report-thread-1',
      url: 'https://discord.com/channels/report-thread-1',
      delete: jest.fn().mockResolvedValue(undefined),
    };
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: {
        fetch: jest.fn().mockResolvedValue(reporter),
      },
    });
    threadManager.createReportIntakeThread.mockResolvedValueOnce(thread as any);
    threadManager.activateReportIntakeThread.mockResolvedValueOnce(false);
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.openIntakeFromThread.mockResolvedValue({ id: 'intake-1' } as any);
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction(REPORT_USER_INITIATE_CUSTOM_ID, 'guild-1', {
      id: 'reporter-1',
    } as User);

    await handler.handleReportUserInitiate(interaction);

    expect(reportIntakeService.markOpenFailed).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      reason: 'thread_activation_failed',
    });
    expect(thread.delete).toHaveBeenCalledWith(
      'Report intake setup failed before reporter activation.'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Could not prepare the private report thread. Please ask a server admin to check Drasil thread permissions.',
    });
  });

  it('keeps an activated report intake thread when the success reply fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = buildMember('guild-1', 'reporter-1');
    const thread = {
      id: 'report-thread-1',
      url: 'https://discord.com/channels/report-thread-1',
      delete: jest.fn().mockResolvedValue(undefined),
    };
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: {
        fetch: jest.fn().mockResolvedValue(reporter),
      },
    });
    threadManager.createReportIntakeThread.mockResolvedValueOnce(thread as any);
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.openIntakeFromThread.mockResolvedValue({ id: 'intake-1' } as any);
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction(REPORT_USER_INITIATE_CUSTOM_ID, 'guild-1', {
      id: 'reporter-1',
    } as User);
    (interaction.editReply as jest.Mock)
      .mockRejectedValueOnce(new Error('interaction expired'))
      .mockResolvedValueOnce(undefined);

    try {
      await handler.handleReportUserInitiate(interaction);
    } finally {
      consoleError.mockRestore();
    }

    expect(threadManager.activateReportIntakeThread).toHaveBeenCalledWith(thread, reporter);
    expect(thread.delete).not.toHaveBeenCalled();
    expect(reportIntakeService.markOpenFailed).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content:
        'Opened a private report thread: https://discord.com/channels/report-thread-1\nPlease put the report context there.',
    });
  });

  it('submits a confirmed report intake target through the user report workflow', async () => {
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.confirmCandidate.mockResolvedValue({
      confirmed: true,
      message: 'confirmed',
      reason: 'Report intake target confirmed by reporter.',
    });
    const targetMember = buildMember('guild-1', 'user-1');
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: { fetch: jest.fn().mockResolvedValue(targetMember) },
    });
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction('report_intake_confirm:intake-1:user-1', 'guild-1', {
      id: 'reporter-1',
    } as User);

    await handler.handleReportIntakeConfirm(interaction, interaction.customId);

    expect(reportIntakeService.confirmCandidate).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
    });
    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      targetMember,
      interaction.user,
      'Report intake target confirmed by reporter.'
    );
    expect(reportIntakeService.markSubmitted).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      targetUserId: 'user-1',
      submittedById: 'reporter-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Submitted report for <@user-1>.',
    });
  });

  it('edits the deferred reply when report intake submission fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.confirmCandidate.mockResolvedValue({
      confirmed: true,
      message: 'confirmed',
      reason: 'Report intake target confirmed by reporter.',
    });
    const targetMember = buildMember('guild-1', 'user-1');
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: { fetch: jest.fn().mockResolvedValue(targetMember) },
    });
    securityActionService.handleUserReport.mockRejectedValueOnce(new Error('case creation failed'));
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction('report_intake_confirm:intake-1:user-1', 'guild-1', {
      id: 'reporter-1',
    } as User);

    try {
      await handler.handleReportIntakeConfirm(interaction, interaction.customId);
    } finally {
      consoleError.mockRestore();
    }

    expect(reportIntakeService.confirmCandidate).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
    });
    expect(reportIntakeService.markSubmitted).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'The report target was confirmed, but Drasil could not finish submitting it automatically. A moderator can review the intake thread.',
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('rejects report intake self-confirmations before submitting a report', async () => {
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.confirmCandidate.mockResolvedValue({
      confirmed: true,
      message: 'confirmed',
      reason: 'Report intake target confirmed by reporter.',
    });
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction('report_intake_confirm:intake-1:reporter-1', 'guild-1', {
      id: 'reporter-1',
    } as User);

    await handler.handleReportIntakeConfirm(interaction, interaction.customId);

    expect(reportIntakeService.confirmCandidate).not.toHaveBeenCalled();
    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(reportIntakeService.markSubmitted).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'You cannot report yourself.' });
  });

  it('checks target availability before confirming a report intake target', async () => {
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.confirmCandidate.mockResolvedValue({
      confirmed: true,
      message: 'confirmed',
      reason: 'Report intake target confirmed by reporter.',
    });
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: { fetch: jest.fn().mockRejectedValue(new Error('missing member')) },
    });
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction('report_intake_confirm:intake-1:user-1', 'guild-1', {
      id: 'reporter-1',
    } as User);

    await handler.handleReportIntakeConfirm(interaction, interaction.customId);

    expect(reportIntakeService.confirmCandidate).not.toHaveBeenCalled();
    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(reportIntakeService.markSubmitted).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'The confirmed target is no longer available in this server.',
    });
  });
});
