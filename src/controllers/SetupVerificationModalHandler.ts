import {
  ChannelType,
  Client,
  Guild,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
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
import { ISetupDiagnosticsService } from '../services/SetupDiagnosticsService';

export class SetupVerificationModalHandler {
  public constructor(
    private readonly client: Client,
    private readonly notificationManager: INotificationManager,
    private readonly configService: IConfigService,
    private readonly setupDiagnosticsService?: ISetupDiagnosticsService
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

    const restrictedRoleInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID)
      .trim();
    const adminChannelInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID)
      .trim();
    const verificationChannelInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_CHANNEL_FIELD_ID)
      .trim();

    const restrictedRoleId = parseRoleId(restrictedRoleInput);
    if (!restrictedRoleId) {
      await interaction.reply({
        content:
          'Please provide a valid restricted role ID or role mention (for example `<@&123...>`).',
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
    const createdSetupArtifacts: { verificationChannelId?: string } = {};

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

      const restrictedRole = await guild.roles.fetch(restrictedRoleId);
      if (!restrictedRole) {
        await interaction.reply({
          content: `Could not find restricted role <@&${restrictedRoleId}> in this server.`,
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

      let verificationChannelId = providedVerificationChannelId;
      let verificationChannelWasCreated = false;

      if (verificationChannelId) {
        const verificationChannel = await guild.channels.fetch(verificationChannelId);
        if (!verificationChannel || verificationChannel.type !== ChannelType.GuildText) {
          await interaction.reply({
            content: `Verification channel must be a text channel in this server. Received: <#${verificationChannelId}>.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      } else {
        if (this.setupDiagnosticsService) {
          const report = await this.setupDiagnosticsService.validateSetupCandidate(guild, {
            restrictedRoleId,
            willCreateRestrictedRole: false,
            adminChannelId,
            verificationChannelId: null,
            willCreateVerificationChannel: true,
            reportInstructionsChannelId: null,
          });
          if (report.errorCount > 0) {
            await interaction.reply({
              content:
                'Setup not saved. Fix these errors before completing setup:\n' +
                report.issues
                  .filter((issue) => issue.severity === 'error')
                  .map((issue) => `- ${issue.message}`)
                  .join('\n'),
              flags: MessageFlags.Ephemeral,
              allowedMentions: { parse: [] },
            });
            return;
          }
        }

        const createdChannelId = await this.notificationManager.setupVerificationChannel(
          guild,
          restrictedRoleId,
          false,
          (channelId) => {
            createdSetupArtifacts.verificationChannelId = channelId;
          }
        );
        if (!createdChannelId) {
          throw new Error('Failed to create a verification channel during setup.');
        }
        verificationChannelId = createdChannelId;
        verificationChannelWasCreated = Boolean(createdSetupArtifacts.verificationChannelId);
      }

      if (this.setupDiagnosticsService) {
        const report = await this.setupDiagnosticsService.validateSetupCandidate(guild, {
          restrictedRoleId,
          willCreateRestrictedRole: false,
          adminChannelId,
          verificationChannelId,
          willCreateVerificationChannel: false,
          reportInstructionsChannelId: null,
        });
        if (report.errorCount > 0) {
          let rollbackDetail = '';
          if (createdSetupArtifacts.verificationChannelId) {
            const rolledBack = await this.rollbackCreatedVerificationChannel(
              guild,
              createdSetupArtifacts.verificationChannelId,
              'Rolling back Drasil setup after final validation failed'
            );
            rollbackDetail = rolledBack
              ? `\nCreated verification channel <#${createdSetupArtifacts.verificationChannelId}> was removed.`
              : `\nCreated verification channel <#${createdSetupArtifacts.verificationChannelId}> could not be removed; delete it before rerunning setup.`;
          }
          await interaction.reply({
            content:
              'Setup not saved. Fix these errors before completing setup:\n' +
              report.issues
                .filter((issue) => issue.severity === 'error')
                .map((issue) => `- ${issue.message}`)
                .join('\n') +
              rollbackDetail,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }
      }

      try {
        await this.configService.updateServerConfig(interaction.guildId, {
          restricted_role_id: restrictedRoleId,
          admin_channel_id: adminChannelId,
          verification_channel_id: verificationChannelId,
        });
      } catch (error) {
        if (createdSetupArtifacts.verificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdSetupArtifacts.verificationChannelId,
            'Rolling back Drasil setup after config save failed'
          );
          setupFailureDetail = rolledBack
            ? 'Configuration could not be saved. The newly created verification channel was removed.'
            : `Configuration could not be saved. The newly created verification channel <#${createdSetupArtifacts.verificationChannelId}> could not be removed; delete it before rerunning setup.`;
        }
        throw error;
      }

      const verificationChannelMessage = verificationChannelWasCreated
        ? `Created verification channel: <#${verificationChannelId}>`
        : `Verification channel: <#${verificationChannelId}>`;

      await interaction.reply({
        content:
          'Setup complete.\n' +
          `Restricted role: <@&${restrictedRoleId}>\n` +
          `Admin channel: <#${adminChannelId}>\n` +
          `${verificationChannelMessage}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(
        '[InteractionHandler] Error handling setup verification modal submission:',
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

  private async rollbackCreatedVerificationChannel(
    guild: Guild,
    channelId: string,
    reason: string
  ): Promise<boolean> {
    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
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
}
