import type { Client, Message } from 'discord.js';
import { MessageDeletionService } from '../../services/MessageDeletionService';
import { InMemoryDetectionEventsRepository } from '../fakes/inMemoryRepositories';
import { DetectionType } from '../../repositories/types';

describe('MessageDeletionService (unit)', () => {
  const action = {
    kind: 'delete_source_message' as const,
    source: 'watchlist' as const,
    watchlistEntryId: 'entry-1',
    watchlistEntryLabel: 'Known scam campaign',
    matchedTerm: 'scam.example',
  };

  const createDetection = async (repository: InMemoryDetectionEventsRepository) =>
    repository.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.PATTERN_MATCH,
      confidence: 1,
      reasons: ['Matched watchlist'],
      metadata: { existing: true },
    });

  const buildMessage = (overrides: Record<string, unknown> = {}): Message =>
    ({
      id: 'message-1',
      channelId: 'channel-1',
      content: 'visit https://scam.example now',
      createdTimestamp: Date.parse('2026-06-23T12:00:00.000Z'),
      deletable: true,
      delete: jest.fn().mockResolvedValue(undefined),
      author: {
        id: 'user-1',
        tag: 'user#0001',
      },
      attachments: {
        map: jest.fn(() => []),
      },
      ...overrides,
    }) as unknown as Message;

  it('preserves evidence before deleting the source message', async () => {
    const repository = new InMemoryDetectionEventsRepository();
    const detection = await createDetection(repository);
    const evidenceMessage = { id: 'evidence-message-1' } as Message;
    const evidenceThread = {
      send: jest.fn().mockResolvedValue(evidenceMessage),
    };
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(evidenceThread),
      },
    } as unknown as Client;
    const sourceMessage = buildMessage();
    const service = new MessageDeletionService(client, repository);

    const result = await service.preserveAndDeleteSourceMessage({
      detectionEventId: detection.id,
      sourceMessage,
      evidenceThreadId: 'thread-1',
      action,
    });

    expect(result).toEqual({ attempted: true, deleted: true, evidencePreserved: true });
    expect(evidenceThread.send).toHaveBeenCalledTimes(1);
    expect(sourceMessage.delete).toHaveBeenCalledTimes(1);
    expect(evidenceThread.send.mock.invocationCallOrder[0]).toBeLessThan(
      (sourceMessage.delete as jest.Mock).mock.invocationCallOrder[0]
    );
    const updated = await repository.findById(detection.id);
    expect(updated?.metadata).toMatchObject({
      existing: true,
      message_deletion: {
        source: 'watchlist',
        scope: 'source_message',
        deleted: true,
        evidence_preserved: true,
        evidence_message_id: 'evidence-message-1',
      },
    });
  });

  it('preserves and audits when Discord reports the source message is not deletable', async () => {
    const repository = new InMemoryDetectionEventsRepository();
    const detection = await createDetection(repository);
    const evidenceThread = {
      send: jest.fn().mockResolvedValue({ id: 'evidence-message-2' } as Message),
    };
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(evidenceThread),
      },
    } as unknown as Client;
    const sourceMessage = buildMessage({ deletable: false });
    const service = new MessageDeletionService(client, repository);

    const result = await service.preserveAndDeleteSourceMessage({
      detectionEventId: detection.id,
      sourceMessage,
      evidenceThreadId: 'thread-1',
      action,
    });

    expect(result).toMatchObject({
      attempted: true,
      deleted: false,
      evidencePreserved: true,
      reason: 'message_not_deletable',
    });
    expect(sourceMessage.delete).not.toHaveBeenCalled();
    const updated = await repository.findById(detection.id);
    expect(updated?.metadata).toMatchObject({
      message_deletion: {
        deleted: false,
        evidence_preserved: true,
        failure_reason: 'message_not_deletable',
      },
    });
  });

  it('audits and skips deletion when evidence preservation fails', async () => {
    const repository = new InMemoryDetectionEventsRepository();
    const detection = await createDetection(repository);
    const evidenceThread = {
      send: jest.fn().mockRejectedValue(new Error('missing permissions')),
    };
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(evidenceThread),
      },
    } as unknown as Client;
    const sourceMessage = buildMessage();
    const service = new MessageDeletionService(client, repository);

    const result = await service.preserveAndDeleteSourceMessage({
      detectionEventId: detection.id,
      sourceMessage,
      evidenceThreadId: 'thread-1',
      action,
    });

    expect(result).toMatchObject({
      attempted: true,
      deleted: false,
      evidencePreserved: false,
      reason: 'missing permissions',
    });
    expect(sourceMessage.delete).not.toHaveBeenCalled();
    const updated = await repository.findById(detection.id);
    expect(updated?.metadata).toMatchObject({
      message_deletion: {
        attempted: true,
        deleted: false,
        evidence_preserved: false,
        failure_reason: 'missing permissions',
      },
    });
  });

  it('caps preserved evidence content to Discord message limits', async () => {
    const repository = new InMemoryDetectionEventsRepository();
    const detection = await createDetection(repository);
    const evidenceThread = {
      send: jest.fn().mockResolvedValue({ id: 'evidence-message-3' } as Message),
    };
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(evidenceThread),
      },
    } as unknown as Client;
    const sourceMessage = buildMessage({ content: `https://scam.example ${'x'.repeat(5000)}` });
    const service = new MessageDeletionService(client, repository);

    await service.preserveAndDeleteSourceMessage({
      detectionEventId: detection.id,
      sourceMessage,
      evidenceThreadId: 'thread-1',
      action,
    });

    const sendPayload = evidenceThread.send.mock.calls[0][0];
    expect(sendPayload.content).toHaveLength(2000);
    expect(sendPayload.content).toContain('Evidence text truncated to fit Discord message limits.');
    expect(((sendPayload.content as string).match(/```/g) ?? []).length % 2).toBe(0);
    expect(sourceMessage.delete).toHaveBeenCalledTimes(1);
  });

  it('uses server report image limits when preserving source evidence', async () => {
    const repository = new InMemoryDetectionEventsRepository();
    const detection = await createDetection(repository);
    const evidenceThread = {
      send: jest.fn().mockResolvedValue({ id: 'evidence-message-4' } as Message),
    };
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue(evidenceThread),
      },
    } as unknown as Client;
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);
    const sourceMessage = buildMessage({
      attachments: {
        map: jest.fn((callback) =>
          [
            {
              id: 'image-1',
              name: 'proof.png',
              url: 'https://example.test/proof.png',
              contentType: 'image/png',
              size: 100,
            },
          ].map(callback)
        ),
      },
    });
    const service = new MessageDeletionService(client, repository);

    await service.preserveAndDeleteSourceMessage({
      detectionEventId: detection.id,
      sourceMessage,
      evidenceThreadId: 'thread-1',
      action,
      settings: { report_ai_max_images: 0 },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(evidenceThread.send.mock.calls[0][0].files).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it('preserves one cleanup evidence message with durable job and item markers', async () => {
    const repository = new InMemoryDetectionEventsRepository();
    const evidenceThread = {
      send: jest.fn().mockResolvedValue({ id: 'evidence-message-5' } as Message),
    };
    const client = {
      channels: { fetch: jest.fn().mockResolvedValue(evidenceThread) },
      rest: { delete: jest.fn(), post: jest.fn() },
    } as unknown as Client;
    const service = new MessageDeletionService(client, repository);

    const result = await service.preserveMessageEvidence({
      sourceMessage: buildMessage(),
      evidenceThreadId: 'thread-1',
      jobId: 'job-1',
      itemId: 'item-1',
      reason: 'Repeated unsolicited links',
    });

    expect(result).toEqual({ preserved: true, evidenceMessageId: 'evidence-message-5' });
    expect(evidenceThread.send).toHaveBeenCalledTimes(1);
    expect(evidenceThread.send.mock.calls[0][0].content).toContain('Cleanup job: job-1');
    expect(evidenceThread.send.mock.calls[0][0].content).toContain('Cleanup item: item-1');
  });

  it('uses audit-log reasons for single and bulk Discord deletion', async () => {
    const repository = new InMemoryDetectionEventsRepository();
    const rest = { delete: jest.fn().mockResolvedValue(undefined), post: jest.fn() };
    const client = { rest } as unknown as Client;
    const service = new MessageDeletionService(client, repository);

    await service.deleteMessage({
      channelId: 'channel-1',
      messageId: 'message-1',
      reason: 'Case cleanup',
    });
    await service.bulkDeleteMessages({
      channelId: 'channel-1',
      messageIds: ['message-1', 'message-2'],
      reason: 'Case cleanup',
    });

    expect(rest.delete).toHaveBeenCalledWith('/channels/channel-1/messages/message-1', {
      reason: 'Case cleanup',
    });
    expect(rest.post).toHaveBeenCalledWith('/channels/channel-1/messages/bulk-delete', {
      body: { messages: ['message-1', 'message-2'] },
      reason: 'Case cleanup',
    });
  });

  it('rejects invalid bulk deletion batches before calling Discord', async () => {
    const repository = new InMemoryDetectionEventsRepository();
    const rest = { post: jest.fn() };
    const client = { rest } as unknown as Client;
    const service = new MessageDeletionService(client, repository);

    await expect(
      service.bulkDeleteMessages({
        channelId: 'channel-1',
        messageIds: ['message-1', 'message-1'],
        reason: 'Case cleanup',
      })
    ).rejects.toThrow('2 to 100 unique message IDs');
    expect(rest.post).not.toHaveBeenCalled();
  });
});
