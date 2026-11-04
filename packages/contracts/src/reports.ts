import { z } from 'zod';
import {
  reportAnalysisMetadataSchema,
  reportHandoffReasonSchema,
  reportIdentityCandidateSchema,
} from '@drasil/application/report-analysis';

export const reportQueueStatusSchema = z.enum([
  'submitted',
  'actioned',
  'dismissed',
  'false_positive',
]);

export const reportQueueActionSchema = z.enum([
  'open_report_thread',
  'open_case',
  'ban_user',
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
]);

export const reportSummarySourceSchema = z.enum(['ai', 'other']);

export const reportQueueItemSchema = z.object({
  id: z.string(),
  guildId: z.string(),
  reporterId: z.string(),
  targetUserId: z.string().nullable(),
  status: reportQueueStatusSchema,
  summary: z.string().nullable(),
  summarySource: reportSummarySourceSchema.default('other'),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
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
  createdAt: z.string().nullable(),
  sourceMessageUrl: z.string().url().nullable(),
  attachment: reportEvidenceAttachmentSchema.nullable(),
});

const REVIEW_CANDIDATE_LIMIT = 5;
const safeReviewCandidateSchema = reportIdentityCandidateSchema.omit({ avatarUrl: true });
export const reporterIdentityReviewSchema = z.object({
  phase: z.enum(['pending', 'delivered', 'acknowledged', 'resolved']),
  delivery: z.enum(['pending', 'delivered', 'unknown']),
  receipt: z.enum(['pending', 'sent', 'unknown']),
  deliveredAt: z.iso.datetime().nullable(),
  acknowledgedAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
});
export const reportIdentityReviewSchema = reporterIdentityReviewSchema.extend({
  reason: reportHandoffReasonSchema.nullable(),
  evidenceRevision: z.number().int().nonnegative().nullable(),
  candidateCount: z.number().int().nonnegative().nullable(),
  candidates: z.array(safeReviewCandidateSchema).max(REVIEW_CANDIDATE_LIMIT),
  coverageKind: z.enum(['not_required', 'complete', 'partial', 'unavailable']).nullable(),
  acknowledgedBy: z.string().nullable(),
  resolvedBy: z.string().nullable(),
});
export type ReportIdentityReview = z.infer<typeof reportIdentityReviewSchema>;
export type ReporterIdentityReview = z.infer<typeof reporterIdentityReviewSchema>;

/** Only validated analysis may contribute identity or delivery facts. */
export function projectReportIdentityReview(input: {
  status: string;
  metadata: unknown;
  evidenceRevision?: unknown;
}): ReportIdentityReview | null {
  const root = z.record(z.string(), z.unknown()).safeParse(input.metadata);
  const parsed = reportAnalysisMetadataSchema.safeParse(root.success ? root.data.analysis : null);
  const analysis = parsed.success ? parsed.data : null;
  const handoff = analysis?.handoff;
  const review = handoff && handoff.state !== 'none' ? handoff : null;
  if (!review && input.status !== 'needs_admin_confirmation') return null;
  const candidates =
    analysis?.outcome?.kind === 'admin_review'
      ? analysis.outcome.candidates
      : analysis?.outcome?.kind === 'confirm'
        ? [analysis.outcome.candidate]
        : null;
  return reportIdentityReviewSchema.parse({
    phase: review?.state ?? 'pending',
    reason: review?.reason ?? null,
    evidenceRevision: z.number().int().nonnegative().safeParse(input.evidenceRevision).success
      ? input.evidenceRevision
      : null,
    candidateCount: candidates?.length ?? null,
    candidates: (candidates ?? [])
      .slice(0, REVIEW_CANDIDATE_LIMIT)
      .map((candidate) => safeReviewCandidateSchema.parse(candidate)),
    coverageKind: analysis?.coverage?.kind ?? null,
    delivery:
      review &&
      review.state !== 'pending' &&
      'messageId' in review &&
      typeof review.messageId === 'string' &&
      typeof review.channelId === 'string'
        ? 'delivered'
        : review?.state === 'pending'
          ? 'pending'
          : 'unknown',
    receipt: review?.receipt ?? 'unknown',
    // The persisted handoff records delivery IDs but no delivery timestamp.
    deliveredAt: null,
    acknowledgedAt:
      review && (review.state === 'acknowledged' || review.state === 'resolved')
        ? (review.acknowledgedAt ?? null)
        : null,
    acknowledgedBy:
      review && (review.state === 'acknowledged' || review.state === 'resolved')
        ? (review.acknowledgedBy ?? null)
        : null,
    resolvedAt: review?.state === 'resolved' ? review.resolvedAt : null,
    resolvedBy: review?.state === 'resolved' ? review.resolvedBy : null,
  });
}
export function projectReporterIdentityReview(
  input: Parameters<typeof projectReportIdentityReview>[0]
): ReporterIdentityReview | null {
  const review = projectReportIdentityReview(input);
  return review ? reporterIdentityReviewSchema.parse(review) : null;
}
export function reportIntakeStatusLabel(status: string, metadata?: unknown): string {
  if (status === 'needs_admin_confirmation') return 'Needs admin review';
  if (status === 'closed_by_reporter') {
    const closure = z
      .object({ closed_by_staff: z.boolean().optional(), closed_by: z.string().optional() })
      .safeParse(metadata);
    if (closure.success && closure.data.closed_by_staff === true) return 'Resolved by staff';
    return closure.success && closure.data.closed_by ? 'Closed by reporter' : 'Closed';
  }
  return status.split('_').join(' ');
}

export const reportDetailSchema = z.object({
  statusLabel: z.string().optional(),
  identityReview: reportIdentityReviewSchema.nullable().optional(),
  analysisFailureCode: z.literal('invalid_metadata').nullable().optional(),
  reporterDisplayName: z.string().nullable().optional(),
  targetDisplayName: z.string().nullable().default(null),
  id: z.string(),
  guildId: z.string(),
  reporterId: z.string(),
  targetUserId: z.string().nullable(),
  status: reportQueueStatusSchema,
  summary: z.string().nullable(),
  summarySource: reportSummarySourceSchema.default('other'),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  reportThreadUrl: z.string().url().nullable(),
  latestDetectionId: z.string().nullable(),
  latestCaseId: z.string().nullable(),
  evidence: z.array(reportEvidenceItemSchema),
  allowedActions: z.array(reportQueueActionSchema),
});

export type ReportQueueStatus = z.infer<typeof reportQueueStatusSchema>;
export type ReportQueueAction = z.infer<typeof reportQueueActionSchema>;
export type ReportSummarySource = z.infer<typeof reportSummarySourceSchema>;
export type ReportQueueItem = z.infer<typeof reportQueueItemSchema>;
export type ReportEvidenceKind = z.infer<typeof reportEvidenceKindSchema>;
export type ReportEvidenceAttachment = z.infer<typeof reportEvidenceAttachmentSchema>;
export type ReportEvidenceItem = z.infer<typeof reportEvidenceItemSchema>;
export type ReportDetail = z.infer<typeof reportDetailSchema>;

export function sortReportQueueItems(reports: readonly ReportQueueItem[]): ReportQueueItem[] {
  return [...reports].sort((left, right) => {
    if (!left.updatedAt || !right.updatedAt) return left.updatedAt ? -1 : right.updatedAt ? 1 : 0;
    if (left.stale !== right.stale) {
      return left.stale ? -1 : 1;
    }

    return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  });
}

export const reportIntakeStatusSchema = z.enum([
  'collecting_evidence',
  'needs_reporter_confirmation',
  'needs_admin_confirmation',
  'submitted',
  'closed_by_reporter',
  'actioned',
  'dismissed',
  'false_positive',
  'expired',
]);
export const reportAttentionRecordSchema = reportDetailSchema
  .omit({ status: true })
  .extend({ status: reportIntakeStatusSchema });
export type ReportIntakeStatus = z.infer<typeof reportIntakeStatusSchema>;
export type ReportAttentionRecord = z.infer<typeof reportAttentionRecordSchema>;
