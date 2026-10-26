import type { ReportCommand } from './commands';
import type { ActionContext } from '../context';
import type { ConfirmationPort } from '../confirmation';
import type { ActionResult } from '../results';
import type { QueuedActionReceipt } from '../requests/receipt';
import { queuedReportCommandSchema, type QueuedReportCommand } from './commands';
export interface ReportAdmissionFacts {
  readonly member: boolean;
  readonly active: boolean;
  readonly reasonRequired: boolean;
}
export interface ReportRequestSubmissionDependencies {
  readonly access: { load(context: ActionContext): Promise<ReportAdmissionFacts> };
  readonly intakes: {
    openForReporter(context: ActionContext): Promise<{ readonly id: string } | null>;
  };
  readonly confirmations: ConfirmationPort;
  readonly queue: {
    enqueue(
      context: ActionContext,
      command: QueuedReportCommand
    ): Promise<QueuedActionReceipt['status']>;
  };
}
export function createReportRequestSubmission(deps: ReportRequestSubmissionDependencies): {
  execute(
    context: ActionContext,
    input: QueuedReportCommand
  ): Promise<ActionResult<{ status: QueuedActionReceipt['status'] }>>;
} {
  return {
    async execute(
      context,
      input
    ): Promise<ActionResult<{ status: QueuedActionReceipt['status'] }>> {
      const command = queuedReportCommandSchema.parse(input);
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      const access = await deps.access.load(context);
      if (!access.member || !access.active) return { kind: 'denied', code: 'actor_unavailable' };
      if (command.kind === 'submit_user_report') {
        if (command.targetUserId === context.actor.userId)
          return { kind: 'denied', code: 'permission_denied' };
        if (access.reasonRequired && !command.reason?.trim())
          return { kind: 'denied', code: 'reason_required' };
      }
      if (command.kind === 'close_report_intake') {
        const intake = await deps.intakes.openForReporter(context);
        if (intake?.id !== command.intakeId) return { kind: 'denied', code: 'stale_state' };
      }
      if (reportNeedsConfirmation(command) && !(await deps.confirmations.verify(context, command)))
        return { kind: 'denied', code: 'confirmation_required' };
      return { kind: 'outcome', outcome: { status: await deps.queue.enqueue(context, command) } };
    },
  };
}

export function reportNeedsConfirmation<T extends Pick<ReportCommand, 'kind'>>(
  command: T
): command is Exclude<T, { kind: 'start_report_intake' | 'reject_intake_candidates' }> {
  return command.kind !== 'start_report_intake' && command.kind !== 'reject_intake_candidates';
}
