import type { DetectionResponseMode } from '../../packages/contracts/src/setup';
import { ChannelType, Guild, Role, TextChannel } from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import type { Server, VerificationChannelPermissionSyncState } from '../repositories/types';
import {
  DEFAULT_DETECTION_RESPONSE_MODE,
  DEFAULT_FIRST_SETUP_DETECTION_RESPONSE_MODE,
} from '../utils/detectionResponseSettings';
import { getCaseResponderSettings } from '../utils/caseResponderSettings';
import { getManualIntakeSettings } from '../utils/manualIntakeSettings';
import { getRoleGateSettings } from '../utils/roleGateSettings';
import { ISetupDiagnosticsService } from './SetupDiagnosticsService';
import { SetupWorkflowService, type SetupWorkflowResult } from './SetupWorkflowService';

export const DEFAULT_CASE_ROLE_NAME = 'Drasil Case';
export const DEFAULT_VERIFICATION_CHANNEL_NAME = 'verification';

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
}

type CaseRoleCandidate =
  | { role: Role | null; roleName: string; ambiguousRoleIds: readonly string[] }
  | { invalidDetail: string };

type VerificationChannelCandidate =
  | {
      channelId: string | null;
      willSyncPermissions: boolean;
      ambiguousChannelIds: readonly string[];
    }
  | { invalidDetail: string };

export class SetupProvisioningService {
  public constructor(
    private readonly configService: IConfigService,
    private readonly setupDiagnosticsService: ISetupDiagnosticsService,
    private readonly setupWorkflowService: SetupWorkflowService
  ) {}

  public async provision(input: ProvisionSetupInput): Promise<SetupProvisioningResult> {
    const existingConfig = await this.configService.getServerConfig(input.guild.id, {
      failOnReadError: true,
      forceRefresh: true,
    });
    const coreSetupIncomplete =
      !existingConfig.case_role_id ||
      !existingConfig.admin_channel_id ||
      !existingConfig.verification_channel_id;
    const surfaceProtectionModeAlreadyConfigured =
      existingConfig.settings.message_detection_response_mode != null ||
      existingConfig.settings.join_detection_response_mode != null;
    const persistedDefaultMode = existingConfig.settings.detection_response_mode;
    const needsFirstSetupProtectionDefault =
      coreSetupIncomplete &&
      !surfaceProtectionModeAlreadyConfigured &&
      (persistedDefaultMode === undefined ||
        persistedDefaultMode === DEFAULT_DETECTION_RESPONSE_MODE);
    const detectionResponseMode =
      input.detectionResponseMode ??
      (needsFirstSetupProtectionDefault ? DEFAULT_FIRST_SETUP_DETECTION_RESPONSE_MODE : undefined);
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

    return this.provisionWithCaseRole(
      input,
      caseRoleCandidate,
      detectionResponseMode,
      existingConfig
    );
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
    const channelSelectionError = this.getChannelSelectionError(input, verificationCandidate);
    if (channelSelectionError) {
      return { status: 'invalid_selection', detail: channelSelectionError };
    }
    if (
      input.reportInstructionsChannelId &&
      input.reportInstructionsChannelId === verificationCandidate.channelId
    ) {
      return {
        status: 'invalid_selection',
        detail: 'Report instructions must use a different channel from verification.',
      };
    }

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
      candidatePermissionSyncState: input.candidatePermissionSyncState,
      persistPermissionSyncState: input.persistPermissionSyncState,
    });
  }

  private getChannelSelectionError(
    input: ProvisionSetupInput,
    verificationCandidate: Exclude<VerificationChannelCandidate, { invalidDetail: string }>
  ): string | null {
    if (
      verificationCandidate.channelId &&
      input.adminChannelId === verificationCandidate.channelId
    ) {
      return 'The admin alert channel must be separate from the verification channel.';
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
    if (explicitCaseRole) {
      return { role: explicitCaseRole, roleName: explicitCaseRole.name, ambiguousRoleIds: [] };
    }
    if (explicitCaseRoleId) {
      const explicitRole = await this.fetchRole(guild, explicitCaseRoleId);
      return explicitRole
        ? { role: explicitRole, roleName: explicitRole.name, ambiguousRoleIds: [] }
        : { invalidDetail: 'The selected case role no longer exists.' };
    }

    const roleName = requestedRoleName ?? DEFAULT_CASE_ROLE_NAME;
    if (serverConfig.case_role_id) {
      const configuredRole = await this.fetchRole(guild, serverConfig.case_role_id);
      if (configuredRole && (!requestedRoleName || configuredRole.name === roleName)) {
        return { role: configuredRole, roleName: configuredRole.name, ambiguousRoleIds: [] };
      }
    }

    const matchingRoles = this.cachedValues(
      (guild as { roles?: { cache?: unknown } }).roles?.cache
    ).filter((role): role is Role => (role as Role | null)?.name === roleName);
    return matchingRoles.length === 1
      ? { role: matchingRoles[0], roleName, ambiguousRoleIds: [] }
      : {
          role: null,
          roleName,
          ambiguousRoleIds: matchingRoles.map((role) => role.id),
        };
  }

  private async resolveVerificationChannelCandidate(
    guild: Guild,
    explicitChannel: TextChannel | null,
    explicitChannelId: string | null,
    serverConfig: Server
  ): Promise<VerificationChannelCandidate> {
    if (explicitChannel) {
      return { channelId: explicitChannel.id, willSyncPermissions: true, ambiguousChannelIds: [] };
    }
    if (explicitChannelId) {
      const fetchedChannel = await guild.channels.fetch(explicitChannelId).catch(() => null);
      return fetchedChannel?.type === ChannelType.GuildText
        ? { channelId: explicitChannelId, willSyncPermissions: true, ambiguousChannelIds: [] }
        : { invalidDetail: 'The selected verification channel is not an available text channel.' };
    }

    if (serverConfig.verification_channel_id) {
      const configuredChannel = await guild.channels
        .fetch(serverConfig.verification_channel_id)
        .catch(() => null);
      if (configuredChannel?.type === ChannelType.GuildText) {
        return {
          channelId: serverConfig.verification_channel_id,
          willSyncPermissions: true,
          ambiguousChannelIds: [],
        };
      }
    }

    const matchingChannels = this.cachedValues(
      (guild as { channels?: { cache?: unknown } }).channels?.cache
    ).filter((channel): channel is TextChannel => {
      const textChannel = channel as TextChannel | null;
      return (
        textChannel?.type === ChannelType.GuildText &&
        textChannel.name === DEFAULT_VERIFICATION_CHANNEL_NAME
      );
    });
    return matchingChannels.length === 1
      ? {
          channelId: matchingChannels[0].id,
          willSyncPermissions: true,
          ambiguousChannelIds: [],
        }
      : {
          channelId: null,
          willSyncPermissions: false,
          ambiguousChannelIds: matchingChannels.map((channel) => channel.id),
        };
  }

  private cachedValues<T>(cache: { values(): IterableIterator<T> } | unknown): T[] {
    const candidate = cache as { values?: () => IterableIterator<T> } | null;
    return typeof candidate?.values === 'function' ? [...candidate.values()] : [];
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
    return roleManager.fetch(roleId).catch(() => null);
  }
}
