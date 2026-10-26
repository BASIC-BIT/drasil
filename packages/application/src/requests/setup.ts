import type { ActionContext } from '../context';
import {
  queuedSetupCommandSchema,
  isQueuedSetupKind,
  type QueuedSetupCommand,
} from '../setup/commands';
import type { QueuedRow } from './decode';
import type { EnqueueInput } from './receipt';
export function encodeSetupAction(
  context: ActionContext,
  command: QueuedSetupCommand
): EnqueueInput {
  if (context.actor.kind !== 'user') throw new Error('Setup submission requires a user actor.');
  const base = {
    actionType: command.kind,
    actorId: context.actor.userId,
    actorSurface: context.source,
    serverId: context.guildId,
    targetUserId: null,
  };
  if (
    context.source === 'mcp' ||
    (command.kind !== 'upsert_report_instructions' &&
      command.kind !== 'complete_setup_verification')
  )
    return {
      ...base,
      idempotencyKey: `${context.source}:setup:${command.kind}:${context.guildId}:${context.requestId}`,
      metadata: { setup_command: command, requested_surface: context.source },
    };
  if (command.kind === 'upsert_report_instructions')
    return {
      ...base,
      idempotencyKey: command.repost
        ? `${context.source}:setup:repost_report_instructions:${context.guildId}:${command.channelId}:${command.expectedMessageId ?? 'none'}:${command.submissionId}`
        : `${context.source}:setup:upsert_report_instructions:${context.guildId}:${context.requestId}`,
      metadata: {
        channel_id: command.channelId,
        requested_surface: context.source,
        setup_action: command.kind,
        ...(command.repost
          ? {
              repost: true,
              expected_message_id: command.expectedMessageId,
              expected_channel_id: command.expectedChannelId,
            }
          : {}),
      },
    };
  return {
    ...base,
    idempotencyKey: `${context.source}:setup:complete_setup_verification:${context.guildId}:${command.submissionId ?? context.requestId}`,
    metadata: {
      admin_channel_id: command.adminChannelId,
      ...(command.caseRoleId !== undefined ? { case_role_id: command.caseRoleId } : {}),
      ...(command.caseRoleName ? { case_role_name: command.caseRoleName } : {}),
      ...(command.onboardingWizard
        ? { detection_response_mode: command.detectionResponseMode ?? null }
        : command.detectionResponseMode
          ? { detection_response_mode: command.detectionResponseMode }
          : {}),
      report_instructions_channel_id: command.reportInstructionsChannelId ?? null,
      requested_surface: context.source,
      onboarding_wizard: command.onboardingWizard,
      setup_action: command.kind,
      ...(command.submissionId ? { submission_id: command.submissionId } : {}),
      verification_channel_id: command.verificationChannelId ?? null,
    },
  };
}
export function decodeSetupCommand(row: QueuedRow): QueuedSetupCommand | null {
  const metadata = row.metadata ?? {};
  if (metadata.setup_command !== undefined) {
    const command = queuedSetupCommandSchema.parse(metadata.setup_command);
    if (!isQueuedSetupKind(row.action_type) || command.kind !== row.action_type)
      throw new Error('Setup command binding mismatch.');
    return command;
  }
  if (row.action_type === 'upsert_report_instructions')
    return queuedSetupCommandSchema.parse({
      kind: row.action_type,
      channelId: metadata.channel_id,
      repost: metadata.repost === true,
      ...(metadata.repost === true
        ? {
            expectedMessageId: metadata.expected_message_id ?? null,
            expectedChannelId: metadata.expected_channel_id ?? null,
            submissionId: row.id,
          }
        : {}),
    });
  if (row.action_type !== 'complete_setup_verification') return null;
  return queuedSetupCommandSchema.parse({
    kind: row.action_type,
    mode: 'provision',
    adminChannelId: metadata.admin_channel_id,
    caseRoleId: metadata.case_role_id ?? null,
    caseRoleName: metadata.case_role_name ?? null,
    verificationChannelId: metadata.verification_channel_id ?? null,
    reportInstructionsChannelId: metadata.report_instructions_channel_id ?? null,
    detectionResponseMode: metadata.detection_response_mode ?? undefined,
    onboardingWizard: metadata.onboarding_wizard === true,
    submissionId: metadata.submission_id ?? undefined,
  });
}
