import type { ActionContext } from './context';

// Only authenticated runtime confirmation flows issue these bindings.
export interface ConfirmationBinding {
  readonly guildId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetId: string;
}
export type ConfirmationCommand = { readonly kind: string } & (
  | { readonly targetUserId: string }
  | { readonly caseId: string }
  | { readonly intakeId: string }
  | { readonly operationId: string }
);
export interface ConfirmationPort {
  verify(context: ActionContext, command: ConfirmationCommand): Promise<boolean>;
}
export function matchesConfirmation(
  context: ActionContext,
  command: ConfirmationCommand,
  evidence: ConfirmationBinding | null
): boolean {
  return (
    context.actor.kind === 'user' &&
    evidence !== null &&
    evidence.guildId === context.guildId &&
    evidence.actorId === context.actor.userId &&
    evidence.action === command.kind &&
    evidence.targetId ===
      ('intakeId' in command
        ? command.intakeId
        : 'caseId' in command
          ? command.caseId
          : 'operationId' in command
            ? command.operationId
            : command.targetUserId)
  );
}
