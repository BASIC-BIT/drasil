import {
  isBotCaptchaMethodConfigured,
  botCaptchaReadiness,
} from '../../services/captcha/readiness';
import {
  createApprovedSetupConfiguration,
  type ApprovedSetupConfiguration,
  type SetupWorkflowConfig,
} from './approvedSetup';
import {
  ActionDeniedError,
  setupStoredChange,
  setupResourceReferences,
  validateSetupResourceReferences,
  canonicalDigest,
  selectSetupProvisioning,
  parseSetupStoredRecord,
  type SetupProvisioningSelection,
  type ExecutionRecord,
  createSetupActions,
  setupCommandSchema,
  decodeQueuedAction,
  serverSettingsSchema,
  setupConfirmationCommand,
  type ActionContext,
  type ActionResult,
  type SetupActions,
  type SetupCommand,
  type SetupDependencies,
  type SetupOutcome,
  type AuthorityPort,
  type SetupConfigurationState,
  type SetupPersistenceChange,
  type SetupProvisioningOutcome,
  type SetupHeuristics,
  type AuthorityFacts,
} from '@drasil/application';
import { ChannelType, type Client, type TextChannel, type Guild, type Role } from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import { globalConfig } from '../../config/GlobalConfig';
import type {
  INotificationManager,
  BoundVerificationSetup,
} from '../../services/NotificationManager';
import type { IProductAnalyticsService } from '../../services/ProductAnalyticsService';
import type { ISetupDiagnosticsService } from '../../services/SetupDiagnosticsService';
import { SetupWorkflowService } from '../../services/SetupWorkflowService';
import {
  SetupProvisioningService,
  runSerializedGuildSetup,
} from '../../services/SetupProvisioningService';
import {
  ReportInstructionsManager,
  ReportInstructionsRollbackRequiredError,
} from '../../controllers/ReportInstructionsManager';
import type { IModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import type { Server, VerificationChannelPermissionSyncState } from '../../repositories/types';
import { Prisma } from '../../db/prisma';
import { createBotAuthority } from './authority';
import { createCaseConfirmationStore } from '../context';
import { z } from 'zod';

export interface BotSetupDependencies {
  readonly client: Client;
  readonly configService: IConfigService;
  readonly notificationManager: INotificationManager;
  readonly productAnalyticsService: IProductAnalyticsService;
  readonly setupDiagnosticsService: ISetupDiagnosticsService;
  readonly actionRequests: IModerationActionRequestRepository;
}
export interface SetupPanelPublication {
  readonly action: string | null;
  readonly messageId: string | null;
  readonly error: string | null;
}
export type SetupExecution =
  | { readonly kind: 'configuration' }
  | {
      readonly kind: 'direct';
      readonly guild: Guild;
      readonly caseRole: Role | null;
      readonly verificationChannel: TextChannel | null;
      readonly reportChannel: TextChannel | null;
      readonly actorLabel: string;
      readonly captureAnalytics: boolean;
      readonly publishPanel: boolean;
    }
  | { readonly kind: 'queued' };
export interface BotSetupRuntime {
  readonly actions: SetupActions;
  readonly confirmations: ReturnType<typeof createCaseConfirmationStore>;
  forExecution(execution: ExecutionRecord): BotSetupRuntime;
  execute(
    context: ActionContext,
    command: SetupCommand,
    execution: SetupExecution
  ): Promise<ActionResult<SetupOutcome>>;
}
export function requireSetupOutcome(
  result: ActionResult<SetupOutcome>,
  command?: SetupCommand
): SetupOutcome {
  if (result.kind === 'outcome') return result.outcome;
  if (
    command?.kind === 'upsert_report_instructions' &&
    command.repost &&
    (result.code === 'permission_denied' || result.code === 'actor_unavailable')
  )
    throw new ActionDeniedError(
      result.code,
      'Report panel repost requires current Administrator permission.'
    );
  if (
    result.code === 'permission_denied' &&
    command?.kind === 'update_settings' &&
    command.section === 'analytics' &&
    command.changes.analytics_consent_level === 'full'
  )
    throw new ActionDeniedError(
      result.code,
      'Only the server owner can enable full analytics sharing because it may include raw Discord IDs.'
    );
  if (result.code === 'permission_denied' || result.code === 'actor_unavailable')
    throw new ActionDeniedError(result.code, 'Setup requires current Administrator permission.');
  if (result.code === 'policy_disabled')
    throw new ActionDeniedError(
      result.code,
      'Configure the browser security-check provider and required roles before enabling this setting.'
    );
  if (result.code === 'confirmation_required')
    throw new ActionDeniedError(result.code, 'Confirm the report panel repost before continuing.');
  throw new ActionDeniedError(result.code, `Setup action denied: ${result.code}`);
}
function projectServer(server: Server): SetupConfigurationState {
  return {
    case_role_id: server.case_role_id ?? null,
    settings: serverSettingsSchema.parse({
      ...server.settings,
      ...(server.settings.role_quarantine_mode === 'audit_only'
        ? { role_quarantine_mode: 'off' }
        : {}),
    }),
  };
}
function createConfiguration(
  config: IConfigService,
  command: SetupCommand,
  approved?: ApprovedSetupConfiguration
): SetupDependencies['configuration'] {
  return {
    async loadFresh(guildId): Promise<SetupConfigurationState> {
      if (approved) return projectServer(await approved.read(guildId));
      return projectServer(
        await config.getServerConfig(guildId, { forceRefresh: true, failOnReadError: true })
      );
    },
    async save(context, change): Promise<SetupConfigurationState> {
      if (command.kind === 'lockdown_allow_add' || command.kind === 'lockdown_allow_remove') {
        const edit = {
          lockdownAllowlist: {
            operation:
              command.kind === 'lockdown_allow_add' ? ('add' as const) : ('remove' as const),
            targetKind: command.targetKind,
            targetId: command.targetId,
          },
        };
        const saved = approved
          ? await approved.save(context.guildId, edit)
          : await config.updateSetupIfUnchanged(context.guildId, undefined, edit);
        if (!saved) throw new Error('Server configuration is unavailable.');
        return projectServer(saved);
      }
      if (approved)
        return projectServer(
          await approved.save(context.guildId, {
            ...setupStoredChange(change),
            captchaReadiness: botCaptchaReadiness(),
          })
        );
      return saveConfiguration(config, context, change);
    },
    async updateHeuristics(context, changes): Promise<SetupHeuristics> {
      if (approved) {
        const updated = await approved.save(context.guildId, {
          normalizeHeuristicKeywords: true,
          columns: {
            heuristic_message_threshold: changes.messageThreshold,
            heuristic_message_timeframe_seconds: changes.timeframeSeconds,
            heuristic_suspicious_keywords: changes.suspiciousKeywords,
          },
        });
        return {
          messageThreshold: updated.heuristic_message_threshold,
          timeWindowMs: updated.heuristic_message_timeframe_seconds * 1000,
          suspiciousKeywords: updated.heuristic_suspicious_keywords,
        };
      }
      return config.updateHeuristicSettings(context.guildId, changes);
    },
    resetHeuristics(context, scope): Promise<SetupHeuristics> {
      if (approved) throw new ActionDeniedError('frozen_reset_delivery_required');
      return scope === 'keywords'
        ? config.updateHeuristicSettings(context.guildId, {
            suspiciousKeywords: [...globalConfig.getSettings().defaultSuspiciousKeywords],
          })
        : config.resetHeuristicSettings(context.guildId);
    },
  };
}
async function saveConfiguration(
  config: IConfigService,
  context: ActionContext,
  change: SetupPersistenceChange
): Promise<SetupConfigurationState> {
  // The native static JSON merge is already atomic; only derived/reset/column edits need the new port.
  if (
    !change.columns &&
    !change.resetSettings?.length &&
    !('captcha_mode' in change.settings) &&
    !('captcha_method' in change.settings)
  )
    return projectServer(await config.updateServerSettings(context.guildId, change.settings));
  const stored = { ...setupStoredChange(change), captchaReadiness: botCaptchaReadiness() };
  const heuristicsChanged =
    stored.columns?.heuristic_suspicious_keywords !== undefined ||
    stored.columns?.heuristic_message_threshold !== undefined ||
    stored.columns?.heuristic_message_timeframe_seconds !== undefined;
  const updated = await config.updateSetupIfUnchanged(context.guildId, undefined, {
    ...stored,
    ...(heuristicsChanged ? { normalizeHeuristicKeywords: true as const } : {}),
  });
  if (!updated) throw new Error('Server configuration is unavailable.');
  return projectServer(updated);
}

export async function fetchSetupTextChannel(
  client: Client,
  guildId: string,
  channelId: string,
  label: string
): Promise<TextChannel> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText)
    throw new Error(`${label} ${channelId} was not found as a text channel.`);
  if (channel.guildId !== guildId)
    throw new Error(`${label} does not belong to the request guild.`);
  return channel;
}
function createSetupAuthority(client: Client): AuthorityPort {
  const authority = createBotAuthority(client);
  return {
    async loadFresh(guildId, userId): Promise<AuthorityFacts | null> {
      // Shipped setup treats an unavailable administrator lookup as unavailable authority.
      return authority.loadFresh(guildId, userId).catch(() => null);
    },
  };
}
export function createBotSetupRuntime(
  deps: BotSetupDependencies,
  authority: AuthorityPort = createSetupAuthority(deps.client),
  approved?: ApprovedSetupConfiguration,
  expectedSelection?: SetupProvisioningSelection
): BotSetupRuntime {
  const runtimeConfirmations = createCaseConfirmationStore();
  const runtime: BotSetupRuntime = {
    confirmations: runtimeConfirmations,
    forExecution(execution) {
      if (execution.preconditions.kind !== 'setup')
        throw new ActionDeniedError('setup_preconditions_required');
      return createBotSetupRuntime(
        deps,
        authority,
        createApprovedSetupConfiguration(deps.configService, execution.preconditions),
        execution.preconditions.provisioning
      );
    },
    actions: {
      execute(context, command) {
        return runtime.execute(context, command, { kind: 'configuration' });
      },
    },
    async execute(context, input, execution) {
      const command = setupCommandSchema.parse(input);
      const confirmations = createCaseConfirmationStore();
      if (execution.kind === 'queued') {
        const request = await deps.actionRequests.findById(context.requestId);
        if (!request) throw new Error('Setup request is unavailable.');
        const accepted = decodeQueuedAction(request);
        if (
          JSON.stringify(accepted.context) !== JSON.stringify(context) ||
          JSON.stringify(accepted.command) !== JSON.stringify(command)
        )
          throw new Error('Setup request binding mismatch.');
        if (command.kind === 'upsert_report_instructions' && command.repost)
          confirmations.recordVerified(context, setupConfirmationCommand(context, command));
      }
      if (approved) {
        await approved.read(context.guildId);
        const references = setupResourceReferences(command);
        if (references.length) {
          const guild = await deps.client.guilds.fetch(context.guildId);
          const roles = await guild.roles.fetch();
          const channels = await guild.channels.fetch();
          validateSetupResourceReferences(references, {
            roles: [...roles.values()].map(({ id, name }) => ({ id, name })),
            channels: [...channels.values()]
              .filter((channel): channel is NonNullable<typeof channel> => channel !== null)
              .map(({ id, name, type }) => ({ id, name, type })),
          });
        }
      }
      const workflowConfig = approved?.config ?? deps.configService;
      const panels = new ReportInstructionsManager(deps.client, workflowConfig);
      return createSetupActions({
        authority,
        confirmations:
          execution.kind === 'queued'
            ? confirmations.confirmations
            : runtimeConfirmations.confirmations,
        configuration: createConfiguration(deps.configService, command, approved),
        provider: { isConfigured: isBotCaptchaMethodConfigured },
        panels: {
          async upsert(actionContext, panel) {
            approved?.startEffects();
            return panels.upsertReportInstructionsMessage(
              actionContext.guildId,
              await fetchSetupTextChannel(
                deps.client,
                actionContext.guildId,
                panel.channelId,
                'Report instructions channel'
              ),
              panel.repost
                ? {
                    repost: true,
                    expectedMessageId: panel.expectedMessageId,
                    expectedChannelId: panel.expectedChannelId,
                  }
                : { repost: false }
            );
          },
          async clear(actionContext) {
            approved?.startEffects();
            return panels.clearReportInstructions(actionContext.guildId);
          },
        },
        provisioning: {
          complete(actionContext, setup) {
            return completeSetup(
              deps,
              actionContext,
              setup,
              execution,
              workflowConfig,
              approved,
              expectedSelection
            );
          },
        },
      }).execute(context, command);
    },
  };
  return runtime;
}
// Permission provenance is a private persisted workflow envelope, never a public command field.
const permissionSyncSchema = z.object({
  channel_id: z.string(),
  managed_overwrites: z.array(
    z.object({
      id: z.string(),
      type: z.union([z.literal(0), z.literal(1)]),
      managed_bits: z.string(),
      original_overwrite: z.object({ existed: z.boolean(), allow: z.string(), deny: z.string() }),
    })
  ),
});
async function queuedPermissionState(
  deps: BotSetupDependencies,
  context: ActionContext
): Promise<{
  previousPermissionSyncState?: VerificationChannelPermissionSyncState;
  candidatePermissionSyncState?: VerificationChannelPermissionSyncState;
  persistPermissionSyncState: (
    state: VerificationChannelPermissionSyncState,
    previousState?: VerificationChannelPermissionSyncState
  ) => Promise<void>;
}> {
  const request = await deps.actionRequests.findById(context.requestId);
  if (
    !request ||
    request.server_id !== context.guildId ||
    context.actor.kind !== 'user' ||
    request.actor_id !== context.actor.userId
  )
    throw new Error('Setup request binding mismatch.');
  const metadata = z.record(z.unknown()).parse(request.metadata ?? {});
  function read(key: string): VerificationChannelPermissionSyncState | undefined {
    const parsed = permissionSyncSchema.safeParse(metadata[key]);
    return parsed.success ? parsed.data : undefined;
  }
  return {
    previousPermissionSyncState: read('previous_verification_channel_permission_sync'),
    candidatePermissionSyncState: read('candidate_verification_channel_permission_sync'),
    async persistPermissionSyncState(state, previousState): Promise<void> {
      const updated = await deps.actionRequests.mergeMetadata(context.requestId, {
        previous_verification_channel_permission_sync: previousState
          ? (previousState as unknown as Prisma.JsonObject)
          : null,
        candidate_verification_channel_permission_sync: state as unknown as Prisma.JsonObject,
      });
      if (!updated)
        throw new Error('Setup request disappeared while saving permission provenance.');
    },
  };
}
async function completeSetup(
  deps: BotSetupDependencies,
  context: ActionContext,
  command: Extract<SetupCommand, { kind: 'complete_setup_verification' }>,
  execution: SetupExecution,
  config: SetupWorkflowConfig,
  approved?: ApprovedSetupConfiguration,
  expectedSelection?: SetupProvisioningSelection
): Promise<SetupProvisioningOutcome> {
  if (execution.kind === 'configuration')
    throw new Error('Provisioning requires an execution envelope.');
  const guild =
    execution.kind === 'direct' ? execution.guild : await deps.client.guilds.fetch(context.guildId);
  const workflow = new SetupWorkflowService(
    config,
    deps.notificationManager,
    deps.productAnalyticsService,
    deps.setupDiagnosticsService
  );
  if (execution.kind === 'queued')
    await fetchSetupTextChannel(
      deps.client,
      context.guildId,
      command.adminChannelId,
      'Admin channel'
    );
  const refreshCandidates = async (): Promise<void> => {
    await guild.roles.fetch();
    await guild.channels.fetch();
  };
  const assertSelection = async (
    selection: SetupProvisioningSelection,
    startEffects = true
  ): Promise<void> => {
    if (!expectedSelection || canonicalDigest(selection) !== canonicalDigest(expectedSelection))
      throw new ActionDeniedError('stale_state');
    await approved?.read(context.guildId);
    if (startEffects) approved?.startEffects();
  };
  const revalidateSelection = async (): Promise<void> => {
    await refreshCandidates();
    if (!approved) return;
    const state = parseSetupStoredRecord(
      (await approved.read(context.guildId)) as unknown as Record<string, unknown>
    );
    await assertSelection(
      selectSetupProvisioning(state, command, {
        roles: [...guild.roles.cache.values()].map(({ id, name }) => ({ id, name })),
        channels: [...guild.channels.cache.values()].map(({ id, name, type }) => ({
          id,
          name,
          type,
        })),
      }),
      false
    );
  };
  if (command.mode === 'verification_modal') {
    const finish = async (): Promise<SetupProvisioningOutcome> => {
      let verificationBinding: BoundVerificationSetup | undefined;
      if (approved) {
        await refreshCandidates();
        const state = parseSetupStoredRecord(
          (await approved.read(context.guildId)) as unknown as Record<string, unknown>
        );
        await assertSelection(
          selectSetupProvisioning(state, command, {
            roles: [...guild.roles.cache.values()].map(({ id, name }) => ({ id, name })),
            channels: [...guild.channels.cache.values()].map(({ id, name, type }) => ({
              id,
              name,
              type,
            })),
          })
        );
        if (!expectedSelection) throw new ActionDeniedError('setup_preconditions_required');
        const choice = expectedSelection.verification;
        if (choice.kind !== 'reuse' && choice.kind !== 'create')
          throw new ActionDeniedError('invalid_selection');
        verificationBinding = {
          choice,
          previousSyncState:
            state.settings.verification_channel_permission_sync == null
              ? null
              : permissionSyncSchema.parse(state.settings.verification_channel_permission_sync),
        };
      }
      const role = command.caseRoleId ? await guild.roles.fetch(command.caseRoleId) : null;
      if (!role) return { status: 'invalid_selection', detail: 'Case role no longer exists.' };
      return workflow.completeSetup({
        guild,
        guildId: context.guildId,
        caseRole: role,
        adminChannelId: command.adminChannelId,
        initialVerificationChannelId: command.verificationChannelId ?? null,
        candidateVerificationChannelId:
          command.verificationChannelId ??
          (approved && expectedSelection?.verification.kind === 'reuse'
            ? expectedSelection.verification.id
            : null),
        reportInstructionsChannelId: null,
        verificationBinding,
      });
    };
    return approved ? runSerializedGuildSetup(context.guildId, finish) : finish();
  }
  const publication: { action: string | null; messageId: string | null; error: string | null } = {
    action: null,
    messageId: null,
    error: null,
  };
  const result = await new SetupProvisioningService(
    config,
    deps.setupDiagnosticsService,
    workflow
  ).provision({
    guild,
    ...command,
    ...(approved
      ? { beforeSelection: revalidateSelection, assertSelection, bindVerificationSelection: true }
      : {}),
    ...(execution.kind === 'direct'
      ? { caseRole: execution.caseRole, verificationChannel: execution.verificationChannel }
      : {}),
    actorLabel:
      execution.kind === 'queued'
        ? `web administrator ${context.actor.kind === 'user' ? context.actor.userId : ''}`
        : execution.actorLabel,
    captureAnalytics: execution.kind === 'queued' || execution.captureAnalytics,
    ...(execution.kind === 'queued' ? await queuedPermissionState(deps, context) : {}),
    afterSetupCompleted: async () => {
      if (execution.kind === 'direct' && !execution.publishPanel) return;
      if (!command.reportInstructionsChannelId && !command.onboardingWizard) return;
      try {
        const manager = new ReportInstructionsManager(deps.client, config);
        const panel = command.reportInstructionsChannelId
          ? await manager.upsertReportInstructionsMessage(
              context.guildId,
              execution.kind === 'direct' && execution.reportChannel
                ? execution.reportChannel
                : await fetchSetupTextChannel(
                    deps.client,
                    context.guildId,
                    command.reportInstructionsChannelId,
                    'Report instructions channel'
                  )
            )
          : await manager.clearReportInstructions(context.guildId);
        publication.action = panel.action;
        publication.messageId = 'messageId' in panel ? panel.messageId : null;
      } catch (error) {
        if (error instanceof ReportInstructionsRollbackRequiredError) throw error;
        publication.error = error instanceof Error ? error.message : String(error);
      }
    },
  });
  if (execution.kind === 'queued' && command.onboardingWizard && result.status !== 'completed')
    void deps.productAnalyticsService.captureGuildEvent(context.guildId, 'setup wizard blocked', {
      diagnostic_codes:
        'report' in result
          ? result.report.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.code)
          : [],
      reason: result.status,
      surface: 'web',
    });
  return result.status === 'completed' ? { ...result, reportInstructions: publication } : result;
}
