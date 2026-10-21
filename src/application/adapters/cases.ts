import type { IRoleGateService } from '../../services/RoleGateService';
import {
  ActionDeniedError,
  readCasePolicy,
  createCaseActions,
  type ActionDenialCode,
  type CaseActions,
  type CaseDependencies,
  type CaseWorkflows,
  type CaseOutcome,
} from '@drasil/application';
import {
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type User,
  type Message,
} from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import type { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import type { ISecurityActionService } from '../../services/SecurityActionService';
import type { IUserModerationService } from '../../services/UserModerationService';
import { createBotAuthority } from './authority';

export interface BotCaseDependencies {
  readonly roleGateService: IRoleGateService | null;
  readonly client: Client;
  readonly configService: IConfigService;
  readonly verificationEventRepository: IVerificationEventRepository;
  readonly detectionEventsRepository: IDetectionEventsRepository;
  readonly securityActionService: ISecurityActionService;
  readonly userModerationService: IUserModerationService;
  readonly confirmations: CaseDependencies['confirmations'];
}
export function createBotCaseActions(deps: BotCaseDependencies): CaseActions {
  return createCaseActions(createBotCaseDependencies(deps));
}
export function createBotCaseDependencies(deps: BotCaseDependencies): CaseDependencies {
  const guild = (guildId: string): Promise<Guild> => deps.client.guilds.fetch(guildId);
  const member = async (guildId: string, userId: string): Promise<GuildMember> =>
    (await guild(guildId)).members.fetch(userId);
  const moderator = (userId: string): Promise<User> => deps.client.users.fetch(userId);
  const enforcePermission = async (
    guildId: string,
    permission: bigint,
    label: string
  ): Promise<void> => {
    const target = await guild(guildId);
    const bot = await target.members.fetchMe({ force: true });
    if (!bot.permissions.has(permission))
      throw new Error(`Drasil is missing ${label} permission in this guild.`);
  };
  const fetchMessage = async (
    channelId: string,
    messageId: string
  ): Promise<Message | undefined> => {
    const channel = await deps.client.channels.fetch(channelId).catch(() => null);
    return channel && 'messages' in channel
      ? ((await channel.messages.fetch(messageId).catch(() => null)) ?? undefined)
      : undefined;
  };
  const roleGate = deps.roleGateService;
  return {
    roleGate: roleGate
      ? {
          async preview(input): ReturnType<NonNullable<CaseDependencies['roleGate']>['preview']> {
            return roleGate.previewResolution(await member(input.guildId, input.targetUserId));
          },
          async apply(
            input,
            action,
            preview
          ): ReturnType<NonNullable<CaseDependencies['roleGate']>['apply']> {
            return roleGate.applyResolution(
              await member(input.guildId, input.targetUserId),
              await moderator(input.actorId),
              action,
              preview
            );
          },
        }
      : null,
    authority: createBotAuthority(deps.client),
    repository: {
      async findSourceMessage(
        channelId,
        messageId
      ): ReturnType<CaseDependencies['repository']['findSourceMessage']> {
        const message = await fetchMessage(channelId, messageId);
        return message ? { guildId: message.guildId, userId: message.author.id } : null;
      },
      findById: (id) => deps.verificationEventRepository.findById(id),
      findActive: (guildId, userId) =>
        deps.verificationEventRepository.findActiveByUserAndServer(userId, guildId),
      async findDetection(id): ReturnType<CaseDependencies['repository']['findDetection']> {
        const detection = await deps.detectionEventsRepository.findById(id);
        if (!detection) return null;
        const metadata = detection.metadata;
        const reportId =
          metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata) &&
          'reportIntakeId' in metadata &&
          typeof metadata.reportIntakeId === 'string'
            ? metadata.reportIntakeId
            : null;
        return { server_id: detection.server_id, user_id: detection.user_id, reportId };
      },
    },
    settings: {
      async loadFresh(guildId): ReturnType<CaseDependencies['settings']['loadFresh']> {
        const config = await deps.configService.getServerConfig(guildId, {
          forceRefresh: true,
          failOnReadError: true,
        });
        return readCasePolicy(config.settings);
      },
    },
    confirmations: deps.confirmations,
    workflows: {
      async openAdmin(input): ReturnType<CaseWorkflows['openAdmin']> {
        const sourceMessage = input.source
          ? await fetchMessage(input.source.source_channel_id, input.source.source_message_id)
          : undefined;
        const result = await deps.securityActionService.openAdminCase(
          await member(input.guildId, input.targetUserId),
          await moderator(input.actorId),
          {
            action: 'open_case',
            reason: input.reason,
            ...(input.sourceSurface === 'web' || input.source
              ? {
                  metadata: {
                    ...(input.sourceSurface === 'web'
                      ? { requested_surface: input.sourceSurface, web_action: 'open_admin_case' }
                      : {}),
                    ...input.source,
                  },
                }
              : {}),
            ...(sourceMessage ? { sourceMessage } : {}),
          }
        );
        return { ...result, sourceMessageFetched: Boolean(sourceMessage) };
      },
      async openObserved(input): ReturnType<CaseWorkflows['openObserved']> {
        return deps.securityActionService.openObservedDetectionCase(
          await member(input.guildId, input.targetUserId),
          input.detectionEventId,
          await moderator(input.actorId)
        );
      },
      async manualFlag(input): ReturnType<CaseWorkflows['manualFlag']> {
        return deps.securityActionService.handleManualFlag(
          await member(input.guildId, input.targetUserId),
          await moderator(input.actorId),
          input.reason
        );
      },
      async verify(input): ReturnType<CaseWorkflows['verify']> {
        return deps.userModerationService.verifyUser(
          await member(input.guildId, input.targetUserId),
          await moderator(input.actorId)
        );
      },
      async closeNoAction(input): ReturnType<CaseWorkflows['closeNoAction']> {
        return deps.userModerationService.closeCaseNoAction(
          await guild(input.guildId),
          input.targetUserId,
          await moderator(input.actorId),
          input.sourceSurface === 'web'
            ? 'Closed with no action from the web moderation workbench.'
            : 'Closed with no action by moderator.'
        );
      },
      async kick(input): ReturnType<CaseWorkflows['kick']> {
        await enforcePermission(input.guildId, PermissionFlagsBits.KickMembers, 'Kick Members');
        const target = input.caseId
          ? await member(input.guildId, input.targetUserId)
          : await member(input.guildId, input.targetUserId).catch(() => null);
        if (!target) return false;
        return deps.userModerationService.kickUser(
          target,
          input.reason,
          await moderator(input.actorId),
          ...(input.detectionEventId || input.sourceSurface === 'web'
            ? [input.detectionEventId]
            : [])
        );
      },
      async ban(input): ReturnType<CaseWorkflows['ban']> {
        await enforcePermission(input.guildId, PermissionFlagsBits.BanMembers, 'Ban Members');
        const target = input.caseId
          ? await member(input.guildId, input.targetUserId)
          : await member(input.guildId, input.targetUserId).catch(() => null);
        if (!target) {
          return deps.userModerationService.banUserById(
            await guild(input.guildId),
            input.targetUserId,
            input.reason,
            await moderator(input.actorId)
          );
        }
        return deps.userModerationService.banUser(
          target,
          input.reason,
          await moderator(input.actorId),
          ...(input.detectionEventId || input.sourceSurface === 'web'
            ? [input.detectionEventId]
            : [])
        );
      },
      async banById(input): ReturnType<CaseWorkflows['banById']> {
        await enforcePermission(input.guildId, PermissionFlagsBits.BanMembers, 'Ban Members');
        return deps.userModerationService.banUserById(
          await guild(input.guildId),
          input.targetUserId,
          input.reason,
          await moderator(input.actorId),
          ...(input.detectionEventId || input.sourceSurface === 'web'
            ? [input.detectionEventId]
            : [])
        );
      },
      async repair(input): ReturnType<CaseWorkflows['repair']> {
        return deps.securityActionService.repairActiveCase(
          await member(input.guildId, input.targetUserId)
        );
      },
      async reopen(input): ReturnType<CaseWorkflows['reopen']> {
        const state = await deps.verificationEventRepository.findById(input.caseId);
        if (!state) throw new Error('Case no longer exists.');
        return deps.securityActionService.reopenVerification(state, await moderator(input.actorId));
      },
      async refresh(input): ReturnType<CaseWorkflows['refresh']> {
        return deps.securityActionService.refreshCaseNotification(
          input.guildId,
          await moderator(input.targetUserId),
          input.caseId
        );
      },
      async syncExistingBan(input): ReturnType<CaseWorkflows['syncExistingBan']> {
        return deps.userModerationService.syncAlreadyBannedUser(
          await guild(input.guildId),
          input.targetUserId,
          await moderator(input.actorId)
        );
      },
    },
  };
}
export class CaseActionDeniedError extends ActionDeniedError {
  public constructor(public readonly code: ActionDenialCode) {
    super(code, `Case action denied: ${code}`);
    this.name = 'CaseActionDeniedError';
  }
}
export function requireCaseOutcome(
  result: Awaited<ReturnType<CaseActions['execute']>>
): CaseOutcome {
  if (result.kind === 'denied') throw new CaseActionDeniedError(result.code);
  return result.outcome;
}
