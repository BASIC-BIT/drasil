import {
  ChannelType,
  Client,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  Role,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import {
  parseChannelId,
  parseRoleId,
  SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID,
} from '../constants/setupVerificationWizard';
import { INotificationManager } from '../services/NotificationManager';
import {
  ISetupDiagnosticsService,
  SetupDiagnosticReport,
} from '../services/SetupDiagnosticsService';
import {
  IProductAnalyticsService,
  NOOP_PRODUCT_ANALYTICS_SERVICE,
} from '../services/ProductAnalyticsService';
import { SetupWorkflowService } from '../services/SetupWorkflowService';

export class SetupVerificationModalHandler {
  private readonly setupWorkflowService?: SetupWorkflowService;

  public constructor(
    private readonly client: Client,
    notificationManager: INotificationManager,
    configService: IConfigService,
    setupDiagnosticsService?: ISetupDiagnosticsService,
    productAnalyticsService: IProductAnalyticsService = NOOP_PRODUCT_ANALYTICS_SERVICE
  ) {
    this.setupWorkflowService = setupDiagnosticsService
      ? new SetupWorkflowService(
          configService,
          notificationManager,
          productAnalyticsService,
          setupDiagnosticsService
        )
      : undefined;
  }

  public async handleSetupVerificationModalSubmit(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const caseRoleInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID)
      .trim();
    const adminChannelInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID)
      .trim();
    const verificationChannelInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_CHANNEL_FIELD_ID)
      .trim();

    const caseRoleId = parseRoleId(caseRoleInput);
    if (!caseRoleId) {
      await interaction.reply({
        content: 'Please provide a valid case role ID or role mention (for example `<@&123...>`).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const adminChannelId = parseChannelId(adminChannelInput);
    if (!adminChannelId) {
      await interaction.reply({
        content:
          'Please provide a valid admin channel ID or channel mention (for example `<#123...>`).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const providedVerificationChannelId = verificationChannelInput
      ? parseChannelId(verificationChannelInput)
      : null;

    if (verificationChannelInput && !providedVerificationChannelId) {
      await interaction.reply({
        content:
          'Please provide a valid verification channel ID or channel mention, or leave it blank to auto-create one.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let setupFailureDetail = 'Please check permissions and try again.';

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const moderator = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!moderator || !moderator.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'You need administrator permissions to complete setup.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!this.setupWorkflowService) {
        await interaction.reply({
          content: 'Setup diagnostics are not available in this runtime.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const caseRole = await guild.roles.fetch(caseRoleId);
      if (!caseRole) {
        await interaction.reply({
          content: `Could not find case role <@&${caseRoleId}> in this server.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const adminChannel = await guild.channels.fetch(adminChannelId);
      if (!adminChannel || adminChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: `Admin channel must be a text channel in this server. Received: <#${adminChannelId}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (providedVerificationChannelId) {
        const verificationChannel = await guild.channels.fetch(providedVerificationChannelId);
        if (!verificationChannel || verificationChannel.type !== ChannelType.GuildText) {
          await interaction.reply({
            content: `Verification channel must be a text channel in this server. Received: <#${providedVerificationChannelId}>.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      const setupResult = await this.setupWorkflowService.completeSetup({
        guild,
        guildId: interaction.guildId,
        caseRole: caseRole as Role,
        adminChannelId,
        initialVerificationChannelId: providedVerificationChannelId,
        candidateVerificationChannelId: providedVerificationChannelId,
        reportInstructionsChannelId: null,
      });

      if (setupResult.status === 'candidate_validation_failed') {
        await interaction.reply({
          content:
            'Setup not saved. Fix these errors before completing setup:\n' +
            this.formatSetupErrorMessages(setupResult.report),
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (setupResult.status === 'final_validation_failed') {
        await interaction.reply({
          content:
            'Setup not saved. Fix these errors before completing setup:\n' +
            this.formatSetupErrorMessages(setupResult.report) +
            this.formatCreatedVerificationChannelRollbackDetail(
              setupResult.setupFailureDetail,
              setupResult.createdVerificationChannelId
            ),
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (setupResult.status === 'verification_channel_failed') {
        setupFailureDetail = setupResult.setupFailureDetail;
        throw setupResult.error;
      }

      if (setupResult.status === 'config_save_failed') {
        setupFailureDetail = setupResult.setupFailureDetail;
        throw setupResult.error;
      }

      const verificationChannelMessage =
        setupResult.verificationChannelAction === 'created'
          ? `Created verification channel: <#${setupResult.verificationChannelId}>`
          : `Verification channel: <#${setupResult.verificationChannelId}>`;

      await interaction.reply({
        content:
          'Setup complete.\n' +
          `Case role: <@&${setupResult.caseRoleId}>\n` +
          `Admin channel: <#${adminChannelId}>\n` +
          `${verificationChannelMessage}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(
        '[SetupVerificationModalHandler] Error handling setup verification modal submission:',
        error
      );
      const errorResponse = {
        content: `Failed to complete setup verification. ${setupFailureDetail}`,
        flags: MessageFlags.Ephemeral,
      } as const;

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorResponse);
      } else {
        await interaction.reply(errorResponse);
      }
    }
  }

  private formatSetupErrorMessages(report: SetupDiagnosticReport): string {
    return report.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `- ${issue.message}`)
      .join('\n');
  }

  private formatCreatedVerificationChannelRollbackDetail(
    setupFailureDetail: string,
    createdVerificationChannelId: string | undefined
  ): string {
    if (!createdVerificationChannelId) {
      return '';
    }

    if (setupFailureDetail.includes('could not be removed')) {
      return `\nCreated verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`;
    }

    return `\nCreated verification channel <#${createdVerificationChannelId}> was removed.`;
  }
}
