import { z } from 'zod';

export const moderationInboxItemKindSchema = z.enum([
  'case',
  'observed_alert',
  'submitted_report',
  'support_attention',
  'report_attention',
  'pending_screening',
]);

export const moderationInboxActionSchema = z.enum([
  'view_case',
  'view_report',
  'view_history',
  'open_case',
  'verify_user',
  'kick_user',
  'ban_user',
  'ban_by_id',
  'sync_existing_ban',
  'refresh_notification',
  'repair_thread',
  'create_thread',
  'reopen_case',
  'close_no_action',
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
  'acknowledge',
  'open_discord',
]);

export const moderationInboxSubjectSchema = z.object({
  userId: z.string(),
  displayLabel: z.string(),
  secondaryLabel: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
});

export const moderationInboxLinkSchema = z.object({
  label: z.string(),
  url: z.string().min(1),
});

export const moderationInboxItemSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  kind: moderationInboxItemKindSchema,
  sourceId: z.string(),
  queueItemId: z.string().nullable(),
  subject: moderationInboxSubjectSchema,
  title: z.string(),
  summary: z.string().nullable(),
  statusLabel: z.string(),
  signalLabel: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stale: z.boolean(),
  staleHours: z.number().int().min(0),
  detailHref: z.string().nullable(),
  links: z.array(moderationInboxLinkSchema),
  allowedActions: z.array(moderationInboxActionSchema),
});

export type ModerationInboxItemKind = z.infer<typeof moderationInboxItemKindSchema>;
export type ModerationInboxAction = z.infer<typeof moderationInboxActionSchema>;
export type ModerationInboxSubject = z.infer<typeof moderationInboxSubjectSchema>;
export type ModerationInboxLink = z.infer<typeof moderationInboxLinkSchema>;
export type ModerationInboxItem = z.infer<typeof moderationInboxItemSchema>;

export function sortModerationInboxItems(
  items: readonly ModerationInboxItem[]
): ModerationInboxItem[] {
  return [...items].sort((left, right) => {
    if (left.stale !== right.stale) {
      return left.stale ? -1 : 1;
    }

    return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  });
}
