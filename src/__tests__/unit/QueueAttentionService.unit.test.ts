import {
  QueueAttentionService,
  type QueueAttentionItemRecord,
  type QueueAttentionRepository,
  type QueueMessageDeleter,
} from '../../services/QueueAttentionService';

class FakeQueueAttentionRepository implements QueueAttentionRepository {
  public item: QueueAttentionItemRecord | null = {
    id: 'queue-1',
    server_id: 'guild-1',
    item_type: 'support_thread_attention',
    queue_channel_id: 'queue-channel',
    queue_message_id: 'queue-message',
  };

  public async findById(id: string): Promise<QueueAttentionItemRecord | null> {
    return this.item?.id === id ? { ...this.item } : null;
  }

  public async deleteById(id: string): Promise<QueueAttentionItemRecord | null> {
    if (!this.item || this.item.id !== id) {
      return null;
    }

    const deleted = this.item;
    this.item = null;
    return { ...deleted };
  }
}

describe('QueueAttentionService', () => {
  const actor = { id: 'moderator-1', surface: 'web' as const };

  it('acknowledges support and report attention items', async () => {
    const repository = new FakeQueueAttentionRepository();
    const messageDeleter: QueueMessageDeleter = {
      deleteQueueMessage: jest.fn(async () => undefined),
    };
    const service = new QueueAttentionService(repository, messageDeleter);

    const result = await service.acknowledgeAttentionItem({
      actor,
      itemId: 'queue-1',
      serverId: 'guild-1',
    });

    expect(result).toEqual({
      actor,
      itemId: 'queue-1',
      status: 'acknowledged',
    });
    expect(messageDeleter.deleteQueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'queue-1' })
    );
    expect(repository.item).toBeNull();
  });

  it('treats missing, cross-server, and non-attention items as already handled', async () => {
    const repository = new FakeQueueAttentionRepository();
    const messageDeleter: QueueMessageDeleter = {
      deleteQueueMessage: jest.fn(async () => undefined),
    };
    const service = new QueueAttentionService(repository, messageDeleter);

    await expect(
      service.acknowledgeAttentionItem({ actor, itemId: 'missing', serverId: 'guild-1' })
    ).resolves.toMatchObject({ status: 'already_handled' });
    await expect(
      service.acknowledgeAttentionItem({ actor, itemId: 'queue-1', serverId: 'other-guild' })
    ).resolves.toMatchObject({ status: 'already_handled' });

    repository.item = {
      id: 'queue-2',
      server_id: 'guild-1',
      item_type: 'case_mirror',
      queue_channel_id: 'queue-channel',
      queue_message_id: 'queue-message',
    };

    await expect(
      service.acknowledgeAttentionItem({ actor, itemId: 'queue-2', serverId: 'guild-1' })
    ).resolves.toMatchObject({ status: 'already_handled' });
    expect(messageDeleter.deleteQueueMessage).not.toHaveBeenCalled();
  });
});
