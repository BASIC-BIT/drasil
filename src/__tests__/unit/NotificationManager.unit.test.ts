import { EmbedBuilder, Guild, GuildMember, Message, TextChannel, User } from 'discord.js';
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

type MockTextChannel = {
  send: jest.Mock;
  messages: { fetch: jest.Mock };
};

type MockMessage = {
  id?: string;
  embeds?: EmbedBuilder[];
  edit: jest.Mock;
};

const buildMember = (guildId: string, userId: string): GuildMember =>
  ({
    id: userId,
    joinedAt: new Date(),
    guild: { id: guildId } as Guild,
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
  notification_message_id: overrides.notification_message_id ?? null,
  status: overrides.status ?? VerificationStatus.PENDING,
  created_at: overrides.created_at ?? new Date(),
  updated_at: overrides.updated_at ?? new Date(),
  resolved_at: overrides.resolved_at ?? null,
  resolved_by: overrides.resolved_by ?? null,
  notes: overrides.notes ?? null,
  metadata: overrides.metadata ?? null,
});

const extractLabels = (components: unknown[]): string[] => {
  return components.flatMap((row) =>
    ((row as { components?: unknown[] }).components ?? []).map(
      (button) => (button as { data?: { label?: string } }).data?.label ?? ''
    )
  );
};

describe('NotificationManager (unit)', () => {
  let detectionRepository: InMemoryDetectionEventsRepository;
  let adminChannel: MockTextChannel;
  let configService: IConfigService;

  beforeEach(() => {
    detectionRepository = new InMemoryDetectionEventsRepository();
    adminChannel = {
      send: jest.fn(),
      messages: {
        fetch: jest.fn(),
      },
    };
    configService = {
      getAdminChannel: jest.fn().mockResolvedValue(adminChannel as unknown as TextChannel),
      getServerConfig: jest.fn().mockResolvedValue({ admin_notification_role_id: null } as any),
    } as unknown as IConfigService;
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

    const manager = new NotificationManager({} as any, configService, detectionRepository);
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
    expect(labels).toEqual(
      expect.arrayContaining(['Verify User', 'Ban User', 'Create Thread', 'View Full History'])
    );
  });

  it('pings the admin notification role when configured and sending new notification', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: 'role-1',
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
    expect(JSON.stringify(sendArgs.components[0])).toContain(
      `observed:open:user-1:${detectionEvent.id}`
    );
    expect(JSON.stringify(sendArgs.components[0])).toContain(
      `observed:dismiss_menu:user-1:${detectionEvent.id}`
    );
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

  it('does not include a mention payload when editing an existing notification (even if role is configured)', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      admin_notification_role_id: 'role-1',
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

    const manager = new NotificationManager({} as any, configService, detectionRepository);
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
    expect(labels).toEqual(expect.arrayContaining(['Verify User', 'Ban User']));
    expect(labels).not.toContain('Create Thread');
  });

  it('updates notification buttons for pending status with thread action', async () => {
    const message: MockMessage = { edit: jest.fn().mockResolvedValue(undefined) };
    adminChannel.messages.fetch.mockResolvedValue(message as unknown as Message<true>);

    const manager = new NotificationManager({} as any, configService, detectionRepository);
    const verificationEvent = buildVerificationEvent({
      notification_message_id: 'message-3',
      thread_id: null,
    });

    await manager.updateNotificationButtons(verificationEvent, VerificationStatus.PENDING);

    expect(message.edit).toHaveBeenCalledTimes(1);
    const editArgs = message.edit.mock.calls[0][0] as { components: unknown[] };
    const labels = extractLabels(editArgs.components);
    expect(labels).toEqual(
      expect.arrayContaining(['Verify User', 'Ban User', 'View Full History', 'Create Thread'])
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
    expect(labels).toEqual(expect.arrayContaining(['View Full History', 'Reopen Verification']));
    expect(labels).not.toContain('Verify User');
    expect(labels).not.toContain('Ban User');
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
    const threadField = fields.find((field) => field.name === 'Verification Thread');
    const actionLog = fields.find((field) => field.name === 'Action Log');

    expect(threadField?.value).toContain('Click here to view the thread');
    expect(actionLog?.value).toContain('<@admin-1>');
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
        result: 'OK',
        confidence: 0.72,
        summary: 'Responses match what legitimate users normally say here.',
      },
      2
    );

    const editArgs = message.edit.mock.calls[0][0] as { embeds: EmbedBuilder[] };
    const fields = editArgs.embeds[0].data.fields ?? [];
    const analysisField = fields.find((field) => field.name === 'AI Thread Analysis');

    expect(analysisField?.value).toContain('Result: **OK** (72% confidence)');
    expect(analysisField?.value).toContain('Analyzed responses: 2');
    expect(analysisField?.value).toContain(
      'Responses match what legitimate users normally say here.'
    );
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

    expect(analysisField?.value).toContain('Result: **OK** (72% confidence)');
    expect(analysisField?.value).toContain('Analyzed responses: 2');
    expect(analysisField?.value).toContain(
      'Responses match what legitimate users normally say here.'
    );
  });
});
