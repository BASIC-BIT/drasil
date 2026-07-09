export const queueAttentionItemTypes = [
  'support_thread_attention',
  'report_thread_attention',
] as const;

export type QueueAttentionItemType = (typeof queueAttentionItemTypes)[number];
export type QueueActionSurface = 'discord_interaction' | 'web';
export type QueueAttentionAcknowledgeStatus = 'acknowledged' | 'already_handled';

export interface QueueActionActor {
  readonly id: string;
  readonly surface: QueueActionSurface;
}

export interface QueueAttentionItemRecord {
  readonly id: string;
  readonly server_id: string;
  readonly item_type: string;
  readonly queue_channel_id: string | null;
  readonly queue_message_id: string | null;
}

export interface QueueAttentionRepository {
  findById(id: string): Promise<QueueAttentionItemRecord | null>;
  deleteById(id: string): Promise<QueueAttentionItemRecord | null>;
}

export interface QueueMessageDeleter {
  deleteQueueMessage(item: QueueAttentionItemRecord): Promise<void>;
}

export interface AcknowledgeQueueAttentionInput {
  readonly actor: QueueActionActor;
  readonly itemId: string;
  readonly serverId: string;
}

export interface AcknowledgeQueueAttentionResult {
  readonly actor: QueueActionActor;
  readonly itemId: string;
  readonly status: QueueAttentionAcknowledgeStatus;
}

export function isQueueAttentionItemType(itemType: string): itemType is QueueAttentionItemType {
  return queueAttentionItemTypes.includes(itemType as QueueAttentionItemType);
}

export class QueueAttentionService {
  public constructor(
    private readonly repository: QueueAttentionRepository,
    private readonly messageDeleter: QueueMessageDeleter
  ) {}

  public async acknowledgeAttentionItem(
    input: AcknowledgeQueueAttentionInput
  ): Promise<AcknowledgeQueueAttentionResult> {
    const item = await this.repository.findById(input.itemId);
    if (!item || item.server_id !== input.serverId || !isQueueAttentionItemType(item.item_type)) {
      return {
        actor: input.actor,
        itemId: input.itemId,
        status: 'already_handled',
      };
    }

    await this.messageDeleter.deleteQueueMessage(item);
    const deleted = await this.repository.deleteById(item.id);
    return {
      actor: input.actor,
      itemId: input.itemId,
      status: deleted ? 'acknowledged' : 'already_handled',
    };
  }
}
