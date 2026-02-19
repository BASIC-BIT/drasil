import { ChannelType, Guild, GuildMember, ThreadChannel, User } from 'discord.js';
import { ThreadManager } from '../../services/ThreadManager';
import { IConfigService } from '../../config/ConfigService';
import {
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
  InMemoryVerificationEventRepository,
} from '../fakes/inMemoryRepositories';
import { VerificationEvent, VerificationStatus } from '../../repositories/types';
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

  it('falls back to default template and logs warning when config load fails', async () => {
    (configService.getServerConfig as jest.Mock).mockRejectedValue(new Error('config failure'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

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
    warnSpy.mockRestore();
  });

  it('truncates rendered prompt to Discord content limit', async () => {
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
