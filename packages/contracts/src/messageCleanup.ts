import { z } from 'zod';

export const MESSAGE_CLEANUP_PREVIEW_CANDIDATE_LIMIT = 500;
export const MESSAGE_CLEANUP_EXECUTION_CANDIDATE_LIMIT = 100;
export const MESSAGE_CLEANUP_CONTENT_PREVIEW_MAX_LENGTH = 500;
export const MESSAGE_CLEANUP_REASON_MAX_LENGTH = 1000;
export const MESSAGE_CLEANUP_LATEST_JOB_LIMIT = 10;

export const messageCleanupJobModeSchema = z.enum(['delete_only', 'ban_with_cleanup']);

export const messageCleanupScopeSchema = z.enum([
  'source_message',
  'last_hour',
  'last_day',
  'last_7_days',
]);

export const messageCleanupJobStatusSchema = z.enum([
  'queued',
  'discovering',
  'ready',
  'executing',
  'completed',
  'failed',
]);

export const messageCleanupCoverageSchema = z.enum([
  'ready',
  'partial',
  'indexing',
  'denied',
  'unavailable',
  'too_many',
]);

export const messageCleanupDiscoverySourceSchema = z.enum([
  'source_message',
  'discord_search',
  'message_context',
]);

export const messageCleanupEvidenceStatusSchema = z.enum(['pending', 'preserved', 'failed']);

export const messageCleanupItemStatusSchema = z.enum([
  'pending',
  'deleted',
  'already_missing',
  'changed_since_preview',
  'evidence_failed',
  'delete_failed',
  'permission_denied',
]);

export const messageCleanupBanStatusSchema = z.enum([
  'not_requested',
  'pending',
  'succeeded',
  'failed',
]);

export const messageCleanupCaseFinalizationStatusSchema = z.enum([
  'not_applicable',
  'pending',
  'succeeded',
  'failed',
]);

export const messageCleanupCaseStatusSchema = z.enum([
  'pending',
  'verified',
  'banned',
  'kicked',
  'closed_no_action',
]);

export const messageCleanupWorkspaceBlockReasonSchema = z.enum([
  'case_not_pending',
  'missing_target_user',
  'missing_evidence_thread',
]);

export const messageCleanupExecutionBlockReasonSchema = z.enum([
  'job_not_ready',
  'coverage_blocked',
  'no_candidates',
  'execution_limit_exceeded',
]);

const countSchema = z.number().int().min(0);
const nullableTimestampSchema = z.string().nullable();

export const messageCleanupAggregateOutcomeSchema = z.object({
  candidateCount: countSchema.max(MESSAGE_CLEANUP_PREVIEW_CANDIDATE_LIMIT),
  preservedCount: countSchema,
  deletedCount: countSchema,
  alreadyMissingCount: countSchema,
  changedSincePreviewCount: countSchema,
  evidenceFailedCount: countSchema,
  deleteFailedCount: countSchema,
  permissionDeniedCount: countSchema,
});

export const messageCleanupExecutionEligibilitySchema = z.object({
  canExecute: z.boolean(),
  blockedReason: messageCleanupExecutionBlockReasonSchema.nullable(),
  previewCandidateLimit: z.literal(MESSAGE_CLEANUP_PREVIEW_CANDIDATE_LIMIT),
  executionCandidateLimit: z.literal(MESSAGE_CLEANUP_EXECUTION_CANDIDATE_LIMIT),
});

export const messageCleanupJobSummarySchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  verificationEventId: z.string().min(1),
  targetUserId: z.string().min(1),
  requestedBy: z.string().min(1),
  actorSurface: z.string().min(1),
  mode: messageCleanupJobModeSchema,
  scope: messageCleanupScopeSchema,
  status: messageCleanupJobStatusSchema,
  coverage: messageCleanupCoverageSchema.nullable(),
  banStatus: messageCleanupBanStatusSchema,
  caseFinalizationStatus: messageCleanupCaseFinalizationStatusSchema,
  reason: z.string().trim().min(1).max(MESSAGE_CLEANUP_REASON_MAX_LENGTH),
  evidenceThreadUrl: z.string().url().nullable(),
  requestedWindowStart: nullableTimestampSchema,
  requestedWindowEnd: nullableTimestampSchema,
  previewedAt: nullableTimestampSchema,
  startedAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  failedAt: nullableTimestampSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastError: z.string().nullable(),
  outcomes: messageCleanupAggregateOutcomeSchema,
  execution: messageCleanupExecutionEligibilitySchema,
});

export const messageCleanupItemSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
  channelId: z.string().min(1),
  authorId: z.string().min(1),
  messageCreatedAt: z.string(),
  messageEditedAt: nullableTimestampSchema,
  contentPreview: z.string().max(MESSAGE_CLEANUP_CONTENT_PREVIEW_MAX_LENGTH),
  attachmentCount: countSchema,
  discoverySource: messageCleanupDiscoverySourceSchema,
  bulkDeleteEligible: z.boolean(),
  evidenceStatus: messageCleanupEvidenceStatusSchema,
  status: messageCleanupItemStatusSchema,
  sourceMessageUrl: z.string().url().nullable(),
  evidenceMessageUrl: z.string().url().nullable(),
  attemptedAt: nullableTimestampSchema,
  evidencePreservedAt: nullableTimestampSchema,
  deletedAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  failureReason: z.string().nullable(),
});

export const messageCleanupJobDetailSchema = messageCleanupJobSummarySchema.extend({
  items: z.array(messageCleanupItemSchema).max(MESSAGE_CLEANUP_PREVIEW_CANDIDATE_LIMIT),
});

export const messageCleanupCaseWorkspaceSchema = z.object({
  guildId: z.string().min(1),
  verificationEventId: z.string().min(1),
  targetUserId: z.string().nullable(),
  caseStatus: messageCleanupCaseStatusSchema,
  evidenceThreadUrl: z.string().url().nullable(),
  canPreview: z.boolean(),
  blockedReason: messageCleanupWorkspaceBlockReasonSchema.nullable(),
  latestJobs: z.array(messageCleanupJobSummarySchema).max(MESSAGE_CLEANUP_LATEST_JOB_LIMIT),
});

export type MessageCleanupJobMode = z.infer<typeof messageCleanupJobModeSchema>;
export type MessageCleanupScope = z.infer<typeof messageCleanupScopeSchema>;
export type MessageCleanupJobStatus = z.infer<typeof messageCleanupJobStatusSchema>;
export type MessageCleanupCoverage = z.infer<typeof messageCleanupCoverageSchema>;
export type MessageCleanupDiscoverySource = z.infer<typeof messageCleanupDiscoverySourceSchema>;
export type MessageCleanupEvidenceStatus = z.infer<typeof messageCleanupEvidenceStatusSchema>;
export type MessageCleanupItemStatus = z.infer<typeof messageCleanupItemStatusSchema>;
export type MessageCleanupBanStatus = z.infer<typeof messageCleanupBanStatusSchema>;
export type MessageCleanupCaseFinalizationStatus = z.infer<
  typeof messageCleanupCaseFinalizationStatusSchema
>;
export type MessageCleanupCaseStatus = z.infer<typeof messageCleanupCaseStatusSchema>;
export type MessageCleanupWorkspaceBlockReason = z.infer<
  typeof messageCleanupWorkspaceBlockReasonSchema
>;
export type MessageCleanupExecutionBlockReason = z.infer<
  typeof messageCleanupExecutionBlockReasonSchema
>;
export type MessageCleanupAggregateOutcome = z.infer<typeof messageCleanupAggregateOutcomeSchema>;
export type MessageCleanupExecutionEligibility = z.infer<
  typeof messageCleanupExecutionEligibilitySchema
>;
export type MessageCleanupJobSummary = z.infer<typeof messageCleanupJobSummarySchema>;
export type MessageCleanupItem = z.infer<typeof messageCleanupItemSchema>;
export type MessageCleanupJobDetail = z.infer<typeof messageCleanupJobDetailSchema>;
export type MessageCleanupCaseWorkspace = z.infer<typeof messageCleanupCaseWorkspaceSchema>;

export interface MessageCleanupExecutionInput {
  readonly status: MessageCleanupJobStatus;
  readonly coverage: MessageCleanupCoverage | null;
  readonly scope: MessageCleanupScope;
  readonly candidateCount: number;
}

export function getMessageCleanupExecutionEligibility(
  job: MessageCleanupExecutionInput
): MessageCleanupExecutionEligibility {
  let blockedReason: MessageCleanupExecutionBlockReason | null = null;

  if (job.status !== 'ready') {
    blockedReason = 'job_not_ready';
  } else if (
    job.coverage !== 'ready' &&
    !(job.scope === 'source_message' && job.coverage === 'partial' && job.candidateCount === 1)
  ) {
    blockedReason = 'coverage_blocked';
  } else if (job.candidateCount === 0) {
    blockedReason = 'no_candidates';
  } else if (job.candidateCount > MESSAGE_CLEANUP_EXECUTION_CANDIDATE_LIMIT) {
    blockedReason = 'execution_limit_exceeded';
  }

  return messageCleanupExecutionEligibilitySchema.parse({
    canExecute: blockedReason === null,
    blockedReason,
    previewCandidateLimit: MESSAGE_CLEANUP_PREVIEW_CANDIDATE_LIMIT,
    executionCandidateLimit: MESSAGE_CLEANUP_EXECUTION_CANDIDATE_LIMIT,
  });
}
