import { createApprovedSetupConfiguration, type ApprovedSetupConfiguration } from './approvedSetup';
import {
  CaseRoleLockdownService,
  type ICaseRoleLockdownService,
} from '../../services/CaseRoleLockdownService';
import {
  ActionDeniedError,
  type ExecutionRecord,
  createOperationsActions,
  type ActionResult,
  type AuthorityPort,
  type ConfirmationPort,
  type OperationsActions,
  type OperationsOutcome,
  type RoleIntakeProgress,
} from '@drasil/application';
import type { Client } from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import type { IModerationQueueService } from '../../services/ModerationQueueService';
import type { ICaseThreadClosureSweepService } from '../../services/CaseThreadClosureSweepService';
import type { IIntegrityAuditService } from '../../services/IntegrityAuditService';
import type { ISecurityActionService } from '../../services/SecurityActionService';
import { getDetectionResponseSettings } from '../../utils/detectionResponseSettings';
import { createBotAuthority } from './authority';
export interface BotOperationsDependencies {
  readonly client: Client;
  readonly configService: IConfigService;
  readonly queueService: IModerationQueueService;
  readonly securityActionService: ISecurityActionService;
  readonly caseThreadClosureSweepService: ICaseThreadClosureSweepService;
  readonly caseRoleLockdownService: ICaseRoleLockdownService;
  readonly integrityAuditService: IIntegrityAuditService;
}
export interface BotOperationsRuntime {
  readonly actions: OperationsActions;
  forExecution(execution: ExecutionRecord): OperationsActions;
  withProgress(onProgress: (progress: RoleIntakeProgress) => Promise<void>): OperationsActions;
}
export function createBotOperationsRuntime(
  deps: BotOperationsDependencies & { readonly confirmations: ConfirmationPort },
  authority: AuthorityPort = createBotAuthority(deps.client)
): BotOperationsRuntime {
  const create = (
    onProgress?: (progress: RoleIntakeProgress) => Promise<void>,
    approved?: ApprovedSetupConfiguration
  ): OperationsActions =>
    createOperationsActions({
      authority,
      confirmations: deps.confirmations,
      policy: {
        async loadFresh(guildId) {
          const config = approved
            ? await approved.read(guildId)
            : await deps.configService.getServerConfig(guildId, {
                forceRefresh: true,
                failOnReadError: true,
              });
          return {
            intakeReasonRequired: getDetectionResponseSettings(config.settings)
              .adminCaseOpenRequiresReason,
          };
        },
      },
      queue: {
        async sync(guildId) {
          await deps.queueService.syncServerQueue(guildId);
        },
        clear: (guildId) => deps.queueService.clearServerQueue(guildId),
      },
      closure: {
        sweep: (input) =>
          deps.caseThreadClosureSweepService.sweepResolvedCaseThreads({
            serverId: input.guildId,
            days: input.days,
            limit: input.limit,
            execute: input.execute,
            ...(input.userId ? { userId: input.userId } : {}),
          }),
      },
      lockdown: {
        async audit(guildId) {
          return deps.caseRoleLockdownService.auditGuild(await deps.client.guilds.fetch(guildId));
        },
        async apply(input) {
          approved?.startEffects();
          return (
            approved ? new CaseRoleLockdownService(approved.config) : deps.caseRoleLockdownService
          ).applyGuild(await deps.client.guilds.fetch(input.guildId), input.actorId, {
            unsyncAllowedChannels: input.unsyncAllowedChannels,
          });
        },
      },
      integrity: {
        async audit(input) {
          return deps.integrityAuditService.auditGuild(
            await deps.client.guilds.fetch(input.guildId),
            {
              scope: input.scope,
              days: input.days,
              limit: input.limit,
              userId: input.userId ?? undefined,
            }
          );
        },
      },
      intake: {
        async run(input) {
          const guild = await deps.client.guilds.fetch(input.guildId);
          const role = await guild.roles.fetch(input.roleId);
          if (!role || role.guild.id !== input.guildId)
            throw new Error('Role-intake role was not found in this server.');
          const moderator = await deps.client.users.fetch(input.actorId);
          return deps.securityActionService.intakeRoleMembers({
            role,
            moderator,
            reason: input.reason?.trim() || undefined,
            action: 'open_case',
            execute: input.execute,
            limit: input.limit,
            onProgress,
          });
        },
      },
    });
  return {
    actions: create(),
    withProgress: create,
    forExecution(execution): OperationsActions {
      if (execution.preconditions.kind !== 'setup')
        throw new ActionDeniedError('setup_preconditions_required');
      return create(
        undefined,
        createApprovedSetupConfiguration(deps.configService, execution.preconditions)
      );
    },
  };
}
export function requireOperationsOutcome(
  result: ActionResult<OperationsOutcome>
): OperationsOutcome {
  if (result.kind === 'denied')
    throw new ActionDeniedError(
      result.code,
      result.code === 'reason_required'
        ? 'Role intake execution requires a case reason.'
        : `Operation denied: ${result.code}`
    );
  return result.outcome;
}
