import { z } from 'zod';

export const reportQueueStatusSchema = z.enum([
  'submitted',
  'actioned',
  'dismissed',
  'false_positive',
]);

export const reportQueueActionSchema = z.enum([
  'open_report_thread',
  'open_case',
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
]);

export const reportQueueItemSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  reporterId: z.string(),
  targetUserId: z.string().nullable(),
  status: reportQueueStatusSchema,
  summary: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stale: z.boolean(),
  staleHours: z.number().int().min(0),
  evidenceCount: z.number().int().min(0),
  reportThreadUrl: z.string().url().nullable(),
  latestDetectionId: z.string().nullable(),
  latestCaseId: z.string().nullable(),
  allowedActions: z.array(reportQueueActionSchema),
});

export const reportEvidenceKindSchema = z.enum([
  'reporter_text',
  'screenshot',
  'message_link',
  'reported_text',
  'followup_answer',
  'candidate_confirmation',
  'admin_note',
]);

export const reportEvidenceAttachmentSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  url: z.string().url().nullable(),
  contentType: z.string().nullable(),
  size: z.number().int().nonnegative().nullable(),
});

export const reportEvidenceItemSchema = z.object({
  id: z.string(),
  kind: reportEvidenceKindSchema,
  content: z.string().nullable(),
  createdAt: z.string(),
  sourceMessageUrl: z.string().url().nullable(),
  attachment: reportEvidenceAttachmentSchema.nullable(),
});

export const reportDetailSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  reporterId: z.string(),
  targetUserId: z.string().nullable(),
  status: reportQueueStatusSchema,
  summary: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  reportThreadUrl: z.string().url().nullable(),
  latestDetectionId: z.string().nullable(),
  latestCaseId: z.string().nullable(),
  evidence: z.array(reportEvidenceItemSchema),
  allowedActions: z.array(reportQueueActionSchema),
});

export type ReportQueueStatus = z.infer<typeof reportQueueStatusSchema>;
export type ReportQueueAction = z.infer<typeof reportQueueActionSchema>;
export type ReportQueueItem = z.infer<typeof reportQueueItemSchema>;
export type ReportEvidenceKind = z.infer<typeof reportEvidenceKindSchema>;
export type ReportEvidenceAttachment = z.infer<typeof reportEvidenceAttachmentSchema>;
export type ReportEvidenceItem = z.infer<typeof reportEvidenceItemSchema>;
export type ReportDetail = z.infer<typeof reportDetailSchema>;

export function sortReportQueueItems(reports: readonly ReportQueueItem[]): ReportQueueItem[] {
  return [...reports].sort((left, right) => {
    if (left.stale !== right.stale) {
      return left.stale ? -1 : 1;
    }

    return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  });
}
