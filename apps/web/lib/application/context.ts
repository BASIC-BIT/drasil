import { randomUUID } from 'node:crypto';
import {
  matchesConfirmation,
  confirmationBindingFor,
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
    formData?.get('confirmAction') === 'on' ? confirmationBindingFor(context, command) : null;
  return {
    async verify(candidateContext, candidateCommand): Promise<boolean> {
      return matchesConfirmation(candidateContext, candidateCommand, evidence);
    },
  };
}

export function createWebReportConfirmationPort(
  context: ActionContext,
  command: ConfirmationCommand,
  formData: FormData
): ConfirmationPort {
  const field = command.kind === 'close_report_intake' ? 'confirmCloseIntake' : 'confirmReport';
  const normalized = new FormData();
  if (formData.get(field) === 'on') normalized.set('confirmAction', 'on');
  return createWebConfirmationPort(context, command, normalized);
}
