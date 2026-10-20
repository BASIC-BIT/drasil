import { createAttentionActions, type AttentionActions } from '@drasil/application';
import {
  PostgresQueueAttentionRepository,
  createWebAttentionMessageDeleter,
  createWebAuthority,
} from './adapters/attention';

export interface WebApplication {
  readonly attention: AttentionActions;
}
export function createWebApplication(): WebApplication {
  return {
    attention: createAttentionActions({
      repository: new PostgresQueueAttentionRepository(),
      authority: createWebAuthority(),
      messageDeleter: createWebAttentionMessageDeleter(),
    }),
  };
}
