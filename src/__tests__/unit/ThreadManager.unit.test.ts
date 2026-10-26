import { SecurityActionService } from '../../services/SecurityActionService';
import {
  ChannelType,
  Client,
  Collection,
  Guild,
  GuildMember,
  ThreadChannel,
  User,
} from 'discord.js';
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
import {
  DetectionType,
  ReportIntake,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
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
  case_revision: overrides.case_revision ?? 0,
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
      remove: jest.fn().mockResolvedValue(undefined),
      fetch: jest.fn().mockResolvedValue({ id: 'user-1' }),
    },
    send: jest.fn().mockResolvedValue({ id: 'message-1' }),
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

  it.each([
    'valid',
    'foreign author',
    'foreign guild',
    'foreign thread',
    'mixed controls',
    'foreign intake',
  ])('retires only scoped bot confirmation controls: %s', async (variant) => {
    const edit = jest.fn().mockResolvedValue(undefined);
    const message = {
      id: 'prompt-1',
      guildId: variant === 'foreign guild' ? 'other-guild' : 'guild-1',
      channelId: variant === 'foreign thread' ? 'other-thread' : 'thread-1',
      author: { id: variant === 'foreign author' ? 'other-bot' : 'bot-1' },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              customId: `report_intake_confirm:${variant === 'foreign intake' ? 'other-intake' : 'intake-1'}:user-1`,
            },
            ...(variant === 'mixed controls' ? [{ type: 2, customId: 'unrelated_action' }] : []),
          ],
        },
      ],
      edit,
    };
    const fetch = jest.fn().mockResolvedValue(message);
    const client = {
      user: { id: 'bot-1' },
      channels: {
        fetch: jest.fn().mockResolvedValue({
          id: 'thread-1',
          guildId: 'guild-1',
          isThread: () => true,
          messages: { fetch },
        }),
      },
    };
    const manager = new ThreadManager(
      client as unknown as Client,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    await manager.retireReportConfirmationPrompts(
      { id: 'intake-1', thread_id: 'thread-1', server_id: 'guild-1' } as ReportIntake,
      ['prompt-1']
    );
    expect(fetch).toHaveBeenCalledWith({ message: 'prompt-1', force: true });
    if (variant === 'valid') expect(edit).toHaveBeenCalledWith({ components: [] });
    else expect(edit).not.toHaveBeenCalled();
  });

  it('unarchives a case thread before sending a CAPTCHA status', async () => {
    (thread as unknown as { archived: boolean }).archived = true;
    const client = {
      channels: { fetch: jest.fn().mockResolvedValue(thread) },
    };
    const manager = new ThreadManager(
      client as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    await expect(
      manager.sendCaptchaStatus(
        buildVerificationEvent({ thread_id: thread.id }),
        'Security check completed.'
      )
    ).resolves.toBe(true);

    expect(thread.setArchived).toHaveBeenCalledWith(false, 'Deliver CAPTCHA case status');
    expect(thread.send).toHaveBeenCalledWith({ content: 'Security check completed.' });
  });

  it('returns false when a CAPTCHA challenge cannot be sent', async () => {
    const challengeUrl = 'https://drasil.example/captcha/plaintext-secret-token';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    thread.send.mockRejectedValueOnce(
      Object.assign(new Error(`Invalid request containing ${challengeUrl}`), {
        code: 50035,
        requestBody: { url: challengeUrl },
      })
    );
    const client = {
      channels: { fetch: jest.fn().mockResolvedValue(thread) },
    };
    const manager = new ThreadManager(
      client as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    await expect(
      manager.sendCaptchaChallenge(buildVerificationEvent({ thread_id: thread.id }), challengeUrl)
    ).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(
      'Failed to deliver CAPTCHA challenge for case ver-1 (Discord code: 50035).'
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(challengeUrl);
  });

  it('delivers a CAPTCHA challenge after confirming the subject belongs to the case thread', async () => {
    const client = {
      channels: { fetch: jest.fn().mockResolvedValue(thread) },
    };
    const manager = new ThreadManager(
      client as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    await expect(
      manager.sendCaptchaChallenge(
        buildVerificationEvent({ thread_id: thread.id }),
        'https://drasil.example/captcha/token'
      )
    ).resolves.toBe('message-1');

    expect(thread.members.fetch).toHaveBeenCalledWith('user-1');
    expect(thread.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Complete the CAPTCHA.',
      })
    );
  });

  it('delivers a generation-bound native image entry button', async () => {
    const client = { channels: { fetch: jest.fn().mockResolvedValue(thread) } };
    const manager = new ThreadManager(
      client as unknown as Client,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );
    await expect(
      manager.sendCaptchaChallenge(buildVerificationEvent({ thread_id: thread.id }), {
        challengeId: '00000000-0000-4000-8000-000000000001',
        generation: 3,
      })
    ).resolves.toBe('message-1');
    const payload = thread.send.mock.calls[0][0];
    if (typeof payload !== 'object' || !('components' in payload))
      throw new Error('Missing entry components');
    expect(extractComponentCustomIds([...(payload.components ?? [])])).toEqual([
      'captcha:image:open:00000000-0000-4000-8000-000000000001:3',
    ]);
    expect(payload.content).toContain('Complete the CAPTCHA.');
  });

  it('does not deliver a CAPTCHA challenge when the subject cannot access the case thread', async () => {
    (thread.members.fetch as jest.Mock).mockRejectedValueOnce(new Error('Unknown thread member'));
    const client = {
      channels: { fetch: jest.fn().mockResolvedValue(thread) },
    };
    const manager = new ThreadManager(
      client as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    await expect(
      manager.sendCaptchaChallenge(
        buildVerificationEvent({ thread_id: thread.id }),
        'https://drasil.example/captcha/token'
      )
    ).resolves.toBeNull();

    expect(thread.members.fetch).toHaveBeenCalledWith('user-1');
    expect(thread.send).not.toHaveBeenCalled();
  });

  it('retracts a stale CAPTCHA challenge message', async () => {
    const deleteMessage = jest.fn().mockResolvedValue(undefined);
    (thread.messages.fetch as jest.Mock).mockResolvedValueOnce({ delete: deleteMessage });
    const client = {
      channels: { fetch: jest.fn().mockResolvedValue(thread) },
    };
    const manager = new ThreadManager(
      client as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    await expect(
      manager.retractCaptchaChallenge(buildVerificationEvent({ thread_id: thread.id }), 'message-1')
    ).resolves.toBe(true);

    expect(thread.messages.fetch).toHaveBeenCalledWith('message-1');
    expect(deleteMessage).toHaveBeenCalledTimes(1);
  });

  it('returns false when a CAPTCHA status thread cannot be unarchived', async () => {
    (thread as unknown as { archived: boolean }).archived = true;
    thread.setArchived.mockRejectedValueOnce(new Error('Discord unavailable'));
    const client = {
      channels: { fetch: jest.fn().mockResolvedValue(thread) },
    };
    const manager = new ThreadManager(
      client as any,
      configService,
      verificationEventRepository,
      userRepository,
      serverRepository,
      serverMemberRepository
    );

    await expect(
      manager.sendCaptchaStatus(
        buildVerificationEvent({ thread_id: thread.id }),
        'Security check completed.'
      )
    ).resolves.toBe(false);
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
    expect(event.metadata).toMatchObject({ initial_verification_prompt_message_id: 'message-1' });
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
      verificationEventId: 'ver-1',
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

      expect(event.thread_id).toBe('thread-1');
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
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(event.id, { thread_id: 'thread-1' });
    event.thread_id = 'thread-1';

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
      verificationEventId: 'ver-1',
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
            id: 'message-1',
            channelId: thread.id,
            guildId: 'guild-1',
            type: 0,
            embeds: [],
            attachments: new Collection(),
            content: renderVerificationPromptTemplate(DEFAULT_VERIFICATION_PROMPT_TEMPLATE, {
              userMention: '<@user-1>',
              serverName: 'Test Guild',
            }),
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    customId: 'admin_actions:m:c:user-1',
                    style: 1,
                    label: 'Admin Actions',
                  },
                ],
              },
            ],
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
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(event.id, { thread_id: 'thread-1' });
    event.thread_id = 'thread-1';

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
            components: [],
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
    const event = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(event.id, { thread_id: 'thread-1' });
    event.thread_id = 'thread-1';

    const result = await manager.repairVerificationThread(member, event);

    expect(thread.members.add).toHaveBeenCalledWith(member.id);
    expect(thread.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining(`<@${member.id}>`) })
    );
    expect(result.promptAlreadyPresent).toBe(false);
    expect(result.promptSent).toBe(true);
  });

  describe('initial verification setup recovery', () => {
    // eslint-disable-next-line no-unused-vars -- This parameter belongs to a function type.
    const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
      // eslint-disable-next-line no-unused-vars -- This parameter belongs to a function type.
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const prompt = (
      customId = 'admin_actions:m:c:user-1:_:ver-1',
      content = 'Welcome <@user-1>'
    ) => ({
      id: 'saved-prompt',
      author: { id: 'bot-1', bot: true },
      content,
      components: [{ type: 1, components: [{ type: 2, customId }] }],
    });
    const manager = (): ThreadManager =>
      new ThreadManager(
        { user: { id: 'bot-1' } } as unknown as Client,
        configService,
        verificationEventRepository,
        userRepository,
        serverRepository,
        serverMemberRepository
      );
    const createCase = async (
      metadata: NonNullable<VerificationEvent['metadata']> = {}
    ): Promise<VerificationEvent> => {
      const event = await verificationEventRepository.createFromDetection(
        null,
        'guild-1',
        'user-1',
        VerificationStatus.PENDING
      );
      return (await verificationEventRepository.update(event.id, {
        thread_id: thread.id,
        metadata,
      }))!;
    };

    it('coordinates repair while creation pauses after storing the thread ID', async () => {
      const stored = deferred<void>();
      const resume = deferred<void>();
      const setThreadIdentity = verificationEventRepository.setThreadIdentity.bind(
        verificationEventRepository
      );
      jest
        .spyOn(verificationEventRepository, 'setThreadIdentity')
        .mockImplementation(async (id, threadId, threadType, patch) => {
          const result = await setThreadIdentity(id, threadId, threadType, patch);
          stored.resolve();
          await resume.promise;
          return result;
        });
      const event = await verificationEventRepository.createFromDetection(
        null,
        'guild-1',
        'user-1',
        VerificationStatus.PENDING
      );
      const service = manager();
      const creating = service.createVerificationThread(buildMember('guild-1', 'user-1'), event);
      await stored.promise;
      const persisted = (await verificationEventRepository.findById(event.id))!;
      const repairing = service.repairVerificationThread(
        buildMember('guild-1', 'user-1'),
        persisted
      );
      resume.resolve();
      const [created, repaired] = await Promise.all([creating, repairing]);
      expect(created?.id).toBe('thread-1');
      expect(repaired.threadId).toBe('thread-1');
      expect(channel.threads.create).toHaveBeenCalledTimes(1);
      expect(thread.send).toHaveBeenCalledTimes(1);
    });

    it('coordinates two repairs inspecting a missing prompt', async () => {
      const entered = deferred<void>();
      const resume = deferred<Map<string, never>>();
      (thread.messages.fetch as jest.Mock).mockImplementation(async () => {
        entered.resolve();
        return resume.promise;
      });
      const event = await createCase();
      const service = manager();
      const first = service.repairVerificationThread(buildMember('guild-1', 'user-1'), event);
      await entered.promise;
      const second = service.repairVerificationThread(buildMember('guild-1', 'user-1'), {
        ...event,
      });
      resume.resolve(new Map<string, never>());
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.threadId)).toEqual(['thread-1', 'thread-1']);
      expect(channel.threads.create).not.toHaveBeenCalled();
      expect(thread.send).toHaveBeenCalledTimes(1);
    });

    it('fetches the stored prompt after restart without scanning history or sending', async () => {
      const event = await createCase({ initial_verification_prompt_message_id: 'saved-prompt' });
      (thread.messages.fetch as jest.Mock).mockResolvedValueOnce(prompt());
      const result = await manager().repairVerificationThread(
        buildMember('guild-1', 'user-1'),
        event
      );
      expect(result.promptAlreadyPresent).toBe(true);
      expect(thread.messages.fetch).toHaveBeenCalledWith({ message: 'saved-prompt', force: true });
      expect(thread.messages.fetch).toHaveBeenCalledTimes(1);
      expect(thread.send).not.toHaveBeenCalled();
    });

    it('replaces a confirmed missing stored prompt after readable history confirms absence', async () => {
      const event = await createCase({
        initial_verification_prompt_message_id: 'deleted-prompt',
        unrelated: true,
      });
      (thread.messages.fetch as jest.Mock)
        .mockRejectedValueOnce({ code: 10008 })
        .mockResolvedValueOnce(new Map());
      const result = await manager().repairVerificationThread(
        buildMember('guild-1', 'user-1'),
        event
      );
      expect(result.promptSent).toBe(true);
      expect(thread.send).toHaveBeenCalledTimes(1);
      expect((await verificationEventRepository.findById(event.id))?.metadata).toMatchObject({
        unrelated: true,
        initial_verification_prompt_message_id: 'message-1',
      });
    });

    it.each([50001, 50013, 'ETIMEDOUT'])(
      'does not replace an unreadable stored prompt (%s)',
      async (code) => {
        const event = await createCase({ initial_verification_prompt_message_id: 'saved-prompt' });
        (thread.messages.fetch as jest.Mock).mockRejectedValueOnce(
          Object.assign(new Error('unreadable'), { code })
        );
        await expect(
          manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event)
        ).rejects.toThrow('unreadable');
        expect(thread.send).not.toHaveBeenCalled();
        expect(thread.messages.fetch).toHaveBeenCalledTimes(1);
      }
    );

    it('does not send when history cannot be read', async () => {
      const event = await createCase();
      (thread.messages.fetch as jest.Mock).mockRejectedValueOnce(new Error('history unavailable'));
      await expect(
        manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event)
      ).rejects.toThrow('history unavailable');
      expect(thread.send).not.toHaveBeenCalled();
    });

    it.each([
      ['unrelated mention', 'admin_actions:m:c:user-1:_:other-case', 'Note about <@user-1>'],
      ['unbound unrelated mention', 'admin_actions:m:c:user-1', 'Note about <@user-1>'],
      ['foreign bot', 'admin_actions:m:c:user-1:_:ver-1', 'Welcome <@user-1>'],
    ])('does not mistake %s for the initial prompt', async (variant, customId, content) => {
      const event = await createCase();
      const message = prompt(customId, content);
      if (variant === 'foreign bot') message.author.id = 'other-bot';
      (thread.messages.fetch as jest.Mock).mockResolvedValueOnce(new Map([[message.id, message]]));
      expect(
        (await manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event))
          .promptSent
      ).toBe(true);
      expect(thread.send).toHaveBeenCalledTimes(1);
    });

    it.each(['admin_actions:m:c:user-1', 'admin_actions:menu:case:user-1'])(
      'recovers the shipped unbound prompt %s with its complete button shape',
      async (customId) => {
        const event = await createCase();
        const message = {
          ...prompt(
            customId,
            renderVerificationPromptTemplate(DEFAULT_VERIFICATION_PROMPT_TEMPLATE, {
              userMention: '<@user-1>',
              serverName: 'Test Guild',
            })
          ),
          channelId: thread.id,
          guildId: 'guild-1',
          type: 0,
          embeds: [],
          attachments: new Collection(),
          components: [
            { type: 1, components: [{ type: 2, customId, label: 'Admin Actions', style: 1 }] },
          ],
        };
        (thread.messages.fetch as jest.Mock).mockResolvedValueOnce(
          new Map([[message.id, message]])
        );
        expect(
          (await manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event))
            .promptAlreadyPresent
        ).toBe(true);
        expect(thread.send).not.toHaveBeenCalled();
        expect((await verificationEventRepository.findById(event.id))?.metadata).toMatchObject({
          initial_verification_prompt_message_id: 'saved-prompt',
        });
      }
    );

    it.each(['changed', 'unavailable'])(
      'recovers the complete shipped legacy prompt with %s config',
      async (mode) => {
        const event = await createCase();
        const message = {
          ...prompt('admin_actions:m:c:user-1', 'Historical custom wording for <@user-1>'),
          channelId: thread.id,
          guildId: 'guild-1',
          type: 0,
          embeds: [],
          attachments: new Collection(),
          components: [
            {
              type: 1,
              components: [
                { type: 2, customId: 'admin_actions:m:c:user-1', label: 'Admin Actions', style: 1 },
              ],
            },
          ],
        };
        if (mode === 'unavailable')
          (configService.getServerConfig as jest.Mock).mockRejectedValue(
            new Error('config unavailable')
          );
        else
          (configService.getServerConfig as jest.Mock).mockResolvedValue({
            settings: { verification_prompt_template: 'New prompt for {userMention}' },
          });
        (thread.messages.fetch as jest.Mock).mockResolvedValueOnce(
          new Map([[message.id, message]])
        );
        expect(
          (await manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event))
            .promptAlreadyPresent
        ).toBe(true);
        expect(thread.send).not.toHaveBeenCalled();
        expect((await verificationEventRepository.findById(event.id))?.metadata).toMatchObject({
          initial_verification_prompt_message_id: message.id,
        });
      }
    );
    it.each([
      'secondary',
      'multiple-buttons',
      'evidence',
      'wrong-bot',
      'wrong-member',
      'wrong-thread',
      'review-thread',
    ])('rejects an unsupported historical prompt shape: %s', async (variant) => {
      const event = await createCase(
        variant === 'review-thread' ? { thread_type: 'report_review' } : {}
      );
      const button = {
        type: 2,
        customId:
          variant === 'wrong-member'
            ? 'admin_actions:m:c:someone-else'
            : 'admin_actions:m:c:user-1',
        label: variant === 'secondary' ? 'Other Actions' : 'Admin Actions',
        style: variant === 'secondary' ? 2 : 1,
      };
      const message = {
        id: 'historical',
        author: { id: variant === 'wrong-bot' ? 'other-bot' : 'bot-1' },
        channelId: variant === 'wrong-thread' ? 'other-thread' : thread.id,
        guildId: 'guild-1',
        type: 0,
        content: 'Historical custom prompt',
        embeds: variant === 'evidence' ? [{}] : [],
        attachments: new Collection(),
        components: [
          { type: 1, components: variant === 'multiple-buttons' ? [button, button] : [button] },
        ],
      };
      (thread.messages.fetch as jest.Mock).mockResolvedValueOnce(new Map([[message.id, message]]));
      const result = await manager().repairVerificationThread(
        buildMember('guild-1', 'user-1'),
        event
      );
      expect(result.promptAlreadyPresent).toBe(false);
      expect(thread.send).toHaveBeenCalledTimes(variant === 'review-thread' ? 0 : 1);
      expect((await verificationEventRepository.findById(event.id))?.metadata).not.toMatchObject({
        initial_verification_prompt_message_id: 'historical',
      });
    });
    it('preserves a newer thread identity while retiring its late created thread', async () => {
      const event = await verificationEventRepository.createFromDetection(
        null,
        'guild-1',
        'user-1',
        VerificationStatus.PENDING
      );
      channel.threads.create.mockImplementationOnce(async () => {
        await verificationEventRepository.setThreadIdentity(
          event.id,
          'newer-thread',
          'verification',
          { retained: true }
        );
        return thread;
      });
      expect(
        await manager().createVerificationThread(buildMember('guild-1', 'user-1'), event)
      ).toBeNull();
      expect((await verificationEventRepository.findById(event.id))?.thread_id).toBe(
        'newer-thread'
      );
      expect(thread.members.add).not.toHaveBeenCalled();
      expect(thread.send).not.toHaveBeenCalled();
      expect(thread.setArchived).toHaveBeenCalledWith(true);
    });
    it('surfaces failed retirement of an exact late prompt', async () => {
      const event = await createCase();
      const deletion = jest.fn().mockRejectedValue(new Error('delete unavailable'));
      thread.send.mockImplementationOnce(async () => {
        await verificationEventRepository.update(event.id, { status: VerificationStatus.VERIFIED });
        return { id: 'late-prompt', delete: deletion } as never;
      });
      await expect(
        manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event)
      ).rejects.toThrow('delete unavailable');
      expect(thread.setArchived).toHaveBeenCalledWith(true);
      expect(thread.setLocked).toHaveBeenCalledWith(true);
      expect((await verificationEventRepository.findById(event.id))?.status).toBe('verified');
    });

    it.each(['routing', 'repair-unarchive', 'repair-add', 'repair-add-absent', 'send'])(
      'retires setup when resolution wins during %s',
      async (stage) => {
        const event =
          stage === 'routing'
            ? await verificationEventRepository.createFromDetection(
                null,
                'guild-1',
                'user-1',
                VerificationStatus.PENDING
              )
            : await createCase();
        const resolve = () =>
          verificationEventRepository.update(event.id, {
            status: VerificationStatus.VERIFIED,
            metadata: { retained: 'terminal' },
          });
        const service = manager();
        const deletion = jest.fn().mockResolvedValue(undefined);
        if (stage === 'routing')
          jest
            .spyOn(
              service as unknown as { addCaseResponderMembers: () => Promise<unknown> },
              'addCaseResponderMembers'
            )
            .mockImplementation(async () => {
              await resolve();
              return { addedUserIds: [], warnings: [] };
            });
        if (stage === 'repair-unarchive') {
          Object.assign(thread, { archived: true });
          thread.setArchived.mockImplementationOnce(async () => {
            await resolve();
            return thread;
          });
        }
        if (stage === 'repair-add-absent')
          (thread.members.fetch as jest.Mock).mockResolvedValueOnce(null);
        if (stage === 'repair-add' || stage === 'repair-add-absent')
          (thread.members.add as jest.Mock).mockImplementationOnce(resolve);
        if (stage === 'send')
          thread.send.mockImplementationOnce(async () => {
            await resolve();
            return { id: 'late-prompt', delete: deletion } as never;
          });
        if (stage === 'routing')
          await service.createVerificationThread(buildMember('guild-1', 'user-1'), event);
        else await service.repairVerificationThread(buildMember('guild-1', 'user-1'), event);
        if (stage === 'repair-add-absent')
          expect(thread.members.remove).toHaveBeenCalledWith('user-1');
        if (stage === 'repair-add') expect(thread.members.remove).not.toHaveBeenCalled();
        if (stage === 'send') expect(deletion).toHaveBeenCalledTimes(1);
        else expect(thread.send).not.toHaveBeenCalled();
        expect(thread.setLocked).toHaveBeenCalledWith(true);
        expect(thread.setArchived).toHaveBeenCalledWith(true);
        expect((await verificationEventRepository.findById(event.id))?.metadata).toMatchObject({
          retained: 'terminal',
        });
        expect((await verificationEventRepository.findById(event.id))?.metadata).not.toHaveProperty(
          'initial_verification_prompt_message_id'
        );
      }
    );

    it.each([
      'before-retirement',
      'remove',
      'lock',
      'archive',
      'preexisting',
      'replacement',
      'later-terminal',
    ])('keeps the reopened case usable across obsolete retirement: %s', async (stage) => {
      const event = await createCase({ retained: true });
      const entered = deferred<void>();
      const resume = deferred<void>();
      let present = stage === 'preexisting';
      Object.assign(thread, { archived: false, locked: false });
      (thread.members.fetch as jest.Mock).mockImplementation(async () =>
        present ? { id: 'user-1' } : null
      );
      (thread.members.add as jest.Mock).mockImplementation(async () => {
        present = true;
      });
      (thread.members.remove as jest.Mock).mockImplementation(async () => {
        if (stage === 'remove') {
          entered.resolve();
          await resume.promise;
        }
        present = false;
      });
      thread.setLocked.mockImplementation(async (locked) => {
        if (locked && stage === 'lock') {
          entered.resolve();
          await resume.promise;
        }
        Object.assign(thread, { locked });
        return thread;
      });
      thread.setArchived.mockImplementation(async (archived) => {
        if (archived && !['remove', 'lock'].includes(stage)) {
          entered.resolve();
          await resume.promise;
        }
        Object.assign(thread, { archived });
        return thread;
      });
      // Resolve after membership was added, so setup owns only that addition.
      (thread.messages.fetch as jest.Mock).mockImplementationOnce(async () => {
        await verificationEventRepository.update(event.id, {
          status: VerificationStatus.VERIFIED,
        });
        return new Map();
      });
      if (stage === 'before-retirement') {
        const find = verificationEventRepository.findById.bind(verificationEventRepository);
        let paused = false;
        jest.spyOn(verificationEventRepository, 'findById').mockImplementation(async (id) => {
          const snapshot = await find(id);
          if (!paused && snapshot?.status === VerificationStatus.VERIFIED) {
            paused = true;
            entered.resolve();
            await resume.promise;
          }
          return snapshot;
        });
      }
      const service = manager();
      const repairing = service.repairVerificationThread(buildMember('guild-1', 'user-1'), event);
      await entered.promise;
      const reopened = (await verificationEventRepository.reopen(event.id))!;
      const replacement = buildThread('replacement');
      if (stage === 'replacement') {
        Object.assign(
          reopened,
          await verificationEventRepository.setThreadIdentity(
            event.id,
            replacement.id,
            'verification'
          )
        );
        (channel.threads.fetch as jest.Mock).mockImplementation(async (id) =>
          id === replacement.id ? replacement : thread
        );
      }
      const reopening = service.reopenVerificationThread(reopened);
      // Let reopen reach its awaited Discord effect or the setup owner barrier.
      await new Promise((resolve) => setImmediate(resolve));
      if (stage === 'later-terminal')
        await verificationEventRepository.update(event.id, { status: VerificationStatus.BANNED });
      resume.resolve();
      await Promise.all([repairing, reopening]);
      expect(await verificationEventRepository.findById(event.id)).toMatchObject({
        case_revision: 1,
        status: stage === 'later-terminal' ? 'banned' : 'pending',
        thread_id: stage === 'replacement' ? replacement.id : thread.id,
        metadata: { retained: true },
      });
      if (stage === 'replacement') {
        expect(replacement.setArchived).toHaveBeenCalledWith(false);
        expect(replacement.setLocked).toHaveBeenCalledWith(false);
      } else if (stage === 'later-terminal') {
        expect(thread.archived).toBe(true);
        expect(thread.locked).toBe(true);
      } else {
        expect(thread.archived).toBe(false);
        expect(thread.locked).toBe(false);
        expect(present).toBe(true);
      }
      if (stage === 'preexisting') expect(thread.members.remove).not.toHaveBeenCalled();
      expect(channel.threads.create).not.toHaveBeenCalled();
    });

    it('recovers a sent prompt after its metadata write fails', async () => {
      const event = await createCase();
      thread.send.mockResolvedValueOnce({ id: 'saved-prompt' } as never);
      // Fail only the new prompt identity write, preserving real repository behavior otherwise.
      const patch = verificationEventRepository.patchMetadata.bind(verificationEventRepository);
      jest
        .spyOn(verificationEventRepository, 'patchMetadata')
        .mockImplementationOnce(async (id, data, options) => {
          if ('initial_verification_prompt_message_id' in data)
            throw new Error('write interrupted');
          return patch(id, data, options);
        });
      await expect(
        manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event)
      ).rejects.toThrow('write interrupted');
      (thread.messages.fetch as jest.Mock).mockResolvedValueOnce(
        new Map([['saved-prompt', prompt()]])
      );
      expect(
        (await manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event))
          .promptAlreadyPresent
      ).toBe(true);
      expect(thread.send).toHaveBeenCalledTimes(1);
    });

    it('recovers creation after member addition failed without creating a second thread', async () => {
      const event = await verificationEventRepository.createFromDetection(
        null,
        'guild-1',
        'user-1',
        VerificationStatus.PENDING
      );
      const service = manager();
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const member = buildMember('guild-1', 'user-1');
      (thread.members.add as jest.Mock).mockRejectedValueOnce(new Error('member add failed'));
      // Membership screening discovered on refresh stops retries immediately.
      Object.assign(member, {
        fetch: jest.fn().mockResolvedValue(buildMember('guild-1', 'user-1', 'Test Guild', true)),
      });
      jest.useFakeTimers();
      await Promise.all([
        expect(service.createVerificationThread(member, event)).rejects.toThrow(
          'Failed to add flagged user'
        ),
        jest.runAllTimersAsync(),
      ]);
      const persisted = (await verificationEventRepository.findById(event.id))!;
      const result = await service.repairVerificationThread(
        buildMember('guild-1', 'user-1'),
        persisted
      );
      expect(result.promptSent).toBe(true);
      expect(channel.threads.create).toHaveBeenCalledTimes(1);
      expect(thread.send).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'Failed to add user-1 to verification thread thread-1; retrying in 750ms:',
        expect.objectContaining({ message: 'member add failed' })
      );
      warn.mockRestore();
      error.mockRestore();
    });

    it('finds a prompt older than the first history page before considering replacement', async () => {
      const event = await createCase();
      const recent = new Collection(
        Array.from({ length: 100 }, (_, index) => {
          const message = { ...prompt('unrelated', 'Case note'), id: `recent-${index}` };
          return [message.id, message] as const;
        })
      );
      (thread.messages.fetch as jest.Mock)
        .mockResolvedValueOnce(recent)
        .mockResolvedValueOnce(new Collection([['saved-prompt', prompt()]]));
      const result = await manager().repairVerificationThread(
        buildMember('guild-1', 'user-1'),
        event
      );
      expect(result.promptAlreadyPresent).toBe(true);
      expect(thread.messages.fetch).toHaveBeenLastCalledWith({ limit: 100, before: 'recent-99' });
      expect(thread.send).not.toHaveBeenCalled();
    });

    it('preserves newer resolution and metadata while a stale setup finishes', async () => {
      const event = await verificationEventRepository.createFromDetection(
        null,
        'guild-1',
        'user-1',
        VerificationStatus.PENDING
      );
      const add = thread.members.add as jest.Mock;
      add.mockImplementationOnce(async () => {
        await verificationEventRepository.update(event.id, {
          status: VerificationStatus.CLOSED_NO_ACTION,
          metadata: { member_left: true, reminder_count: 2 },
        });
      });
      await manager().createVerificationThread(buildMember('guild-1', 'user-1'), event);
      expect(await verificationEventRepository.findById(event.id)).toMatchObject({
        status: VerificationStatus.CLOSED_NO_ACTION,
        metadata: {
          member_left: true,
          reminder_count: 2,
        },
      });
      expect(thread.send).not.toHaveBeenCalled();
      expect(thread.setLocked).toHaveBeenCalledWith(true);
      expect(thread.setArchived).toHaveBeenCalledWith(true);
      expect(thread.members.remove).toHaveBeenCalledWith('user-1');
    });

    it.each([false, true])(
      'keeps thread identity and type consistent if a separate metadata write fails (legacy=%s)',
      async (legacy) => {
        const event = await verificationEventRepository.createFromDetection(
          null,
          'guild-1',
          'user-1',
          VerificationStatus.PENDING
        );
        if (legacy) {
          const updated = await verificationEventRepository.update(event.id, {
            thread_id: 'legacy-review',
            metadata: { thread_type: 'report_review', retained: true },
          });
          Object.assign(event, updated);
        }
        const patch = verificationEventRepository.patchMetadata.bind(verificationEventRepository);
        jest
          .spyOn(verificationEventRepository, 'patchMetadata')
          .mockImplementation(async (id, data, options) => {
            if ('thread_type' in data) throw new Error('separate thread type write failed');
            return patch(id, data, options);
          });
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const service = manager();
        // A failed separate type write must never leave a newly persisted identity
        // paired with its old type or hidden from the caller.
        await service
          .createVerificationThread(buildMember('guild-1', 'user-1'), event)
          .catch(() => null);
        expect(await verificationEventRepository.findById(event.id)).toMatchObject({
          thread_id: 'thread-1',
          metadata: { thread_type: 'verification' },
        });
        expect(event.thread_id).toBe('thread-1');
        expect(event.metadata).toMatchObject({ thread_type: 'verification' });
        (thread.messages.fetch as jest.Mock).mockResolvedValueOnce({
          ...prompt(),
          id: 'message-1',
        });
        expect(
          (await service.createVerificationThread(buildMember('guild-1', 'user-1'), event))?.id
        ).toBe('thread-1');
        expect(channel.threads.create).toHaveBeenCalledTimes(1);
        expect(thread.send).toHaveBeenCalledTimes(1);
        error.mockRestore();
      }
    );

    it('creates a user-visible thread when promoting a legacy report review', async () => {
      const event = await createCase({ thread_type: 'report_review' });
      const reviewThread = buildThread('review-thread');
      await verificationEventRepository.update(event.id, { thread_id: reviewThread.id });
      event.thread_id = reviewThread.id;
      channel.threads.fetch!.mockResolvedValue(reviewThread);
      const created = await manager().createVerificationThread(
        buildMember('guild-1', 'user-1'),
        event
      );
      expect(created?.id).toBe('thread-1');
      expect(channel.threads.create).toHaveBeenCalledTimes(1);
      expect(reviewThread.members.add).not.toHaveBeenCalled();
      expect(reviewThread.send).not.toHaveBeenCalled();
    });

    it.each(['repair-first', 'promotion-first', 'repair-only'])(
      'keeps legacy review private during %s setup',
      async (order) => {
        const event = await createCase({ thread_type: 'report_review' });
        const reviewThread = buildThread('review-thread');
        await verificationEventRepository.update(event.id, { thread_id: reviewThread.id });
        event.thread_id = reviewThread.id;
        channel.threads.fetch!.mockResolvedValue(reviewThread);
        const entered = deferred<void>();
        const resume = deferred<void>();
        const find = verificationEventRepository.findById.bind(verificationEventRepository);
        jest.spyOn(verificationEventRepository, 'findById').mockImplementationOnce(async (id) => {
          entered.resolve();
          await resume.promise;
          return find(id);
        });
        const service = manager();
        const member = buildMember('guild-1', 'user-1');
        const first =
          order === 'promotion-first'
            ? service.createVerificationThread(member, { ...event })
            : service.repairVerificationThread(member, { ...event });
        await entered.promise;
        const second =
          order === 'repair-only'
            ? Promise.resolve(null)
            : order === 'promotion-first'
              ? service.repairVerificationThread(member, { ...event })
              : service.createVerificationThread(member, { ...event });
        resume.resolve();
        await Promise.all([first, second]);
        expect(reviewThread.members.add).not.toHaveBeenCalled();
        expect(reviewThread.send).not.toHaveBeenCalled();
        expect(channel.threads.create).toHaveBeenCalledTimes(order === 'repair-only' ? 0 : 1);
        expect(thread.send).toHaveBeenCalledTimes(order === 'repair-only' ? 0 : 1);
        expect((await find(event.id))?.thread_id).toBe(
          order === 'repair-only' ? 'review-thread' : 'thread-1'
        );
      }
    );

    it('keeps the direct delayed-repair caller from exposing a legacy thread', async () => {
      const event = await createCase({
        thread_type: 'report_review',
        action_failures: [
          { action: 'thread', message: 'Promotion failed', at: new Date().toISOString() },
        ],
      });
      const reviewThread = buildThread('review-thread');
      await verificationEventRepository.update(event.id, { thread_id: reviewThread.id });
      channel.threads.fetch!.mockResolvedValue(reviewThread);
      const service = new SecurityActionService(
        {} as never,
        {} as never,
        serverMemberRepository,
        verificationEventRepository,
        userRepository,
        serverRepository,
        {} as never,
        manager(),
        {} as never,
        {} as Client
      );
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await service['runDelayedThreadRepair'](buildMember('guild-1', 'user-1'), event.id, {
          label: 'SUSPICIOUS',
          confidence: 0.9,
          reasons: [],
          triggerSource: DetectionType.USER_REPORT,
          triggerContent: '',
        });
      } finally {
        error.mockRestore();
      }
      expect(reviewThread.members.add).not.toHaveBeenCalled();
      expect(reviewThread.send).not.toHaveBeenCalled();
      expect(channel.threads.create).not.toHaveBeenCalled();
    });

    it('creates a missing thread during repair without waiting on its own setup promise', async () => {
      const event = await verificationEventRepository.createFromDetection(
        null,
        'guild-1',
        'user-1',
        VerificationStatus.PENDING
      );
      expect(
        (await manager().repairVerificationThread(buildMember('guild-1', 'user-1'), event)).threadId
      ).toBe('thread-1');
      expect(thread.send).toHaveBeenCalledTimes(1);
    });
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
      content: expect.stringContaining('Describe what happened and who you want to report.'),
      components: expect.any(Array),
      allowedMentions: {
        parse: [],
        users: ['reporter-1'],
        roles: [],
        repliedUser: false,
      },
    });
    const message = (thread.send as jest.Mock).mock.calls[0][0];
    const buttons = message.components[0].toJSON().components;
    expect(buttons.map((button: { label: string }) => button.label)).toEqual([
      'Close Report',
      'Admin Actions',
    ]);
    expect(parseReportIntakeAdminActionCustomId(buttons[0].custom_id)).toEqual({
      action: 'thread_close',
      intakeId: 'intake-1',
    });
    expect(parseReportIntakeAdminActionCustomId(buttons[1].custom_id)).toEqual({
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

    const created = await verificationEventRepository.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    const event = (await verificationEventRepository.update(created.id, {
      thread_id: 'thread-1',
      private_evidence_thread_id: 'evidence-thread-1',
    }))!;

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
