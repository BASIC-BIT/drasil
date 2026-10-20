import { randomUUID } from 'node:crypto';
import {
  matchesConfirmation,
  type ActionContext,
  type ConfirmationCommand,
  type ConfirmationPort,
} from '@drasil/application';

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

// The authenticated action supplies this form and its route-bound operation, never queue metadata.
export function createWebConfirmationPort(
  context: ActionContext,
  command: ConfirmationCommand,
  formData: FormData | undefined
): ConfirmationPort {
  const evidence =
    context.actor.kind === 'user' && formData?.get('confirmAction') === 'on'
      ? {
          guildId: context.guildId,
          actorId: context.actor.userId,
          action: command.kind,
          targetId: 'caseId' in command ? command.caseId : command.targetUserId,
        }
      : null;
  return {
    async verify(candidateContext, candidateCommand): Promise<boolean> {
      return matchesConfirmation(candidateContext, candidateCommand, evidence);
    },
  };
}
