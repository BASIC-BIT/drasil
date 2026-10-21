import {
  selectSetupCandidate,
  setupProvisioningDetectionMode,
  type SetupProvisioningSelection,
} from '@drasil/application';
import type { DetectionResponseMode } from '../contracts/setup';
import { ChannelType, Guild, Role, TextChannel, type GuildBasedChannel } from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import type { Server, VerificationChannelPermissionSyncState } from '../repositories/types';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { getCaseResponderSettings } from '../utils/caseResponderSettings';
import { getManualIntakeSettings } from '../utils/manualIntakeSettings';
import { getModerationQueueSettings } from '../utils/moderationQueueSettings';
import { getRoleGateSettings } from '../utils/roleGateSettings';
import { ISetupDiagnosticsService } from './SetupDiagnosticsService';
import { SetupWorkflowService, type SetupWorkflowResult } from './SetupWorkflowService';

export const DEFAULT_CASE_ROLE_NAME = 'Drasil Case';
export const DEFAULT_VERIFICATION_CHANNEL_NAME = 'verification';
const DISCORD_UNKNOWN_CHANNEL_ERROR_CODE = 10003;
const DISCORD_UNKNOWN_ROLE_ERROR_CODE = 10011;
const setupExecutionChains = new Map<string, Promise<unknown>>();

export async function runSerializedGuildSetup<T>(
  guildId: string,
  operation: () => Promise<T>
): Promise<T> {
  // Setup surfaces may construct separate services, so the lock must be module-scoped.
  const previous = setupExecutionChains.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  setupExecutionChains.set(guildId, next);

  try {
    return await next;
  } finally {
    if (setupExecutionChains.get(guildId) === next) {
      setupExecutionChains.delete(guildId);
    }
  }
}

export type SetupProvisioningResult =
  | SetupWorkflowResult
  | {
      readonly status: 'ambiguous_case_role';
      readonly roleName: string;
      readonly roleIds: readonly string[];
    }
  | {
      readonly status: 'ambiguous_verification_channel';
      readonly channelIds: readonly string[];
    }
  | {
      readonly status: 'invalid_selection';
      readonly detail: string;
    };

export interface ProvisionSetupInput {
  readonly bindVerificationSelection?: boolean;
  readonly beforeSelection?: () => Promise<void>;
  readonly assertSelection?: (selection: SetupProvisioningSelection) => Promise<void>;

  readonly guild: Guild;
  readonly adminChannelId: string;
  readonly caseRole?: Role | null;
  readonly caseRoleId?: string | null;
  readonly caseRoleName?: string | null;
  readonly verificationChannelId?: string | null;
  readonly verificationChannel?: TextChannel | null;
  readonly reportInstructionsChannelId?: string | null;
  readonly detectionResponseMode?: DetectionResponseMode;
  readonly actorLabel: string;
  readonly captureAnalytics?: boolean;
  readonly previousPermissionSyncState?: VerificationChannelPermissionSyncState;
  readonly candidatePermissionSyncState?: VerificationChannelPermissionSyncState;
  readonly persistPermissionSyncState?: (
    state: VerificationChannelPermissionSyncState,
    previousState?: VerificationChannelPermissionSyncState
  ) => Promise<void>;
  readonly afterSetupCompleted?: (
    result: Extract<SetupWorkflowResult, { status: 'completed' }>
  ) => Promise<void>;
}

type CaseRoleCandidate =
  | { role: Role | null; roleName: string; ambiguousRoleIds: readonly string[] }
  | { invalidDetail: string };

type VerificationChannelCandidate =
  | {
      channelId: string | null;
      channelName?: string;
      willSyncPermissions: boolean;
      ambiguousChannelIds: readonly string[];
    }
  | { invalidDetail: string };

export class SetupProvisioningService {
  public constructor(
    private readonly configService: Pick<IConfigService, 'getServerConfig'>,
    private readonly setupDiagnosticsService: ISetupDiagnosticsService,
    private readonly setupWorkflowService: SetupWorkflowService
  ) {}

  public async provision(input: ProvisionSetupInput): Promise<SetupProvisioningResult> {
    return runSerializedGuildSetup(input.guild.id, () => this.provisionExclusive(input));
  }

  private async provisionExclusive(input: ProvisionSetupInput): Promise<SetupProvisioningResult> {
    const existingConfig = await this.configService.getServerConfig(input.guild.id, {
      failOnReadError: true,
      forceRefresh: true,
    });
    await input.beforeSelection?.();
    const detectionResponseMode = setupProvisioningDetectionMode(
      existingConfig,
      input.detectionResponseMode
    );
    const caseRoleCandidate = await this.resolveCaseRoleCandidate(
      input.guild,
      input.caseRole ?? null,
      input.caseRoleId ?? null,
      input.caseRoleName?.trim() || null,
      existingConfig
    );
    if ('invalidDetail' in caseRoleCandidate) {
      return { status: 'invalid_selection', detail: caseRoleCandidate.invalidDetail };
    }
    if (caseRoleCandidate.ambiguousRoleIds.length > 0) {
      return {
        status: 'ambiguous_case_role',
        roleName: caseRoleCandidate.roleName,
        roleIds: caseRoleCandidate.ambiguousRoleIds,
      };
    }
    const operationalRoleConflict = this.getOperationalRoleConflict(
      caseRoleCandidate.role?.id ?? null,
      existingConfig
    );
    if (operationalRoleConflict) {
      return { status: 'invalid_selection', detail: operationalRoleConflict };
    }

    const result = await this.provisionWithCaseRole(
      input,
      caseRoleCandidate,
      detectionResponseMode,
      existingConfig
    );
    if (result.status === 'completed' && input.afterSetupCompleted) {
      await input.afterSetupCompleted(result);
    }
    return result;
  }

  private async provisionWithCaseRole(
    input: ProvisionSetupInput,
    caseRoleCandidate: Exclude<CaseRoleCandidate, { invalidDetail: string }>,
    detectionResponseMode: DetectionResponseMode | undefined,
    existingConfig: Server
  ): Promise<SetupProvisioningResult> {
    const verificationCandidate = await this.resolveVerificationChannelCandidate(
      input.guild,
      input.verificationChannel ?? null,
      input.verificationChannelId ?? null,
      existingConfig
    );
    if ('invalidDetail' in verificationCandidate) {
      return { status: 'invalid_selection', detail: verificationCandidate.invalidDetail };
    }
    if (verificationCandidate.ambiguousChannelIds.length > 0) {
      return {
        status: 'ambiguous_verification_channel',
        channelIds: verificationCandidate.ambiguousChannelIds,
      };
    }
    const channelSelectionError = this.getChannelSelectionError(
      input,
      verificationCandidate,
      existingConfig
    );
    if (channelSelectionError) {
      return { status: 'invalid_selection', detail: channelSelectionError };
    }

    await input.assertSelection?.({
      role: caseRoleCandidate.role
        ? { kind: 'reuse', id: caseRoleCandidate.role.id, name: caseRoleCandidate.roleName }
        : { kind: 'create', name: caseRoleCandidate.roleName },
      verification: verificationCandidate.channelId
        ? {
            kind: 'reuse',
            id: verificationCandidate.channelId,
            name: verificationCandidate.channelName ?? DEFAULT_VERIFICATION_CHANNEL_NAME,
          }
        : { kind: 'create', name: DEFAULT_VERIFICATION_CHANNEL_NAME },
      detectionResponseMode: detectionResponseMode ?? null,
    });
    const candidateReport = await this.setupDiagnosticsService.validateSetupCandidate(input.guild, {
      caseRoleId: caseRoleCandidate.role?.id ?? null,
      willCreateCaseRole: !caseRoleCandidate.role,
      adminChannelId: input.adminChannelId,
      verificationChannelId: verificationCandidate.channelId,
      willCreateVerificationChannel: !verificationCandidate.channelId,
      ...(verificationCandidate.willSyncPermissions
        ? { willSyncVerificationChannelPermissions: true }
        : {}),
      reportInstructionsChannelId: input.reportInstructionsChannelId ?? null,
    });
    if (candidateReport.errorCount > 0) {
      return { status: 'candidate_validation_failed', report: candidateReport };
    }

    let createdCaseRole: Role | null = null;
    let caseRole = caseRoleCandidate.role;
    if (!caseRole) {
      createdCaseRole = await input.guild.roles.create({
        name: caseRoleCandidate.roleName,
        permissions: [],
        reason: `Drasil setup requested by ${input.actorLabel}`,
      });
      caseRole = createdCaseRole;
    }

    return this.setupWorkflowService.completeSetup({
      guild: input.guild,
      caseRole,
      adminChannelId: input.adminChannelId,
      initialVerificationChannelId: verificationCandidate.willSyncPermissions
        ? null
        : (input.verificationChannelId ?? null),
      candidateVerificationChannelId: verificationCandidate.channelId,
      ...(verificationCandidate.willSyncPermissions
        ? { willSyncVerificationChannelPermissions: true }
        : {}),
      reportInstructionsChannelId: input.reportInstructionsChannelId ?? null,
      candidateReport,
      createdCaseRole,
      captureAnalytics: input.captureAnalytics,
      detectionResponseMode,
      previousPermissionSyncState:
        input.previousPermissionSyncState ??
        existingConfig.settings.verification_channel_permission_sync,
      previousVerificationChannelId: existingConfig.verification_channel_id,
      previousCaseRoleId: existingConfig.case_role_id,
      candidatePermissionSyncState: input.candidatePermissionSyncState,
      persistPermissionSyncState: input.persistPermissionSyncState,
      ...(input.bindVerificationSelection
        ? {
            verificationBinding: {
              choice: verificationCandidate.channelId
                ? { kind: 'reuse' as const, id: verificationCandidate.channelId }
                : { kind: 'create' as const },
              previousSyncState:
                input.candidatePermissionSyncState ??
                input.previousPermissionSyncState ??
                existingConfig.settings.verification_channel_permission_sync ??
                null,
            },
          }
        : {}),
    });
  }

  private getChannelSelectionError(
    input: ProvisionSetupInput,
    verificationCandidate: Exclude<VerificationChannelCandidate, { invalidDetail: string }>,
    serverConfig: Server
  ): string | null {
    const channelId = verificationCandidate.channelId;
    if (!channelId) {
      return null;
    }
    if (input.adminChannelId === channelId) {
      return 'The admin alert channel must be separate from the verification channel.';
    }
    if (input.reportInstructionsChannelId === channelId) {
      return 'Report instructions must use a different channel from verification.';
    }

    const persistedConflicts: ReadonlyArray<readonly [string | null | undefined, string]> = [
      [serverConfig.admin_channel_id, 'admin alert'],
      [serverConfig.settings.report_instructions_channel_id, 'report instructions'],
      [getModerationQueueSettings(serverConfig.settings).channelId, 'moderation queue'],
      [
        getDetectionResponseSettings(serverConfig.settings).observedNotificationChannelId,
        'observed-alert',
      ],
    ];
    const conflict = persistedConflicts.find(
      ([configuredChannelId]) => configuredChannelId === channelId
    );
    if (conflict) {
      return `The verification channel must be separate from the configured ${conflict[1]} channel.`;
    }
    return null;
  }

  private getOperationalRoleConflict(roleId: string | null, serverConfig: Server): string | null {
    if (!roleId) {
      return null;
    }
    const manualIntakeSettings = getManualIntakeSettings(serverConfig.settings);
    if (roleId === manualIntakeSettings.roleId) {
      return 'The case role must be separate from the configured manual-intake trigger role.';
    }
    const roleGateSettings = getRoleGateSettings(serverConfig.settings);
    if (roleId === roleGateSettings.honeypotRoleId) {
      return 'The case role must be separate from the configured honeypot trigger role.';
    }
    if (roleId === roleGateSettings.memberAccessRoleId) {
      return 'The case role must be separate from the configured member-access role.';
    }
    if (roleId === serverConfig.admin_notification_role_id) {
      return 'The case role must be separate from the configured admin-notification role.';
    }
    if (getCaseResponderSettings(serverConfig.settings).roleIds.includes(roleId)) {
      return 'The case role must be separate from configured case-responder roles.';
    }
    return null;
  }

  private async resolveCaseRoleCandidate(
    guild: Guild,
    explicitCaseRole: Role | null,
    explicitCaseRoleId: string | null,
    requestedRoleName: string | null,
    serverConfig: Server
  ): Promise<CaseRoleCandidate> {
    const explicit =
      explicitCaseRole ??
      (explicitCaseRoleId ? await this.fetchRole(guild, explicitCaseRoleId) : null);
    const configured =
      !explicitCaseRole && !explicitCaseRoleId && serverConfig.case_role_id
        ? await this.fetchRole(guild, serverConfig.case_role_id)
        : null;
    const candidates = new Map(
      this.cachedValues<Role>((guild as { roles?: { cache?: unknown } }).roles?.cache).map(
        (role) => [role.id, role]
      )
    );
    if (explicit) candidates.set(explicit.id, explicit);
    if (configured) candidates.set(configured.id, configured);
    if (explicitCaseRoleId && !explicit) candidates.delete(explicitCaseRoleId);
    const selected = selectSetupCandidate({
      explicitId: explicitCaseRole?.id ?? explicitCaseRoleId,
      configuredId: configured?.id,
      requestedName: requestedRoleName,
      defaultName: DEFAULT_CASE_ROLE_NAME,
      candidates: [...candidates.values()].map(({ id, name }) => ({ id, name })),
    });
    if (selected.kind === 'invalid')
      return { invalidDetail: 'The selected case role no longer exists.' };
    if (selected.kind === 'ambiguous')
      return {
        role: null,
        roleName: requestedRoleName ?? DEFAULT_CASE_ROLE_NAME,
        ambiguousRoleIds: selected.ids,
      };
    return {
      role: selected.kind === 'reuse' ? (candidates.get(selected.id) ?? null) : null,
      roleName: selected.name,
      ambiguousRoleIds: [],
    };
  }

  private async resolveVerificationChannelCandidate(
    guild: Guild,
    explicitChannel: TextChannel | null,
    explicitChannelId: string | null,
    serverConfig: Server
  ): Promise<VerificationChannelCandidate> {
    const explicit =
      explicitChannel ??
      (explicitChannelId ? await this.fetchVerificationChannel(guild, explicitChannelId) : null);
    const configured =
      !explicitChannel && !explicitChannelId && serverConfig.verification_channel_id
        ? await this.fetchVerificationChannel(guild, serverConfig.verification_channel_id)
        : null;
    const candidates = new Map(
      this.cachedValues<GuildBasedChannel>(
        (guild as { channels?: { cache?: unknown } }).channels?.cache
      )
        .filter((c): c is TextChannel => c.type === ChannelType.GuildText)
        .map((c) => [c.id, c])
    );
    if (explicit) candidates.set(explicit.id, explicit);
    if (configured) candidates.set(configured.id, configured);
    if (explicitChannelId && !explicit) candidates.delete(explicitChannelId);
    const selected = selectSetupCandidate({
      explicitId: explicitChannel?.id ?? explicitChannelId,
      configuredId: configured?.id,
      defaultName: DEFAULT_VERIFICATION_CHANNEL_NAME,
      candidates: [...candidates.values()].map(({ id, name }) => ({ id, name })),
    });
    if (selected.kind === 'invalid')
      return {
        invalidDetail: 'The selected verification channel is not an available text channel.',
      };
    if (selected.kind === 'ambiguous')
      return { channelId: null, willSyncPermissions: false, ambiguousChannelIds: selected.ids };
    return {
      channelId: selected.kind === 'reuse' ? selected.id : null,
      channelName: selected.name,
      willSyncPermissions: selected.kind === 'reuse',
      ambiguousChannelIds: [],
    };
  }

  private cachedValues<T>(cache: { values(): IterableIterator<T> } | unknown): T[] {
    const candidate = cache as { values?: () => IterableIterator<T> } | null;
    return typeof candidate?.values === 'function' ? [...candidate.values()] : [];
  }

  private async fetchVerificationChannel(
    guild: Guild,
    channelId: string
  ): Promise<TextChannel | null> {
    try {
      const channel = await guild.channels.fetch(channelId, { force: true });
      return channel?.type === ChannelType.GuildText ? channel : null;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === DISCORD_UNKNOWN_CHANNEL_ERROR_CODE
      ) {
        return null;
      }
      throw error;
    }
  }

  private async fetchRole(guild: Guild, roleId: string): Promise<Role | null> {
    const roleManager = guild.roles as { fetch?: (id: string) => Promise<Role | null> };
    if (typeof roleManager.fetch !== 'function') {
      return (
        this.cachedValues<Role>((guild.roles as { cache?: unknown }).cache).find(
          (role) => role.id === roleId
        ) ?? null
      );
    }
    try {
      return await roleManager.fetch(roleId);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === DISCORD_UNKNOWN_ROLE_ERROR_CODE
      ) {
        return null;
      }
      throw error;
    }
  }
}
