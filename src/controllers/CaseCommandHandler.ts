import {
  ButtonStyle,
  ChatInputCommandInteraction,
  Guild,
  MessageFlags,
  PermissionFlagsBits,
  Role,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { AdminCaseAction, ISecurityActionService } from '../services/SecurityActionService';
import { requestSlashCommandConfirmation } from '../utils/slashCommandConfirmations';

type ReplyGuildInstallRequired = (interaction: ChatInputCommandInteraction) => Promise<void>;

export class CaseCommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly securityActionService: ISecurityActionService,
    private readonly replyGuildInstallRequired: ReplyGuildInstallRequired
  ) {}

  private async requireAdministrator(
    interaction: ChatInputCommandInteraction,
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

  public async handleCaseCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    if (!(await this.requireAdministrator(interaction, guild))) {
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === 'open') {
      const restrict = interaction.options.getBoolean('restrict') ?? true;
      await this.handleCaseUserCommand(interaction, guild, restrict ? 'restrict' : 'open_case');
      return;
    }

    if (subcommand === 'repair') {
      await this.handleCaseRepairCommand(interaction, guild);
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
    guild: Guild,
    action: AdminCaseAction
  ): Promise<void> {
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason')?.trim() || undefined;
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await requestSlashCommandConfirmation(interaction, {
      message:
        action === 'restrict'
          ? `Open a case for ${targetUser.tag} and restrict them pending review?`
          : `Open an unrestricted case for ${targetUser.tag}?`,
      confirmLabel: action === 'restrict' ? 'Open And Restrict' : 'Open Case',
      confirmStyle: action === 'restrict' ? ButtonStyle.Danger : ButtonStyle.Primary,
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
              action,
              reason,
            }
          );
          if (!result.opened) {
            throw new Error('Case flow returned false');
          }
          const content =
            action === 'restrict'
              ? result.restricted
                ? `Opened a case for ${targetUser.tag} and restricted them pending review.`
                : `Opened a case for ${targetUser.tag}, but I could not apply the restricted role. Check bot permissions and role hierarchy.`
              : `Opened an unrestricted case for ${targetUser.tag}.`;
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

  private async resolveRoleIntakeRole(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<Role | null> {
    const explicitRole = interaction.options.getRole('role');
    if (explicitRole) {
      return explicitRole as Role;
    }

    const serverConfig = await this.configService.getServerConfig(guild.id);
    if (!serverConfig.restricted_role_id) {
      return null;
    }

    return await guild.roles.fetch(serverConfig.restricted_role_id).catch(() => null);
  }

  private async handleCaseRoleIntakeCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<void> {
    const role = await this.resolveRoleIntakeRole(interaction, guild);
    if (!role) {
      await interaction.reply({
        content:
          'No role was provided and this server does not have a configured restricted role. Provide `role` or run setup first.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawAction = interaction.options.getString('action') ?? 'open_case';
    const action: AdminCaseAction =
      rawAction === 'open_case' || rawAction === 'restrict' ? rawAction : 'open_case';
    const execute = interaction.options.getBoolean('execute') ?? false;
    const limit = interaction.options.getInteger('limit') ?? undefined;
    const reason = interaction.options.getString('reason')?.trim() || undefined;

    if (execute) {
      await requestSlashCommandConfirmation(interaction, {
        message: `Execute role intake for ${role.name}? This will ${action === 'restrict' ? 'open cases and restrict eligible members' : 'open cases for eligible members'}${limit ? `, up to ${limit} members` : ''}.`,
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
    action: AdminCaseAction,
    execute: boolean,
    limit: number | undefined
  ): Promise<void> {
    try {
      const result = await this.securityActionService.intakeRoleMembers({
        role,
        moderator,
        reason,
        action,
        execute,
        limit,
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
    action: AdminCaseAction;
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
}
