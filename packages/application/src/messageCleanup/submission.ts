import type { ActionContext } from '../context';
import type { ConfirmationPort } from '../confirmation';
import type { ActionDenialCode } from '../results';
import { checkMessageCleanupBinding } from './actions';
import type { MessageCleanupCommand } from './commands';
import type { MessageCleanupJob, MessageCleanupCase } from './ports';
export function isMessageCleanupFinalizationContinuation(job: MessageCleanupJob): boolean {
  return (
    job.mode === 'ban_with_cleanup' &&
    job.status === 'completed' &&
    job.banStatus === 'succeeded' &&
    job.caseFinalizationStatus === 'failed'
  );
}
export function canSubmitMessageCleanup(job: MessageCleanupJob): boolean {
  if (
    !['ready', 'executing'].includes(job.status) &&
    !isMessageCleanupFinalizationContinuation(job)
  )
    return false;
  if (
    job.coverage !== 'ready' &&
    !(job.scope === 'source_message' && job.coverage === 'partial' && job.candidateCount === 1)
  )
    return false;
  return job.candidateCount > 0 && job.candidateCount <= 100;
}
export async function checkMessageCleanupSubmission(input: {
  readonly context: ActionContext;
  readonly command: MessageCleanupCommand;
  readonly job: MessageCleanupJob;
  readonly state: MessageCleanupCase;
  readonly confirmations: ConfirmationPort;
  readonly banEnabled: boolean;
}): Promise<ActionDenialCode | null> {
  const { context, command, job, state } = input;
  const binding = checkMessageCleanupBinding(context, command, job, state);
  if (binding) return binding;
  if (!command.reason.trim()) return 'reason_required';
  if (command.kind === 'preview_case_message_deletion') return null;
  if (!(await input.confirmations.verify(context, command))) return 'confirmation_required';
  if (
    command.kind === 'ban_case_user_with_message_cleanup' &&
    !input.banEnabled &&
    !isMessageCleanupFinalizationContinuation(job)
  )
    return 'policy_disabled';
  return null;
}
