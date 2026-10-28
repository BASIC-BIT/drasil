import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  workflowDefinitions,
  type WorkflowCommandBindings,
  type HumanCommand,
  type WorkflowFamily,
} from '../delegation/commands';
import type {
  DelegatedPrincipal,
  IntentResolver,
  IntentResolution,
  IntentPreconditions,
} from '../delegation/types';
import type { MessageCleanupJob } from '../messageCleanup/ports';
import { checkMessageCleanupBinding } from '../messageCleanup/actions';
import { canSubmitMessageCleanup } from '../messageCleanup/submission';
import { ActionDeniedError } from '../results';
import type { QueuedCommand } from '../requests/commands';

export interface ContainmentCase {
  readonly id: string;
  readonly guildId: string;
  readonly targetUserId: string | null;
  readonly status: string;
  readonly caseKind: string;
  readonly revision: number;
  readonly evidenceThreadId: string | null;
  readonly detectionEventId: string | null;
  readonly challenge: { readonly id: string; readonly generation: number } | null;
}
export type ResolvedPreview =
  | {
      readonly kind: 'cleanup';
      readonly guildId: string;
      readonly caseId: string;
      readonly targetUserId: string;
      readonly job: MessageCleanupJob;
      readonly detectionEventId: string | null;
      readonly expiresAt: null;
    }
  | {
      readonly kind: 'quarantine';
      readonly guildId: string;
      readonly caseId: string;
      readonly targetUserId: string;
      readonly requestId: string;
      readonly fingerprint: string;
      readonly expiresAt: Date;
      readonly plannedRoleIds: readonly string[];
      readonly retainedRoleIds: readonly string[];
      readonly canContain: boolean;
    };
export interface ContainmentResolutionResources {
  loadCase(guildId: string, caseId: string): Promise<ContainmentCase | null>;
  loadPolicy(guildId: string): Promise<{
    readonly captchaEnabled: boolean;
    readonly quarantineEnabled: boolean;
    readonly banEnabled: boolean;
  }>;
  /** Resolves an own completed delegated preparation; never consumes a native preview. */
  resolvePreviewReference(
    principal: DelegatedPrincipal,
    reference: string
  ): Promise<ResolvedPreview>;
}
export function createContainmentIntentResolver(
  resources: ContainmentResolutionResources
): IntentResolver {
  return {
    async resolve(principal, invocation, context): Promise<IntentResolution> {
      const definition = workflowDefinitions.find((d) => d.id === invocation.workflowId);
      if (
        !definition ||
        !['cleanup', 'quarantine', 'captcha', 'attention'].includes(definition.family)
      )
        throw new ActionDeniedError('unsupported_workflow');
      const options = definition.inputSchema.parse(invocation.input);
      if (definition.family === 'attention')
        return {
          delivery: { kind: 'direct' },
          preconditions: { kind: 'none' },
          relevantState: null,
          previewExpiresAt: null,
          summary: `Acknowledge attention items: ${JSON.stringify(options.itemIds)}. Each item is checked independently.`,
        };
      const targetUserId = z.string().parse(options.targetUserId);
      const state = await resources.loadCase(invocation.guildId, z.string().parse(options.caseId));
      if (
        !state ||
        state.id !== options.caseId ||
        state.guildId !== invocation.guildId ||
        state.targetUserId !== targetUserId ||
        state.status !== 'pending'
      )
        throw new ActionDeniedError('stale_state');
      const policy = await resources.loadPolicy(invocation.guildId);
      let bindings: WorkflowCommandBindings = {};
      let preconditions: IntentPreconditions = {
        kind: 'resource_revision',
        resource: { kind: 'case', id: state.id },
        revision: state.revision,
      };
      let preview: ResolvedPreview | undefined;
      if (definition.family === 'cleanup') {
        if (!z.string().parse(options.reason).trim())
          throw new ActionDeniedError('reason_required');
        if (!state.evidenceThreadId || options.detectionEventId !== state.detectionEventId)
          throw new ActionDeniedError('stale_state');
        if (definition.commandKind === 'preview_case_message_deletion') {
          const previous = context?.previous.preconditions;
          const jobId = previous?.kind === 'cleanup_job_provision' ? previous.jobId : randomUUID();
          bindings = { cleanup: { jobId, generation: null } };
          preconditions = {
            kind: 'cleanup_job_provision',
            jobId,
            caseId: state.id,
            targetUserId,
            revision: state.revision,
            evidenceThreadId: state.evidenceThreadId,
            detectionEventId: state.detectionEventId,
          };
        } else {
          preview = await resources.resolvePreviewReference(
            principal,
            z.string().parse(options.cleanupReference)
          );
          if (!matchesCleanupPreview(preview, state, options.detectionEventId, principal.userId))
            throw new ActionDeniedError('binding_mismatch');
          bindings = { cleanup: { jobId: preview.job.id, generation: preview.job.generation } };
          preconditions = {
            kind: 'cleanup_preview',
            jobId: preview.job.id,
            generation: preview.job.generation,
            expiresAt: null,
          };
        }
      }
      if (definition.commandKind === 'quarantine_compromised_account') {
        preview = await resources.resolvePreviewReference(
          principal,
          z.string().parse(options.previewReference)
        );
        if (!matchesQuarantinePreview(preview, state)) throw new ActionDeniedError('stale_state');
        bindings = { quarantine: { requestId: preview.requestId } };
        preconditions = {
          kind: 'quarantine_preview',
          requestId: preview.requestId,
          fingerprint: preview.fingerprint,
          expiresAt: preview.expiresAt,
        };
      }
      const command = definition.parseCommand(options, bindings);
      validateContainmentCommand(
        command,
        definition.family,
        state,
        policy,
        preview,
        principal,
        invocation.guildId
      );
      const summary = containmentSummary(command, state, preview);
      return {
        bindings,
        delivery: { kind: 'queued', command: command as QueuedCommand },
        preconditions,
        relevantState: {
          state,
          policy: relevantPolicy(definition.family, command, policy),
          preview,
        },
        summary,
        previewExpiresAt: preview?.expiresAt ?? null,
      };
    },
  };
}

type ContainmentPolicy = Awaited<ReturnType<ContainmentResolutionResources['loadPolicy']>>;
function validateContainmentCommand(
  command: HumanCommand,
  family: WorkflowFamily,
  state: ContainmentCase,
  policy: ContainmentPolicy,
  preview: ResolvedPreview | undefined,
  principal: DelegatedPrincipal,
  guildId: string
): void {
  if (family === 'captcha') {
    if (state.caseKind !== 'standard') throw new ActionDeniedError('stale_state');
    if (command.kind !== 'bypass_captcha_challenge' && !policy.captchaEnabled)
      throw new ActionDeniedError('policy_disabled');
    if (
      'expectedChallengeId' in command &&
      (command.expectedChallengeId !== state.challenge?.id ||
        command.expectedGeneration !== state.challenge.generation)
    )
      throw new ActionDeniedError('stale_state');
    if (command.kind === 'bypass_captcha_challenge' && !command.reason.trim())
      throw new ActionDeniedError('reason_required');
  }
  if (family === 'quarantine' && !policy.quarantineEnabled)
    throw new ActionDeniedError('policy_disabled');
  if (preview?.kind === 'cleanup' && 'jobId' in command) {
    const denial = checkMessageCleanupBinding(
      {
        guildId,
        requestId: 'preparation',
        source: 'mcp',
        actor: { kind: 'user', userId: principal.userId },
      },
      command,
      preview.job,
      state
    );
    if (denial) throw new ActionDeniedError(denial);
    if (!canSubmitMessageCleanup(preview.job)) throw new ActionDeniedError('stale_state');
    if (command.kind === 'ban_case_user_with_message_cleanup' && !policy.banEnabled)
      throw new ActionDeniedError('policy_disabled');
  }
}
const containmentSummary = (
  command: HumanCommand,
  state: ContainmentCase,
  preview: ResolvedPreview | undefined
): string => {
  const actionLabels: Record<string, string> = {
    request_captcha_challenge: 'Send browser security check',
    retry_captcha_challenge: 'Replace and resend browser security check',
    bypass_captcha_challenge: 'Bypass browser security check',
    preview_account_quarantine: 'Preview compromised-account quarantine',
    quarantine_compromised_account: 'Quarantine compromised account',
    preview_case_message_deletion: 'Preview message cleanup',
    execute_case_message_deletion: 'Delete previewed messages',
    ban_case_user_with_message_cleanup: 'Ban account and delete previewed messages',
  };
  const summary = [
    `${actionLabels[command.kind]} for account ${state.targetUserId} in case ${state.id}.`,
    ...('jobId' in command ? [`Scope: ${command.scope}; mode: ${command.mode}.`] : []),
    ...('expectedGeneration' in command
      ? [
          `Expected security check ${command.expectedChallengeId}, generation ${command.expectedGeneration}.`,
        ]
      : []),
    ...('reason' in command ? [`Reason: ${JSON.stringify(command.reason)}.`] : []),
    ...(preview?.kind === 'cleanup'
      ? [
          `Frozen preview: ${preview.job.candidateCount} candidates; coverage ${preview.job.coverage}.`,
        ]
      : []),
    ...(preview?.kind === 'quarantine'
      ? [
          `Planned role removals: ${JSON.stringify(preview.plannedRoleIds)}; retained roles: ${JSON.stringify(preview.retainedRoleIds)}; containment ready: ${preview.canContain}.`,
        ]
      : []),
  ].join('\n');
  return summary;
};
function relevantPolicy(
  family: WorkflowFamily,
  command: HumanCommand,
  policy: ContainmentPolicy
): { enabled: boolean } | null {
  return family === 'quarantine'
    ? { enabled: policy.quarantineEnabled }
    : family === 'captcha' && command.kind !== 'bypass_captcha_challenge'
      ? { enabled: policy.captchaEnabled }
      : command.kind === 'ban_case_user_with_message_cleanup'
        ? { enabled: policy.banEnabled }
        : null;
}

function matchesCleanupPreview(
  preview: ResolvedPreview,
  state: ContainmentCase,
  detectionEventId: unknown,
  userId: string
): preview is Extract<ResolvedPreview, { kind: 'cleanup' }> {
  return (
    preview.kind === 'cleanup' &&
    preview.guildId === state.guildId &&
    preview.caseId === state.id &&
    preview.targetUserId === state.targetUserId &&
    preview.detectionEventId === detectionEventId &&
    preview.job.requestedBy === userId
  );
}
function matchesQuarantinePreview(
  preview: ResolvedPreview,
  state: ContainmentCase
): preview is Extract<ResolvedPreview, { kind: 'quarantine' }> {
  return (
    preview.kind === 'quarantine' &&
    preview.guildId === state.guildId &&
    preview.caseId === state.id &&
    preview.targetUserId === state.targetUserId &&
    !(preview.expiresAt.getTime() <= Date.now())
  );
}
