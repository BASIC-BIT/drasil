import { z } from 'zod';

const id = z.string().min(1);
const timestamp = z.iso.datetime();
const revision = z.number().int().nonnegative();

export const reportEvidenceRefSchema = z.object({
  evidenceId: id,
  messageId: id,
  sourceVersion: revision,
  role: z.enum(['reporter', 'staff']),
  kind: z.enum(['text', 'image']),
});
export const reportSubjectCluesSchema = z.object({
  subjectId: id,
  role: z.enum(['target', 'reporter', 'other', 'unknown']),
  readability: z.enum(['clear', 'uncertain', 'unreadable']),
  sourceRefs: z.array(reportEvidenceRefSchema),
  userIds: z.array(id),
  usernames: z.array(id),
  displayNames: z.array(id),
  messageLinks: z.array(z.url()),
  uncertainty: z.array(z.string()),
});
const scan = { scannedAt: timestamp, expiresAt: timestamp, memberCount: revision };
export const reportDirectoryCoverageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('complete'), ...scan }),
  z.object({
    kind: z.literal('partial'),
    ...scan,
    reason: z.enum(['page_limit', 'deadline', 'interrupted']),
  }),
  z.object({
    kind: z.literal('unavailable'),
    reason: z.enum(['permissions', 'rate_limited', 'transport']),
  }),
]);
export const reportIdentityCandidateSchema = z.object({
  candidateId: id,
  discordUserId: id,
  serverId: id,
  username: z.string().nullable(),
  globalName: z.string().nullable(),
  nickname: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  subjectId: id,
  sourceRefs: z.array(reportEvidenceRefSchema),
  matchedFields: z.array(
    z.enum(['username', 'globalName', 'nickname', 'displayName', 'userId', 'messageAuthor'])
  ),
});
export const reportHandoffReasonSchema = z.enum([
  'no_match',
  'ambiguous',
  'conflicting_anchors',
  'uncertain_text',
  'incomplete_coverage',
  'evidence_unavailable',
  'evidence_over_budget',
  'provider_failure',
  'lookup_failure',
  'rejected',
  'confirmation_timeout',
]);
const evidenceCoverage = {
  coverage: reportDirectoryCoverageSchema,
  includedEvidenceIds: z.array(id),
  excludedEvidenceIds: z.array(id),
};
export const reportAnalysisOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('confirm'),
    candidate: reportIdentityCandidateSchema,
    ...evidenceCoverage,
  }),
  z.object({
    kind: z.literal('admin_review'),
    reason: reportHandoffReasonSchema,
    candidates: z.array(reportIdentityCandidateSchema),
    ...evidenceCoverage,
  }),
]);
const delivery = {
  reason: reportHandoffReasonSchema,
  messageId: id,
  channelId: id,
  attempts: revision,
  nextDueAt: timestamp.nullable(),
  receipt: z.enum(['pending', 'sent']),
};
const acknowledgement = { acknowledgedBy: id, acknowledgedAt: timestamp };
export const reportHandoffSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }).passthrough(),
  z
    .object({
      state: z.literal('pending'),
      reason: reportHandoffReasonSchema,
      attempts: revision,
      nextDueAt: timestamp,
      receipt: z.enum(['pending', 'sent']),
    })
    .passthrough(),
  z.object({ state: z.literal('delivered'), ...delivery }).passthrough(),
  z
    .object({
      state: z.literal('acknowledged'),
      ...delivery,
      messageId: id.optional(),
      channelId: id.optional(),
      ...acknowledgement,
    })
    .passthrough()
    .refine(
      (value) => Boolean(value.messageId) === Boolean(value.channelId),
      'Delivery identifiers must be present together'
    ),
  z
    .object({
      state: z.literal('resolved'),
      ...delivery,
      messageId: id.optional(),
      channelId: id.optional(),
      acknowledgedBy: id.optional(),
      acknowledgedAt: timestamp.optional(),
      resolvedBy: id,
      resolvedAt: timestamp,
    })
    .passthrough()
    .refine(
      (value) =>
        Boolean(value.messageId) === Boolean(value.channelId) &&
        Boolean(value.acknowledgedBy) === Boolean(value.acknowledgedAt),
      'Delivery and acknowledgement fields must be present together'
    ),
]);
export const reportSourceVersionSchema = z
  .object({
    availability: z.enum(['available', 'unavailable']).default('available'),
    availabilityFailureToken: id.nullable().default(null),
    sourceVersion: revision,
    sourceFingerprint: id,
    sourceChannelId: id,
    sourceAuthorId: id.nullable(),
    observedAt: timestamp,
    editedAt: timestamp.nullable(),
    operation: z.enum(['upsert', 'delete']),
  })
  .refine(
    (source) => source.operation === 'delete' || source.sourceAuthorId !== null,
    'Upserts require an authorized author'
  );
export const reportAnalysisMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    sources: z.record(z.string(), reportSourceVersionSchema),
    batchingStartedAt: timestamp.optional(),
    outcome: reportAnalysisOutcomeSchema.nullable(),
    coverage: reportDirectoryCoverageSchema.nullable(),
    requestReservations: z.array(z.object({ revision, leaseToken: id, reservedAt: timestamp })),
    handoff: reportHandoffSchema,
  })
  .passthrough();

export type ReportEvidenceRef = z.infer<typeof reportEvidenceRefSchema>;
export type ReportSubjectClues = z.infer<typeof reportSubjectCluesSchema>;
export type ReportDirectoryCoverage = z.infer<typeof reportDirectoryCoverageSchema>;
export type ReportIdentityCandidate = z.infer<typeof reportIdentityCandidateSchema>;
export type ReportAnalysisOutcome = z.infer<typeof reportAnalysisOutcomeSchema>;
export type ReportHandoffReason = z.infer<typeof reportHandoffReasonSchema>;
export type ReportAnalysisMetadata = z.infer<typeof reportAnalysisMetadataSchema>;
export type ReportHandoff = z.infer<typeof reportHandoffSchema>;
