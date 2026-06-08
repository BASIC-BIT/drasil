import {
  ChannelType,
  EmbedBuilder,
  Guild,
  GuildMember,
  Message,
  TextChannel,
  User,
} from 'discord.js';
import { NotificationManager } from '../../services/NotificationManager';
import { InMemoryDetectionEventsRepository } from '../fakes/inMemoryRepositories';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import { GPT_PROFILE_MODEL, GPT_PROFILE_PROMPT_VERSION } from '../../services/GPTService';
import {
  AdminActionType,
  DetectionType,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { IConfigService } from '../../config/ConfigService';
import { VERIFICATION_ACTION_FAILURES_METADATA_KEY } from '../../utils/verificationActionFailures';
import { MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY } from '../../utils/detectionResponseSettings';
import { parseAdminActionCustomId } from '../../utils/adminActionCustomIds';

type MockTextChannel = {
  send: jest.Mock;
  messages: { fetch: jest.Mock };
};

type MockMessage = {
  id?: string;
  embeds?: EmbedBuilder[];
  edit: jest.Mock;
};

type MockGuildChannel = {
  id: string;
  name?: string;
  type?: ChannelType;
};

type MockChannelPredicate = Parameters<MockGuildChannel[]['find']>[0];

const buildChannelCollection = (channels: MockGuildChannel[]) => ({
  values: jest.fn(() => channels.values()),
  find: jest.fn((predicate: MockChannelPredicate) =>
    channels.find((channel, index, array) => predicate(channel, index, array))
  ),
});

const buildMember = (guildId: string, userId: string): GuildMember =>
  ({
    id: userId,
    joinedAt: new Date(),
    guild: {
      id: guildId,
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
      },
    } as unknown as Guild,
    user: {
      id: userId,
      username: 'test-user',
      tag: 'test-user#0001',
      createdTimestamp: Date.now(),
      displayAvatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png'),
    } as unknown as User,
  }) as unknown as GuildMember;

const buildVerificationEvent = (overrides: Partial<VerificationEvent> = {}): VerificationEvent => ({
  id: overrides.id ?? 'ver-1',
  server_id: overrides.server_id ?? 'guild-1',
  user_id: overrides.user_id ?? 'user-1',
  detection_event_id: overrides.detection_event_id ?? null,
  thread_id: overrides.thread_id ?? null,
  private_evidence_thread_id: overrides.private_evidence_thread_id ?? null,
  notification_message_id: overrides.notification_message_id ?? null,
  status: overrides.status ?? VerificationStatus.PENDING,
  created_at: overrides.created_at ?? new Date(),
  updated_at: overrides.updated_at ?? new Date(),
  resolved_at: overrides.resolved_at ?? null,
  resolved_by: overrides.resolved_by ?? null,
  notes: overrides.notes ?? null,
  metadata: overrides.metadata ?? null,
});

const buildClientWithBotBanPermission = (): unknown => ({
  guilds: {
    fetch: jest.fn().mockResolvedValue({
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
      },
    }),
  },
});

const extractLabels = (components: unknown[]): string[] => {
  return components.flatMap((row) =>
    ((row as { components?: unknown[] }).components ?? []).map(
      (button) => (button as { data?: { label?: string } }).data?.label ?? ''
    )
  );
};

const extractCustomIds = (components: unknown[]): string[] => {
  return components.flatMap((row) =>
    ((row as { components?: unknown[] }).components ?? []).map(
      (button) => (button as { data?: { custom_id?: string } }).data?.custom_id ?? ''
    )
  );
};

const extractUrls = (components: unknown[]): string[] => {
  return components.flatMap((row) =>
    ((row as { components?: unknown[] }).components ?? [])
      .map((button) => (button as { data?: { url?: string } }).data?.url)
      .filter((url): url is string => typeof url === 'string')
  );
};

describe('NotificationManager (unit)', () => {
  const originalDrasilWebPublicUrl = process.env.DRASIL_WEB_PUBLIC_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  let detectionRepository: InMemoryDetectionEventsRepository;
  let adminChannel: MockTextChannel;
  let configService: IConfigService;

  beforeEach(() => {
    delete process.env.DRASIL_WEB_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    detectionRepository = new InMemoryDetectionEventsRepository();
    adminChannel = {
      send: jest.fn(),
      messages: {
        fetch: jest.fn(),
      },
    };
    configService = {
      getAdminChannel: jest.fn().mockResolvedValue(adminChannel as unknown as TextChannel),
      getServerConfig: jest.fn().mockResolvedValue({
        admin_notification_role_id: null,
        settings: {},
      } as any),
      updateServerConfig: jest.fn().mockResolvedValue({}),
    } as unknown as IConfigService;
  });

  afterEach(() => {
    if (originalDrasilWebPublicUrl === undefined) {
      delete process.env.DRASIL_WEB_PUBLIC_URL;
    } else {
      process.env.DRASIL_WEB_PUBLIC_URL = originalDrasilWebPublicUrl;
    }

    if (originalNextPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
    }
  });

  it('sends a new notification when no existing message is set', async () => {
    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };

    for (let i = 0; i < 6; i += 1) {
      await detectionRepository.create({
        server_id: 'guild-1',
        user_id: 'user-1',
        detection_type: DetectionType.SUSPICIOUS_CONTENT,
        confidence: 0.5,
        reasons: ['reason'],
        detected_at: new Date(),
      });
    }

    const sentMessage: MockMessage = { id: 'message-1', edit: jest.fn() };
    adminChannel.send.mockResolvedValue(sentMessage);

    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );
    const verificationEvent = buildVerificationEvent({ thread_id: null });

    await manager.upsertSuspiciousUserNotification(member, detectionResult, verificationEvent);

    expect(adminChannel.send).toHaveBeenCalledTimes(1);
    const sendArgs = adminChannel.send.mock.calls[0][0] as {
      components: unknown[];
      content?: string;
      allowedMentions?: unknown;
    };
    expect(sendArgs.content).toBeUndefined();
    expect(sendArgs.allowedMentions).toEqual({
      parse: [],
      roles: [],
      users: [],
      repliedUser: false,
    });
    const labels = extractLabels(sendArgs.components);
    expect(labels).toEqual(['Admin Actions']);
    expect(parseAdminActionCustomId(extractCustomIds(sendArgs.components)[0])).toEqual({
      action: 'menu',
      surface: 'case',
      userId: 'user-1',
    });
  });

  it('adds a web case button to suspicious user notifications when configured', async () => {
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasilbot.com';
    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };
    const sentMessage: MockMessage = { id: 'message-1', edit: jest.fn() };
    adminChannel.send.mockResolvedValue(sentMessage);

    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );

    await manager.upsertSuspiciousUserNotification(
      member,
      detectionResult,
      buildVerificationEvent({ id: 'ver-1', thread_id: null })
    );

    const sendArgs = adminChannel.send.mock.calls[0][0] as { components: unknown[] };
    expect(extractLabels(sendArgs.components)).toEqual(['Admin Actions', 'Web Case']);
    expect(extractUrls(sendArgs.components)).toEqual([
      'https://drasilbot.com/admin/guild/guild-1/cases/ver-1',
    ]);
  });

  it('hides the ban action when explicitly disabled', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: null,
      settings: { [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: false },
    } as any);
    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };
    const sentMessage: MockMessage = { id: 'message-1', edit: jest.fn() };
    adminChannel.send.mockResolvedValue(sentMessage);

    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );

    await manager.upsertSuspiciousUserNotification(
      member,
      detectionResult,
      buildVerificationEvent({ thread_id: null })
    );

    const sendArgs = adminChannel.send.mock.calls[0][0] as { components: unknown[] };
    expect(extractLabels(sendArgs.components)).not.toContain('Ban User');
  });

  it('renders moderation action warnings on suspicious user notifications', async () => {
    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };

    const sentMessage: MockMessage = { id: 'message-1', edit: jest.fn() };
    adminChannel.send.mockResolvedValue(sentMessage);

    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );
    const verificationEvent = buildVerificationEvent({
      metadata: {
        [VERIFICATION_ACTION_FAILURES_METADATA_KEY]: [
          {
            action: 'restrict',
            message: 'Missing Permissions',
            at: '2026-05-25T00:00:00.000Z',
          },
        ],
      },
    });

    await manager.upsertSuspiciousUserNotification(member, detectionResult, verificationEvent);

    const sendArgs = adminChannel.send.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const warningField = sendArgs.embeds[0].data.fields?.find(
      (field) => field.name === 'Moderation Action Warning'
    );

    expect(warningField?.value).toContain('Apply restricted role failed');
    expect(warningField?.value).toContain('Missing Permissions');
    expect(warningField?.value).toContain('Case record was still created');
  });

  it('pings the admin notification role when configured and sending new notification', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: 'role-1',
      settings: {},
    } as any);

    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };

    const sentMessage: MockMessage = { id: 'message-1', edit: jest.fn() };
    adminChannel.send.mockResolvedValue(sentMessage);

    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );
    const verificationEvent = buildVerificationEvent({ thread_id: null });

    await manager.upsertSuspiciousUserNotification(member, detectionResult, verificationEvent);

    expect(adminChannel.send).toHaveBeenCalledTimes(1);
    const sendArgs = adminChannel.send.mock.calls[0][0] as {
      content?: string;
      allowedMentions?: {
        parse?: string[];
        roles?: string[];
        users?: string[];
        repliedUser?: boolean;
      };
    };
    expect(sendArgs.content).toBe('<@&role-1>');
    expect(sendArgs.allowedMentions).toEqual({
      parse: [],
      roles: ['role-1'],
      users: [],
      repliedUser: false,
    });
  });

  it('pings configured case responder roles with constrained allowed mentions', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: 'role-1',
      settings: {
        case_responder_role_ids: ['123456789012345678', '234567890123456789'],
        case_responder_routing_mode: 'ping_only',
      },
    } as any);

    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };

    const sentMessage: MockMessage = { id: 'message-1', edit: jest.fn() };
    adminChannel.send.mockResolvedValue(sentMessage);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({ thread_id: null });

    await manager.upsertSuspiciousUserNotification(member, detectionResult, verificationEvent);

    const sendArgs = adminChannel.send.mock.calls[0][0] as {
      content?: string;
      allowedMentions?: { roles?: string[] };
    };
    expect(sendArgs.content).toBe('<@&role-1> <@&123456789012345678> <@&234567890123456789>');
    expect(sendArgs.allowedMentions?.roles).toEqual([
      'role-1',
      '123456789012345678',
      '234567890123456789',
    ]);
  });

  it('sends an observe-only detection notification with action buttons', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: 'role-1',
      settings: {
        detection_response_mode: 'notify_only',
        observed_detection_notification_window_minutes: 60,
      },
    } as any);

    const detectionEvent = await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: [
        'Message contains suspicious keywords or patterns',
        'AI analysis flagged recent message context as suspicious',
      ],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
      detectionEventId: detectionEvent.id,
      gptAnalysis: {
        result: 'SUSPICIOUS',
        confidence: 0.91,
        reasons: ['AI analysis flagged recent message context as suspicious'],
        reasonCodes: ['suspicious_keyword'],
        primarySignal: 'message_content',
        summary: 'Recent message context matches common scam patterns.',
        model: GPT_PROFILE_MODEL,
        promptVersion: GPT_PROFILE_PROMPT_VERSION,
        isFallback: false,
      },
    };
    const sentMessage: MockMessage = { id: 'message-1', edit: jest.fn() };
    adminChannel.send.mockResolvedValue(sentMessage);

    const manager = new NotificationManager({} as any, configService, detectionRepository);

    await manager.upsertObservedDetectionNotification(member, detectionResult);

    expect(adminChannel.send).toHaveBeenCalledTimes(1);
    const sendArgs = adminChannel.send.mock.calls[0][0] as {
      content?: string;
      allowedMentions?: { roles?: string[] };
      components: unknown[];
      embeds: EmbedBuilder[];
    };
    expect(sendArgs.content).toBe('<@&role-1>');
    expect(sendArgs.allowedMentions).toEqual({
      parse: [],
      roles: ['role-1'],
      users: [],
      repliedUser: false,
    });
    expect(sendArgs.components).toHaveLength(1);
    expect(parseAdminActionCustomId(extractCustomIds(sendArgs.components)[0])).toEqual({
      action: 'menu',
      surface: 'observed',
      userId: 'user-1',
      detectionEventId: detectionEvent.id,
    });
    expect(sendArgs.embeds[0].data.title).toBe('Suspicious Activity Observed');
    const fields = sendArgs.embeds[0].data.fields ?? [];
    const reasonsField = fields.find((field) => field.name === 'Reasons');
    const aiField = fields.find((field) => field.name === 'AI Analysis');
    expect(reasonsField?.value).toContain('Message contains suspicious keywords or patterns');
    expect(aiField?.value).toContain('Primary signal: message_content');
    expect(aiField?.value).toContain('Reason codes: suspicious_keyword');
    expect(aiField?.value).toContain('Recent message context matches common scam patterns.');

    const updatedEvent = await detectionRepository.findById(detectionEvent.id);
    expect(updatedEvent?.metadata).toMatchObject({
      observed_notification_message_id: 'message-1',
    });
  });

  it('edits a recent observe-only notification instead of sending another ping', async () => {
    const now = new Date();
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: 'role-1',
      settings: {
        detection_response_mode: 'notify_only',
        observed_detection_notification_window_minutes: 60,
      },
    } as any);

    await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Previous suspicious content'],
      detected_at: now,
      metadata: {
        observed_notification_message_id: 'message-1',
        observed_notification_last_notified_at: now.toISOString(),
      },
    });
    const currentEvent = await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.85,
      reasons: ['Suspicious content'],
      detected_at: now,
    });
    const existingMessage: MockMessage = {
      id: 'message-1',
      edit: jest.fn(),
    };
    existingMessage.edit.mockResolvedValue(existingMessage);
    adminChannel.messages.fetch.mockResolvedValue(existingMessage as unknown as Message<true>);

    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.85,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
      detectionEventId: currentEvent.id,
    };
    const manager = new NotificationManager({} as any, configService, detectionRepository);

    await manager.upsertObservedDetectionNotification(member, detectionResult);

    expect(adminChannel.send).not.toHaveBeenCalled();
    expect(adminChannel.messages.fetch).toHaveBeenCalledWith('message-1');
    expect(existingMessage.edit).toHaveBeenCalledTimes(1);
    const editArgs = existingMessage.edit.mock.calls[0][0] as { components: unknown[] };
    expect(editArgs.components).toHaveLength(1);
  });

  it('sends a new observe-only notification after the previous alert was actioned', async () => {
    const now = new Date();
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: 'role-1',
      settings: {
        detection_response_mode: 'notify_only',
        observed_detection_notification_window_minutes: 60,
      },
    } as any);

    await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Previous suspicious content'],
      detected_at: now,
      metadata: {
        observed_notification_message_id: 'message-1',
        observed_notification_last_notified_at: now.toISOString(),
        observed_action: 'false_positive',
      },
    });
    await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.88,
      reasons: ['Coalesced suspicious content'],
      detected_at: now,
      metadata: {
        observed_notification_message_id: 'message-1',
        observed_notification_last_notified_at: now.toISOString(),
      },
    });
    const currentEvent = await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.85,
      reasons: ['Suspicious content'],
      detected_at: now,
    });
    adminChannel.send.mockResolvedValue({ id: 'message-2', edit: jest.fn() });

    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.85,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
      detectionEventId: currentEvent.id,
    };
    const manager = new NotificationManager({} as any, configService, detectionRepository);

    await manager.upsertObservedDetectionNotification(member, detectionResult);

    expect(adminChannel.messages.fetch).not.toHaveBeenCalled();
    expect(adminChannel.send).toHaveBeenCalledTimes(1);
  });

  it('clears observed action buttons even if the notification embed is missing', async () => {
    const detectionEvent = await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: { observed_notification_message_id: 'message-1' },
    });
    const message: MockMessage = {
      id: 'message-1',
      embeds: [],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);
    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );

    const marked = await manager.markObservedDetectionActionTaken(
      detectionEvent.id,
      'dismissed this alert',
      { id: 'admin-1' } as User
    );

    expect(marked).toBe(false);
    expect(message.edit).toHaveBeenCalledWith({
      allowedMentions: { parse: [] },
      components: [],
    });
  });

  it('keeps undo controls after marking an observed false positive', async () => {
    const detectionEvent = await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: { observed_notification_message_id: 'message-1' },
    });
    const message: MockMessage = {
      id: 'message-1',
      embeds: [new EmbedBuilder().setTitle('Observed suspicious activity')],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);
    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );

    await manager.markObservedDetectionActionTaken(
      detectionEvent.id,
      'marked this detection as a false positive',
      { id: 'admin-1' } as User
    );

    const editArgs = message.edit.mock.calls[0][0] as { components: unknown[] };
    expect(extractLabels(editArgs.components)).toEqual(['Admin Actions']);
  });

  it('restores observed action buttons after undo', async () => {
    const detectionEvent = await detectionRepository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: { observed_notification_message_id: 'message-1' },
    });
    const message: MockMessage = {
      id: 'message-1',
      embeds: [
        new EmbedBuilder()
          .setTitle('Observed suspicious activity')
          .addFields({ name: 'Action Taken', value: 'dismissed this alert' }),
      ],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);
    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );

    await manager.restoreObservedDetectionActions(detectionEvent.id, 'undid the dismissal', {
      id: 'admin-1',
    } as User);

    const editArgs = message.edit.mock.calls[0][0] as {
      components: unknown[];
      embeds: EmbedBuilder[];
    };
    expect(extractLabels(editArgs.components)).toEqual(['Admin Actions']);
    expect(editArgs.embeds[0].data.fields?.[0].name).toBe('Action Reverted');
  });

  it('does not include a mention payload when editing an existing notification (even if role is configured)', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: 'role-1',
      settings: {},
    } as any);

    const member = buildMember('guild-2', 'user-2');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.8,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };

    const existingMessage: MockMessage = {
      id: 'message-2',
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(existingMessage as unknown as Message<true>);

    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );
    const verificationEvent = buildVerificationEvent({
      notification_message_id: 'message-2',
      thread_id: 'thread-1',
    });

    await manager.upsertSuspiciousUserNotification(member, detectionResult, verificationEvent);

    expect(existingMessage.edit).toHaveBeenCalledTimes(1);
    const editArgs = existingMessage.edit.mock.calls[0][0] as {
      content?: string;
      allowedMentions?: unknown;
    };

    expect(editArgs.content).toBeUndefined();
    expect(editArgs.allowedMentions).toEqual({ parse: [] });
  });

  it('edits existing notification and omits Create Thread when thread exists', async () => {
    const member = buildMember('guild-2', 'user-2');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.8,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };

    const existingMessage: MockMessage = {
      id: 'message-2',
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(existingMessage as unknown as Message<true>);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({
      notification_message_id: 'message-2',
      thread_id: 'thread-1',
    });

    await manager.upsertSuspiciousUserNotification(member, detectionResult, verificationEvent);

    expect(existingMessage.edit).toHaveBeenCalledTimes(1);
    const editArgs = existingMessage.edit.mock.calls[0][0] as {
      components: unknown[];
      content?: string;
      allowedMentions?: unknown;
    };
    expect(editArgs.content).toBeUndefined();
    expect(editArgs.allowedMentions).toEqual({ parse: [] });
    const labels = extractLabels(editArgs.components);
    expect(labels).toEqual(['Admin Actions']);
  });

  it('updates notification buttons for pending status with thread action', async () => {
    const message: MockMessage = { edit: jest.fn().mockResolvedValue(undefined) };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);

    const manager = new NotificationManager(
      buildClientWithBotBanPermission() as any,
      configService,
      detectionRepository
    );
    const verificationEvent = buildVerificationEvent({
      notification_message_id: 'message-3',
      thread_id: null,
    });

    await manager.updateNotificationButtons(verificationEvent, VerificationStatus.PENDING);

    expect(message.edit).toHaveBeenCalledTimes(1);
    const editArgs = message.edit.mock.calls[0][0] as { components: unknown[] };
    const labels = extractLabels(editArgs.components);
    expect(labels).toEqual(['Admin Actions']);
  });

  it('removes repaired action warnings without dropping action log fields', async () => {
    const embed = new EmbedBuilder().setTitle('Suspicious User').addFields(
      {
        name: 'Moderation Action Warning',
        value: 'Warning: Create case thread failed: Missing Access',
        inline: false,
      },
      {
        name: 'Latest Admin Action',
        value: 'Reopened verification by <@admin-1> at <t:123:F>',
        inline: false,
      },
      {
        name: 'Action Log',
        value: 'Reopened verification by <@admin-1> at <t:123:F>',
        inline: false,
      }
    );
    const message: MockMessage = {
      embeds: [embed],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({
      notification_message_id: 'message-repair',
      metadata: {},
    });

    await manager.updateNotificationButtons(verificationEvent, VerificationStatus.PENDING);

    const editArgs = message.edit.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const fields = editArgs.embeds[0].data.fields ?? [];
    expect(fields.find((field) => field.name === 'Moderation Action Warning')).toBeUndefined();
    expect(fields.find((field) => field.name === 'Latest Admin Action')?.value).toContain(
      'Reopened verification'
    );
    expect(fields.find((field) => field.name === 'Action Log')?.value).toContain(
      'Reopened verification'
    );
  });

  it('updates notification buttons for verified status', async () => {
    const message: MockMessage = { edit: jest.fn().mockResolvedValue(undefined) };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({
      notification_message_id: 'message-4',
    });

    await manager.updateNotificationButtons(verificationEvent, VerificationStatus.VERIFIED);

    expect(message.edit).toHaveBeenCalledTimes(1);
    const editArgs = message.edit.mock.calls[0][0] as { components: unknown[] };
    const labels = extractLabels(editArgs.components);
    expect(labels).toEqual(['Admin Actions']);
  });

  it('logs action and adds a thread field for create thread', async () => {
    const embed = new EmbedBuilder().setTitle('Suspicious User');
    const message: MockMessage = {
      embeds: [embed],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({
      notification_message_id: 'message-5',
    });

    const thread = { url: 'https://discord.com/channels/thread-1' } as any;
    await manager.logActionToMessage(
      verificationEvent,
      AdminActionType.CREATE_THREAD,
      { id: 'admin-1' } as User,
      thread
    );

    const editArgs = message.edit.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const fields = editArgs.embeds[0].data.fields ?? [];
    const latestAction = fields.find((field) => field.name === 'Latest Admin Action');
    const threadField = fields.find((field) => field.name === 'Verification Thread');
    const actionLog = fields.find((field) => field.name === 'Action Log');

    expect(latestAction?.value).toContain('Created verification thread by <@admin-1> at <t:');
    expect(latestAction?.value).toContain(':F>');
    expect(threadField?.value).toContain('Click here to view the thread');
    expect(actionLog?.value).toContain('Created verification thread by <@admin-1> at <t:');
    expect(actionLog?.value).toContain(':F>');
  });

  it('updates the admin notification with AI thread analysis details', async () => {
    const embed = new EmbedBuilder().setTitle('Suspicious User');
    const message: MockMessage = {
      embeds: [embed],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({
      notification_message_id: 'message-6',
    });

    await manager.updateVerificationThreadAnalysis(
      verificationEvent,
      {
        result: 'likely_legitimate',
        confidence: 0.72,
        summary: 'Responses match what legitimate users normally say here.',
        reasonCodes: ['normal_context'],
        legitimacySignals: ['Specific server context matched'],
        suspicionSignals: [],
        recommendedAction: 'none',
        model: GPT_PROFILE_MODEL,
        promptVersion: 'verification-thread-legitimacy-v2',
        isFallback: false,
      },
      2
    );

    const editArgs = message.edit.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const fields = editArgs.embeds[0].data.fields ?? [];
    const analysisField = fields.find((field) => field.name === 'AI Thread Analysis');

    expect(analysisField?.value).toContain('Result: **likely_legitimate** (72% confidence)');
    expect(analysisField?.value).toContain('Analyzed responses: 2');
    expect(analysisField?.value).toContain(
      'Responses match what legitimate users normally say here.'
    );
    expect(analysisField?.value).toContain('Reason codes: normal_context');
  });

  it('displays fallback GPT diagnostics as unavailable', async () => {
    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content', 'AI analysis unavailable; review manually'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
      gptAnalysis: {
        result: 'OK',
        confidence: 0.1,
        reasons: ['AI analysis unavailable; review manually'],
        reasonCodes: ['ai_analysis_unavailable'],
        primarySignal: 'none',
        summary: 'AI returned incomplete analysis; review manually.',
        model: GPT_PROFILE_MODEL,
        promptVersion: GPT_PROFILE_PROMPT_VERSION,
        isFallback: true,
      },
    };
    const sentMessage: MockMessage = { id: 'message-8', edit: jest.fn() };
    adminChannel.send.mockResolvedValue(sentMessage);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({ thread_id: null });

    await manager.upsertSuspiciousUserNotification(member, detectionResult, verificationEvent);

    const sendArgs = adminChannel.send.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const fields = sendArgs.embeds[0].data.fields ?? [];
    const aiField = fields.find((field) => field.name === 'AI Analysis');

    expect(aiField?.value).toContain('Result: **Unavailable**');
    expect(aiField?.value).not.toContain('Result: **OK**');
  });

  it('preserves persisted AI thread analysis when rebuilding the embed', async () => {
    const member = buildMember('guild-1', 'user-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };
    const message: MockMessage = {
      id: 'message-7',
      embeds: [new EmbedBuilder().setTitle('Suspicious User')],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({
      thread_id: 'thread-1',
      notification_message_id: 'message-7',
      metadata: {
        thread_analysis: {
          analyzedMessageIds: ['msg-1'],
          latestAnalysis: {
            result: 'OK',
            confidence: 0.72,
            summary: 'Responses match what legitimate users normally say here.',
            analyzedMessageCount: 2,
          },
        },
      },
    });

    await manager.upsertSuspiciousUserNotification(member, detectionResult, verificationEvent);

    const editArgs = message.edit.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const fields = editArgs.embeds[0].data.fields ?? [];
    const analysisField = fields.find((field) => field.name === 'AI Thread Analysis');

    expect(analysisField?.value).toContain('Result: **likely_legitimate** (72% confidence)');
    expect(analysisField?.value).toContain('Analyzed responses: 2');
    expect(analysisField?.value).toContain(
      'Responses match what legitimate users normally say here.'
    );
  });

  it('reuses the configured verification text channel instead of creating a duplicate', async () => {
    const overwriteSet = jest.fn().mockResolvedValue(undefined);
    const existingChannel = {
      id: 'verification-channel-1',
      name: 'verification',
      type: ChannelType.GuildText,
      permissionOverwrites: {
        set: overwriteSet,
      },
    };
    const createChannel = jest.fn();
    const fetchChannel = jest.fn().mockResolvedValue(existingChannel);
    configService.getServerConfig = jest.fn().mockResolvedValue({
      verification_channel_id: 'verification-channel-1',
      settings: {},
    } as any);
    const guild = {
      id: 'guild-1',
      roles: {
        everyone: { id: 'guild-1' },
        cache: {
          filter: jest.fn().mockReturnValue([]),
        },
      },
      channels: {
        cache: buildChannelCollection([]),
        fetch: fetchChannel,
        create: createChannel,
      },
    } as unknown as Guild;

    const manager = new NotificationManager({} as any, configService, detectionRepository);

    const channelId = await manager.setupVerificationChannel(guild, 'restricted-role-1');

    expect(channelId).toBe('verification-channel-1');
    expect(fetchChannel).toHaveBeenCalledWith('verification-channel-1');
    expect(overwriteSet).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'guild-1' }),
        expect.objectContaining({ id: 'restricted-role-1' }),
      ]),
      'Sync Drasil verification channel permissions'
    );
    expect(createChannel).not.toHaveBeenCalled();
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      verification_channel_id: 'verification-channel-1',
    });
  });

  it('syncs an already resolved verification channel without rereading config', async () => {
    const overwriteSet = jest.fn().mockResolvedValue(undefined);
    const existingChannel = {
      id: 'verification-channel-1',
      type: ChannelType.GuildText,
      permissionOverwrites: {
        set: overwriteSet,
      },
    };
    const createChannel = jest.fn();
    const fetchChannel = jest.fn().mockResolvedValue(existingChannel);
    configService.getServerConfig = jest.fn();
    const guild = {
      id: 'guild-1',
      roles: {
        everyone: { id: 'guild-1' },
        cache: {
          filter: jest.fn().mockReturnValue([]),
        },
      },
      channels: {
        cache: buildChannelCollection([]),
        fetch: fetchChannel,
        create: createChannel,
      },
    } as unknown as Guild;

    const manager = new NotificationManager({} as any, configService, detectionRepository);

    const channelId = await manager.setupVerificationChannel(
      guild,
      'restricted-role-1',
      false,
      undefined,
      'verification-channel-1'
    );

    expect(channelId).toBe('verification-channel-1');
    expect(configService.getServerConfig).not.toHaveBeenCalled();
    expect(fetchChannel).toHaveBeenCalledWith('verification-channel-1');
    expect(overwriteSet).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'restricted-role-1' })]),
      'Sync Drasil verification channel permissions'
    );
    expect(createChannel).not.toHaveBeenCalled();
    expect(configService.updateServerConfig).not.toHaveBeenCalled();
  });

  it('reuses a single existing verification channel when no channel is configured', async () => {
    const overwriteSet = jest.fn().mockResolvedValue(undefined);
    const existingChannel = {
      id: 'unrelated-verification-channel',
      name: 'verification',
      type: ChannelType.GuildText,
      permissionOverwrites: {
        set: overwriteSet,
      },
    };
    const createChannel = jest.fn();
    const fetchChannel = jest.fn();
    configService.getServerConfig = jest.fn().mockResolvedValue({
      verification_channel_id: null,
      settings: {},
    } as any);
    const guild = {
      id: 'guild-1',
      roles: {
        everyone: { id: 'guild-1' },
        cache: {
          filter: jest.fn().mockReturnValue([]),
        },
      },
      channels: {
        cache: buildChannelCollection([existingChannel]),
        fetch: fetchChannel,
        create: createChannel,
      },
    } as unknown as Guild;

    const manager = new NotificationManager({} as any, configService, detectionRepository);

    const channelId = await manager.setupVerificationChannel(guild, 'restricted-role-1');

    expect(channelId).toBe('unrelated-verification-channel');
    expect(fetchChannel).not.toHaveBeenCalled();
    expect(overwriteSet).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'restricted-role-1' })]),
      'Sync Drasil verification channel permissions'
    );
    expect(createChannel).not.toHaveBeenCalled();
  });
});
