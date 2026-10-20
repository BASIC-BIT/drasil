import {
  matchesConfirmation,
  type ActionContext,
  type CaseCommand,
  type ConfirmationBinding,
  type ConfirmationPort,
} from '@drasil/application';

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

// Runtime adapters issue evidence only after their shipped authenticated confirmation path.
export function createCaseConfirmationStore(): {
  readonly confirmations: ConfirmationPort;
  recordVerified(
    context: ActionContext,
    command: CaseCommand,
    evidence?: ConfirmationBinding
  ): void;
} {
  const bindings = new Map<string, ConfirmationBinding>();
  return {
    recordVerified(context, command, evidence): void {
      if (context.actor.kind !== 'user') throw new Error('A case confirmation needs a user actor.');
      bindings.set(
        context.requestId,
        evidence ?? {
          guildId: context.guildId,
          actorId: context.actor.userId,
          action: command.kind,
          targetId: 'caseId' in command ? command.caseId : command.targetUserId,
        }
      );
    },
    confirmations: {
      async verify(context, command): Promise<boolean> {
        const binding = bindings.get(context.requestId) ?? null;
        bindings.delete(context.requestId);
        return matchesConfirmation(context, command, binding);
      },
    },
  };
}
