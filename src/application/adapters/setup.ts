import {
  ActionDeniedError,
  createSetupActions,
  setupCaptchaProviderIssues,
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
import type { INotificationManager } from '../../services/NotificationManager';
import type { IProductAnalyticsService } from '../../services/ProductAnalyticsService';
import type { ISetupDiagnosticsService } from '../../services/SetupDiagnosticsService';
import { SetupWorkflowService } from '../../services/SetupWorkflowService';
import { SetupProvisioningService } from '../../services/SetupProvisioningService';
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
function createConfiguration(config: IConfigService): SetupDependencies['configuration'] {
  return {
    async loadFresh(guildId): Promise<SetupConfigurationState> {
      return projectServer(
        await config.getServerConfig(guildId, { forceRefresh: true, failOnReadError: true })
      );
    },
    async save(context, change): Promise<SetupConfigurationState> {
      return saveConfiguration(config, context, change);
    },
    updateHeuristics(context, changes): Promise<SetupHeuristics> {
      return config.updateHeuristicSettings(context.guildId, changes);
    },
    resetHeuristics(context, scope): Promise<SetupHeuristics> {
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
  if (change.resetSettings?.length) {
    const current = await config.getServerConfig(context.guildId, {
      forceRefresh: true,
      failOnReadError: true,
    });
    const settings = { ...current.settings, ...change.settings };
    for (const key of change.resetSettings) delete settings[key];
    return projectServer(await config.updateServerConfig(context.guildId, { settings }));
  }
  if (!change.columns)
    return projectServer(await config.updateServerSettings(context.guildId, change.settings));
  const columns = change.columns;
  const data = Object.fromEntries(
    Object.entries({
      case_role_id: columns.caseRoleId,
      admin_channel_id: columns.adminChannelId,
      verification_channel_id: columns.verificationChannelId,
      admin_notification_role_id: columns.adminNotificationRoleId,
    }).filter(([, value]) => value !== undefined)
  );
  let updated = Object.keys(data).length
    ? await config.updateServerConfig(context.guildId, data)
    : null;
  if (
    columns.heuristicMessageThreshold !== undefined ||
    columns.heuristicMessageTimeframeSeconds !== undefined ||
    columns.heuristicSuspiciousKeywords !== undefined
  ) {
    await config.updateHeuristicSettings(context.guildId, {
      messageThreshold: columns.heuristicMessageThreshold,
      timeframeSeconds: columns.heuristicMessageTimeframeSeconds,
      suspiciousKeywords: columns.heuristicSuspiciousKeywords,
    });
    updated = null;
  }
  if (Object.keys(change.settings).length)
    return projectServer(await config.updateServerSettings(context.guildId, change.settings));
  return projectServer(
    updated ??
      (await config.getServerConfig(context.guildId, { forceRefresh: true, failOnReadError: true }))
  );
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
  authority: AuthorityPort = createSetupAuthority(deps.client)
): BotSetupRuntime {
  const runtimeConfirmations = createCaseConfirmationStore();
  const runtime: BotSetupRuntime = {
    confirmations: runtimeConfirmations,
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
      const panels = new ReportInstructionsManager(deps.client, deps.configService);
      return createSetupActions({
        authority,
        confirmations:
          execution.kind === 'queued'
            ? confirmations.confirmations
            : runtimeConfirmations.confirmations,
        configuration: createConfiguration(deps.configService),
        provider: {
          isConfigured: () =>
            setupCaptchaProviderIssues({
              siteKeyConfigured: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()),
              secretKeyConfigured: Boolean(process.env.TURNSTILE_SECRET_KEY?.trim()),
              bindingSecretConfigured: Boolean(process.env.DRASIL_CAPTCHA_BINDING_SECRET?.trim()),
              expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME?.trim(),
              publicUrl:
                process.env.NEXT_PUBLIC_APP_URL?.trim() ||
                process.env.DRASIL_WEB_PUBLIC_URL?.trim(),
            }).length === 0,
        },
        panels: {
          async upsert(actionContext, panel) {
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
            return panels.clearReportInstructions(actionContext.guildId);
          },
        },
        provisioning: {
          complete(actionContext, setup) {
            return completeSetup(deps, actionContext, setup, execution);
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
  execution: SetupExecution
): Promise<SetupProvisioningOutcome> {
  if (execution.kind === 'configuration')
    throw new Error('Provisioning requires an execution envelope.');
  const guild =
    execution.kind === 'direct' ? execution.guild : await deps.client.guilds.fetch(context.guildId);
  const workflow = new SetupWorkflowService(
    deps.configService,
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
  if (command.mode === 'verification_modal') {
    const role = command.caseRoleId ? await guild.roles.fetch(command.caseRoleId) : null;
    if (!role) return { status: 'invalid_selection', detail: 'Case role no longer exists.' };
    return workflow.completeSetup({
      guild,
      guildId: context.guildId,
      caseRole: role,
      adminChannelId: command.adminChannelId,
      initialVerificationChannelId: command.verificationChannelId ?? null,
      candidateVerificationChannelId: command.verificationChannelId ?? null,
      reportInstructionsChannelId: null,
    });
  }
  const publication: { action: string | null; messageId: string | null; error: string | null } = {
    action: null,
    messageId: null,
    error: null,
  };
  const result = await new SetupProvisioningService(
    deps.configService,
    deps.setupDiagnosticsService,
    workflow
  ).provision({
    guild,
    ...command,
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
        const manager = new ReportInstructionsManager(deps.client, deps.configService);
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
