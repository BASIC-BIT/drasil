import { z } from 'zod';

export const casePresenceStateSchema = z.enum([
  'in_server',
  'left_or_removed',
  'banned',
  'kicked',
  'unknown',
]);

export const caseActionSchema = z.enum([
  'view_history',
  'verify_user',
  'quarantine_compromised_account',
  'kick_user',
  'ban_user',
  'ban_by_id',
  'sync_existing_ban',
  'refresh_notification',
  'repair_thread',
  'create_thread',
  'reopen_case',
  'close_no_action',
  'challenge_user',
  'retry_captcha',
  'bypass_captcha',
]);

export const captchaChallengeGenerationHistorySchema = z.object({
  generation: z.number().int().positive(),
  requestSource: z.enum(['moderator', 'automatic_suspicious_join']),
  passEffect: z.enum(['evidence_only', 'verify_join_only']),
  caseRevisionAtIssue: z.number().int().min(0),
  requestedBy: z.string().nullable(),
  requestedAt: z.string(),
  presentedAt: z.string().nullable(),
  outcome: z.enum(['delivery_failed', 'failed', 'expired', 'bypassed', 'cancelled']).nullable(),
  outcomeAt: z.string().nullable(),
  deliveryErrorCode: z.string().nullable(),
  bypassedBy: z.string().nullable(),
  bypassedAt: z.string().nullable(),
  bypassReason: z.string().nullable(),
});

export const captchaChallengeSummarySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'passed', 'failed', 'expired', 'bypassed', 'cancelled']),
  requestSource: z.enum(['moderator', 'automatic_suspicious_join']),
  passEffect: z.enum(['evidence_only', 'verify_join_only']),
  generation: z.number().int().positive(),
  submissionCount: z.number().int().min(0),
  expiresAt: z.string(),
  requestedAt: z.string(),
  deliveredAt: z.string().nullable(),
  deliveryErrorCode: z.string().nullable(),
  passedAt: z.string().nullable(),
  bypassedAt: z.string().nullable(),
  bypassedBy: z.string().nullable(),
  bypassReason: z.string().nullable(),
  history: z.array(captchaChallengeGenerationHistorySchema).optional(),
});

export const caseSurfaceKindSchema = z.enum([
  'admin_notification',
  'admin_evidence_thread',
  'verification_thread',
  'report_intake_thread',
  'source_message',
]);

export const caseSurfaceLinkSchema = z.object({
  kind: caseSurfaceKindSchema,
  label: z.string(),
  url: z.string().url(),
  desktopUrl: z
    .string()
    .regex(/^discord:\/\//)
    .optional(),
});

export const caseUserIdentitySchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  globalName: z.string().nullable(),
  nickname: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  displayLabel: z.string(),
});

export const caseSummarySchema = z.object({
  id: z.string(),
  guildId: z.string(),
  userId: z.string(),
  userIdentity: caseUserIdentitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  caseKind: z.enum(['standard', 'compromised_account']).optional(),
  attentionState: z.enum(['review_required', 'parked']).optional(),
  containmentStatus: z
    .enum(['not_applicable', 'in_progress', 'contained', 'incomplete'])
    .optional(),
  parkedAt: z.string().nullable().optional(),
  parkedBy: z.string().nullable().optional(),
  quarantineEffects: z
    .object({
      removedRoleCount: z.number().int().min(0),
      retainedRoleCount: z.number().int().min(0),
      failedRoleCount: z.number().int().min(0),
      memberBypassCount: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  stale: z.boolean(),
  staleHours: z.number().int().min(0),
  presenceState: casePresenceStateSchema,
  confidence: z.number().min(0).max(1).nullable(),
  latestDetectionType: z.string().nullable(),
  latestDetectionAt: z.string().nullable(),
  lastActionType: z.string().nullable(),
  lastActionAt: z.string().nullable(),
  surfaces: z.array(caseSurfaceLinkSchema),
  allowedActions: z.array(caseActionSchema),
  captchaChallenge: captchaChallengeSummarySchema.nullable().optional(),
});

export const caseDetectionHistoryItemSchema = z.object({
  id: z.string(),
  detectionType: z.string(),
  confidence: z.number().min(0).max(1),
  detectedAt: z.string(),
  reasons: z.array(z.string()),
});

export const caseEvidenceItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  content: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: z.string().url().nullable(),
});

export const caseMessageContextItemSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  channelId: z.string().nullable(),
  contentPreview: z.string(),
  createdAt: z.string(),
  url: z.string().url().nullable(),
  isSource: z.boolean(),
});

export const caseModerationOutcomeSchema = z.object({
  id: z.string(),
  outcomeType: z.string(),
  source: z.string(),
  actorId: z.string().nullable(),
  reason: z.string().nullable(),
  occurredAt: z.string().nullable(),
});

export const caseDetailSchema = caseSummarySchema.extend({
  notes: z.string().nullable(),
  evidenceItems: z.array(caseEvidenceItemSchema),
  messageContext: z.array(caseMessageContextItemSchema),
  detectionHistory: z.array(caseDetectionHistoryItemSchema),
  moderationOutcomes: z.array(caseModerationOutcomeSchema),
});

export type CasePresenceState = z.infer<typeof casePresenceStateSchema>;
export type CaseAction = z.infer<typeof caseActionSchema>;
export type CaseSurfaceKind = z.infer<typeof caseSurfaceKindSchema>;
export type CaseSurfaceLink = z.infer<typeof caseSurfaceLinkSchema>;
export type CaseUserIdentity = z.infer<typeof caseUserIdentitySchema>;
export type CaseSummary = z.infer<typeof caseSummarySchema>;
export type CaseDetectionHistoryItem = z.infer<typeof caseDetectionHistoryItemSchema>;
export type CaseEvidenceItem = z.infer<typeof caseEvidenceItemSchema>;
export type CaseMessageContextItem = z.infer<typeof caseMessageContextItemSchema>;
export type CaseModerationOutcome = z.infer<typeof caseModerationOutcomeSchema>;
export type CaseDetail = z.infer<typeof caseDetailSchema>;
export type CaptchaChallengeSummary = z.infer<typeof captchaChallengeSummarySchema>;
export type CaptchaChallengeGenerationHistory = z.infer<
  typeof captchaChallengeGenerationHistorySchema
>;

export function sortCaseSummariesForQueue(cases: readonly CaseSummary[]): CaseSummary[] {
  return [...cases].sort((left, right) => {
    if (left.stale !== right.stale) {
      return left.stale ? -1 : 1;
    }

    return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  });
}
