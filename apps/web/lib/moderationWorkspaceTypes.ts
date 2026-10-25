import { z } from 'zod';
import { captchaIssuanceConfigurationSchema, queuedCommandSchemas } from '@drasil/application';
import {
  caseDetailSchema,
  moderationInboxItemSchema,
  moderationInboxActionSchema,
  reportDetailSchema,
  reportAttentionRecordSchema,
  memberProfileMembershipSchema,
  memberProfileDetectionSchema,
  messageCleanupCaseWorkspaceSchema,
  messageCleanupJobDetailSchema,
} from '@drasil/contracts';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';
import { caseDiscordMessageSchema, conversationSourceSchema } from './conversationTypes';
export { caseDiscordMessageSchema } from './conversationTypes';

const nullableString = z.string().nullable();
const roleSchema = z.object({
  roleId: z.string(),
  roleName: nullableString,
  reason: nullableString,
});
const previewSchema = z.object({
  lockdownIssues: z
    .array(z.object({ code: z.string(), message: z.string(), severity: z.string() }))
    .optional(),
  memberBypasses: z
    .array(
      z.object({
        channelId: z.string(),
        channelName: z.string(),
        permissions: z.array(z.string()),
        subjectId: z.string(),
        subjectType: z.string(),
      })
    )
    .optional(),
  adminNotificationReady: z.boolean(),
  canContain: z.boolean(),
  caseRoleReady: z.boolean(),
  caseRole: roleSchema.nullable(),
  enabled: z.boolean(),
  lockdownErrorCount: z.number(),
  lockdownIssueCount: z.number(),
  lockdownPlannedActionCount: z.number(),
  memberBypassCount: z.number(),
  plannedRoles: z.array(roleSchema),
  previewedAt: nullableString,
  privilegedRoles: z.array(roleSchema),
  recoveryThreadReady: z.boolean(),
  recoveryThreadId: nullableString,
  retainedRoles: z.array(roleSchema),
  unremovablePrivilegeReasons: z.array(z.string()),
});
export const moderationActionRequestSummarySchema: z.ZodType<
  ModerationActionRequestSummary,
  z.ZodTypeDef,
  unknown
> = z.object({
  id: z.string(),
  actionType: z
    .string()
    .refine((value): value is keyof typeof queuedCommandSchemas =>
      Object.prototype.hasOwnProperty.call(queuedCommandSchemas, value)
    ),
  actorSurface: z.string(),
  actorUserId: z.string().nullable().optional(),
  accountQuarantinePreviewRequestId: z.string().nullable().optional(),
  captchaConfiguration: captchaIssuanceConfigurationSchema.nullable().optional(),
  captchaBinding: z
    .object({ challengeId: z.string(), generation: z.number().int().positive() })
    .nullable()
    .optional(),
  completedAt: nullableString,
  detectionEventId: nullableString,
  failedAt: nullableString,
  lastError: nullableString,
  cleanupIntentToken: nullableString.optional(),
  messageDeletionJobId: nullableString,
  requestedAt: z.string(),
  reportIntakeId: nullableString,
  requestedAction: nullableString,
  resultSummary: nullableString,
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  targetUserId: nullableString,
  updatedAt: z.string(),
  verificationEventId: nullableString,
  observedBanResult: z
    .discriminatedUnion('status', [
      z.object({ status: z.literal('banned') }),
      z.object({ status: z.literal('already_handled') }),
      z.object({ status: z.literal('banned_updates_pending'), operationId: z.string() }),
      z.object({ status: z.literal('ban_outcome_unknown'), operationId: z.string() }),
      z.object({ status: z.literal('ban_reviewed_no_current_ban'), operationId: z.string() }),
    ])
    .nullable()
    .optional(),
  accountQuarantinePreview: previewSchema.nullable().optional(),
  setupInput: z
    .object({
      adminChannelId: nullableString,
      caseRoleId: nullableString,
      caseRoleName: nullableString,
      detectionResponseMode: z.enum(['off', 'record_only', 'notify_only', 'restrict']).nullable(),
      reportInstructionsChannelId: nullableString,
      submissionId: nullableString,
      verificationChannelId: nullableString,
    })
    .nullable()
    .optional(),
});
export const workspaceActionPolicySchema = z.object({
  allowedActions: z.array(moderationInboxActionSchema).readonly(),
  canQueueCaseActions: z.boolean(),
  canOpenReportCases: z.boolean(),
  canManageCleanup: z.boolean(),
  kickReasonRequired: z.boolean(),
  banReasonRequired: z.boolean(),
});
export const securityCheckConfigurationSchema = z.object({
  method: z.enum(['turnstile', 'discord_image', 'none']),
  methodRevision: z.number().int().min(0).max(2147483647),
});
export type SecurityCheckConfiguration = z.infer<typeof securityCheckConfigurationSchema>;
export const caseWorkspaceDataSchema = z.object({
  securityCheckConfiguration: securityCheckConfigurationSchema.nullable().default(null),
  actorUserId: z.string().nullable().default(null),
  recoveryAttention: z.array(moderationInboxItemSchema).optional(),
  conversationSources: z.array(conversationSourceSchema).optional(),
  detail: caseDetailSchema,
  report: reportDetailSchema.nullable(),
  membership: memberProfileMembershipSchema.nullable(),
  requests: z.array(moderationActionRequestSummarySchema).readonly(),
  cleanup: z
    .object({
      workspace: messageCleanupCaseWorkspaceSchema,
      jobs: z.array(messageCleanupJobDetailSchema).readonly(),
    })
    .nullable(),
  policy: workspaceActionPolicySchema,
  loadedAt: z.string(),
});
export const replyReadStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), message: caseDiscordMessageSchema }),
  z.object({ kind: z.literal('unavailable'), sourceUrl: z.string().url().nullable() }),
]);
export const supportAttentionSubtypeSchema = z.enum([
  'support_reply',
  'recovery_reply',
  'quarantine_breach',
]);
const common = { item: moderationInboxItemSchema, policy: workspaceActionPolicySchema };
export const workspaceItemDetailSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('case'),
    item: moderationInboxItemSchema.extend({ kind: z.literal('case') }),
    data: caseWorkspaceDataSchema,
  }),
  z.object({
    ...common,
    kind: z.literal('submitted_report'),
    conversationSources: z.array(conversationSourceSchema).optional(),
    item: moderationInboxItemSchema.extend({ kind: z.literal('submitted_report') }),
    report: reportDetailSchema,
    requests: z.array(moderationActionRequestSummarySchema).readonly(),
  }),
  z.object({
    ...common,
    kind: z.literal('observed_alert'),
    item: moderationInboxItemSchema.extend({ kind: z.literal('observed_alert') }),
    detection: memberProfileDetectionSchema,
    requests: z.array(moderationActionRequestSummarySchema).readonly(),
  }),
  z.object({
    ...common,
    kind: z.literal('report_attention'),
    item: moderationInboxItemSchema.extend({ kind: z.literal('report_attention') }),
    intake: reportAttentionRecordSchema,
    reply: replyReadStateSchema,
  }),
  z.object({
    ...common,
    kind: z.literal('support_attention'),
    item: moderationInboxItemSchema.extend({ kind: z.literal('support_attention') }),
    subtype: supportAttentionSubtypeSchema,
    caseData: caseWorkspaceDataSchema.nullable(),
    reply: replyReadStateSchema,
  }),
  z.object({
    ...common,
    kind: z.literal('pending_screening'),
    item: moderationInboxItemSchema.extend({ kind: z.literal('pending_screening') }),
    screening: z.object({
      pendingSince: nullableString,
      thresholdDays: z.number().nonnegative().nullable(),
      lastCheckedAt: nullableString,
    }),
  }),
]);
export type WorkspaceItemDetail = z.infer<typeof workspaceItemDetailSchema>;
export type WorkspaceActionPolicy = z.infer<typeof workspaceActionPolicySchema>;
export type CaseWorkspaceData = z.infer<typeof caseWorkspaceDataSchema>;
export type ReplyReadState = z.infer<typeof replyReadStateSchema>;
export type SupportAttentionSubtype = z.infer<typeof supportAttentionSubtypeSchema>;
