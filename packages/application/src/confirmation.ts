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
export function confirmationBindingFor(
  context: ActionContext,
  command: ConfirmationCommand
): ConfirmationBinding | null {
  if (context.actor.kind !== 'user') return null;
  return {
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
  };
}
export function matchesConfirmation(
  context: ActionContext,
  command: ConfirmationCommand,
  evidence: ConfirmationBinding | null
): boolean {
  const binding = confirmationBindingFor(context, command);
  return (
    binding !== null &&
    evidence !== null &&
    evidence.guildId === binding.guildId &&
    evidence.actorId === binding.actorId &&
    evidence.action === binding.action &&
    evidence.targetId === binding.targetId
  );
}
