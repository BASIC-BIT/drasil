import {
  ButtonStyle,
  ChatInputCommandInteraction,
  Guild,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { ISecurityActionService } from '../services/SecurityActionService';
import { IUserModerationService } from '../services/UserModerationService';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { requestSlashCommandConfirmation } from '../utils/slashCommandConfirmations';

type ReplyGuildInstallRequired = (interaction: ChatInputCommandInteraction) => Promise<void>;

export class ModerationCommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly userModerationService: IUserModerationService,
    private readonly securityActionService: ISecurityActionService,
    private readonly replyGuildInstallRequired: ReplyGuildInstallRequired
  ) {}

  public async handleBanCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      await interaction.reply({
        content: 'You must specify a user to ban.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = interaction.options.getString('reason') || 'No reason provided';
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    let hasBanPermission = interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers);
    if (hasBanPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      hasBanPermission = invokingMember
        ? invokingMember.permissionsIn(interaction.channelId).has(PermissionFlagsBits.BanMembers)
        : false;
    }

    if (!hasBanPermission) {
      await interaction.reply({
        content: 'You need Ban Members permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await this.canUseModeratorBanAction(guild))) {
      await interaction.reply({
        content:
          'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    await requestSlashCommandConfirmation(interaction, {
      message: member
        ? `Ban ${targetUser.tag} from this server?`
        : `Ban ${targetUser.tag} from this server by ID?`,
      confirmLabel: member ? 'Ban User' : 'Ban by ID',
      confirmStyle: ButtonStyle.Danger,
      execute: async (buttonInteraction) => {
        await buttonInteraction.update({ content: `Banning ${targetUser.tag}...`, components: [] });
        try {
          if (member) {
            await this.userModerationService.banUser(member, reason, interaction.user);
          } else {
            await this.userModerationService.banUserById(
              guild,
              targetUser.id,
              reason,
              interaction.user
            );
          }
          await buttonInteraction.editReply({ content: `User ${targetUser.tag} has been banned.` });
        } catch (error) {
          console.error('Failed to ban user via command:', error);
          await buttonInteraction.editReply({
            content: `Failed to ban ${targetUser.tag}. Please try again later.`,
          });
        }
      },
    });
  }

  public async handleAuditCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    let hasManageGuildPermission = interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    );
    if (hasManageGuildPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      hasManageGuildPermission = invokingMember
        ? invokingMember.permissionsIn(interaction.channelId).has(PermissionFlagsBits.ManageGuild)
        : false;
    }

    if (!hasManageGuildPermission) {
      await interaction.reply({
        content: 'You need Manage Server permission to audit detection accounting.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    const detectionEventId = interaction.options.getString('detection-id', true).trim();
    const reason = interaction.options.getString('reason')?.trim() || undefined;

    if (subcommand !== 'ignore-detection' && subcommand !== 'restore-detection') {
      await interaction.reply({
        content: 'Unsupported /audit subcommand.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isRestore = subcommand === 'restore-detection';
    await requestSlashCommandConfirmation(interaction, {
      message: `${isRestore ? 'Restore' : 'Ignore'} detection ${detectionEventId} for future accounting?`,
      confirmLabel: isRestore ? 'Restore Detection' : 'Ignore Detection',
      confirmStyle: isRestore ? ButtonStyle.Success : ButtonStyle.Danger,
      execute: async (buttonInteraction) => {
        await buttonInteraction.update({
          content: `${isRestore ? 'Restoring' : 'Ignoring'} detection ${detectionEventId}...`,
          components: [],
        });
        try {
          const updatedDetection = isRestore
            ? await this.securityActionService.restoreDetectionAccounting(
                guild.id,
                detectionEventId,
                interaction.user,
                reason
              )
            : await this.securityActionService.excludeDetectionFromAccounting(
                guild.id,
                detectionEventId,
                interaction.user,
                reason
              );
          await buttonInteraction.editReply({
            content: updatedDetection
              ? isRestore
                ? `Detection ${detectionEventId} now counts toward future accounting again.`
                : `Detection ${detectionEventId} is now ignored for future accounting.`
              : `Detection ${detectionEventId} was not found or is not auditable from this server.`,
          });
        } catch (error) {
          console.error(`Failed to audit detection ${detectionEventId}:`, error);
          await buttonInteraction.editReply({
            content: 'Failed to update detection accounting. Please try again later.',
          });
        }
      },
    });
  }

  public async handleFlagUserCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await requestSlashCommandConfirmation(interaction, {
      message: `Flag ${targetUser.tag} and restrict them pending moderator review?`,
      confirmLabel: 'Flag User',
      confirmStyle: ButtonStyle.Danger,
      execute: async (buttonInteraction) => {
        await buttonInteraction.update({
          content: `Flagging ${targetUser.tag}...`,
          components: [],
        });
        try {
          await this.securityActionService.handleManualFlag(
            targetMember,
            interaction.user,
            reason ?? undefined
          );
          await buttonInteraction.editReply({
            content: `Flag request for ${targetUser.tag} received. Initiating verification process...`,
          });
        } catch (error) {
          console.error('Failed to manually flag user:', error);
          await buttonInteraction.editReply({
            content: `Failed to flag ${targetUser.tag}. Please try again later.`,
          });
        }
      },
    });
  }

  private async canUseModeratorBanAction(guild: Guild): Promise<boolean> {
    const serverConfig = await this.configService.getServerConfig(guild.id);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (!settings.moderatorBanActionEnabled) {
      return false;
    }

    const botMember =
      guild.members.me ??
      (typeof guild.members.fetchMe === 'function'
        ? await guild.members.fetchMe().catch(() => null)
        : null);
    return botMember?.permissions.has(PermissionFlagsBits.BanMembers) ?? false;
  }
}
