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

export type ReportQueueStatus = z.infer<typeof reportQueueStatusSchema>;
export type ReportQueueAction = z.infer<typeof reportQueueActionSchema>;
export type ReportQueueItem = z.infer<typeof reportQueueItemSchema>;

export function sortReportQueueItems(reports: readonly ReportQueueItem[]): ReportQueueItem[] {
  return [...reports].sort((left, right) => {
    if (left.stale !== right.stale) {
      return left.stale ? -1 : 1;
    }

    return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  });
}
