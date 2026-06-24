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
});
