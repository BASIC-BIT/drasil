import { randomUUID } from 'node:crypto';
import type { ActionContext } from '@drasil/application';

export function createWebActionContext(input: {
  readonly guildId: string;
  readonly userId: string;
}): ActionContext {
  return {
    guildId: input.guildId,
    requestId: randomUUID(),
    source: 'web',
    actor: { kind: 'user', userId: input.userId },
  };
}
