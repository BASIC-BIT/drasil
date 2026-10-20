import type {
  ActionContext,
  QueuedSetupCommand,
  SetupProvisioningOutcome,
} from '@drasil/application';
import { requireSetupOutcome, type BotSetupRuntime } from './adapters/setup';
export type QueuedSetupOutcome =
  | {
      readonly action_type: 'upsert_report_instructions';
      readonly action: string;
      readonly channel_id: string;
      readonly message_id: string;
      readonly server_id: string;
    }
  | {
      readonly action_type: 'complete_setup_verification';
      readonly admin_channel_id: string;
      readonly case_role_created: boolean;
      readonly case_role_id: string;
      readonly report_instructions_action: string | null;
      readonly report_instructions_channel_id: string | null;
      readonly report_instructions_error: string | null;
      readonly report_instructions_message_id: string | null;
      readonly server_id: string;
      readonly verification_channel_action: string;
      readonly verification_channel_id: string;
    };
export async function dispatchSetupAction(
  runtime: BotSetupRuntime,
  context: ActionContext,
  command: QueuedSetupCommand
): Promise<QueuedSetupOutcome> {
  const outcome = requireSetupOutcome(
    await runtime.execute(context, command, { kind: 'queued' }),
    command
  );
  if (outcome.kind === 'upsert_report_instructions' && command.kind === outcome.kind)
    return {
      action_type: outcome.kind,
      action: outcome.result.action,
      channel_id: command.channelId,
      message_id: outcome.result.messageId,
      server_id: context.guildId,
    };
  if (outcome.kind !== 'complete_setup_verification' || command.kind !== outcome.kind)
    throw new Error('Setup receipt outcome mismatch.');
  const result = outcome.result;
  if (result.status !== 'completed') throw new Error(describeSetupFailure(result));
  return {
    action_type: outcome.kind,
    admin_channel_id: result.adminChannelId,
    case_role_created: result.caseRoleWasCreated,
    case_role_id: result.caseRoleId,
    report_instructions_action: result.reportInstructions?.action ?? null,
    report_instructions_channel_id: command.reportInstructionsChannelId ?? null,
    report_instructions_error: result.reportInstructions?.error ?? null,
    report_instructions_message_id: result.reportInstructions?.messageId ?? null,
    server_id: context.guildId,
    verification_channel_action: result.verificationChannelAction,
    verification_channel_id: result.verificationChannelId,
  };
}
function describeSetupFailure(
  result: Exclude<SetupProvisioningOutcome, { status: 'completed' }>
): string {
  switch (result.status) {
    case 'ambiguous_case_role':
      return `Multiple roles named ${result.roleName} exist; choose one before retrying.`;
    case 'ambiguous_verification_channel':
      return 'Multiple verification channels exist; choose one before retrying.';
    case 'invalid_selection':
      return result.detail;
    case 'candidate_validation_failed':
    case 'final_validation_failed': {
      const report = result.report;
      const first =
        report.issues.find((issue) => issue.severity === 'error') ??
        report.issues.find((issue) => issue.severity === 'warning');
      return `Setup validation failed. ${report.errorCount} error(s), ${report.warningCount} warning(s).${first ? ` First issue: ${first.message}` : ''}${'setupFailureDetail' in result ? ` ${result.setupFailureDetail}` : ''}`;
    }
    case 'config_save_failed':
    case 'verification_channel_failed':
      return result.setupFailureDetail;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}
