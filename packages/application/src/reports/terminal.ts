import { z } from 'zod';
import type { HumanCommand, WorkflowId } from '../delegation/commands';
import { IntentError } from '../delegation/intents';
const terminalSchema = z
  .object({
    actor: z.object({ id: z.string(), surface: z.literal('mcp') }).strict(),
    action: z.literal('open_case'),
    reportId: z.string(),
    status: z.enum([
      'busy',
      'already_handled',
      'case_exists',
      'missing_detection',
      'missing_target',
      'opener_unavailable',
    ]),
    caseId: z.string().nullable(),
    detectionEventId: z.string().nullable(),
    targetUserId: z.string().nullable(),
    queueCleanupStatus: z.literal('skipped'),
  })
  .strict();
export type ReportCaseTerminalOutcome = z.infer<typeof terminalSchema>;
export interface ReportCaseTerminalDelivery {
  readonly kind: 'report_case_terminal';
  readonly outcome: ReportCaseTerminalOutcome;
}
export function validateReportCaseTerminal(
  binding: { workflowId: WorkflowId; command: HumanCommand; userId: string },
  value: unknown
): ReportCaseTerminalOutcome {
  const parsed = terminalSchema.safeParse(value);
  if (
    !parsed.success ||
    binding.workflowId !== 'open_submitted_report_case' ||
    binding.command.kind !== 'open_submitted_report_case' ||
    parsed.data.reportId !== binding.command.reportId ||
    parsed.data.actor.id !== binding.userId
  )
    throw new IntentError('delivery_mismatch');
  return parsed.data;
}
