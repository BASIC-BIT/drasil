import {
  ActionRowBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Guild,
  MessageContextMenuCommandInteraction,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  Role,
  TextInputBuilder,
  TextInputStyle,
  UserContextMenuCommandInteraction,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { ISecurityActionService, RoleIntakeProgress } from '../services/SecurityActionService';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { requestSlashCommandConfirmation } from '../utils/slashCommandConfirmations';

export const OPEN_CASE_CONTEXT_MODAL_PREFIX = 'case_open_context';
export const OPEN_CASE_MESSAGE_CONTEXT_MODAL_PREFIX = 'case_open_message_context';
export const OPEN_CASE_CONTEXT_REASON_FIELD_ID = 'case_open_reason';

type CaseCommandInteraction =
  | ChatInputCommandInteraction
  | UserContextMenuCommandInteraction
  | MessageContextMenuCommandInteraction;
type ReplyGuildInstallRequired = (interaction: CaseCommandInteraction) => Promise<void>;

export interface OpenCaseMessageContextModalData {
  targetUserId: string;
  sourceChannelId: string;
  sourceMessageId: string;
}

export function buildOpenCaseContextModalCustomId(targetUserId: string): string {
  return `${OPEN_CASE_CONTEXT_MODAL_PREFIX}:${targetUserId}`;
}

export function buildOpenCaseMessageContextModalCustomId(
  targetUserId: string,
  sourceChannelId: string,
  sourceMessageId: string
): string {
  return [
    OPEN_CASE_MESSAGE_CONTEXT_MODAL_PREFIX,
    targetUserId,
    sourceChannelId,
    sourceMessageId,
  ].join(':');
}

export function parseOpenCaseContextModalCustomId(customId: string): string | null {
  const prefix = `${OPEN_CASE_CONTEXT_MODAL_PREFIX}:`;
  if (!customId.startsWith(prefix)) {
    return null;
  }

  return customId.slice(prefix.length) || null;
}

export function parseOpenCaseMessageContextModalCustomId(
  customId: string
): OpenCaseMessageContextModalData | null {
  const [prefix, targetUserId, sourceChannelId, sourceMessageId] = customId.split(':');
  if (
    prefix !== OPEN_CASE_MESSAGE_CONTEXT_MODAL_PREFIX ||
    !targetUserId ||
    !sourceChannelId ||
    !sourceMessageId
  ) {
    return null;
  }

  return { targetUserId, sourceChannelId, sourceMessageId };
}

export class CaseCommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly securityActionService: ISecurityActionService,
    private readonly replyGuildInstallRequired: ReplyGuildInstallRequired
  ) {}

  private async requireAdministrator(
    interaction: CaseCommandInteraction,
    guild: Guild
  ): Promise<boolean> {
    const memberPermissions = interaction.memberPermissions;
    if (memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return true;
    }

    if (memberPermissions && !memberPermissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    return true;
  }

  private async requireCaseOpenPermission(
    interaction: CaseCommandInteraction,
    guild: Guild
  ): Promise<boolean> {
    const memberPermissions = interaction.memberPermissions;
    if (
      memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      memberPermissions?.has(PermissionFlagsBits.ModerateMembers)
    ) {
      return true;
    }

    if (
      memberPermissions &&
      !memberPermissions.has(PermissionFlagsBits.ModerateMembers) &&
      !memberPermissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content: 'You need Moderate Members permission to open a case.',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (
      !member ||
      (!member.permissions.has(PermissionFlagsBits.Administrator) &&
        !member.permissions.has(PermissionFlagsBits.ModerateMembers))
    ) {
      await interaction.reply({
        content: 'You need Moderate Members permission to open a case.',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    return true;
  }

  private async getCaseOpenReasonRequired(guildId: string): Promise<boolean> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    return getDetectionResponseSettings(serverConfig.settings).adminCaseOpenRequiresReason;
  }

  public async handleOpenCaseUserContextCommand(
    interaction: UserContextMenuCommandInteraction
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    if (!(await this.requireCaseOpenPermission(interaction, guild))) {
      return;
    }

    const targetUser = interaction.targetUser;
    if (targetUser.id === interaction.user.id) {
      await interaction.reply({
        content: 'You cannot open a case for yourself.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.showOpenCaseReasonModal(
      interaction,
      buildOpenCaseContextModalCustomId(targetUser.id),
      'Open Case',
      await this.getCaseOpenReasonRequired(guild.id)
    );
  }

  public async handleOpenCaseMessageContextCommand(
    interaction: MessageContextMenuCommandInteraction
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    if (!(await this.requireCaseOpenPermission(interaction, guild))) {
      return;
    }

    const targetMessage = interaction.targetMessage;
    const targetUser = targetMessage.author;
    if (targetUser.id === interaction.user.id) {
      await interaction.reply({
        content: 'You cannot open a case for yourself.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.showOpenCaseReasonModal(
      interaction,
      buildOpenCaseMessageContextModalCustomId(
        targetUser.id,
        targetMessage.channelId,
        targetMessage.id
      ),
      'Open Case from Message',
      await this.getCaseOpenReasonRequired(guild.id)
    );
  }

  private async showOpenCaseReasonModal(
    interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction,
    customId: string,
    title: string,
    reasonRequired: boolean
  ): Promise<void> {
    const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
    const reasonInput = new TextInputBuilder()
      .setCustomId(OPEN_CASE_CONTEXT_REASON_FIELD_ID)
      .setLabel(reasonRequired ? 'Reason' : 'Reason (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(reasonRequired)
      .setMaxLength(500)
      .setPlaceholder('Why should moderators review this user?');

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  public async handleCaseCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === 'open') {
      if (!(await this.requireCaseOpenPermission(interaction, guild))) {
        return;
      }
      await this.handleCaseUserCommand(interaction, guild);
      return;
    }

    if (!(await this.requireAdministrator(interaction, guild))) {
      return;
    }

    if (subcommand === 'repair') {
      await this.handleCaseRepairCommand(interaction, guild);
      return;
    }

    if (subcommand === 'refresh') {
      await this.handleCaseRefreshCommand(interaction, guild);
      return;
    }

    if (subcommand === 'intake-role') {
      await this.handleCaseRoleIntakeCommand(interaction, guild);
      return;
    }

    await interaction.reply({
      content: 'Unsupported case subcommand.',
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleCaseUserCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<void> {
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason')?.trim() || undefined;
    if ((await this.getCaseOpenReasonRequired(guild.id)) && !reason) {
      await interaction.reply({
        content: 'A case reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await requestSlashCommandConfirmation(interaction, {
      message: `Open a case for ${targetUser.tag} and apply the case role?`,
      confirmLabel: 'Open Case',
      confirmStyle: ButtonStyle.Primary,
      execute: async (buttonInteraction) => {
        await buttonInteraction.update({
          content: `Opening case for ${targetUser.tag}...`,
          components: [],
        });
        try {
          const result = await this.securityActionService.openAdminCase(
            targetMember,
            interaction.user,
            {
              action: 'open_case',
              reason,
            }
          );
          if (!result.opened) {
            throw new Error('Case flow returned false');
          }
          const content = result.caseRoleActive
            ? `Opened a case for ${targetUser.tag} and applied the case role.`
            : `Opened a case for ${targetUser.tag}, but I could not apply the case role. Check bot permissions and role hierarchy.`;
          await buttonInteraction.editReply({
            content,
            allowedMentions: { parse: [] },
          });
        } catch (error) {
          console.error('Failed to open admin case:', error);
          await buttonInteraction.editReply({
            content: `Failed to open a case for ${targetUser.tag}. Please try again later.`,
          });
        }
      },
    });
  }

  private async handleCaseRepairCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<void> {
    const targetUser = interaction.options.getUser('user', true);
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await this.securityActionService.repairActiveCase(targetMember);
      const lines = [result.message];

      if (result.threadId) {
        lines.push(`Thread: https://discord.com/channels/${guild.id}/${result.threadId}`);
      }
      lines.push(
        `Thread created: \`${result.threadCreated ? 'yes' : 'no'}\``,
        `User added: \`${result.userAdded ? 'yes' : 'no'}\``,
        `Prompt sent: \`${result.promptSent ? 'yes' : 'no'}\``,
        `Prompt already present: \`${result.promptAlreadyPresent ? 'yes' : 'no'}\``
      );

      await interaction.editReply({
        content: lines.join('\n'),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Failed to repair active case:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await interaction.editReply({
        content: `Failed to repair the active case for ${targetUser.tag}: ${message}`,
        allowedMentions: { parse: [] },
      });
    }
  }

  private async handleCaseRefreshCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<void> {
    const targetUser = interaction.options.getUser('user', true);
    const caseId = interaction.options.getString('case-id')?.trim() || undefined;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await this.securityActionService.refreshCaseNotification(
        guild.id,
        targetUser,
        caseId
      );

      const lines = [result.message];
      if (result.verificationEventId) {
        lines.push(`Case: \`${result.verificationEventId}\``);
      }
      if (result.status) {
        lines.push(`Status: \`${result.status}\``);
      }
      if (result.notificationChannelId && result.notificationMessageId) {
        lines.push(
          `Notification: https://discord.com/channels/${guild.id}/${result.notificationChannelId}/${result.notificationMessageId}`
        );
      }

      await interaction.editReply({
        content: lines.join('\n'),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Failed to refresh case notification:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await interaction.editReply({
        content: `Failed to refresh case notification for ${targetUser.tag}: ${message}`,
        allowedMentions: { parse: [] },
      });
    }
  }

  private async resolveRoleIntakeRole(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<Role | null> {
    const explicitRole = interaction.options.getRole('role');
    if (explicitRole) {
      return explicitRole as Role;
    }

    const serverConfig = await this.configService.getServerConfig(guild.id);
    if (!serverConfig.case_role_id) {
      return null;
    }

    return await guild.roles.fetch(serverConfig.case_role_id).catch(() => null);
  }

  private async handleCaseRoleIntakeCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<void> {
    const role = await this.resolveRoleIntakeRole(interaction, guild);
    if (!role) {
      await interaction.reply({
        content:
          'No role was provided and this server does not have a configured case role. Provide `role` or run setup first.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const action = 'open_case' as const;
    const execute = interaction.options.getBoolean('execute') ?? false;
    const limit = interaction.options.getInteger('limit') ?? undefined;
    const reason = interaction.options.getString('reason')?.trim() || undefined;

    if (execute && (await this.getCaseOpenReasonRequired(guild.id)) && !reason) {
      await interaction.reply({
        content: 'A case reason is required before executing role intake.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (execute) {
      await requestSlashCommandConfirmation(interaction, {
        message: `Execute role intake for ${role.name}? This will open cases and apply the case role to eligible members${limit ? `, up to ${limit} members` : ''}.`,
        confirmLabel: 'Execute Intake',
        confirmStyle: ButtonStyle.Danger,
        execute: async (buttonInteraction) => {
          await buttonInteraction.update({
            content: `Executing role intake for ${role.name}...`,
            components: [],
          });
          await this.executeRoleIntake(
            buttonInteraction,
            role,
            interaction.user,
            reason,
            action,
            execute,
            limit
          );
        },
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.executeRoleIntake(
      interaction,
      role,
      interaction.user,
      reason,
      action,
      execute,
      limit
    );
  }

  private async executeRoleIntake(
    interaction: Pick<ChatInputCommandInteraction, 'editReply'>,
    role: Role,
    moderator: ChatInputCommandInteraction['user'],
    reason: string | undefined,
    action: 'open_case',
    execute: boolean,
    limit: number | undefined
  ): Promise<void> {
    let lastProgressUpdateAt = 0;
    try {
      const result = await this.securityActionService.intakeRoleMembers({
        role,
        moderator,
        reason,
        action,
        execute,
        limit,
        onProgress: execute
          ? async (progress): Promise<void> => {
              const now = Date.now();
              const shouldUpdate =
                progress.completedMembers === 1 ||
                progress.completedMembers === progress.result.processed ||
                progress.completedMembers % 5 === 0 ||
                now - lastProgressUpdateAt > 15_000;
              if (!shouldUpdate) {
                return;
              }

              lastProgressUpdateAt = now;
              await interaction.editReply({
                content: this.formatRoleIntakeProgress(progress),
                allowedMentions: { parse: [] },
              });
            }
          : undefined,
      });

      await interaction.editReply({
        content: this.formatRoleIntakeResult(result),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Failed to intake role members:', error);
      await interaction.editReply({
        content: `Failed to intake members from ${role.name}. Please check bot permissions and try again.`,
      });
    }
  }

  private formatRoleIntakeResult(result: {
    batchId: string;
    roleId: string;
    roleName: string;
    action: string;
    execute: boolean;
    totalMembers: number;
    eligibleMembers: number;
    processed: number;
    opened: number;
    skippedBots: number;
    skippedActiveCases: number;
    skippedOverLimit: number;
    failed: number;
    failures: Array<{ userId: string; message: string }>;
  }): string {
    const mode = result.execute ? 'executed' : 'dry run';
    const lines = [
      `Role intake ${mode} for ${result.roleName} (${result.roleId})`,
      `Batch: ${result.batchId}`,
      `Action: ${result.action}`,
      `Total role members: ${result.totalMembers}`,
      `Eligible non-bot members: ${result.eligibleMembers}`,
      `Selected for this batch: ${result.processed}`,
      `Cases opened: ${result.opened}`,
      `Skipped bots: ${result.skippedBots}`,
      `Skipped active cases: ${result.skippedActiveCases}`,
      `Skipped over limit: ${result.skippedOverLimit}`,
      `Failures: ${result.failed}`,
    ];

    if (!result.execute) {
      lines.push('Re-run with `execute: true` to open cases.');
    }
    if (result.failures.length > 0) {
      lines.push(
        `First failures: ${result.failures
          .slice(0, 3)
          .map((failure) => `${failure.userId}: ${failure.message}`)
          .join('; ')}`
      );
    }

    return lines.join('\n');
  }

  private formatRoleIntakeProgress(progress: RoleIntakeProgress): string {
    const result = progress.result;
    return [
      `Executing role intake for ${result.roleName} (${result.roleId})`,
      `Batch: ${result.batchId}`,
      `Action: ${result.action}`,
      `Progress: ${progress.completedMembers}/${result.processed} selected members processed`,
      `Cases opened: ${result.opened}`,
      `Skipped active cases: ${result.skippedActiveCases}`,
      `Failures: ${result.failed}`,
    ].join('\n');
  }
}
