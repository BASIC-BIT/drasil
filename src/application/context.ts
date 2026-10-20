import {
  matchesConfirmation,
  type ActionContext,
  type QuarantinePreviewBinding,
  type QuarantineExecuteInput,
  type ConfirmationCommand,
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
    command: ConfirmationCommand,
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
          targetId:
            'intakeId' in command
              ? command.intakeId
              : 'caseId' in command
                ? command.caseId
                : 'operationId' in command
                  ? command.operationId
                  : command.targetUserId,
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

// Discord custom IDs retain their shipped short fingerprint. The full preview
// binding is held by the authenticated runtime, never reconstructed from the ID.
export interface QuarantinePreviewStore {
  record(binding: QuarantinePreviewBinding): void;
  resolve(context: ActionContext, input: QuarantineExecuteInput): QuarantinePreviewBinding | null;
}
export function createQuarantinePreviewStore(): QuarantinePreviewStore {
  const bindings = new Map<string, QuarantinePreviewBinding>();
  const key = (
    binding: { guildId: string; actorId: string; caseId: string; targetUserId: string },
    fingerprint: string
  ): string =>
    JSON.stringify([
      binding.guildId,
      binding.actorId,
      binding.caseId,
      binding.targetUserId,
      fingerprint,
    ]);
  return {
    record(binding: QuarantinePreviewBinding): void {
      for (const [id, entry] of bindings) if (entry.expiresAt <= Date.now()) bindings.delete(id);
      bindings.set(key(binding, binding.fingerprint.slice(0, 20)), binding);
    },
    resolve(
      context: ActionContext,
      input: QuarantineExecuteInput
    ): QuarantinePreviewBinding | null {
      if (context.actor.kind !== 'user' || input.previewReference.kind !== 'discord_confirmation')
        return null;
      const id = key(
        { ...input, guildId: context.guildId, actorId: context.actor.userId },
        input.previewReference.fingerprint
      );
      const binding = bindings.get(id) ?? null;
      bindings.delete(id);
      return binding;
    },
  };
}
