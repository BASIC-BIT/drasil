import {
  ButtonInteraction,
  ChannelType,
  Client,
  Guild,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  User,
} from 'discord.js';
import {
  REPORT_USER_INITIATE_CUSTOM_ID,
  REPORT_USER_TYPED_MODAL_ID,
  ReportInteractionHandler,
} from '../../controllers/ReportInteractionHandler';
import { IConfigService } from '../../config/ConfigService';
import { ReportIntake, ReportIntakeStatus } from '../../repositories/types';
import { IReportIntakeService } from '../../services/ReportIntakeService';
import { ReportSubmissionService } from '../../services/ReportSubmissionService';
import { ISecurityActionService } from '../../services/SecurityActionService';
import { IThreadManager } from '../../services/ThreadManager';
import {
  buildReportIntakeAdminActionsCustomId,
  buildReportIntakeAdminCloseCustomId,
  buildReportIntakeAdminConfirmCloseCustomId,
} from '../../utils/reportIntakeAdminActions';
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
    channelId: 'channel-1',
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
    update: jest.fn().mockImplementation(async () => {
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

const buildReportIntake = (overrides: Partial<ReportIntake> = {}): ReportIntake => ({
  id: 'intake-1',
  server_id: 'guild-1',
  reporter_id: 'reporter-1',
  thread_id: 'report-thread-1',
  status: ReportIntakeStatus.COLLECTING_EVIDENCE,
  summary: null,
  confirmed_target_user_id: null,
  created_at: null,
  updated_at: null,
  closed_at: null,
  metadata: null,
  ...overrides,
});

const createReportIntakeService = (): jest.Mocked<IReportIntakeService> => ({
  openIntakeFromThread: jest.fn().mockResolvedValue(buildReportIntake()),
  findOpenIntakeForReporter: jest.fn().mockResolvedValue(null),
  findIntakeById: jest.fn().mockResolvedValue(null),
  handleThreadMessage: jest.fn().mockResolvedValue(false),
  confirmCandidate: jest.fn().mockResolvedValue({ confirmed: false, message: '' }),
  rejectCandidates: jest.fn().mockResolvedValue({ rejected: false, message: '' }),
  closeIntakeForThread: jest.fn().mockResolvedValue({ closed: false, message: '' }),
  recordAgentAnalysis: jest.fn().mockResolvedValue(false),
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
      handleConfirmedReportIntake: jest.fn().mockResolvedValue(true),
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
      reporter,
      'intake-1'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Opened a private report thread: https://discord.com/channels/report-thread-1\nAdd what happened there.',
    });
    expect(adminChannel.send).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Report Intake Started' }),
        }),
      ],
      allowedMentions: { parse: [], roles: [], users: [], repliedUser: false },
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
        'You already have an open report thread: https://discord.com/channels/guild-1/existing-thread-1\nPlease continue there, or use /close-report in that thread if it was opened by mistake.',
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

    expect(threadManager.activateReportIntakeThread).toHaveBeenCalledWith(
      thread,
      reporter,
      'intake-1'
    );
    expect(thread.delete).not.toHaveBeenCalled();
    expect(reportIntakeService.markOpenFailed).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content:
        'Opened a private report thread: https://discord.com/channels/report-thread-1\nAdd what happened there.',
    });
  });

  it('shows the report intake admin menu to staff from the report thread button', async () => {
    const staffMember = {
      ...buildMember('guild-1', 'staff-1'),
      permissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ModerateMembers),
      },
    } as unknown as GuildMember;
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      id: 'guild-1',
      members: { fetch: jest.fn().mockResolvedValue(staffMember) },
    });
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.findIntakeById.mockResolvedValue(
      buildReportIntake({ confirmed_target_user_id: 'user-1' })
    );
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction(
      buildReportIntakeAdminActionsCustomId('intake-1'),
      'guild-1',
      {
        id: 'staff-1',
      } as User
    );
    const thread = {
      id: 'report-thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    };
    (interaction as any).channel = thread;
    (interaction as any).channelId = 'report-thread-1';

    await handler.handleReportIntakeAdminAction(interaction, interaction.customId);

    expect(reportIntakeService.findIntakeById).toHaveBeenCalledWith('intake-1');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.stringContaining('Reporter: <@reporter-1>'),
        allowedMentions: { parse: [] },
      })
    );
    const reply = (interaction.reply as jest.Mock).mock.calls[0][0];
    const button = reply.components[0].toJSON().components[0];
    expect(button).toMatchObject({
      custom_id: buildReportIntakeAdminCloseCustomId('intake-1'),
      label: 'Close Report',
    });
  });

  it('denies report intake admin actions for non-staff members', async () => {
    const viewerMember = buildMember('guild-1', 'viewer-1');
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      id: 'guild-1',
      members: { fetch: jest.fn().mockResolvedValue(viewerMember) },
    });
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.findIntakeById.mockResolvedValue(buildReportIntake());
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction(
      buildReportIntakeAdminActionsCustomId('intake-1'),
      'guild-1',
      {
        id: 'viewer-1',
      } as User
    );
    (interaction as any).channel = {
      id: 'report-thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    };
    (interaction as any).channelId = 'report-thread-1';

    await handler.handleReportIntakeAdminAction(interaction, interaction.customId);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: 'You need moderation permissions to use report admin actions.',
      })
    );
  });

  it('closes a report intake from the admin action confirmation', async () => {
    const staffMember = {
      ...buildMember('guild-1', 'staff-1'),
      permissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ModerateMembers),
      },
    } as unknown as GuildMember;
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      id: 'guild-1',
      members: { fetch: jest.fn().mockResolvedValue(staffMember) },
    });
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.findIntakeById.mockResolvedValue(buildReportIntake());
    reportIntakeService.closeIntakeForThread.mockResolvedValue({
      closed: true,
      message: 'Report intake closed. No report has been filed.',
      shouldArchiveThread: true,
    });
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction(
      buildReportIntakeAdminConfirmCloseCustomId('intake-1'),
      'guild-1',
      { id: 'staff-1' } as User
    );
    const thread = {
      id: 'report-thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
      archived: false,
      setArchived: jest.fn().mockResolvedValue(undefined),
    };
    (interaction as any).channel = thread;
    (interaction as any).channelId = 'report-thread-1';

    await handler.handleReportIntakeAdminAction(interaction, interaction.customId);

    expect(reportIntakeService.closeIntakeForThread).toHaveBeenCalledWith({
      threadId: 'report-thread-1',
      closedById: 'staff-1',
      closedByStaff: true,
    });
    expect(interaction.update).toHaveBeenCalledWith({
      content: 'Report intake closed.',
      components: [],
      allowedMentions: { parse: [] },
    });
    expect(thread.send).toHaveBeenCalledWith({
      content: 'Report intake closed. No report has been filed.',
      allowedMentions: { parse: [] },
    });
    expect(thread.setArchived).toHaveBeenCalledWith(true, 'Report intake closed');
  });

  it('submits a confirmed report intake target through the user report workflow', async () => {
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.confirmCandidate.mockResolvedValue({
      confirmed: true,
      message: 'confirmed',
      reason: 'Report intake target confirmed by reporter.',
      attachments: [
        {
          id: 'attachment-1',
          url: 'https://cdn.discordapp.com/screenshot.png',
          contentType: 'image/png',
          size: 1234,
        },
      ],
    });
    const targetMember = buildMember('guild-1', 'user-1');
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      members: { fetch: jest.fn().mockResolvedValue(targetMember) },
    });
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction('report_intake_confirm:intake-1:user-1', 'guild-1', {
      id: 'reporter-1',
    } as User);
    const thread = {
      id: 'thread-1',
      isThread: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
      archived: false,
      setArchived: jest.fn().mockResolvedValue(undefined),
    };
    (interaction as any).channel = thread;

    await handler.handleReportIntakeConfirm(interaction, interaction.customId);

    expect(reportIntakeService.confirmCandidate).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      targetUserId: 'user-1',
      confirmedById: 'reporter-1',
      confirmedByStaff: false,
    });
    expect(securityActionService.handleConfirmedReportIntake).toHaveBeenCalledWith(
      targetMember,
      interaction.user,
      {
        reason: 'Report intake target confirmed by reporter.',
        intakeId: 'intake-1',
        attachments: [
          {
            id: 'attachment-1',
            url: 'https://cdn.discordapp.com/screenshot.png',
            contentType: 'image/png',
            size: 1234,
          },
        ],
      }
    );
    expect(reportIntakeService.markSubmitted).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      targetUserId: 'user-1',
      submittedById: 'reporter-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Submitted report for <@user-1> (ID: `user-1`; Discord username: `test-user`).',
    });
    expect(thread.send).toHaveBeenCalledWith({
      content:
        'Report submitted. Moderators have been notified, so this intake thread is now closed.\nTarget: <@user-1> (ID: `user-1`; Discord username: `test-user`)',
      allowedMentions: { parse: [] },
    });
    expect(thread.setArchived).toHaveBeenCalledWith(true, 'Report intake submitted');
  });

  it('allows configured case responders to confirm an intake for the original reporter', async () => {
    const reporter = { id: 'reporter-1', username: 'reporter' } as User;
    const staffMember = {
      ...buildMember('guild-1', 'staff-1'),
      roles: { cache: new Map([['123456789012345678', {}]]) },
    } as unknown as GuildMember;
    const targetMember = buildMember('guild-1', 'user-1');
    const membersFetch = jest.fn().mockImplementation(async (userId: string) => {
      if (userId === 'user-1') return targetMember;
      if (userId === 'staff-1') return staffMember;
      return null;
    });
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      id: 'guild-1',
      members: { fetch: membersFetch },
    });
    (client as any).users = {
      fetch: jest.fn().mockResolvedValue(reporter),
    };
    configService.getServerConfig.mockResolvedValue({
      settings: {
        case_responder_role_ids: ['123456789012345678'],
        case_responder_routing_mode: 'ping_only',
      },
    } as any);
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.confirmCandidate.mockResolvedValue({
      confirmed: true,
      message: 'confirmed',
      reporterId: 'reporter-1',
      reason: 'Report intake target confirmed by staff.',
    });
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction('report_intake_confirm:intake-1:user-1', 'guild-1', {
      id: 'staff-1',
    } as User);

    await handler.handleReportIntakeConfirm(interaction, interaction.customId);

    expect(reportIntakeService.confirmCandidate).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      targetUserId: 'user-1',
      confirmedById: 'staff-1',
      confirmedByStaff: true,
    });
    expect(securityActionService.handleConfirmedReportIntake).toHaveBeenCalledWith(
      targetMember,
      reporter,
      {
        reason: 'Report intake target confirmed by staff.',
        intakeId: 'intake-1',
      }
    );
    expect(reportIntakeService.markSubmitted).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      targetUserId: 'user-1',
      submittedById: 'staff-1',
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
    securityActionService.handleConfirmedReportIntake.mockRejectedValueOnce(
      new Error('case creation failed')
    );
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
      confirmedByStaff: false,
    });
    expect(reportIntakeService.markSubmitted).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'The report target was confirmed, but Drasil could not finish submitting it automatically. A moderator can review the intake thread.',
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('records a reporter No answer for report intake candidates', async () => {
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.rejectCandidates.mockResolvedValue({
      rejected: true,
      message: 'Okay, I will not submit a report for that target.',
    });
    const threadChannel = { isThread: jest.fn().mockReturnValue(true), send: jest.fn() };
    const handler = createHandler(reportIntakeService);
    const interaction = {
      ...buildInteraction('report_intake_reject:intake-1:prompt-token', 'guild-1', {
        id: 'reporter-1',
      } as User),
      channel: threadChannel,
    } as unknown as ButtonInteraction;

    await handler.handleReportIntakeConfirm(interaction, interaction.customId);

    expect(reportIntakeService.rejectCandidates).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      rejectedById: 'reporter-1',
      promptToken: 'prompt-token',
      rejectedByStaff: false,
    });
    expect(securityActionService.handleConfirmedReportIntake).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Okay, I will not submit a report for that target.',
    });
    expect(threadChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('I will not submit that target'),
      })
    );
  });

  it('allows moderators to reject report intake candidates', async () => {
    const staffMember = {
      ...buildMember('guild-1', 'staff-1'),
      permissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ModerateMembers),
      },
    } as unknown as GuildMember;
    (client.guilds.fetch as jest.Mock).mockResolvedValueOnce({
      id: 'guild-1',
      members: { fetch: jest.fn().mockResolvedValue(staffMember) },
    });
    const reportIntakeService = createReportIntakeService();
    reportIntakeService.rejectCandidates.mockResolvedValue({
      rejected: true,
      message: 'Okay, I will not submit a report for that target.',
    });
    const handler = createHandler(reportIntakeService);
    const interaction = buildInteraction('report_intake_reject:intake-1:prompt-token', 'guild-1', {
      id: 'staff-1',
    } as User);

    await handler.handleReportIntakeConfirm(interaction, interaction.customId);

    expect(reportIntakeService.rejectCandidates).toHaveBeenCalledWith({
      intakeId: 'intake-1',
      rejectedById: 'staff-1',
      promptToken: 'prompt-token',
      rejectedByStaff: true,
    });
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
    expect(securityActionService.handleConfirmedReportIntake).not.toHaveBeenCalled();
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
    expect(securityActionService.handleConfirmedReportIntake).not.toHaveBeenCalled();
    expect(reportIntakeService.markSubmitted).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'The confirmed target is no longer available in this server.',
    });
  });
});
