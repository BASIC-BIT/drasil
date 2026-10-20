import { z } from 'zod';

const id = z.string().min(1);
const target = { targetUserId: id };
const bound = { ...target, caseId: id };
const reason = z.string().nullable();
export const selectedMessageSchema = z.object({ channelId: id, messageId: id }).strict();
export const caseCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ban_user'),
      ...target,
      reason,
      intent: z.enum(['slash_command', 'native_action']).default('native_action'),
      selectedMessage: selectedMessageSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal('kick_user'),
      ...target,
      reason,
      selectedMessage: selectedMessageSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal('open_case_from_observed_detection'),
      ...target,
      detectionEventId: id,
      reportId: id.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('open_admin_case'),
      intent: z.enum(['native_case_open', 'dashboard_case_open']),
      ...target,
      reason,
      detectionEventId: id.nullable(),
      selectedMessage: selectedMessageSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('manual_flag_user'), ...target, reason }).strict(),
  z.object({ kind: z.literal('verify_case_user'), ...bound }).strict(),
  z.object({ kind: z.literal('close_case_no_action'), ...bound }).strict(),
  z
    .object({
      kind: z.literal('kick_case_user'),
      ...bound,
      reason,
      detectionEventId: id.nullable(),
    })
    .strict(),
  z
    .object({ kind: z.literal('ban_case_user'), ...bound, reason, detectionEventId: id.nullable() })
    .strict(),
  z
    .object({
      kind: z.literal('ban_case_user_by_id'),
      ...bound,
      reason,
      detectionEventId: id.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('repair_active_case'),
      ...bound,
      mode: z.enum(['create_thread', 'repair_thread']).default('repair_thread'),
      intent: z.enum(['administrator_repair', 'moderator_repair']).default('moderator_repair'),
    })
    .strict(),
  z.object({ kind: z.literal('reopen_case'), ...bound }).strict(),
  z.object({ kind: z.literal('refresh_case_notification'), ...bound }).strict(),
  z.object({ kind: z.literal('sync_existing_ban'), ...bound }).strict(),
]);
export type CaseCommand = z.infer<typeof caseCommandSchema>;
export type BoundCaseCommand = Extract<CaseCommand, { caseId: string }>;
