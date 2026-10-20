import type { BotApplication } from '../application/createBotApplication';
import { requireSetupOutcome } from '../application/adapters/setup';
import { createDiscordActionContext } from '../application/context';
import {
  ChannelType,
  Client,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import {
  parseChannelId,
  parseRoleId,
  SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID,
} from '../constants/setupVerificationWizard';
import {
  ISetupDiagnosticsService,
  SetupDiagnosticReport,
} from '../services/SetupDiagnosticsService';

export class SetupVerificationModalHandler {
  public constructor(
    private readonly client: Client,
    private readonly setupDiagnosticsService?: ISetupDiagnosticsService,
    private readonly application?: BotApplication
  ) {}

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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let setupFailureDetail = 'Please check permissions and try again.';

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const moderator = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!moderator || !moderator.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.editReply({
          content: 'You need administrator permissions to complete setup.',
        });
        return;
      }

      if (!this.setupDiagnosticsService || !this.application) {
        await interaction.editReply({
          content: 'Setup diagnostics are not available in this runtime.',
        });
        return;
      }

      const caseRole = await guild.roles.fetch(caseRoleId);
      if (!caseRole) {
        await interaction.editReply({
          content: `Could not find case role <@&${caseRoleId}> in this server.`,
        });
        return;
      }

      const adminChannel = await guild.channels.fetch(adminChannelId);
      if (!adminChannel || adminChannel.type !== ChannelType.GuildText) {
        await interaction.editReply({
          content: `Admin channel must be a text channel in this server. Received: <#${adminChannelId}>.`,
        });
        return;
      }

      if (providedVerificationChannelId) {
        const verificationChannel = await guild.channels.fetch(providedVerificationChannelId);
        if (!verificationChannel || verificationChannel.type !== ChannelType.GuildText) {
          await interaction.editReply({
            content: `Verification channel must be a text channel in this server. Received: <#${providedVerificationChannelId}>.`,
          });
          return;
        }
      }

      const outcome = requireSetupOutcome(
        await this.application.setupRuntime.execute(
          createDiscordActionContext({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            requestId: interaction.id,
          }),
          {
            kind: 'complete_setup_verification',
            mode: 'verification_modal',
            adminChannelId,
            caseRoleId,
            verificationChannelId: providedVerificationChannelId,
            reportInstructionsChannelId: null,
            onboardingWizard: false,
          },
          {
            kind: 'direct',
            guild,
            caseRole,
            verificationChannel: null,
            reportChannel: null,
            actorLabel: interaction.user.username,
            captureAnalytics: false,
            publishPanel: false,
          }
        )
      );
      if (outcome.kind !== 'complete_setup_verification')
        throw new Error('Setup outcome mismatch.');
      const setupResult = outcome.result;
      if (setupResult.status === 'invalid_selection') throw new Error(setupResult.detail);
      if (
        setupResult.status === 'ambiguous_case_role' ||
        setupResult.status === 'ambiguous_verification_channel'
      )
        throw new Error('Choose setup resources before continuing.');

      if (setupResult.status === 'candidate_validation_failed') {
        await interaction.editReply({
          content:
            'Setup not saved. Fix these errors before completing setup:\n' +
            this.formatSetupErrorMessages(setupResult.report),
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (setupResult.status === 'final_validation_failed') {
        await interaction.editReply({
          content:
            'Setup not saved. Fix these errors before completing setup:\n' +
            this.formatSetupErrorMessages(setupResult.report) +
            this.formatCreatedVerificationChannelRollbackDetail(
              setupResult.setupFailureDetail,
              setupResult.createdVerificationChannelId
            ),
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

      await interaction.editReply({
        content:
          'Setup complete.\n' +
          `Case role: <@&${setupResult.caseRoleId}>\n` +
          `Admin channel: <#${adminChannelId}>\n` +
          `${verificationChannelMessage}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(
        '[SetupVerificationModalHandler] Error handling setup verification modal submission:',
        error
      );
      const errorResponse = {
        content: `Failed to complete setup verification. ${setupFailureDetail}`,
      } as const;

      await interaction.editReply(errorResponse);
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
