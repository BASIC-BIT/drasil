import type { ActionContext, ReportActions, QueuedReportCommand } from '@drasil/application';
import { requireReportOutcome } from './adapters/reports';
export type QueuedReportOutcome =
  | {
      action_type: 'submit_user_report';
      reporter_id: string;
      server_id: string;
      submitted: true;
      target_user_id: string;
    }
  | {
      action_type: 'start_report_intake';
      existing_open_intake: true;
      intake_id: string;
      opened: false;
      server_id: string;
      thread_id: string | null;
    }
  | {
      action_type: 'start_report_intake';
      channel_id: string;
      intake_id: string;
      opened: true;
      reporter_id: string;
      server_id: string;
      thread_id: string | null;
      thread_url: string;
    }
  | {
      action_type: 'close_report_intake';
      closed: true;
      message: string;
      report_intake_id: string;
      server_id: string;
      thread_archived: boolean;
      thread_id: string;
    };
export async function dispatchReportAction(
  actions: ReportActions,
  context: ActionContext,
  command: QueuedReportCommand
): Promise<QueuedReportOutcome> {
  if (context.actor.kind !== 'user') throw new Error('Report request requires a user actor.');
  if (command.kind === 'close_report_intake') return closeReport(actions, context, command);
  const result = await actions.execute(context, command);
  if (command.kind === 'submit_user_report') {
    const outcome = requireReportOutcome(result, command.kind);
    if (outcome.result.status !== 'submitted')
      throw new Error(`Report was not submitted: ${outcome.result.status}`);
    return {
      action_type: command.kind,
      reporter_id: context.actor.userId,
      server_id: context.guildId,
      submitted: true,
      target_user_id: outcome.result.targetUserId,
    };
  }
  const outcome = requireReportOutcome(result, command.kind);
  if (!outcome.intake) throw new Error('Could not open a private report thread.');
  if (outcome.status === 'existing')
    return {
      action_type: command.kind,
      existing_open_intake: true,
      intake_id: outcome.intake.id,
      opened: false,
      server_id: context.guildId,
      thread_id: outcome.intake.threadId,
    };
  if (outcome.status !== 'opened' || !outcome.threadUrl)
    throw new Error('Could not prepare the private report thread.');
  return {
    action_type: command.kind,
    channel_id: command.channelId,
    intake_id: outcome.intake.id,
    opened: true,
    reporter_id: context.actor.userId,
    server_id: context.guildId,
    thread_id: outcome.intake.threadId,
    thread_url: outcome.threadUrl,
  };
}
async function closeReport(
  actions: ReportActions,
  context: ActionContext,
  command: Extract<QueuedReportCommand, { kind: 'close_report_intake' }>
): Promise<QueuedReportOutcome> {
  const outcome = requireReportOutcome(await actions.execute(context, command), command.kind);
  if (!outcome.result.closed || !outcome.intake.threadId) throw new Error(outcome.result.message);
  return {
    action_type: command.kind,
    closed: true,
    message: outcome.result.message,
    report_intake_id: command.intakeId,
    server_id: context.guildId,
    thread_archived: outcome.archived === true,
    thread_id: outcome.intake.threadId,
  };
}
