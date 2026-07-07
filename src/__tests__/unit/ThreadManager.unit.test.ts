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
import { parseAdminActionCustomId } from '../../utils/adminActionCustomIds';
import { parseReportIntakeAdminActionCustomId } from '../../utils/reportIntakeAdminActions';

const buildMember = (
  guildId: string,
  userId: string,
  guildName = 'Test Guild',
  pending = false
): GuildMember =>
  ({
    id: userId,
    joinedAt: new Date(),
    pending,
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
  private_evidence_thread_id: overrides.private_evidence_thread_id ?? null,
  notification_channel_id: overrides.notification_channel_id ?? null,
  notification_message_id: overrides.notification_message_id ?? null,
  status: overrides.status ?? VerificationStatus.PENDING,
  created_at: overrides.created_at ?? new Date(),
  updated_at: overrides.updated_at ?? new Date(),
  resolved_at: overrides.resolved_at ?? null,
  resolved_by: overrides.resolved_by ?? null,
  notes: overrides.notes ?? null,
  metadata: overrides.metadata ?? null,
});

const extractComponentCustomIds = (components: unknown[]): string[] =>
  components.flatMap((row) =>
    ((row as { components?: unknown[] }).components ?? []).map(
      (component) =>
        (component as { data?: { custom_id?: string }; customId?: string }).data?.custom_id ??
        (component as { customId?: string }).customId ??
        ''
    )
  );

const extractComponentLabels = (components: unknown[]): string[] =>
  components.flatMap((row) =>
    ((row as { components?: unknown[] }).components ?? []).map(
      (component) => (component as { data?: { label?: string } }).data?.label ?? ''
    )
  );

const buildThread = (id = 'thread-1'): jest.Mocked<ThreadChannel> =>
  ({
    id,
    url: `https://discord.com/channels/${id}`,
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
  }) as unknown as jest.Mocked<ThreadChannel>;

describe('ThreadManager (unit)', () => {
  let configService: IConfigService;
  let verificationEventRepository: InMemoryVerificationEventRepository;
  let userRepository: InMemoryUserRepository;
  let serverRepository: InMemoryServerRepository;
  let serverMemberRepository: InMemoryServerMemberRepository;

  type ThreadParentChannel = {
    id?: string;
    threads: {
      create: jest.Mock;
      fetch?: jest.Mock;
    };
    permissionsFor?: jest.Mock;
    fetch?: jest.Mock;
  };

  let channel: ThreadParentChannel;
  let thread: jest.Mocked<ThreadChannel>;

  beforeEach(() => {
    thread = buildThread();

    channel = {
      id: 'verification-channel',
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
      components: expect.any(Array),
    });
    const prompt = thread.send.mock.calls[0][0] as { components: unknown[] };
    const customIds = extractComponentCustomIds(prompt.components);
    expect(customIds).toHaveLength(1);
    expect(parseAdminActionCustomId(customIds[0])).toEqual({
      surface: 'case',
      action: 'menu',
      userId: member.id,
    });
  });

  it('does not create a verification thread while the member is pending screening', async () => {
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const member = buildMember('guild-1', 'user-1', 'Test Guild', true);
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    await expect(manager.createVerificationThread(member, event)).rejects.toThrow(
      'membership screening/onboarding'
    );
    expect(channel.threads.create).not.toHaveBeenCalled();
    const storedEvent = await verificationEventRepository.findById(event.id);
    expect(storedEvent?.thread_id).toBeNull();
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

  it('explains parent-channel access when Discord denies adding the flagged user', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    channel.permissionsFor = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(false),
    });
    (thread.members.add as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Missing Access'), { code: 50001 })
    );
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
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    try {
      await expect(manager.createVerificationThread(member, event)).rejects.toThrow(
        'cannot currently view parent channel verification-channel'
      );
      expect(thread.members.add).toHaveBeenCalledTimes(4);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('describes missing access after parent access is visible as propagation', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    channel.permissionsFor = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true),
    });
    (thread.members.add as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Missing Access'), { code: 50001 })
    );
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
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    try {
      await expect(manager.createVerificationThread(member, event)).rejects.toThrow(
        'not that the bot lost access'
      );
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('explains pending screening when the refreshed member is still pending', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (thread.members.add as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Missing Access'), { code: 50001 })
    );
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
    const pendingMember = buildMember('guild-1', 'user-1', 'Test Guild', true);
    const fetch = jest.fn().mockResolvedValue(pendingMember);
    (member as any).fetch = fetch;
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    try {
      await expect(manager.createVerificationThread(member, event)).rejects.toThrow(
        'membership screening/onboarding'
      );
      expect(fetch).toHaveBeenCalledWith(true);
      expect(thread.members.add).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('does not claim propagation when parent-channel access cannot be checked', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (thread.members.add as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Missing Access'), { code: 50001 })
    );
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
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );

    try {
      await expect(manager.createVerificationThread(member, event)).rejects.toThrow(
        'parent-channel access could not be verified'
      );
    } finally {
      errorSpy.mockRestore();
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
    expect(thread.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
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
      components: expect.any(Array),
    });
    const prompt = thread.send.mock.calls[0][0] as { components: unknown[] };
    const customIds = extractComponentCustomIds(prompt.components);
    expect(customIds).toHaveLength(1);
    expect(parseAdminActionCustomId(customIds[0])).toEqual({
      surface: 'case',
      action: 'menu',
      userId: member.id,
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

  it('sends a missing prompt when repair finds unrelated bot messages', async () => {
    (thread.messages.fetch as jest.Mock).mockResolvedValueOnce(
      new Map([
        [
          'message-1',
          {
            author: { id: 'bot-1', bot: true },
            content: 'Case responder routing updated.',
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
    expect(thread.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(`<@${member.id}>`) })
    );
    expect(result.promptAlreadyPresent).toBe(false);
    expect(result.promptSent).toBe(true);
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
      components: expect.any(Array),
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
      content: expect.stringContaining('No case was opened automatically.'),
      allowedMentions: {
        parse: [],
        users: [],
        roles: [],
        repliedUser: false,
      },
      components: expect.any(Array),
    });
    const prompt = thread.send.mock.calls[0][0] as { components: unknown[] };
    expect(extractComponentLabels(prompt.components)).toEqual([
      'Verify',
      'Ban...',
      'Close',
      'Other Actions',
    ]);
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

  it('creates an admin evidence thread from the notification message', async () => {
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
    const notificationMessage = {
      startThread: jest.fn().mockResolvedValue(thread),
      fetch: jest.fn().mockResolvedValue({ thread: null }),
    } as any;

    const createdThread = await manager.createPrivateEvidenceThread(
      member,
      event,
      {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: ['Admin case opened by <@admin-1>.'],
        triggerSource: DetectionType.ADMIN_CASE,
        triggerContent: 'Opened by <@admin-1>',
      },
      notificationMessage
    );
    const storedEvent = await verificationEventRepository.findById(event.id);

    expect(notificationMessage.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Evidence: test-user' })
    );
    expect(createdThread?.id).toBe('thread-1');
    expect(storedEvent?.private_evidence_thread_id).toBe('thread-1');
    expect(thread.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Admin-only evidence thread for <@user-1> (user-1).'),
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
        components: expect.any(Array),
      })
    );
    const prompt = thread.send.mock.calls[0][0] as { components: unknown[] };
    expect(extractComponentLabels(prompt.components)).toEqual([
      'Verify',
      'Ban...',
      'Close',
      'Other Actions',
    ]);
  });

  it('recovers an already-attached admin evidence thread when duplicate start fails', async () => {
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
    const notificationMessage = {
      startThread: jest
        .fn()
        .mockRejectedValue(new Error('Thread already created for this message')),
      fetch: jest.fn().mockResolvedValueOnce({ thread: null }).mockResolvedValueOnce({ thread }),
    } as any;

    const recoveredThread = await manager.createPrivateEvidenceThread(
      member,
      event,
      {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: ['Admin case opened by <@admin-1>.'],
        triggerSource: DetectionType.ADMIN_CASE,
        triggerContent: 'Opened by <@admin-1>',
      },
      notificationMessage
    );
    const storedEvent = await verificationEventRepository.findById(event.id);

    expect(notificationMessage.startThread).toHaveBeenCalled();
    expect(notificationMessage.fetch).toHaveBeenCalledTimes(2);
    expect(recoveredThread?.id).toBe('thread-1');
    expect(storedEvent?.private_evidence_thread_id).toBe('thread-1');
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

    const activated = await manager.activateReportIntakeThread(thread, reporter, 'intake-1');

    expect(activated).toBe(true);
    expect(thread.members.add).toHaveBeenCalledWith('reporter-1');
    expect(thread.send).toHaveBeenCalledWith({
      content: expect.stringContaining('Add what happened here.'),
      components: expect.any(Array),
      allowedMentions: {
        parse: [],
        users: ['reporter-1'],
        roles: [],
        repliedUser: false,
      },
    });
    const message = (thread.send as jest.Mock).mock.calls[0][0];
    const button = message.components[0].toJSON().components[0];
    expect(button.label).toBe('Admin Actions');
    expect(parseReportIntakeAdminActionCustomId(button.custom_id)).toEqual({
      action: 'menu',
      intakeId: 'intake-1',
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
        components: expect.any(Array),
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
    const evidenceThread = buildThread('evidence-thread-1');
    (channel.threads.fetch as jest.Mock).mockImplementation((threadId: string) =>
      Promise.resolve(threadId === 'evidence-thread-1' ? evidenceThread : thread)
    );
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const event = buildVerificationEvent({
      thread_id: 'thread-1',
      private_evidence_thread_id: 'evidence-thread-1',
      status: VerificationStatus.BANNED,
      resolved_at: new Date('2026-01-05T00:00:00Z'),
      notes: 'Confirmed scam',
      metadata: {
        user_snapshot: {
          tag: 'test-user#0001',
          username: 'test-user',
          display_name: 'Test User',
          avatar_url: 'https://example.com/avatar.png',
          account_created_at: '2026-01-01T00:00:00.000Z',
          joined_at: '2026-01-02T00:00:00.000Z',
        },
      },
    });

    const result = await manager.resolveVerificationThread(
      event,
      VerificationStatus.BANNED,
      'admin-1'
    );

    expect(result).toBe(true);
    expect(thread.send).toHaveBeenCalledWith({
      content: expect.stringContaining('Case handled: banned.'),
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    });
    expect(thread.send).toHaveBeenCalledWith({
      content: expect.stringContaining('Action taken by: admin-1'),
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    });
    expect(thread.send).toHaveBeenCalledWith({
      content: expect.stringContaining('- Avatar at time of case: https://example.com/avatar.png'),
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    });
    expect(thread.send).toHaveBeenCalledWith({
      content: expect.stringContaining('- Notes: Confirmed scam'),
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    });
    expect(thread.setArchived).toHaveBeenCalledWith(true);
    expect(thread.setLocked).toHaveBeenCalledWith(true);
    expect(evidenceThread.setArchived).toHaveBeenCalledWith(true);
    expect(evidenceThread.setLocked).toHaveBeenCalledWith(true);
    expect(thread.setLocked.mock.invocationCallOrder[0]).toBeLessThan(
      thread.setArchived.mock.invocationCallOrder[0]
    );
    expect(evidenceThread.setLocked.mock.invocationCallOrder[0]).toBeLessThan(
      evidenceThread.setArchived.mock.invocationCallOrder[0]
    );
  });

  it('closes verification threads even when the final resolution message fails', async () => {
    const evidenceThread = buildThread('evidence-thread-1');
    thread.send.mockRejectedValueOnce(new Error('thread archived'));
    (channel.threads.fetch as jest.Mock).mockImplementation((threadId: string) =>
      Promise.resolve(threadId === 'evidence-thread-1' ? evidenceThread : thread)
    );
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const result = await manager.resolveVerificationThread(
      buildVerificationEvent({
        thread_id: 'thread-1',
        private_evidence_thread_id: 'evidence-thread-1',
        status: VerificationStatus.CLOSED_NO_ACTION,
      }),
      VerificationStatus.CLOSED_NO_ACTION,
      'admin-1'
    );

    expect(result).toBe(true);
    expect(thread.setLocked).toHaveBeenCalledWith(true);
    expect(thread.setArchived).toHaveBeenCalledWith(true);
    expect(evidenceThread.setLocked).toHaveBeenCalledWith(true);
    expect(evidenceThread.setArchived).toHaveBeenCalledWith(true);
  });

  it('dry-runs and executes resolved thread closure without posting duplicate messages', async () => {
    const evidenceThread = buildThread('evidence-thread-1');
    (channel.threads.fetch as jest.Mock).mockImplementation((threadId: string) =>
      Promise.resolve(threadId === 'evidence-thread-1' ? evidenceThread : thread)
    );
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    const event = buildVerificationEvent({
      thread_id: 'thread-1',
      private_evidence_thread_id: 'evidence-thread-1',
      status: VerificationStatus.VERIFIED,
    });

    const dryRun = await manager.closeResolvedVerificationThreads(event);

    expect(dryRun.closedAny).toBe(false);
    expect(dryRun.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadId: 'thread-1', wouldClose: true, closed: false }),
        expect.objectContaining({ threadId: 'evidence-thread-1', wouldClose: true, closed: false }),
      ])
    );
    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setArchived).not.toHaveBeenCalled();

    const executed = await manager.closeResolvedVerificationThreads(event, { execute: true });

    expect(executed.closedAny).toBe(true);
    expect(thread.send).not.toHaveBeenCalled();
    expect(thread.setLocked).toHaveBeenCalledWith(true);
    expect(evidenceThread.setLocked).toHaveBeenCalledWith(true);
  });

  it('reopens verification thread when available', async () => {
    const evidenceThread = buildThread('evidence-thread-1');
    (channel.threads.fetch as jest.Mock).mockImplementation((threadId: string) =>
      Promise.resolve(threadId === 'evidence-thread-1' ? evidenceThread : thread)
    );
    const manager = new ThreadManager(
      {} as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    const event = buildVerificationEvent({
      thread_id: 'thread-1',
      private_evidence_thread_id: 'evidence-thread-1',
    });

    const result = await manager.reopenVerificationThread(event);

    expect(result).toBe(true);
    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.setLocked).toHaveBeenCalledWith(false);
    expect(evidenceThread.setArchived).toHaveBeenCalledWith(false);
    expect(evidenceThread.setLocked).toHaveBeenCalledWith(false);
    expect(thread.setArchived.mock.invocationCallOrder[0]).toBeLessThan(
      thread.setLocked.mock.invocationCallOrder[0]
    );
    expect(evidenceThread.setArchived.mock.invocationCallOrder[0]).toBeLessThan(
      evidenceThread.setLocked.mock.invocationCallOrder[0]
    );
  });
});
