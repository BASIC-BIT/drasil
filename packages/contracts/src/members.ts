import { z } from 'zod';
import { caseSummarySchema, caseUserIdentitySchema, casePresenceStateSchema } from './cases';
import { reportQueueStatusSchema } from './reports';

export const memberProfileMembershipSchema = z.object({
  joinDate: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
  messageCount: z.number().int().nonnegative().nullable(),
  verificationStatus: z.string().nullable(),
  caseRoleActive: z.boolean().nullable(),
  screeningPending: z.boolean().nullable(),
});

export const memberProfileDetectionAccountingSchema = z.object({
  excluded: z.boolean(),
  scope: z.string().nullable(),
  reason: z.string().nullable(),
  excludedBy: z.string().nullable(),
  excludedAt: z.string().nullable(),
});

export const memberProfileDetectionSchema = z.object({
  id: z.string(),
  detectionType: z.string(),
  confidence: z.number().min(0).max(1),
  detectedAt: z.string(),
  reasons: z.array(z.string()),
  latestCaseId: z.string().nullable(),
  accounting: memberProfileDetectionAccountingSchema,
  observedAction: z.enum(['dismiss', 'false_positive']).nullable(),
  observedActionAt: z.string().nullable(),
  observedActionBy: z.string().nullable(),
  sourceChannelId: z.string().nullable(),
  sourceMessageId: z.string().nullable(),
  sourceMessageUrl: z.string().url().nullable(),
});

export const memberProfileReportSchema = z.object({
  id: z.string(),
  reporterId: z.string(),
  status: reportQueueStatusSchema,
  summary: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  reportThreadUrl: z.string().url().nullable(),
  latestCaseId: z.string().nullable(),
});

export const memberProfileOutcomeSchema = z.object({
  id: z.string(),
  outcomeType: z.string(),
  source: z.string(),
  actorId: z.string().nullable(),
  reason: z.string().nullable(),
  occurredAt: z.string().nullable(),
  verificationEventId: z.string().nullable(),
  detectionEventId: z.string().nullable(),
});

export const memberProfileSchema = z.object({
  guildId: z.string(),
  userId: z.string(),
  identity: caseUserIdentitySchema,
  presenceState: casePresenceStateSchema,
  membership: memberProfileMembershipSchema,
  cases: z.array(caseSummarySchema),
  detections: z.array(memberProfileDetectionSchema),
  reports: z.array(memberProfileReportSchema),
  outcomes: z.array(memberProfileOutcomeSchema),
});

export type MemberProfileMembership = z.infer<typeof memberProfileMembershipSchema>;
export type MemberProfileDetectionAccounting = z.infer<
  typeof memberProfileDetectionAccountingSchema
>;
export type MemberProfileDetection = z.infer<typeof memberProfileDetectionSchema>;
export type MemberProfileReport = z.infer<typeof memberProfileReportSchema>;
export type MemberProfileOutcome = z.infer<typeof memberProfileOutcomeSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
