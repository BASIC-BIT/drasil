import type { Guild, Role } from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { INotificationManager } from './NotificationManager';
import { IProductAnalyticsService } from './ProductAnalyticsService';
import { ISetupDiagnosticsService, SetupDiagnosticReport } from './SetupDiagnosticsService';

export type VerificationChannelSetupAction = 'configured' | 'created' | 'synced';

export type SetupWorkflowResult =
  | { status: 'candidate_validation_failed'; report: SetupDiagnosticReport }
  | {
      status: 'verification_channel_failed';
      error: Error;
      setupFailureDetail: string;
      createdVerificationChannelId?: string;
    }
  | {
      status: 'final_validation_failed';
      report: SetupDiagnosticReport;
      setupFailureDetail: string;
      createdVerificationChannelId?: string;
    }
  | {
      status: 'config_save_failed';
      error: unknown;
      setupFailureDetail: string;
      createdVerificationChannelId?: string;
    }
  | {
      status: 'completed';
      candidateReport: SetupDiagnosticReport;
      restrictedRoleWasCreated: boolean;
      restrictedRoleId: string;
      adminChannelId: string;
      verificationChannelId: string;
      verificationChannelAction: VerificationChannelSetupAction;
    };

export interface CompleteSetupWorkflowInput {
  guild: Guild;
  guildId?: string;
  restrictedRole: Role;
  adminChannelId: string;
  initialVerificationChannelId: string | null;
  candidateVerificationChannelId: string | null;
  willSyncVerificationChannelPermissions?: boolean;
  reportInstructionsChannelId: string | null;
  candidateReport?: SetupDiagnosticReport;
  createdRestrictedRole?: Role | null;
  captureAnalytics?: boolean;
}

export class SetupWorkflowService {
  public constructor(
    private readonly configService: IConfigService,
    private readonly notificationManager: INotificationManager,
    private readonly productAnalyticsService: IProductAnalyticsService,
    private readonly setupDiagnosticsService: ISetupDiagnosticsService
  ) {}

  public async completeSetup(input: CompleteSetupWorkflowInput): Promise<SetupWorkflowResult> {
    const guildId = input.guildId ?? input.guild.id;
    const candidateReport =
      input.candidateReport ??
      (await this.setupDiagnosticsService.validateSetupCandidate(input.guild, {
        restrictedRoleId: input.restrictedRole.id,
        willCreateRestrictedRole: false,
        adminChannelId: input.adminChannelId,
        verificationChannelId:
          input.initialVerificationChannelId ?? input.candidateVerificationChannelId,
        willCreateVerificationChannel: !(
          input.initialVerificationChannelId ?? input.candidateVerificationChannelId
        ),
        ...(input.willSyncVerificationChannelPermissions
          ? { willSyncVerificationChannelPermissions: true }
          : {}),
        reportInstructionsChannelId: input.reportInstructionsChannelId,
      }));

    if (candidateReport.errorCount > 0) {
      return { status: 'candidate_validation_failed', report: candidateReport };
    }

    let verificationChannelId = input.initialVerificationChannelId;
    let verificationChannelAction: VerificationChannelSetupAction = verificationChannelId
      ? 'configured'
      : 'created';
    const createdSetupArtifacts: { verificationChannelId?: string } = {};

    if (!verificationChannelId) {
      const onChannelCreated = (channelId: string): void => {
        createdSetupArtifacts.verificationChannelId = channelId;
      };
      verificationChannelId = input.candidateVerificationChannelId
        ? await this.notificationManager.setupVerificationChannel(
            input.guild,
            input.restrictedRole.id,
            false,
            onChannelCreated,
            input.candidateVerificationChannelId
          )
        : await this.notificationManager.setupVerificationChannel(
            input.guild,
            input.restrictedRole.id,
            false,
            onChannelCreated
          );

      if (!verificationChannelId) {
        const setupFailureDetail = await this.rollbackCreatedArtifacts(
          input.guild,
          createdSetupArtifacts.verificationChannelId,
          input.createdRestrictedRole,
          guildId,
          'Verification channel setup failed.',
          'Rolling back Drasil setup after verification channel setup failed'
        );
        return {
          status: 'verification_channel_failed',
          error: new Error('Failed to create a verification channel during setup.'),
          setupFailureDetail,
          createdVerificationChannelId: createdSetupArtifacts.verificationChannelId,
        };
      }

      verificationChannelAction =
        input.candidateVerificationChannelId && !createdSetupArtifacts.verificationChannelId
          ? 'synced'
          : 'created';
    }

    const finalCandidateReport = await this.setupDiagnosticsService.validateSetupCandidate(
      input.guild,
      {
        restrictedRoleId: input.restrictedRole.id,
        willCreateRestrictedRole: false,
        adminChannelId: input.adminChannelId,
        verificationChannelId,
        willCreateVerificationChannel: false,
        reportInstructionsChannelId: input.reportInstructionsChannelId,
      }
    );
    if (finalCandidateReport.errorCount > 0) {
      const setupFailureDetail = await this.rollbackCreatedArtifacts(
        input.guild,
        createdSetupArtifacts.verificationChannelId,
        input.createdRestrictedRole,
        guildId,
        'Final validation failed.',
        'Rolling back Drasil setup after final validation failed'
      );
      return {
        status: 'final_validation_failed',
        report: finalCandidateReport,
        setupFailureDetail,
        createdVerificationChannelId: createdSetupArtifacts.verificationChannelId,
      };
    }

    try {
      await this.configService.updateServerConfig(guildId, {
        restricted_role_id: input.restrictedRole.id,
        admin_channel_id: input.adminChannelId,
        verification_channel_id: verificationChannelId,
      });
    } catch (error) {
      const setupFailureDetail = await this.rollbackCreatedArtifacts(
        input.guild,
        createdSetupArtifacts.verificationChannelId,
        input.createdRestrictedRole,
        guildId,
        'Configuration could not be saved.',
        'Rolling back Drasil setup after config save failed'
      );
      return {
        status: 'config_save_failed',
        error,
        setupFailureDetail,
        createdVerificationChannelId: createdSetupArtifacts.verificationChannelId,
      };
    }

    if (input.captureAnalytics) {
      void this.productAnalyticsService.captureGuildEvent(guildId, 'verification setup completed', {
        verification_channel_created: verificationChannelAction === 'created',
        verification_channel_configured: Boolean(verificationChannelId),
        admin_channel_configured: true,
        restricted_role_configured: true,
      });
    }

    return {
      status: 'completed',
      candidateReport,
      restrictedRoleWasCreated: Boolean(input.createdRestrictedRole),
      restrictedRoleId: input.restrictedRole.id,
      adminChannelId: input.adminChannelId,
      verificationChannelId,
      verificationChannelAction,
    };
  }

  private async rollbackCreatedArtifacts(
    guild: Guild,
    createdVerificationChannelId: string | undefined,
    createdRestrictedRole: Role | null | undefined,
    guildId: string,
    prefix: string,
    rollbackReason: string
  ): Promise<string> {
    const rollbackDetails = [prefix];

    if (createdVerificationChannelId) {
      const rolledBack = await this.rollbackCreatedVerificationChannel(
        guild,
        createdVerificationChannelId,
        rollbackReason
      );
      rollbackDetails.push(
        rolledBack
          ? 'The newly created verification channel was removed.'
          : `The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`
      );
    }

    if (createdRestrictedRole) {
      const rolledBack = await this.rollbackCreatedRestrictedRole(
        createdRestrictedRole,
        guildId,
        rollbackReason
      );
      rollbackDetails.push(
        rolledBack
          ? 'The newly created case role was removed.'
          : `The newly created case role <@&${createdRestrictedRole.id}> could not be removed; delete it or pass it as restricted-role when rerunning setup.`
      );
    }

    return rollbackDetails.join(' ');
  }

  private async rollbackCreatedVerificationChannel(
    guild: Guild,
    channelId: string,
    reason: string
  ): Promise<boolean> {
    try {
      const channels = guild.channels as {
        cache?: { get?: (id: string) => unknown };
        fetch: (id: string) => Promise<unknown> | unknown;
      };
      const channel =
        channels.cache?.get?.(channelId) ??
        (await Promise.resolve(channels.fetch(channelId)).catch(() => null));
      const deletableChannel = channel as {
        delete?: (deleteReason?: string) => Promise<unknown>;
      } | null;
      if (!deletableChannel?.delete) {
        return false;
      }

      await deletableChannel.delete(reason);
      return true;
    } catch (error) {
      console.error(`Failed to roll back verification channel ${channelId}:`, error);
      return false;
    }
  }

  private async rollbackCreatedRestrictedRole(
    role: Role,
    guildId: string,
    reason: string
  ): Promise<boolean> {
    try {
      await role.delete(reason);
      return true;
    } catch (error) {
      console.error(`Failed to roll back case role ${role.id} for guild ${guildId}:`, error);
      return false;
    }
  }
}
