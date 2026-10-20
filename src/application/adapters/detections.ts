import { randomUUID } from 'node:crypto';
import { PermissionFlagsBits, type Guild, type User } from 'discord.js';
import {
  createDetectionActions,
  type AuthorityPort,
  type DetectionActions,
  type DetectionDependencies,
  type DetectionOutcome,
  type DetectionOperation,
} from '@drasil/application';
import type { BotCaseDependencies } from './cases';
import { createBotAuthority } from './attention';
import {
  getReportBanAttemptToken,
  type IModerationActionRequestRepository,
} from '../../repositories/ModerationActionRequestRepository';
import { AdminActionType, type ModerationActionRequest } from '../../repositories/types';
import type { ReportBanReviewReference } from '../../services/SecurityActionService';
import { getDetectionResponseSettings } from '../../utils/detectionResponseSettings';
import { DISCORD_UNKNOWN_MEMBER_ERROR_CODE, isDiscordErrorCode } from '../../utils/discordErrors';
export interface BotDetectionDependencies extends Pick<
  BotCaseDependencies,
  | 'client'
  | 'configService'
  | 'securityActionService'
  | 'detectionEventsRepository'
  | 'confirmations'
> {
  readonly actionRequests: IModerationActionRequestRepository;
}
export interface BotDetectionRuntime {
  readonly actions: DetectionActions;
  forRequest(request: ModerationActionRequest): DetectionActions;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function continuation(request: ModerationActionRequest): DetectionOperation['continuation'] {
  const meta = record(request.metadata);
  if (meta.report_ban_phase === 'preparing') return 'preparing';
  if (meta.report_ban_phase === 'discord_confirmed' || meta.report_ban_confirmed_at)
    return 'confirmed';
  if (
    meta.report_ban_phase === 'enforcement_started' ||
    meta.report_ban_phase === 'reconciliation_required'
  )
    return 'uncertain';
  const status = record(record(request.result).observed_ban_result).status;
  if (status === 'ban_outcome_unknown') return 'uncertain';
  if (status === 'banned_updates_pending') return 'confirmed';
  return status === 'banned' ? 'completed' : 'fresh';
}
export function createBotDetectionRuntime(
  deps: BotDetectionDependencies,
  authority: AuthorityPort = createBotAuthority(deps.client)
): BotDetectionRuntime {
  const reviews = new Map<
    string,
    { reference: ReportBanReviewReference; guildId: string; actorId: string; expires: number }
  >();
  const guild = (id: string): Promise<Guild> => deps.client.guilds.fetch(id);
  const actor = (id: string): Promise<User> => deps.client.users.fetch(id);
  const capability = async (guildId: string, permission: bigint, label: string): Promise<void> => {
    if (
      !(await (await guild(guildId)).members.fetchMe({ force: true })).permissions.has(permission)
    )
      throw new Error(`Drasil is missing ${label} permission in this guild.`);
  };
  const create = (envelope: ModerationActionRequest | null): DetectionActions => {
    const ownedRequest = async (id: string): Promise<ModerationActionRequest> => {
      const persisted = await deps.actionRequests.findById(id);
      if (
        !envelope ||
        !persisted ||
        envelope.id !== id ||
        !getReportBanAttemptToken(envelope) ||
        getReportBanAttemptToken(envelope) !== getReportBanAttemptToken(persisted)
      )
        throw new Error('Report ban operation ownership changed.');
      return persisted;
    };
    const dependencies: DetectionDependencies = {
      authority,
      confirmations: deps.confirmations,
      settings: {
        async loadFresh(guildId) {
          const config = await deps.configService.getServerConfig(guildId, {
            forceRefresh: true,
            failOnReadError: true,
          });
          const s = getDetectionResponseSettings(config.settings);
          return {
            banEnabled: s.moderatorBanActionEnabled,
            kickEnabled: s.observedActionKickEnabled,
            banRequiresReason: s.moderatorBanActionRequiresReason,
            kickRequiresReason: s.moderatorKickActionRequiresReason,
          };
        },
      },
      repository: {
        async findDetection(id) {
          const d = await deps.detectionEventsRepository.findById(id);
          if (!d || !d.server_id) return null;
          const reportId = record(d.metadata).reportIntakeId;
          return {
            guildId: d.server_id,
            targetUserId: d.user_id,
            reportId: typeof reportId === 'string' ? reportId : null,
          };
        },
        async findOperation(id) {
          const r = await deps.actionRequests.findById(id);
          if (
            !r ||
            r.action_type !== 'ban_observed_detection' ||
            !r.target_user_id ||
            !r.detection_event_id
          )
            return null;
          return {
            id: r.id,
            guildId: r.server_id,
            targetUserId: r.target_user_id,
            detectionEventId: r.detection_event_id,
            reportId: r.report_intake_id,
            actorId: r.actor_id,
            source: r.actor_surface,
            continuation: continuation(r),
            owned:
              envelope?.id === id &&
              Boolean(getReportBanAttemptToken(envelope)) &&
              getReportBanAttemptToken(envelope) === getReportBanAttemptToken(r),
          };
        },
      },
      workflows: {
        async dismiss(input, action) {
          return deps.securityActionService.dismissObservedDetection(
            input.guildId,
            input.targetUserId,
            input.detectionEventId,
            await actor(input.actorId),
            action === 'dismiss' ? AdminActionType.DISMISS : AdminActionType.FALSE_POSITIVE
          );
        },
        async undo(input) {
          return deps.securityActionService.undoObservedDetectionAction(
            input.guildId,
            input.targetUserId,
            input.detectionEventId,
            await actor(input.actorId)
          );
        },
        async changeAccounting(input, excluded, reason) {
          const moderator = await actor(input.actorId);
          return Boolean(
            await (excluded
              ? deps.securityActionService.excludeDetectionFromAccounting(
                  input.guildId,
                  input.detectionEventId,
                  moderator,
                  reason ?? undefined
                )
              : deps.securityActionService.restoreDetectionAccounting(
                  input.guildId,
                  input.detectionEventId,
                  moderator,
                  reason ?? undefined
                ))
          );
        },
        async kick(input, reason) {
          await capability(input.guildId, PermissionFlagsBits.KickMembers, 'Kick Members');
          return deps.securityActionService.kickObservedDetection(
            await (await guild(input.guildId)).members.fetch(input.targetUserId),
            input.detectionEventId,
            await actor(input.actorId),
            reason
          );
        },
        async ban(input, reason) {
          const request = await ownedRequest(input.operationId);
          await capability(input.guildId, PermissionFlagsBits.BanMembers, 'Ban Members');
          const targetGuild = await guild(input.guildId);
          const moderator = await actor(input.actorId);
          const member = await targetGuild.members.fetch(input.targetUserId).catch((error) => {
            if (isDiscordErrorCode(error, DISCORD_UNKNOWN_MEMBER_ERROR_CODE)) return null;
            throw error;
          });
          const result = member
            ? await deps.securityActionService.banObservedDetection(
                member,
                input.detectionEventId,
                moderator,
                reason,
                request
              )
            : await deps.securityActionService.banObservedDetectionById(
                targetGuild,
                input.targetUserId,
                input.detectionEventId,
                moderator,
                reason,
                request
              );
          return { result, banById: !member };
        },
        async reconcile(input) {
          return deps.securityActionService.reconcileReportBan(
            await ownedRequest(input.operationId)
          );
        },
        async prepareReview(input) {
          const reference = await deps.securityActionService.prepareReportBanReview(
            await guild(input.guildId),
            input.operationId,
            await actor(input.actorId)
          );
          const reviewReference = randomUUID();
          for (const [key, value] of reviews) if (value.expires <= Date.now()) reviews.delete(key);
          reviews.set(reviewReference, {
            reference,
            guildId: input.guildId,
            actorId: input.actorId,
            expires: Date.now() + 10 * 60 * 1000,
          });
          return {
            operationId: reference.operationId,
            targetUserId: reference.targetUserId,
            reviewReference,
          };
        },
        async review(input) {
          const pending = reviews.get(input.reference.reviewReference);
          reviews.delete(input.reference.reviewReference);
          if (
            !pending ||
            pending.expires <= Date.now() ||
            pending.guildId !== input.guildId ||
            pending.actorId !== input.actorId ||
            pending.reference.operationId !== input.reference.operationId ||
            pending.reference.targetUserId !== input.reference.targetUserId
          )
            throw new Error('The review confirmation expired or changed.');
          await deps.securityActionService.reviewUncertainReportBan(
            await guild(input.guildId),
            pending.reference,
            await actor(input.actorId),
            input.reason
          );
        },
      },
    };
    return createDetectionActions(dependencies);
  };
  return { actions: create(null), forRequest: create };
}
export function requireDetectionOutcome(
  result: Awaited<ReturnType<DetectionActions['execute']>>
): DetectionOutcome {
  if (result.kind === 'denied') throw new Error(`Detection action denied: ${result.code}`);
  return result.outcome;
}
