import { ChannelType, Guild, GuildMember, ThreadChannel, User } from 'discord.js';
import {
  CASE_STAFF_ROUTING_METADATA_KEY,
  REPORT_REVIEW_THREAD_TYPE,
  ThreadManager,
  VERIFICATION_THREAD_TYPE,
  VERIFICATION_THREAD_TYPE_METADATA_KEY,
} from '../../services/ThreadManager';
import { IConfigService } from '../../config/ConfigService';
import {
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
  InMemoryVerificationEventRepository,
} from '../fakes/inMemoryRepositories';
import { DetectionType, VerificationEvent, VerificationStatus } from '../../repositories/types';
import {
  DISCORD_MESSAGE_CONTENT_MAX_LENGTH,
  DEFAULT_VERIFICATION_PROMPT_TEMPLATE,
  renderVerificationPromptTemplate,
} from '../../utils/verificationPromptTemplate';

const buildMember = (guildId: string, userId: string, guildName = 'Test Guild'): GuildMember =>
  ({
    id: userId,
    joinedAt: new Date(),
    guild: { id: guildId, name: guildName } as Guild,
    user: {
      id: userId,
      username: 'test-user',
      tag: 'test-user#0001',
    } as User,
  }) as unknown as GuildMember;

const buildVerificationEvent = (overrides: Partial<VerificationEvent> = {}): VerificationEvent => ({
  id: overrides.id ?? 'ver-1',
  server_id: overrides.server_id ?? 'guild-1',
  user_id: overrides.user_id ?? 'user-1',
  detection_event_id: overrides.detection_event_id ?? null,
  thread_id: overrides.thread_id ?? null,
  notification_message_id: overrides.notification_message_id ?? null,
  status: overrides.status ?? VerificationStatus.PENDING,
  created_at: overrides.created_at ?? new Date(),
  updated_at: overrides.updated_at ?? new Date(),
  resolved_at: overrides.resolved_at ?? null,
  resolved_by: overrides.resolved_by ?? null,
  notes: overrides.notes ?? null,
  metadata: overrides.metadata ?? null,
});

describe('ThreadManager (unit)', () => {
  let configService: IConfigService;
  let verificationEventRepository: InMemoryVerificationEventRepository;
  let userRepository: InMemoryUserRepository;
  let serverRepository: InMemoryServerRepository;
  let serverMemberRepository: InMemoryServerMemberRepository;

  type ThreadParentChannel = {
    threads: {
      create: jest.Mock;
      fetch?: jest.Mock;
    };
  };

  let channel: ThreadParentChannel;
  let thread: jest.Mocked<ThreadChannel>;

  beforeEach(() => {
    thread = {
      id: 'thread-1',
      url: 'https://discord.com/channels/thread-1',
      members: {
        add: jest.fn().mockResolvedValue(undefined),
      },
      send: jest.fn().mockResolvedValue(undefined),
      setArchived: jest.fn().mockResolvedValue(undefined),
      setLocked: jest.fn().mockResolvedValue(undefined),
      setInvitable: jest.fn().mockResolvedValue(undefined),
      messages: {
        fetch: jest.fn().mockResolvedValue(new Map()),
      },
      isThread: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<ThreadChannel>;

    channel = {
      threads: {
        create: jest.fn().mockResolvedValue(thread),
        fetch: jest.fn().mockResolvedValue(thread),
      },
    };

    configService = {
      getVerificationChannel: jest.fn().mockResolvedValue(channel),
      getAdminChannel: jest.fn().mockResolvedValue(channel),
      getServerConfig: jest.fn().mockResolvedValue({ settings: {} }),
    } as unknown as IConfigService;

    verificationEventRepository = new InMemoryVerificationEventRepository();
    userRepository = new InMemoryUserRepository();
    serverRepository = new InMemoryServerRepository();
    serverMemberRepository = new InMemoryServerMemberRepository();
  });

  it('creates a verification thread and stores thread_id', async () => {
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const member = buildMember('guild-1', 'user-1');
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    const createdThread = await manager.createVerificationThread(member, event);
    const storedEvent = await verificationEventRepository.findById(event.id);

    expect(channel.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ChannelType.PrivateThread,
      })
    );
    expect(thread.setInvitable).toHaveBeenCalledWith(false, expect.any(String));
    expect(createdThread?.id).toBe('thread-1');
    expect(storedEvent?.thread_id).toBe('thread-1');
    expect(storedEvent?.metadata).toMatchObject({
      [VERIFICATION_THREAD_TYPE_METADATA_KEY]: VERIFICATION_THREAD_TYPE,
    });
    expect(thread.members.add).toHaveBeenCalledWith(member.id);
    expect(thread.send).toHaveBeenCalledWith({
      content: renderVerificationPromptTemplate(DEFAULT_VERIFICATION_PROMPT_TEMPLATE, {
        userMention: `<@${member.id}>`,
        serverName: member.guild.name,
      }),
      allowedMentions: {
        parse: [],
        users: [member.id],
        roles: [],
        repliedUser: false,
      },
    });
  });

  it('retries adding the flagged user before sending the verification prompt', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (thread.members.add as jest.Mock)
      .mockRejectedValueOnce(new Error('Missing Access'))
      .mockResolvedValueOnce(undefined);
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    (manager as any).wait = jest.fn().mockResolvedValue(undefined);
    const member = buildMember('guild-1', 'user-1');
    const fetch = jest.fn().mockResolvedValue(member);
    (member as any).fetch = fetch;
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    try {
      const createdThread = await manager.createVerificationThread(member, event);

      expect(createdThread?.id).toBe('thread-1');
      expect(thread.members.add).toHaveBeenCalledTimes(2);
      expect((manager as any).wait).toHaveBeenCalledWith(750);
      expect(fetch).toHaveBeenCalledWith(true);
      expect(thread.send).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining(`<@${member.id}>`) })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps a created verification thread linked when prompt send fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    thread.send.mockRejectedValueOnce(new Error('Missing Send Messages permission'));
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    const member = buildMember('guild-1', 'user-1');
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    try {
      await expect(manager.createVerificationThread(member, event)).rejects.toThrow(
        'Failed to send initial verification prompt'
      );
      const storedEvent = await verificationEventRepository.findById(event.id);

      expect(channel.threads.create).toHaveBeenCalled();
      expect(storedEvent?.thread_id).toBe('thread-1');
      expect(storedEvent?.metadata).toMatchObject({
        [VERIFICATION_THREAD_TYPE_METADATA_KEY]: VERIFICATION_THREAD_TYPE,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('repairs an existing verification thread by adding the user and sending a missing prompt', async () => {
    const manager = new ThreadManager(
      { user: { id: 'bot-1' } } as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    const member = buildMember('guild-1', 'user-1');
    const event = buildVerificationEvent({ thread_id: 'thread-1' });

    const result = await manager.repairVerificationThread(member, event);

    expect(channel.threads.fetch).toHaveBeenCalledWith('thread-1');
    expect(thread.members.add).toHaveBeenCalledWith(member.id);
    expect(thread.messages.fetch).toHaveBeenCalledWith({ limit: 25 });
    expect(thread.send).toHaveBeenCalledWith({
      content: renderVerificationPromptTemplate(DEFAULT_VERIFICATION_PROMPT_TEMPLATE, {
        userMention: `<@${member.id}>`,
        serverName: member.guild.name,
      }),
      allowedMentions: {
        parse: [],
        users: [member.id],
        roles: [],
        repliedUser: false,
      },
    });
    expect(result).toEqual({
      threadId: 'thread-1',
      threadCreated: false,
      userAdded: true,
      promptSent: true,
      promptAlreadyPresent: false,
    });
  });

  it('does not duplicate the verification prompt during repair', async () => {
    (thread.messages.fetch as jest.Mock).mockResolvedValueOnce(
      new Map([
        [
          'message-1',
          {
            author: { id: 'bot-1', bot: true },
            content: '<@user-1> already asked for verification.',
          },
        ],
      ])
    );
    const manager = new ThreadManager(
      { user: { id: 'bot-1' } } as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    const member = buildMember('guild-1', 'user-1');
    const event = buildVerificationEvent({ thread_id: 'thread-1' });

    const result = await manager.repairVerificationThread(member, event);

    expect(thread.members.add).toHaveBeenCalledWith(member.id);
    expect(thread.send).not.toHaveBeenCalled();
    expect(result.promptAlreadyPresent).toBe(true);
    expect(result.promptSent).toBe(false);
  });

  it('uses custom verification prompt template when configured', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      settings: {
        verification_prompt_template:
          'Welcome {user_mention} to {server_name}.\nTell us about yourself.',
      },
    });

    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const member = buildMember('guild-1', 'user-1', 'My @everyone Server');
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    await manager.createVerificationThread(member, event);

    expect(thread.send).toHaveBeenCalledWith({
      content: 'Welcome <@user-1> to My @\u200beveryone Server.\nTell us about yourself.',
      allowedMentions: {
        parse: [],
        users: [member.id],
        roles: [],
        repliedUser: false,
      },
    });
  });

  it('creates a moderator-only report review thread without adding the reported user', async () => {
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const member = buildMember('guild-1', 'user-1');
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    const createdThread = await manager.createReportReviewThread(member, event, {
      label: 'SUSPICIOUS',
      confidence: 1.0,
      reasons: ['Reported by user reporter-1. Reason: suspicious DM'],
      triggerSource: DetectionType.USER_REPORT,
      triggerContent: 'suspicious DM',
    });
    const storedEvent = await verificationEventRepository.findById(event.id);

    expect(channel.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Report review: test-user',
        type: ChannelType.PrivateThread,
      })
    );
    expect(createdThread?.id).toBe('thread-1');
    expect(storedEvent?.thread_id).toBe('thread-1');
    expect(storedEvent?.metadata).toMatchObject({
      [VERIFICATION_THREAD_TYPE_METADATA_KEY]: REPORT_REVIEW_THREAD_TYPE,
    });
    expect(thread.members.add).not.toHaveBeenCalled();
    expect(thread.setInvitable).toHaveBeenCalledWith(false, expect.any(String));
    expect(thread.send).toHaveBeenCalledWith({
      content: expect.stringContaining('No automatic restriction was applied.'),
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
        repliedUser: false,
      },
    });
  });

  it('keeps a created report review thread linked when prompt send fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    thread.send.mockRejectedValueOnce(new Error('Missing Send Messages permission'));
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    const member = buildMember('guild-1', 'user-1');
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    try {
      await expect(
        manager.createReportReviewThread(member, event, {
          label: 'SUSPICIOUS',
          confidence: 1.0,
          reasons: ['Reported by user reporter-1. Reason: suspicious DM'],
          triggerSource: DetectionType.USER_REPORT,
          triggerContent: 'suspicious DM',
        })
      ).rejects.toThrow('Failed to send report review thread prompt');
      const storedEvent = await verificationEventRepository.findById(event.id);

      expect(channel.threads.create).toHaveBeenCalled();
      expect(storedEvent?.thread_id).toBe('thread-1');
      expect(storedEvent?.metadata).toMatchObject({
        [VERIFICATION_THREAD_TYPE_METADATA_KEY]: REPORT_REVIEW_THREAD_TYPE,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('creates an inactive report intake thread before adding the reporter', async () => {
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    const reporter = buildMember('guild-1', 'reporter-1');

    const createdThread = await manager.createReportIntakeThread(channel as any, reporter);

    expect(channel.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Report intake: test-user',
        type: ChannelType.PrivateThread,
      })
    );
    expect(createdThread?.id).toBe('thread-1');
    expect(thread.setInvitable).toHaveBeenCalledWith(false, expect.any(String));
    expect(thread.members.add).not.toHaveBeenCalled();
    expect(thread.send).not.toHaveBeenCalled();
  });

  it('activates a report intake thread by adding the reporter and welcome message', async () => {
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    const reporter = buildMember('guild-1', 'reporter-1');

    const activated = await manager.activateReportIntakeThread(thread, reporter);

    expect(activated).toBe(true);
    expect(thread.members.add).toHaveBeenCalledWith('reporter-1');
    expect(thread.send).toHaveBeenCalledWith({
      content: expect.stringContaining('Please put the report context in this private thread.'),
      allowedMentions: {
        parse: [],
        users: ['reporter-1'],
        roles: [],
        repliedUser: false,
      },
    });
  });

  it('adds configured case responder role members to private report review threads', async () => {
    const staffMember = { id: 'staff-1' };
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      members: {
        fetch: jest.fn().mockResolvedValue(undefined),
      },
      roles: {
        fetch: jest.fn().mockResolvedValue({
          members: new Map([['staff-1', staffMember]]),
        }),
      },
    } as any;
    const member = {
      ...buildMember('guild-1', 'user-1'),
      guild,
    } as GuildMember;
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      settings: {
        case_responder_role_ids: ['123456789012345678'],
        case_responder_routing_mode: 'ping_and_add_members',
        case_responder_thread_member_cap: 5,
      },
    });

    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    await manager.createReportReviewThread(member, event, {
      label: 'SUSPICIOUS',
      confidence: 1.0,
      reasons: ['Reported by user reporter-1. Reason: suspicious DM'],
      triggerSource: DetectionType.USER_REPORT,
      triggerContent: 'suspicious DM',
    });

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(thread.members.add).toHaveBeenCalledWith('staff-1');
    expect(thread.members.add).not.toHaveBeenCalledWith(member.id);
    const storedEvent = await verificationEventRepository.findById(event.id);
    expect(storedEvent?.metadata).toMatchObject({
      [CASE_STAFF_ROUTING_METADATA_KEY]: {
        addedUserIds: ['staff-1'],
        warnings: [],
      },
    });
  });

  it('falls back to default template and logs warning when config load fails', async () => {
    (configService.getServerConfig as jest.Mock).mockRejectedValue(new Error('config failure'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const manager = new ThreadManager(
        {} as any,
        configService,
        verificationEventRepository,
        userRepository,
        serverRepository,
        serverMemberRepository
      );

      const member = buildMember('guild-1', 'user-1');
      const event = await verificationEventRepository.createFromDetection(
        null,
        'guild-1',
        'user-1',
        VerificationStatus.PENDING
      );

      await manager.createVerificationThread(member, event);

      expect(thread.send).toHaveBeenCalledWith({
        content: renderVerificationPromptTemplate(DEFAULT_VERIFICATION_PROMPT_TEMPLATE, {
          userMention: `<@${member.id}>`,
          serverName: member.guild.name,
        }),
        allowedMentions: {
          parse: [],
          users: [member.id],
          roles: [],
          repliedUser: false,
        },
      });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('truncates rendered prompt to Discord content limit', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const repeatedPlaceholder = '{user_mention}'.repeat(250);
      (configService.getServerConfig as jest.Mock).mockResolvedValue({
        settings: {
          verification_prompt_template: repeatedPlaceholder,
        },
      });

      const manager = new ThreadManager(
        {} as any,
        configService,
        verificationEventRepository,
        userRepository,
        serverRepository,
        serverMemberRepository
      );

      const member = buildMember('guild-1', 'user-1');
      const event = await verificationEventRepository.createFromDetection(
        null,
        'guild-1',
        'user-1',
        VerificationStatus.PENDING
      );

      await manager.createVerificationThread(member, event);

      const sendPayload = (thread.send as jest.Mock).mock.calls[0][0] as {
        content: string;
      };
      expect(sendPayload.content.length).toBeLessThanOrEqual(DISCORD_MESSAGE_CONTENT_MAX_LENGTH);
      expect(sendPayload.content).toContain(
        '[Verification prompt truncated to fit Discord message limits.]'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Verification prompt exceeded Discord content limit')
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('falls back to admin channel when verification channel is missing', async () => {
    channel = {
      threads: {
        create: jest.fn().mockResolvedValue(thread),
      },
    };
    (configService.getVerificationChannel as jest.Mock).mockResolvedValue(undefined);
    (configService.getAdminChannel as jest.Mock).mockResolvedValue(channel);

    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const member = buildMember('guild-1', 'user-1');
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    await manager.createVerificationThread(member, event);

    expect(channel.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ChannelType.PrivateThread,
      })
    );
    expect(thread.setInvitable).toHaveBeenCalledWith(false, expect.any(String));
  });

  it('resolves verification thread and locks it', async () => {
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const event = buildVerificationEvent({ thread_id: 'thread-1' });

    const result = await manager.resolveVerificationThread(event, VerificationStatus.VERIFIED);

    expect(result).toBe(true);
    expect(thread.send).toHaveBeenCalled();
    expect(thread.setArchived).toHaveBeenCalledWith(true);
    expect(thread.setLocked).toHaveBeenCalledWith(true);
  });

  it('reopens verification thread when available', async () => {
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const event = buildVerificationEvent({ thread_id: 'thread-1' });

    const result = await manager.reopenVerificationThread(event);

    expect(result).toBe(true);
    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.setLocked).toHaveBeenCalledWith(false);
  });
});
