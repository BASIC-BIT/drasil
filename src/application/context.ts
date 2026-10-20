import type { ActionContext } from '@drasil/application';

export function createDiscordActionContext(input: {
  readonly guildId: string;
  readonly userId: string;
  readonly requestId: string;
}): ActionContext {
  return {
    guildId: input.guildId,
    requestId: input.requestId,
    source: 'discord_interaction',
    actor: { kind: 'user', userId: input.userId },
  };
}
