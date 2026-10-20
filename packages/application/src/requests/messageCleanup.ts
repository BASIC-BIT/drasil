import type { ActionContext } from '../context';
import {
  messageCleanupCommandSchema,
  type MessageCleanupCommand,
} from '../messageCleanup/commands';
import type { QueuedRow } from './decode';
import type { EnqueueInput } from './receipt';
export function decodeMessageCleanupCommand(row: QueuedRow): MessageCleanupCommand | null {
  if (
    ![
      'preview_case_message_deletion',
      'execute_case_message_deletion',
      'ban_case_user_with_message_cleanup',
    ].includes(row.action_type)
  )
    return null;
  const metadata = row.metadata ?? {};
  return messageCleanupCommandSchema.parse({
    kind: row.action_type,
    targetUserId: row.target_user_id,
    caseId: row.verification_event_id,
    jobId: row.message_deletion_job_id,
    detectionEventId: row.detection_event_id ?? null,
    mode: metadata.cleanup_mode,
    scope: metadata.cleanup_scope,
    reason: metadata.reason,
    previewReference: {
      jobId: row.message_deletion_job_id,
      generation: metadata.cleanup_preview_generation ?? null,
    },
  });
}
export function encodeMessageCleanupAction(
  context: ActionContext,
  command: MessageCleanupCommand
): EnqueueInput {
  if (context.actor.kind !== 'user') throw new Error('Cleanup submission requires a user actor.');
  return {
    actionType: command.kind,
    actorId: context.actor.userId,
    actorSurface: context.source,
    serverId: context.guildId,
    targetUserId: command.targetUserId,
    verificationEventId: command.caseId,
    detectionEventId: command.detectionEventId,
    messageDeletionJobId: command.jobId,
    idempotencyKey: messageCleanupSubmissionKey(context, command),
    metadata: {
      cleanup_mode: command.mode,
      cleanup_scope: command.scope,
      reason: command.reason,
      cleanup_preview_generation: command.previewReference.generation,
    },
  };
}

export function messageCleanupSubmissionKey(
  context: ActionContext,
  command: Pick<MessageCleanupCommand, 'kind' | 'caseId'>
): string {
  if (context.actor.kind !== 'user') throw new Error('Cleanup submission requires a user actor.');
  return `message-cleanup:${command.kind}:${context.guildId}:${command.caseId}:${context.actor.userId}:${context.requestId}`;
}
