import { PermissionFlagsBits, type Client } from 'discord.js';
import {
  createMessageCleanupActions,
  isQueuedMessageCleanupCommand,
  decodeQueuedAction,
  type ActionContext,
  type ActionResult,
  type DecodedQueuedAction,
  type MessageCleanupActions,
  type MessageCleanupCommand,
  type MessageCleanupJob,
  type MessageCleanupDependencies,
} from '@drasil/application';
import type { IConfigService } from '../../config/ConfigService';
import type { IMessageDeletionJobRepository } from '../../repositories/MessageDeletionJobRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import {
  MessageDeletionBanStatus,
  MessageDeletionCaseFinalizationStatus,
  type MessageDeletionJob,
  type ModerationActionRequest,
} from '../../repositories/types';
import type { MessageCleanupService } from '../../services/MessageCleanupService';
import type { ICombinedBanLifecycleService } from '../../services/UserModerationService';
import { createBotAuthority } from './attention';
import { createCaseConfirmationStore } from '../context';
import { getDetectionResponseSettings } from '../../utils/detectionResponseSettings';

export interface BotMessageCleanupDependencies {
  readonly client: Client;
  readonly configService: IConfigService;
  readonly messageDeletionJobs: IMessageDeletionJobRepository;
  readonly messageCleanupService: Pick<MessageCleanupService, 'previewJob' | 'executeJob'>;
  readonly verificationEventRepository: IVerificationEventRepository;
  readonly userModerationService: ICombinedBanLifecycleService;
}
export interface BotMessageCleanupRuntime {
  decodeRequest(request: ModerationActionRequest): Promise<DecodedQueuedAction>;
  forRequest(request: ModerationActionRequest): MessageCleanupActions;
  afterComplete(request: ModerationActionRequest): Promise<void>;
}
export function projectMessageCleanupJob(job: MessageDeletionJob): MessageCleanupJob {
  return {
    id: job.id,
    guildId: job.server_id,
    caseId: job.verification_event_id,
    targetUserId: job.user_id,
    requestedBy: job.requested_by,
    source: job.actor_surface,
    mode: job.mode,
    scope: job.scope,
    reason: job.reason,
    evidenceThreadId: job.evidence_thread_id,
    generation: job.previewed_at?.toISOString() ?? null,
    status: job.status,
    coverage: job.coverage,
    candidateCount: job.candidate_count,
    banStatus: job.ban_status,
    caseFinalizationStatus: job.case_finalization_status,
  };
}
function matchesRequest(
  request: ModerationActionRequest,
  context: ActionContext,
  command: MessageCleanupCommand
): boolean {
  return (
    context.actor.kind === 'user' &&
    request.id === context.requestId &&
    request.server_id === context.guildId &&
    request.actor_id === context.actor.userId &&
    request.actor_surface === context.source &&
    request.action_type === command.kind &&
    request.target_user_id === command.targetUserId &&
    request.verification_event_id === command.caseId &&
    request.message_deletion_job_id === command.jobId
  );
}
export function createBotMessageCleanupRuntime(
  deps: BotMessageCleanupDependencies
): BotMessageCleanupRuntime {
  async function assertBotPermissions(
    guildId: string,
    requirements: { ban: boolean; deleteMessages: boolean }
  ): Promise<void> {
    const guild = await deps.client.guilds.fetch(guildId);
    const member = await guild.members.fetchMe({ force: true });
    if (requirements.ban && !member.permissions.has(PermissionFlagsBits.BanMembers))
      throw new Error('Drasil is missing Ban Members permission in this guild.');
    if (requirements.deleteMessages && !member.permissions.has(PermissionFlagsBits.ManageMessages))
      throw new Error('Drasil is missing Manage Messages permission in this guild.');
  }
  const runtime: BotMessageCleanupRuntime = {
    async decodeRequest(request) {
      const job = request.message_deletion_job_id
        ? await deps.messageDeletionJobs.findById(request.message_deletion_job_id)
        : null;
      if (!job) throw new Error('Message cleanup job was not found.');
      // Shipped rows contain only cleanup_mode/scope. Bind their missing snapshot at
      // the trusted persisted-row boundary; new submissions always save all fields.
      const metadata =
        request.metadata && typeof request.metadata === 'object' && !Array.isArray(request.metadata)
          ? request.metadata
          : {};
      return decodeQueuedAction({
        ...request,
        metadata: {
          cleanup_mode: job.mode,
          cleanup_scope: job.scope,
          reason: job.reason,
          cleanup_preview_generation: job.previewed_at?.toISOString() ?? null,
          ...metadata,
        },
      });
    },
    forRequest(request) {
      const confirmationStore = createCaseConfirmationStore();
      const ports: MessageCleanupDependencies = {
        authority: createBotAuthority(deps.client),
        confirmations: confirmationStore.confirmations,
        settings: {
          async loadFresh(guildId) {
            const config = await deps.configService.getServerConfig(guildId, {
              forceRefresh: true,
              failOnReadError: true,
            });
            return {
              moderatorBanActionEnabled: getDetectionResponseSettings(config.settings)
                .moderatorBanActionEnabled,
            };
          },
        },
        cases: {
          async find(caseId) {
            const state = await deps.verificationEventRepository.findById(caseId);
            return state
              ? {
                  id: state.id,
                  guildId: state.server_id,
                  targetUserId: state.user_id,
                  status: state.status,
                  evidenceThreadId: state.private_evidence_thread_id,
                }
              : null;
          },
        },
        jobs: {
          async find(jobId) {
            const job = await deps.messageDeletionJobs.findById(jobId);
            return job ? projectMessageCleanupJob(job) : null;
          },
          async fail(jobId, message) {
            await deps.messageDeletionJobs.fail(jobId, message);
          },
          async setBanStatus(jobId, status) {
            await deps.messageDeletionJobs.updateBanStatus(
              jobId,
              MessageDeletionBanStatus[
                status.toUpperCase() as keyof typeof MessageDeletionBanStatus
              ]
            );
          },
          async setFinalizationStatus(jobId, status) {
            await deps.messageDeletionJobs.updateCaseFinalizationStatus(
              jobId,
              MessageDeletionCaseFinalizationStatus[
                status.toUpperCase() as keyof typeof MessageDeletionCaseFinalizationStatus
              ]
            );
          },
        },
        recovery: {
          async resolveCommitted(context, command) {
            if (!matchesRequest(request, context, command)) return null;
            const job = await deps.messageDeletionJobs.findById(command.jobId);
            const metadata = job?.metadata;
            if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
            const stored = metadata.combined_operation;
            if (stored === undefined) return { kind: 'legacy_unowned', context };
            const operation = stored;
            if (
              !operation ||
              typeof operation !== 'object' ||
              Array.isArray(operation) ||
              typeof operation.requestId !== 'string' ||
              typeof operation.actorId !== 'string' ||
              typeof operation.source !== 'string'
            )
              return null;
            return {
              kind: 'recorded_operation',
              context: {
                guildId: context.guildId,
                requestId: operation.requestId,
                source: operation.source,
                actor: { kind: 'user', userId: operation.actorId },
              },
            };
          },
        },
        workflows: {
          async preview(jobId) {
            return projectMessageCleanupJob(await deps.messageCleanupService.previewJob(jobId));
          },
          cleanup: (jobId) => deps.messageCleanupService.executeJob(jobId),
          assertBotPermissions,
          async markPending(caseId, jobId) {
            await deps.messageDeletionJobs.recordCombinedOperation(jobId, {
              requestId: request.id,
              actorId: request.actor_id,
              source: request.actor_surface,
            });
            await deps.userModerationService.markCombinedBanCleanupPending(caseId, jobId);
          },
          async clearMarker(caseId, jobId) {
            await deps.userModerationService.clearCombinedBanCleanupMarker(caseId, jobId);
          },
          async ban(context, command) {
            await deps.userModerationService.performDiscordBanById(
              await deps.client.guilds.fetch(context.guildId),
              command.targetUserId,
              command.reason
            );
          },
          async finalize(context, command) {
            if (context.actor.kind !== 'user')
              throw new Error('Cleanup finalization requires its initiating actor.');
            await deps.userModerationService.finalizeSuccessfulCombinedBan(
              await deps.client.guilds.fetch(context.guildId),
              command.targetUserId,
              command.caseId,
              command.jobId,
              command.reason,
              await deps.client.users.fetch(context.actor.userId),
              command.detectionEventId ?? undefined
            );
          },
        },
      };
      const actions = createMessageCleanupActions(ports);
      return {
        async execute(context, command): ReturnType<MessageCleanupActions['execute']> {
          if (!matchesRequest(request, context, command))
            return { kind: 'denied', code: 'binding_mismatch' };
          const bound = (await runtime.decodeRequest(request)).command;
          if (
            !isQueuedMessageCleanupCommand(bound) ||
            bound.mode !== command.mode ||
            bound.scope !== command.scope ||
            bound.reason !== command.reason ||
            bound.previewReference.generation !== command.previewReference.generation ||
            bound.detectionEventId !== command.detectionEventId
          )
            return { kind: 'denied', code: 'binding_mismatch' };
          confirmationStore.recordVerified(context, command);
          return actions.execute(context, command);
        },
      };
    },
    async afterComplete(request) {
      if (
        request.action_type !== 'ban_case_user_with_message_cleanup' ||
        !request.verification_event_id ||
        !request.message_deletion_job_id
      )
        return;
      try {
        await deps.userModerationService.clearCombinedBanCleanupMarker(
          request.verification_event_id,
          request.message_deletion_job_id
        );
      } catch (error) {
        console.warn(
          `Failed to clear completed cleanup marker for job ${request.message_deletion_job_id}:`,
          error
        );
      }
    },
  };
  return runtime;
}
export function requireMessageCleanupOutcome<T>(result: ActionResult<T>): T {
  if (result.kind === 'outcome') return result.outcome;
  const messages = {
    permission_denied: 'Message cleanup requires current Administrator permission.',
    actor_unavailable: 'Message cleanup requires current Administrator permission.',
    policy_disabled: 'Moderator ban action is disabled for this server.',
    reason_required: 'Message cleanup requires a reason.',
    confirmation_required: 'Confirm the moderation action before queueing it.',
    binding_mismatch: 'Message cleanup job does not match the queued request.',
    stale_state: 'The cleanup preview changed. Refresh the case before continuing.',
  };
  throw new Error(messages[result.code]);
}
