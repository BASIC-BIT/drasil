import type { QueueMessageDeleter } from '@drasil/application';
import type { IModerationQueueService } from '../../services/ModerationQueueService';

export function createBotAttentionMessageDeleter(
  queue: IModerationQueueService
): QueueMessageDeleter {
  return {
    async deleteQueueMessage(item): Promise<void> {
      if (!(await queue.deleteQueueMessage(item)))
        throw new Error(`Failed to delete live moderation queue message for item ${item.id}.`);
    },
  };
}
