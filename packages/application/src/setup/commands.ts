import { z } from 'zod';
import {
  guildSetupUpdateSchema,
  settingsSectionSchemas,
  detectionResponseModeSchema,
} from './settings';
const id = z.string().trim().min(1);
export const setupChangesSchema = z
  .object(guildSetupUpdateSchema.shape)
  .omit({ guildId: true, updatedBy: true })
  .strict();
const sectionCommands = [
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('roleGate'),
      changes: settingsSectionSchemas.roleGate,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('roleQuarantine'),
      changes: settingsSectionSchemas.roleQuarantine,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('queue'),
      changes: settingsSectionSchemas.queue,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('manualIntake'),
      changes: settingsSectionSchemas.manualIntake,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('detection'),
      changes: settingsSectionSchemas.detection,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('caseStaff'),
      changes: settingsSectionSchemas.caseStaff,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('caseReview'),
      changes: settingsSectionSchemas.caseReview,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('report'),
      changes: settingsSectionSchemas.report,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('analytics'),
      changes: settingsSectionSchemas.analytics,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('verification'),
      changes: settingsSectionSchemas.verification,
      reset: z.enum(['prompt', 'context']).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_settings'),
      section: z.literal('lockdown'),
      changes: settingsSectionSchemas.lockdown,
    })
    .strict(),
] as const;
export const updateSettingsCommandSchema = z.discriminatedUnion('section', sectionCommands);
export const completeSetupCommandSchema = z
  .object({
    kind: z.literal('complete_setup_verification'),
    mode: z.enum(['provision', 'verification_modal']).default('provision'),
    adminChannelId: id,
    caseRoleId: id.nullable().optional(),
    caseRoleName: z.string().trim().min(1).nullable().optional(),
    verificationChannelId: id.nullable().optional(),
    reportInstructionsChannelId: id.nullable().optional(),
    detectionResponseMode: detectionResponseModeSchema.optional(),
    onboardingWizard: z.boolean().default(false),
    submissionId: id.optional(),
  })
  .strict();
export const upsertReportInstructionsCommandSchema = z.discriminatedUnion('repost', [
  z
    .object({
      kind: z.literal('upsert_report_instructions'),
      channelId: id,
      repost: z.literal(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('upsert_report_instructions'),
      channelId: id,
      repost: z.literal(true),
      expectedMessageId: id.nullable(),
      expectedChannelId: id.nullable(),
      submissionId: id,
    })
    .strict(),
]);
export const heuristicChangesSchema = z
  .object({
    messageThreshold: guildSetupUpdateSchema.shape.heuristicMessageThreshold,
    timeframeSeconds: guildSetupUpdateSchema.shape.heuristicMessageTimeframeSeconds,
    suspiciousKeywords: guildSetupUpdateSchema.shape.heuristicSuspiciousKeywords,
  })
  .strict();
export const queuedSetupCommandSchema = z.union([
  completeSetupCommandSchema,
  upsertReportInstructionsCommandSchema,
  updateSettingsCommandSchema,
  z.object({ kind: z.literal('clear_report_instructions') }).strict(),
  z.object({ kind: z.literal('update_heuristics'), changes: heuristicChangesSchema }).strict(),
  z
    .object({
      kind: z.literal('reset_heuristics'),
      scope: z.enum(['all', 'keywords']).default('all'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('lockdown_allow_add'),
      targetId: id,
      targetKind: z.enum(['channel', 'category']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('lockdown_allow_remove'),
      targetId: id,
      targetKind: z.enum(['channel', 'category']),
    })
    .strict(),
  z.object({ kind: z.literal('disable_lockdown') }).strict(),
]);
export const setupCommandSchema = z.union([
  queuedSetupCommandSchema,
  z.object({ kind: z.literal('update_setup'), changes: setupChangesSchema }).strict(),
]);
export type SetupCommand = z.infer<typeof setupCommandSchema>;
export type QueuedSetupCommand = z.infer<typeof queuedSetupCommandSchema>;
export type UpdateSettingsCommand = z.infer<typeof updateSettingsCommandSchema>;
export type SetupChanges = z.infer<typeof setupChangesSchema>;
export type HeuristicChanges = z.infer<typeof heuristicChangesSchema>;
export function isQueuedSetupKind(kind: string): boolean {
  return [
    'complete_setup_verification',
    'upsert_report_instructions',
    'update_settings',
    'update_heuristics',
    'reset_heuristics',
    'lockdown_allow_add',
    'lockdown_allow_remove',
    'disable_lockdown',
    'clear_report_instructions',
  ].includes(kind);
}
export function isQueuedSetupCommand(command: {
  readonly kind: string;
}): command is QueuedSetupCommand {
  return isQueuedSetupKind(command.kind);
}
