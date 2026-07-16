import type { Client, Message } from 'discord.js';
import type { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import type { IMessageContextRepository } from '../../repositories/MessageContextRepository';
import type { IMessageDeletionJobRepository } from '../../repositories/MessageDeletionJobRepository';
import type { IServerRepository } from '../../repositories/ServerRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import {
  MessageDeletionBanStatus,
  MessageDeletionCaseFinalizationStatus,
  MessageDeletionCoverage,
  MessageDeletionDiscoverySource,
  MessageDeletionEvidenceStatus,
  MessageDeletionItemStatus,
  MessageDeletionJobMode,
  MessageDeletionJobStatus,
  MessageDeletionScope,
  VerificationStatus,
  type DetectionEvent,
  type MessageContext,
  type MessageDeletionItem,
  type MessageDeletionItemOutcome,
  type MessageDeletionJobSummary,
  type MessageDeletionJobWithItems,
  type MessageDeletionPreviewResult,
  type ServerSettings,
  type VerificationEvent,
} from '../../repositories/types';
import {
  MessageCleanupService,
  type MessageCleanupDeletionService,
} from '../../services/MessageCleanupService';

const NOW = new Date('2026-07-15T12:00:00.000Z');

function buildJob(
  overrides: Partial<MessageDeletionJobWithItems> = {}
): MessageDeletionJobWithItems {
  return {
    id: 'job-1',
    server_id: 'guild-1',
    user_id: 'user-1',
    verification_event_id: 'case-1',
    requested_by: 'admin-1',
    actor_surface: 'web',
    mode: MessageDeletionJobMode.DELETE_ONLY,
    ban_status: MessageDeletionBanStatus.NOT_REQUESTED,
    case_finalization_status: MessageDeletionCaseFinalizationStatus.NOT_APPLICABLE,
    scope: MessageDeletionScope.LAST_HOUR,
    status: MessageDeletionJobStatus.QUEUED,
    coverage: null,
    reason: 'Spam cleanup',
    evidence_thread_id: 'evidence-1',
    requested_window_start: null,
    requested_window_end: null,
    previewed_at: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    created_at: NOW,
    updated_at: NOW,
    candidate_count: 0,
    preserved_count: 0,
    deleted_count: 0,
    already_missing_count: 0,
    changed_count: 0,
    evidence_failed_count: 0,
    delete_failed_count: 0,
    permission_denied_count: 0,
    last_error: null,
    metadata: {},
    items: [],
    ...overrides,
  };
}

function buildItem(overrides: Partial<MessageDeletionItem> = {}): MessageDeletionItem {
  return {
    id: 'item-1',
    job_id: 'job-1',
    message_id: 'message-1',
    channel_id: 'channel-1',
    author_id: 'user-1',
    message_created_at: new Date('2026-07-15T11:30:00.000Z'),
    message_edited_at: null,
    content_preview: 'spam',
    attachment_count: 0,
    discovery_source: MessageDeletionDiscoverySource.DISCORD_SEARCH,
    bulk_delete_eligible: true,
    evidence_status: MessageDeletionEvidenceStatus.PENDING,
    status: MessageDeletionItemStatus.PENDING,
    evidence_message_id: null,
    attempted_at: null,
    evidence_preserved_at: null,
    deleted_at: null,
    completed_at: null,
    failure_reason: null,
    metadata: {},
    ...overrides,
  };
}

function buildMessage(id: string, overrides: Record<string, unknown> = {}): Message {
  return {
    id,
    channelId: 'channel-1',
    content: `content ${id}`,
    createdTimestamp: new Date('2026-07-15T11:30:00.000Z').getTime(),
    editedTimestamp: null,
    editedAt: null,
    author: { id: 'user-1' },
    attachments: { size: 0 },
    ...overrides,
  } as unknown as Message;
}

function buildVerification(overrides: Partial<VerificationEvent> = {}): VerificationEvent {
  return {
    id: 'case-1',
    server_id: 'guild-1',
    user_id: 'user-1',
    detection_event_id: 'detection-1',
    thread_id: 'case-thread-1',
    private_evidence_thread_id: 'evidence-1',
    notification_channel_id: null,
    notification_message_id: null,
    status: VerificationStatus.PENDING,
    created_at: NOW,
    updated_at: NOW,
    resolved_at: null,
    resolved_by: null,
    notes: null,
    metadata: {},
    ...overrides,
  };
}

class FakeJobRepository implements IMessageDeletionJobRepository {
  public readonly replacePreviewMock = jest.fn();
  public readonly updateItemOutcomeMock = jest.fn();
  public readonly markItemEvidencePreservedMock = jest.fn();
  public readonly completeMock = jest.fn();
  public readonly failMock = jest.fn();
  public job: MessageDeletionJobWithItems;

  public constructor(initialJob: MessageDeletionJobWithItems) {
    this.job = initialJob;
  }

  public async create(): Promise<never> {
    throw new Error('not used');
  }

  public async findById(): Promise<MessageDeletionJobWithItems> {
    return this.job;
  }

  public async beginPreview(): Promise<MessageDeletionJobWithItems> {
    this.job.status = MessageDeletionJobStatus.DISCOVERING;
    return this.job;
  }

  public async replacePreview(
    _id: string,
    preview: MessageDeletionPreviewResult
  ): Promise<MessageDeletionJobWithItems> {
    this.replacePreviewMock(preview);
    this.job.status = MessageDeletionJobStatus.READY;
    this.job.coverage = preview.coverage;
    this.job.items = preview.items.map((item, index) =>
      buildItem({
        id: `preview-item-${index}`,
        message_id: item.messageId,
        channel_id: item.channelId,
        author_id: item.authorId,
        message_created_at: item.messageCreatedAt,
        message_edited_at: item.messageEditedAt ?? null,
        content_preview: item.contentPreview,
        attachment_count: item.attachmentCount,
        discovery_source: item.discoverySource,
        bulk_delete_eligible: item.bulkDeleteEligible,
      })
    );
    return this.job;
  }

  public async beginExecution(): Promise<MessageDeletionJobWithItems> {
    this.job.status = MessageDeletionJobStatus.EXECUTING;
    return this.job;
  }

  public async updateBanStatus(): Promise<MessageDeletionJobWithItems> {
    throw new Error('not used');
  }

  public async markItemEvidencePreserved(
    itemId: string,
    evidenceMessageId: string,
    preservedAt = NOW
  ): Promise<MessageDeletionItem | null> {
    this.markItemEvidencePreservedMock(itemId, evidenceMessageId, preservedAt);
    const item = this.job.items.find((candidate) => candidate.id === itemId);
    if (!item) return null;
    item.evidence_status = MessageDeletionEvidenceStatus.PRESERVED;
    item.evidence_message_id = evidenceMessageId;
    item.evidence_preserved_at = preservedAt;
    return item;
  }

  public async updateCaseFinalizationStatus(): Promise<MessageDeletionJobWithItems> {
    throw new Error('not used');
  }

  public async updateItemOutcome(
    itemId: string,
    outcome: MessageDeletionItemOutcome
  ): Promise<MessageDeletionItem | null> {
    this.updateItemOutcomeMock(itemId, outcome);
    const item = this.job.items.find((candidate) => candidate.id === itemId);
    if (!item) return null;
    item.status = outcome.status;
    item.evidence_status = outcome.evidenceStatus;
    item.evidence_message_id = outcome.evidenceMessageId ?? item.evidence_message_id;
    item.failure_reason = outcome.failureReason ?? null;
    return item;
  }

  public async complete(
    _id: string,
    summary: MessageDeletionJobSummary
  ): Promise<MessageDeletionJobWithItems> {
    this.completeMock(summary);
    this.job.status = MessageDeletionJobStatus.COMPLETED;
    return this.job;
  }

  public async fail(_id: string, error: string): Promise<MessageDeletionJobWithItems> {
    this.failMock(error);
    this.job.status = MessageDeletionJobStatus.FAILED;
    return this.job;
  }
}

function createHarness(
  input: {
    job?: MessageDeletionJobWithItems;
    restGet?: jest.Mock;
    channelsFetch?: jest.Mock;
    verification?: VerificationEvent;
    detection?: DetectionEvent | null;
    contexts?: MessageContext[];
    deletion?: Partial<MessageCleanupDeletionService>;
    serverSettings?: ServerSettings;
  } = {}
) {
  const jobs = new FakeJobRepository(input.job ?? buildJob());
  const restGet = input.restGet ?? jest.fn();
  const channelsFetch = input.channelsFetch ?? jest.fn();
  const client = {
    rest: { get: restGet },
    channels: { fetch: channelsFetch },
  } as unknown as Client;
  const verificationEvents = {
    findById: jest.fn().mockResolvedValue(input.verification ?? buildVerification()),
  } as unknown as IVerificationEventRepository;
  const detectionEvents = {
    findById: jest.fn().mockResolvedValue(input.detection ?? null),
  } as unknown as IDetectionEventsRepository;
  const messageContexts = {
    findRecentByServerAndUser: jest.fn().mockResolvedValue(input.contexts ?? []),
  } as unknown as IMessageContextRepository;
  const servers = {
    findById: jest.fn().mockResolvedValue({ settings: input.serverSettings ?? {} }),
  } as unknown as IServerRepository;
  const deletionService: MessageCleanupDeletionService = {
    preserveMessageEvidence: jest
      .fn()
      .mockResolvedValue({ preserved: true, evidenceMessageId: 'evidence-message' }),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    bulkDeleteMessages: jest.fn().mockResolvedValue(undefined),
    ...input.deletion,
  };
  const service = new MessageCleanupService(
    client,
    jobs,
    verificationEvents,
    detectionEvents,
    messageContexts,
    servers,
    deletionService,
    () => new Date(NOW)
  );
  return { service, jobs, restGet, channelsFetch, messageContexts, deletionService };
}

describe('MessageCleanupService', () => {
  it('discovers an exact source message from linked detection metadata', async () => {
    const source = buildMessage('source-1');
    const detection = {
      id: 'detection-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      message_id: 'source-1',
      channel_id: 'channel-1',
    } as DetectionEvent;
    const harness = createHarness({
      job: buildJob({ scope: MessageDeletionScope.SOURCE_MESSAGE }),
      detection,
      channelsFetch: jest.fn().mockResolvedValue({
        messages: { fetch: jest.fn().mockResolvedValue(source) },
      }),
    });

    const result = await harness.service.previewJob('job-1');

    expect(result.coverage).toBe(MessageDeletionCoverage.READY);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      message_id: 'source-1',
      discovery_source: MessageDeletionDiscoverySource.SOURCE_MESSAGE,
    });
  });

  it('paginates search in groups of 25 and deduplicates message context hits', async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => [
      {
        id: `message-${index}`,
        channel_id: 'channel-1',
        author: { id: 'user-1' },
        content: `message ${index}`,
        timestamp: '2026-07-15T11:30:00.000Z',
      },
      {
        id: 'context-message',
        channel_id: 'channel-1',
        author: { id: 'someone-else' },
        timestamp: '2026-07-15T11:30:00.000Z',
      },
    ]);
    const restGet = jest
      .fn()
      .mockResolvedValueOnce({ total_results: 26, messages: firstPage })
      .mockResolvedValueOnce({
        total_results: 26,
        messages: [
          [
            firstPage[0][0],
            {
              id: 'message-25',
              channel_id: 'channel-1',
              author: { id: 'user-1' },
              timestamp: '2026-07-15T11:31:00.000Z',
            },
          ],
        ],
      });
    const harness = createHarness({ restGet });

    const result = await harness.service.previewJob('job-1');

    expect(result.coverage).toBe(MessageDeletionCoverage.READY);
    expect(result.items).toHaveLength(26);
    expect(restGet).toHaveBeenCalledTimes(2);
    const firstQuery = restGet.mock.calls[0][1].query as URLSearchParams;
    const secondQuery = restGet.mock.calls[1][1].query as URLSearchParams;
    expect(firstQuery.get('limit')).toBe('25');
    expect(firstQuery.get('author_id')).toBe('user-1');
    expect(secondQuery.get('offset')).toBe('25');
  });

  it('continues past an underreported search total until Discord returns an empty page', async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => [
      {
        id: `underreported-${index}`,
        channel_id: 'channel-1',
        author: { id: 'user-1' },
        content: `message ${index}`,
        timestamp: '2026-07-15T11:30:00.000Z',
      },
    ]);
    const restGet = jest
      .fn()
      .mockResolvedValueOnce({ total_results: 1, messages: firstPage })
      .mockResolvedValueOnce({ total_results: 1, messages: [] });
    const harness = createHarness({ restGet });

    const result = await harness.service.previewJob('job-1');

    expect(result.coverage).toBe(MessageDeletionCoverage.READY);
    expect(result.items).toHaveLength(25);
    expect(restGet).toHaveBeenCalledTimes(2);
  });

  it('uses message contexts as blocked partial coverage when Discord search is denied', async () => {
    const context = {
      id: 'context-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      message_id: 'context-message',
      channel_id: 'channel-1',
      content_preview: 'context preview',
      content_features: {},
      created_at: new Date('2026-07-15T11:45:00.000Z'),
      observed_at: NOW,
      expires_at: new Date('2026-08-01T00:00:00.000Z'),
    } satisfies MessageContext;
    const harness = createHarness({
      restGet: jest.fn().mockRejectedValue({ code: 50013, message: 'Missing permissions' }),
      contexts: [context],
    });

    const result = await harness.service.previewJob('job-1');

    expect(result.coverage).toBe(MessageDeletionCoverage.PARTIAL);
    expect(result.items[0]).toMatchObject({
      message_id: 'context-message',
      discovery_source: MessageDeletionDiscoverySource.MESSAGE_CONTEXT,
    });
  });

  it('preserves one evidence message per candidate before bulk deleting', async () => {
    const first = buildItem({ id: 'item-1', message_id: 'message-1' });
    const second = buildItem({ id: 'item-2', message_id: 'message-2' });
    const messages = new Map([
      ['message-1', buildMessage('message-1')],
      ['message-2', buildMessage('message-2')],
    ]);
    const fetchMessage = jest.fn((id: string) => Promise.resolve(messages.get(id)));
    const preserve = jest
      .fn()
      .mockImplementation(({ itemId }: { itemId: string }) =>
        Promise.resolve({ preserved: true, evidenceMessageId: `evidence-${itemId}` })
      );
    const bulkDelete = jest.fn().mockResolvedValue(undefined);
    const harness = createHarness({
      job: buildJob({
        status: MessageDeletionJobStatus.READY,
        coverage: MessageDeletionCoverage.READY,
        candidate_count: 2,
        items: [first, second],
      }),
      channelsFetch: jest.fn().mockResolvedValue({ messages: { fetch: fetchMessage } }),
      deletion: { preserveMessageEvidence: preserve, bulkDeleteMessages: bulkDelete },
      serverSettings: { report_ai_max_images: 1, report_ai_max_image_bytes: 2048 },
    });

    const result = await harness.service.executeJob('job-1');

    expect(preserve).toHaveBeenCalledTimes(2);
    expect(preserve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        settings: { report_ai_max_images: 1, report_ai_max_image_bytes: 2048 },
      })
    );
    expect(preserve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        settings: { report_ai_max_images: 1, report_ai_max_image_bytes: 2048 },
      })
    );
    expect(bulkDelete).toHaveBeenCalledWith({
      channelId: 'channel-1',
      messageIds: ['message-1', 'message-2'],
      reason: 'Spam cleanup',
    });
    expect(Math.max(...preserve.mock.invocationCallOrder)).toBeLessThan(
      bulkDelete.mock.invocationCallOrder[0]
    );
    expect(result).toMatchObject({ deletedCount: 2, preservedCount: 2 });
    expect(harness.deletionService.deleteMessage).not.toHaveBeenCalled();
  });

  it('fails the job without relabeling a successful bulk delete when outcome persistence fails', async () => {
    const first = buildItem({ id: 'item-1', message_id: 'message-1' });
    const second = buildItem({ id: 'item-2', message_id: 'message-2' });
    const messages = new Map([
      ['message-1', buildMessage('message-1')],
      ['message-2', buildMessage('message-2')],
    ]);
    const bulkDelete = jest.fn().mockResolvedValue(undefined);
    const harness = createHarness({
      job: buildJob({
        status: MessageDeletionJobStatus.READY,
        coverage: MessageDeletionCoverage.READY,
        candidate_count: 2,
        items: [first, second],
      }),
      channelsFetch: jest.fn().mockResolvedValue({
        messages: { fetch: jest.fn((id: string) => Promise.resolve(messages.get(id))) },
      }),
      deletion: { bulkDeleteMessages: bulkDelete },
    });
    harness.jobs.updateItemOutcomeMock.mockImplementation(
      (_itemId: string, outcome: MessageDeletionItemOutcome) => {
        if (outcome.status === MessageDeletionItemStatus.DELETED) {
          throw new Error('outcome persistence failed');
        }
      }
    );

    await expect(harness.service.executeJob('job-1')).rejects.toThrow('outcome persistence failed');

    expect(bulkDelete).toHaveBeenCalledTimes(1);
    expect(harness.jobs.failMock).toHaveBeenCalledWith('outcome persistence failed');
    expect(
      harness.jobs.updateItemOutcomeMock.mock.calls.some(
        ([, outcome]) => outcome.status === MessageDeletionItemStatus.DELETE_FAILED
      )
    ).toBe(false);
  });

  it('skips changed and completed items and never deletes when evidence preservation fails', async () => {
    const completed = buildItem({
      id: 'item-completed',
      message_id: 'message-completed',
      status: MessageDeletionItemStatus.DELETED,
      evidence_status: MessageDeletionEvidenceStatus.PRESERVED,
      evidence_message_id: 'existing-evidence',
    });
    const changed = buildItem({
      id: 'item-changed',
      message_id: 'message-changed',
      message_edited_at: null,
      bulk_delete_eligible: false,
    });
    const evidenceFailure = buildItem({
      id: 'item-evidence',
      message_id: 'message-evidence',
      bulk_delete_eligible: false,
    });
    const messages = new Map([
      [
        'message-changed',
        buildMessage('message-changed', {
          editedTimestamp: new Date('2026-07-15T11:50:00.000Z').getTime(),
          editedAt: new Date('2026-07-15T11:50:00.000Z'),
        }),
      ],
      ['message-evidence', buildMessage('message-evidence')],
    ]);
    const preserve = jest.fn().mockResolvedValue({
      preserved: false,
      reason: 'evidence thread denied',
    });
    const harness = createHarness({
      job: buildJob({
        status: MessageDeletionJobStatus.EXECUTING,
        coverage: MessageDeletionCoverage.READY,
        candidate_count: 3,
        items: [completed, changed, evidenceFailure],
      }),
      channelsFetch: jest.fn().mockResolvedValue({
        messages: { fetch: jest.fn((id: string) => Promise.resolve(messages.get(id))) },
      }),
      deletion: { preserveMessageEvidence: preserve },
    });

    const result = await harness.service.executeJob('job-1');

    expect(harness.channelsFetch).toHaveBeenCalledTimes(2);
    expect(preserve).toHaveBeenCalledTimes(1);
    expect(harness.deletionService.deleteMessage).not.toHaveBeenCalled();
    expect(harness.deletionService.bulkDeleteMessages).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      deletedCount: 1,
      changedCount: 1,
      evidenceFailedCount: 1,
    });
  });
});
