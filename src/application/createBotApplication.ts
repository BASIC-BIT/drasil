import { createAttentionActions, type AttentionActions } from '@drasil/application';
import type { Client } from 'discord.js';
import type { IModerationQueueRepository } from '../repositories/ModerationQueueRepository';
import type { IModerationQueueService } from '../services/ModerationQueueService';
import { createBotAuthority, createBotAttentionMessageDeleter } from './adapters/attention';

export interface BotApplication {
  readonly attention: AttentionActions;
}
export function createBotApplication(deps: {
  readonly client: Client;
  readonly queueRepository: IModerationQueueRepository;
  readonly queueService: IModerationQueueService;
}): BotApplication {
  return {
    attention: createAttentionActions({
      repository: deps.queueRepository,
      authority: createBotAuthority(deps.client),
      messageDeleter: createBotAttentionMessageDeleter(deps.queueService),
    }),
  };
}
