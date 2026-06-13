import type { Client, Message, MessageCreateOptions, MessageEditOptions } from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import type { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import type { IModerationQueueRepository } from '../../repositories/ModerationQueueRepository';
import type { IServerRepository } from '../../repositories/ServerRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import {
  DetectionEvent,
  DetectionType,
  ModerationQueueItem,
  ModerationQueueItemType,
  Server,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { ModerationQueueService } from '../../services/ModerationQueueService';

class FakeDiscordMessage {
  public readonly id: string;
  public readonly channelId: string;
  public payload: Record<string, unknown>;
  public deleted = false;
  public edit = jest.fn(async (payload: MessageEditOptions) => {
    this.payload = { ...this.payload, ...payload };
    return this as unknown as Message;
  });
  public delete = jest.fn(async () => {
    this.deleted = true;
    return this as unknown as Message;
  });

  constructor(id: string, channelId: string, payload: Record<string, unknown>) {
    this.id = id;
    this.channelId = channelId;
    this.payload = payload;
  }
}

class FakeDiscordChannel {
  public readonly id: string;
  private nextMessageId = 0;
  public readonly sentMessages: FakeDiscordMessage[] = [];
  public readonly messages = {
    fetch: jest.fn(async (messageId: string) => {
      const message = this.sentMessages.find((entry) => entry.id === messageId);
      if (!message) {
        throw new Error(`Message ${messageId} not found`);
      }
      return message as unknown as Message;
    }),
  };
  public readonly send = jest.fn(async (payload: MessageCreateOptions) => {
    this.nextMessageId += 1;
    const message = new FakeDiscordMessage(
      `queue-msg-${this.nextMessageId}`,
      this.id,
      payload as unknown as Record<string, unknown>
    );
    this.sentMessages.push(message);
    return message as unknown as Message;
  });

  constructor(id: string) {
    this.id = id;
  }
}

class FakeModerationQueueRepository implements IModerationQueueRepository {
  public items: ModerationQueueItem[] = [];
  private nextId = 0;

  async findById(id: string): Promise<ModerationQueueItem | null> {
    return this.clone(this.items.find((item) => item.id === id) ?? null);
  }

  async findByCase(verificationEventId: string): Promise<ModerationQueueItem | null> {
    return this.clone(
      this.items.find(
        (item) =>
          item.item_type === ModerationQueueItemType.CASE_MIRROR &&
          item.verification_event_id === verificationEventId
      ) ?? null
    );
  }

  async findByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem | null> {
    return this.clone(
      this.items.find(
        (item) =>
          item.item_type === ModerationQueueItemType.OBSERVED_ALERT_MIRROR &&
          item.detection_event_id === detectionEventId
      ) ?? null
    );
  }

  async findAttentionByThread(
    itemType: ModerationQueueItemType,
    sourceThreadId: string
  ): Promise<ModerationQueueItem | null> {
    return this.clone(
      this.items.find(
        (item) => item.item_type === itemType && item.source_thread_id === sourceThreadId
      ) ?? null
    );
  }

  async listByServer(serverId: string): Promise<ModerationQueueItem[]> {
    return this.items.filter((item) => item.server_id === serverId).map((item) => ({ ...item }));
  }

  async listByServerAndTypes(
    serverId: string,
    itemTypes: ModerationQueueItemType[]
  ): Promise<ModerationQueueItem[]> {
    return this.items
      .filter((item) => item.server_id === serverId && itemTypes.includes(item.item_type))
      .map((item) => ({ ...item }));
  }

  async upsert(
    data: Parameters<IModerationQueueRepository['upsert']>[0]
  ): Promise<ModerationQueueItem> {
    const existingIndex = this.items.findIndex((item) => this.matches(item, data));
    const now = new Date();
    if (existingIndex >= 0) {
      const existing = this.items[existingIndex];
      const updated: ModerationQueueItem = {
        ...existing,
        server_id: data.serverId,
        user_id: data.userId,
        verification_event_id: data.verificationEventId ?? existing.verification_event_id,
        detection_event_id: data.detectionEventId ?? existing.detection_event_id,
        report_intake_id: data.reportIntakeId ?? existing.report_intake_id,
        source_thread_id: data.sourceThreadId ?? existing.source_thread_id,
        queue_channel_id: data.queueChannelId ?? existing.queue_channel_id,
        queue_message_id: data.queueMessageId ?? existing.queue_message_id,
        last_source_message_id: data.lastSourceMessageId ?? existing.last_source_message_id,
        last_notified_at: data.lastNotifiedAt ?? existing.last_notified_at,
        metadata: data.metadata ?? existing.metadata,
        updated_at: now,
      };
      this.items[existingIndex] = updated;
      return { ...updated };
    }

    this.nextId += 1;
    const created: ModerationQueueItem = {
      id: `queue-${this.nextId}`,
      server_id: data.serverId,
      user_id: data.userId,
      item_type: data.itemType,
      verification_event_id: data.verificationEventId ?? null,
      detection_event_id: data.detectionEventId ?? null,
      report_intake_id: data.reportIntakeId ?? null,
      source_thread_id: data.sourceThreadId ?? null,
      queue_channel_id: data.queueChannelId ?? null,
      queue_message_id: data.queueMessageId ?? null,
      last_source_message_id: data.lastSourceMessageId ?? null,
      last_notified_at: data.lastNotifiedAt ?? null,
      created_at: now,
      updated_at: now,
      metadata: data.metadata ?? {},
    };
    this.items.push(created);
    return { ...created };
  }

  async updateDiscordMessage(
    id: string,
    queueChannelId: string | null,
    queueMessageId: string | null
  ): Promise<ModerationQueueItem | null> {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) {
      return null;
    }
    item.queue_channel_id = queueChannelId;
    item.queue_message_id = queueMessageId;
    item.updated_at = new Date();
    return { ...item };
  }

  async deleteById(id: string): Promise<ModerationQueueItem | null> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }
    const [deleted] = this.items.splice(index, 1);
    return { ...deleted };
  }

  async deleteByCase(verificationEventId: string): Promise<ModerationQueueItem[]> {
    return this.deleteMatching((item) => item.verification_event_id === verificationEventId);
  }

  async deleteByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem[]> {
    return this.deleteMatching(
      (item) =>
        item.item_type === ModerationQueueItemType.OBSERVED_ALERT_MIRROR &&
        item.detection_event_id === detectionEventId
    );
  }

  async deleteByReportIntake(reportIntakeId: string): Promise<ModerationQueueItem[]> {
    return this.deleteMatching((item) => item.report_intake_id === reportIntakeId);
  }

  private matches(
    item: ModerationQueueItem,
    data: Parameters<IModerationQueueRepository['upsert']>[0]
  ): boolean {
    return (
      (data.itemType === ModerationQueueItemType.CASE_MIRROR &&
        item.item_type === data.itemType &&
        item.verification_event_id === data.verificationEventId) ||
      (data.itemType === ModerationQueueItemType.OBSERVED_ALERT_MIRROR &&
        item.item_type === data.itemType &&
        item.detection_event_id === data.detectionEventId) ||
      ((data.itemType === ModerationQueueItemType.SUPPORT_THREAD_ATTENTION ||
        data.itemType === ModerationQueueItemType.REPORT_THREAD_ATTENTION) &&
        item.item_type === data.itemType &&
        item.source_thread_id === data.sourceThreadId)
    );
  }

  // eslint-disable-next-line no-unused-vars -- TypeScript requires a parameter name in this function type.
  private deleteMatching(predicate: (item: ModerationQueueItem) => boolean): ModerationQueueItem[] {
    const deleted = this.items.filter(predicate);
    this.items = this.items.filter((item) => !predicate(item));
    return deleted.map((item) => ({ ...item }));
  }

  private clone(item: ModerationQueueItem | null): ModerationQueueItem | null {
    return item ? { ...item } : null;
  }
}

const buildServer = (): Server => ({
  guild_id: 'guild-1',
  restricted_role_id: null,
  admin_channel_id: null,
  verification_channel_id: null,
  admin_notification_role_id: 'admin-role',
  heuristic_message_threshold: 5,
  heuristic_message_timeframe_seconds: 10,
  heuristic_suspicious_keywords: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  updated_by: null,
  settings: {
    moderation_queue_channel_id: 'queue-channel',
    moderator_ban_action_enabled: true,
  },
  is_active: true,
});

const buildVerificationEvent = (): VerificationEvent => ({
  id: 'case-1',
  server_id: 'guild-1',
  user_id: 'user-1',
  detection_event_id: 'det-1',
  thread_id: 'support-thread',
  private_evidence_thread_id: 'evidence-thread',
  notification_channel_id: 'admin-channel',
  notification_message_id: 'admin-message',
  status: VerificationStatus.PENDING,
  created_at: new Date('2026-06-13T10:00:00Z'),
  updated_at: new Date('2026-06-13T10:00:00Z'),
  resolved_at: null,
  resolved_by: null,
  notes: null,
  metadata: {},
});

const buildDetectionEvent = (): DetectionEvent => ({
  id: 'det-2',
  server_id: 'guild-1',
  user_id: 'user-2',
  thread_id: null,
  message_id: null,
  channel_id: null,
  detection_type: DetectionType.SUSPICIOUS_CONTENT,
  confidence: 0.91,
  reasons: ['Suspicious link'],
  detected_at: new Date('2026-06-13T11:00:00Z'),
  latest_verification_event_id: null,
  metadata: {
    observed_notification_channel_id: 'admin-channel',
    observed_notification_message_id: 'observed-message',
  },
});

const buildService = (
  input: {
    server?: Server;
    pendingCases?: VerificationEvent[];
    observedAlerts?: DetectionEvent[];
    queueRepository?: FakeModerationQueueRepository;
    channel?: FakeDiscordChannel;
  } = {}
) => {
  const server = input.server ?? buildServer();
  const channel = input.channel ?? new FakeDiscordChannel('queue-channel');
  const queueRepository = input.queueRepository ?? new FakeModerationQueueRepository();
  const configService = {
    getServerConfig: jest.fn(async () => server),
  } as unknown as IConfigService;
  const serverRepository = {
    findAllActive: jest.fn(async () => [server]),
  } as unknown as IServerRepository;
  const verificationRepository = {
    findPendingByServer: jest.fn(async () => input.pendingCases ?? []),
  } as unknown as IVerificationEventRepository;
  const detectionRepository = {
    findUnresolvedObservedNotificationsByServer: jest.fn(async () => input.observedAlerts ?? []),
    findById: jest.fn(
      async (id: string) => input.observedAlerts?.find((event) => event.id === id) ?? null
    ),
  } as unknown as IDetectionEventsRepository;
  const client = {
    channels: {
      fetch: jest.fn(async (channelId: string) => (channelId === channel.id ? channel : null)),
    },
  } as unknown as Client;

  return {
    channel,
    queueRepository,
    service: new ModerationQueueService(
      client,
      configService,
      serverRepository,
      verificationRepository,
      detectionRepository,
      queueRepository
    ),
  };
};

describe('ModerationQueueService', () => {
  it('syncs pending cases and un-actioned observed alerts, then removes stale mirrors', async () => {
    const queueRepository = new FakeModerationQueueRepository();
    const stale = await queueRepository.upsert({
      serverId: 'guild-1',
      userId: 'stale-user',
      itemType: ModerationQueueItemType.CASE_MIRROR,
      verificationEventId: 'stale-case',
      queueChannelId: 'queue-channel',
      queueMessageId: 'queue-msg-stale',
    });
    const channel = new FakeDiscordChannel('queue-channel');
    channel.sentMessages.push(
      new FakeDiscordMessage('queue-msg-stale', 'queue-channel', { content: 'stale' })
    );
    const { service } = buildService({
      pendingCases: [buildVerificationEvent()],
      observedAlerts: [buildDetectionEvent()],
      queueRepository,
      channel,
    });

    await service.syncServerQueue('guild-1');

    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(
      channel.sentMessages.find((message) => message.id === stale.queue_message_id)?.deleted
    ).toBe(true);
    expect(queueRepository.items.map((item) => item.item_type).sort()).toEqual([
      ModerationQueueItemType.CASE_MIRROR,
      ModerationQueueItemType.OBSERVED_ALERT_MIRROR,
    ]);
  });

  it('does not create observed mirrors for detections without observed notifications', async () => {
    const { channel, queueRepository, service } = buildService();
    const detectionEvent = { ...buildDetectionEvent(), metadata: {} };

    await service.upsertObservedAlertMirror(detectionEvent);

    expect(channel.send).not.toHaveBeenCalled();
    expect(queueRepository.items).toHaveLength(0);
  });

  it('deletes observed alert mirrors without deleting case mirrors for the same detection', async () => {
    const queueRepository = new FakeModerationQueueRepository();
    await queueRepository.upsert({
      serverId: 'guild-1',
      userId: 'user-1',
      itemType: ModerationQueueItemType.CASE_MIRROR,
      verificationEventId: 'case-1',
      detectionEventId: 'det-2',
    });
    await queueRepository.upsert({
      serverId: 'guild-1',
      userId: 'user-2',
      itemType: ModerationQueueItemType.OBSERVED_ALERT_MIRROR,
      detectionEventId: 'det-2',
    });
    const { service } = buildService({ queueRepository });

    await service.deleteObservedAlertMirror('det-2');

    expect(queueRepository.items).toHaveLength(1);
    expect(queueRepository.items[0]).toMatchObject({
      item_type: ModerationQueueItemType.CASE_MIRROR,
      verification_event_id: 'case-1',
    });
  });

  it('debounces support-thread attention until acknowledgement deletes the reminder only', async () => {
    const { channel, queueRepository, service } = buildService();
    const verificationEvent = buildVerificationEvent();
    const firstMessage = {
      id: 'reply-1',
      channelId: 'support-thread',
      content: 'I am a real member.',
      url: 'https://discord.com/channels/guild-1/support-thread/reply-1',
      createdTimestamp: Date.parse('2026-06-13T12:00:00Z'),
      author: { id: 'user-1' },
    } as unknown as Message;
    const secondMessage = {
      ...firstMessage,
      id: 'reply-2',
      content: 'Adding a screenshot next.',
      url: 'https://discord.com/channels/guild-1/support-thread/reply-2',
      createdTimestamp: Date.parse('2026-06-13T12:01:00Z'),
    } as unknown as Message;

    await service.recordSupportThreadAttention(verificationEvent, firstMessage);
    await service.recordSupportThreadAttention(verificationEvent, secondMessage);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send.mock.calls[0][0].content).toBe('<@&admin-role>');
    expect(channel.sentMessages[0].edit).toHaveBeenCalledTimes(1);
    expect(queueRepository.items).toHaveLength(1);
    expect(queueRepository.items[0].last_source_message_id).toBe('reply-2');

    const acknowledged = await service.acknowledgeAttentionItem(queueRepository.items[0].id);

    expect(acknowledged).toBe(true);
    expect(channel.sentMessages[0].delete).toHaveBeenCalledTimes(1);
    expect(queueRepository.items).toHaveLength(0);
  });
});
