import { z } from 'zod';
import { caseCommandSchema } from '../cases/commands';
import { detectionCommandSchema } from '../detections/commands';
import { operationCommandSchema } from '../operations/commands';
import { reportCommandSchema } from '../reports/commands';
import { reportClosureActions } from '../reports/review';
import {
  setupCommandSchema,
  updateSettingsCommandSchema,
  setupChangesSchema,
} from '../setup/commands';
import { messageCleanupCommandSchema } from '../messageCleanup/commands';
import { queuedQuarantineCommandSchema } from '../containment/commands';
import { captchaCommandSchema } from '../containment/captcha';
import type { DelegatedScope } from './types';

const id = z.string().min(1);
const wrapperSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('close_submitted_report'),
      reportId: id,
      action: z.enum(reportClosureActions),
    })
    .strict(),
  z.object({ kind: z.literal('open_submitted_report_case'), reportId: id }).strict(),
  z
    .object({ kind: z.literal('acknowledge_attention'), itemIds: z.array(id).min(1).max(100) })
    .strict(),
]);
export const humanCommandSchema = z.union([
  caseCommandSchema,
  detectionCommandSchema,
  operationCommandSchema,
  reportCommandSchema,
  setupCommandSchema,
  messageCleanupCommandSchema,
  queuedQuarantineCommandSchema,
  z.union([
    captchaCommandSchema.options[0],
    captchaCommandSchema.options[1],
    captchaCommandSchema.options[2],
  ]),
  wrapperSchema,
]);
export type HumanCommand = z.infer<typeof humanCommandSchema>;
export type SemanticWorkflowId =
  | 'open_admin_case_moderator'
  | 'open_admin_case_administrator'
  | 'repair_active_case_moderator'
  | 'repair_active_case_administrator'
  | 'close_resolved_case_threads_guild_audit'
  | 'close_resolved_case_threads_administrator'
  | 'complete_setup_verification_provision'
  | 'complete_setup_verification_verification_modal'
  | 'ban_observed_detection_observed'
  | 'ban_observed_detection_report'
  | 'upsert_report_instructions_repair'
  | 'upsert_report_instructions_repost';
export type WorkflowId =
  | Exclude<
      HumanCommand['kind'],
      | 'open_admin_case'
      | 'repair_active_case'
      | 'close_resolved_case_threads'
      | 'complete_setup_verification'
      | 'ban_observed_detection'
      | 'upsert_report_instructions'
    >
  | SemanticWorkflowId;
export type WorkflowFamily =
  | 'cases'
  | 'detections'
  | 'operations'
  | 'reports'
  | 'setup'
  | 'cleanup'
  | 'quarantine'
  | 'captcha'
  | 'reportReview'
  | 'attention';
export type WorkflowConfirmationRule = 'shared_policy' | 'exact_settings_diff' | 'not_required';

/** These values come from connection-bound resource resolution, never public tool arguments. */
export interface WorkflowCommandBindings {
  readonly quarantine?: { readonly requestId: string };
  readonly intakePrompt?: {
    readonly threadId: string;
    readonly promptMessageId: string;
    readonly promptToken: string;
  };
  readonly cleanup?: { readonly jobId: string; readonly generation: string | null };
  readonly panel?: {
    readonly expectedMessageId: string | null;
    readonly expectedChannelId: string | null;
    readonly submissionId: string;
  };
}
/** Canonical fields used by family authority predicates; frozen by the workflow definition. */
export interface WorkflowAuthorityCommand {
  readonly kind: HumanCommand['kind'];
  readonly intent?: string;
}
export interface WorkflowDefinition {
  readonly id: WorkflowId;
  readonly commandKind: HumanCommand['kind'];
  readonly toolName: `drasil_${string}`;
  readonly family: WorkflowFamily;
  readonly scope: DelegatedScope;
  readonly authorityPolicy: string;
  readonly authorityCommand: WorkflowAuthorityCommand;
  readonly confirmationRule: WorkflowConfirmationRule;
  readonly delivery: 'direct' | 'queued';
  readonly resultContract: WorkflowFamily;
  readonly publicMethods: readonly string[];
  readonly inputSchema: z.AnyZodObject;
  readonly settingsFields: readonly string[];
  readonly parseCommand: (input: unknown, bindings?: WorkflowCommandBindings) => HumanCommand;
}

function objects(schema: z.ZodTypeAny): z.AnyZodObject[] {
  if (schema instanceof z.ZodObject) return [schema];
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion)
    return schema.options.flatMap(objects);
  throw new Error('Workflow schemas must contain canonical objects.');
}
const canonicalObjects = objects(humanCommandSchema);
interface Variant {
  readonly id?: SemanticWorkflowId;
  readonly fixed?: Readonly<Record<string, string | boolean>>;
  readonly authority?: string;
}
function identifier(kind: HumanCommand['kind'], variant: Variant): WorkflowId {
  if (variant.id) return variant.id;
  switch (kind) {
    case 'open_admin_case':
    case 'repair_active_case':
    case 'close_resolved_case_threads':
    case 'complete_setup_verification':
    case 'ban_observed_detection':
    case 'upsert_report_instructions':
      throw new Error(`Workflow requires an explicit semantic variant: ${kind}`);
    default:
      return kind;
  }
}
function define(
  family: WorkflowFamily,
  kind: HumanCommand['kind'],
  variant: Variant = {}
): WorkflowDefinition {
  const canonical = canonicalObjects.find((schema) => schema.shape.kind.value === kind);
  if (!canonical) throw new Error(`Missing canonical command schema: ${kind}`);
  const fixed = variant.fixed ?? {};
  // Provenance, interaction tokens and runtime-created jobs are not public options.
  let inputSchema = canonical
    .omit({
      kind: true,
      intent: true,
      origin: true,
      interactionContext: true,
      passUndefinedReason: true,
      submissionId: true,
      jobId: true,
      promptToken: true,
      promptMessageId: true,
      threadId: true,
      expectedMessageId: true,
      expectedChannelId: true,
      ...Object.fromEntries(Object.keys(fixed).map((key) => [key, true])),
    })
    .strict();
  if (kind === 'update_settings') {
    const [first, second, ...rest] = updateSettingsCommandSchema.options;
    inputSchema = z
      .object({
        patch: z.union([
          first.omit({ kind: true }),
          second.omit({ kind: true }),
          ...rest.map((schema: z.AnyZodObject) => schema.omit({ kind: true })),
        ]),
      })
      .strict();
  }
  if (kind === 'confirm_intake_candidate' || kind === 'reject_intake_candidates')
    inputSchema = inputSchema.extend({ intakePromptReference: id }).strict();
  if (family === 'cleanup')
    inputSchema = inputSchema
      .omit({ previewReference: true })
      // Initial preview admission creates the job; later actions resolve its opaque reference.
      .extend(kind === 'preview_case_message_deletion' ? {} : { cleanupReference: id })
      .strict();
  if (kind === 'quarantine_compromised_account')
    inputSchema = inputSchema.extend({ previewReference: id }).strict();
  if (kind === 'ban_observed_detection')
    inputSchema = inputSchema
      .omit({ subject: true })
      .extend(variant.id === 'ban_observed_detection_report' ? { reportId: id } : {})
      .strict();
  const scope = family === 'setup' ? 'drasil:configure' : 'drasil:moderate';
  const delivery =
    family === 'attention' ||
    kind === 'close_submitted_report' ||
    (family === 'setup' && kind === 'update_setup')
      ? 'direct'
      : 'queued';
  return {
    id: identifier(kind, variant),
    commandKind: kind,
    toolName: `drasil_${identifier(kind, variant)}`,
    family,
    scope,
    authorityPolicy: variant.authority ?? `${family}.${kind}`,
    authorityCommand: {
      kind,
      ...(typeof fixed.intent === 'string' ? { intent: fixed.intent } : {}),
    },
    confirmationRule: [
      'update_settings',
      'update_setup',
      'update_heuristics',
      'reset_heuristics',
      'lockdown_allow_add',
      'lockdown_allow_remove',
      'disable_lockdown',
      'complete_setup_verification',
    ].includes(kind)
      ? 'exact_settings_diff'
      : family === 'attention'
        ? 'not_required'
        : 'shared_policy',
    delivery,
    resultContract: family,
    inputSchema,
    publicMethods:
      family === 'attention'
        ? ['attention.acknowledge', 'attention.acknowledgeBatch']
        : family === 'reportReview'
          ? [kind === 'close_submitted_report' ? 'reportReview.close' : 'reportReview.openCase']
          : [
              `${family === 'cleanup' ? 'messageCleanup' : family}.${kind === 'preview_account_quarantine' ? 'preview' : 'execute'}`,
            ],
    settingsFields: kind === 'update_settings' ? Object.keys(setupChangesSchema.shape) : [],
    parseCommand(input, bindings = {}): HumanCommand {
      const options = inputSchema.parse(input);
      delete options.intakePromptReference;
      delete options.cleanupReference;
      if (kind === 'update_settings') return humanCommandSchema.parse({ kind, ...options.patch });
      if (kind === 'ban_observed_detection') {
        const { reportId, ...rest } = options;
        return humanCommandSchema.parse({
          ...rest,
          kind,
          subject:
            variant.id === 'ban_observed_detection_report'
              ? { kind: 'report', reportId }
              : { kind: 'observed' },
        });
      }
      if (kind === 'quarantine_compromised_account')
        return humanCommandSchema.parse({
          ...options,
          kind,
          previewReference: {
            kind: 'persisted_preview',
            requestId: bindings.quarantine?.requestId ?? options.previewReference,
          },
        });
      const resolved =
        family === 'cleanup'
          ? { jobId: bindings.cleanup?.jobId, previewReference: bindings.cleanup }
          : kind === 'confirm_intake_candidate'
            ? {
                threadId: bindings.intakePrompt?.threadId,
                promptMessageId: bindings.intakePrompt?.promptMessageId,
              }
            : kind === 'reject_intake_candidates'
              ? bindings.intakePrompt
              : variant.id === 'upsert_report_instructions_repost'
                ? bindings.panel
                : {};
      return humanCommandSchema.parse({ ...options, ...resolved, kind, ...fixed });
    },
  };
}

export const workflowDefinitions: readonly WorkflowDefinition[] = [
  define('cases', 'ban_user'),
  define('cases', 'kick_user'),
  define('cases', 'open_case_from_observed_detection'),
  define('cases', 'manual_flag_user'),
  define('cases', 'verify_case_user'),
  define('cases', 'close_case_no_action'),
  define('cases', 'kick_case_user'),
  define('cases', 'ban_case_user'),
  define('cases', 'ban_case_user_by_id'),
  define('cases', 'reopen_case'),
  define('cases', 'refresh_case_notification'),
  define('cases', 'sync_existing_ban'),
  define('detections', 'dismiss_observed_detection'),
  define('detections', 'mark_observed_detection_false_positive'),
  define('detections', 'undo_observed_detection_action'),
  define('detections', 'kick_observed_detection'),
  define('detections', 'ignore_detection_accounting'),
  define('detections', 'restore_detection_accounting'),
  define('detections', 'prepare_report_ban_review'),
  define('detections', 'review_uncertain_report_ban'),
  define('operations', 'sync_moderation_queue'),
  define('operations', 'clear_moderation_queue'),
  define('operations', 'audit_case_role_lockdown'),
  define('operations', 'apply_case_role_lockdown'),
  define('operations', 'intake_role_members'),
  define('operations', 'audit_integrity'),
  define('reports', 'submit_user_report'),
  define('reports', 'start_report_intake'),
  define('reports', 'close_report_intake'),
  define('reports', 'submit_message_report'),
  define('reports', 'confirm_intake_candidate'),
  define('reports', 'reject_intake_candidates'),
  define('setup', 'update_settings'),
  define('setup', 'clear_report_instructions'),
  define('setup', 'update_setup'),
  define('setup', 'update_heuristics'),
  define('setup', 'reset_heuristics'),
  define('setup', 'lockdown_allow_add'),
  define('setup', 'lockdown_allow_remove'),
  define('setup', 'disable_lockdown'),
  define('cleanup', 'preview_case_message_deletion'),
  define('cleanup', 'execute_case_message_deletion'),
  define('cleanup', 'ban_case_user_with_message_cleanup'),
  define('quarantine', 'preview_account_quarantine'),
  define('quarantine', 'quarantine_compromised_account'),
  define('captcha', 'request_captcha_challenge'),
  define('captcha', 'retry_captcha_challenge'),
  define('captcha', 'bypass_captcha_challenge'),
  define('cases', 'open_admin_case', {
    id: 'open_admin_case_moderator',
    fixed: { intent: 'native_case_open' },
    authority: 'cases.native_case_open',
  }),
  define('cases', 'open_admin_case', {
    id: 'open_admin_case_administrator',
    fixed: { intent: 'dashboard_case_open' },
    authority: 'cases.dashboard_case_open',
  }),
  define('cases', 'repair_active_case', {
    id: 'repair_active_case_moderator',
    fixed: { intent: 'moderator_repair' },
    authority: 'cases.moderator_repair',
  }),
  define('cases', 'repair_active_case', {
    id: 'repair_active_case_administrator',
    fixed: { intent: 'administrator_repair' },
    authority: 'cases.administrator_repair',
  }),
  define('operations', 'close_resolved_case_threads', {
    id: 'close_resolved_case_threads_guild_audit',
    fixed: { intent: 'guild_audit' },
    authority: 'operations.guild_audit',
  }),
  define('operations', 'close_resolved_case_threads', {
    id: 'close_resolved_case_threads_administrator',
    fixed: { intent: 'administrator_operation' },
    authority: 'operations.administrator',
  }),
  define('setup', 'complete_setup_verification', {
    id: 'complete_setup_verification_provision',
    fixed: { mode: 'provision' },
  }),
  define('setup', 'complete_setup_verification', {
    id: 'complete_setup_verification_verification_modal',
    fixed: { mode: 'verification_modal' },
  }),
  define('detections', 'ban_observed_detection', { id: 'ban_observed_detection_observed' }),
  define('detections', 'ban_observed_detection', { id: 'ban_observed_detection_report' }),
  define('setup', 'upsert_report_instructions', {
    id: 'upsert_report_instructions_repair',
    fixed: { repost: false },
  }),
  define('setup', 'upsert_report_instructions', {
    id: 'upsert_report_instructions_repost',
    fixed: { repost: true },
  }),
  define('reportReview', 'close_submitted_report'),
  define('reportReview', 'open_submitted_report_case'),
  define('attention', 'acknowledge_attention'),
];

export const internalWorkflowExclusions = [
  { kind: 'apply_captcha_pass', reason: 'System-only CAPTCHA completion.' },
  { kind: 'notify_captcha_attention', reason: 'System-only CAPTCHA lifecycle notification.' },
  { kind: 'reconcile_report_ban', reason: 'Internal enforcement-free recovery.' },
  { kind: 'automatic_detection', reason: 'Automatic policy workflow.' },
  { kind: 'lifecycle_bookkeeping', reason: 'Internal lifecycle persistence.' },
  {
    kind: 'global_watchlist_administration',
    reason: 'Global operator authority is outside guild grants.',
  },
  {
    kind: 'discord_passthrough',
    reason: 'General Discord administration is outside Drasil workflows.',
  },
] as const;
