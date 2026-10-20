import { z } from 'zod';
import type { ActionContext } from '../context';
import { queuedCommandSchema, type QueuedCommand } from './commands';

const queuedRowSchema = z.object({
  id: z.string().min(1),
  server_id: z.string().min(1),
  action_type: z.literal('open_case_from_observed_detection'),
  actor_id: z.string().min(1),
  actor_surface: z.string().min(1),
  target_user_id: z.string().min(1),
  detection_event_id: z.string().min(1),
  report_intake_id: z.string().min(1).nullable(),
});
export interface DecodedQueuedAction {
  readonly context: ActionContext;
  readonly command: QueuedCommand;
}
export function decodeQueuedAction(row: unknown): DecodedQueuedAction {
  const parsed = queuedRowSchema.parse(row);
  return {
    context: {
      guildId: parsed.server_id,
      requestId: parsed.id,
      source: parsed.actor_surface,
      actor: { kind: 'user', userId: parsed.actor_id },
    },
    command: queuedCommandSchema.parse({
      kind: parsed.action_type,
      detectionEventId: parsed.detection_event_id,
      targetUserId: parsed.target_user_id,
      reportId: parsed.report_intake_id,
    }),
  };
}
