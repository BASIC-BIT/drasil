import { EmbedBuilder, Guild, GuildMember, Message, TextChannel, User } from 'discord.js';
import { NotificationManager } from '../../services/NotificationManager';
import { InMemoryDetectionEventsRepository } from '../fakes/inMemoryRepositories';
import { DetectionResult } from '../../services/DetectionOrchestrator';
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
    const sendArgs = adminChannel.send.mock.calls[0][0] as { components: unknown[] };
    const labels = extractLabels(sendArgs.components);
    expect(labels).toEqual(
      expect.arrayContaining(['Verify User', 'Ban User', 'Create Thread', 'View Full History'])
    );
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
    const editArgs = existingMessage.edit.mock.calls[0][0] as { components: unknown[] };
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
});
