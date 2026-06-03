import { ChannelType, ChatInputCommandInteraction, Guild, MessageFlags } from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { ServerSettings } from '../repositories/types';
import {
  IRestrictedRoleLockdownService,
  RestrictedLockdownReport,
} from '../services/RestrictedRoleLockdownService';
import {
  getRestrictedLockdownSettings,
  RESTRICTED_LOCKDOWN_ALLOWED_CATEGORY_IDS_SETTING_KEY,
  RESTRICTED_LOCKDOWN_ALLOWED_CHANNEL_IDS_SETTING_KEY,
  RESTRICTED_LOCKDOWN_ENABLED_SETTING_KEY,
} from '../utils/restrictedLockdownSettings';
import { truncatePreview } from '../utils/textPreview';

export class LockdownConfigCommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly restrictedRoleLockdownService?: IRestrictedRoleLockdownService
  ) {}

  public async handleLockdownConfigCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const serverConfig = await this.configService.getServerConfig(guild.id);
      await interaction.editReply({
        content: this.formatRestrictedLockdownSettings(
          guild.id,
          serverConfig.verification_channel_id,
          serverConfig.settings
        ),
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (subcommand === 'disable') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.configService.updateServerSettings(guild.id, {
        [RESTRICTED_LOCKDOWN_ENABLED_SETTING_KEY]: false,
      });
      await interaction.editReply({
        content:
          'Restricted-role lockdown marked disabled. Existing Discord channel overwrites were not removed.',
      });
      return;
    }

    if (subcommand === 'allow-add' || subcommand === 'allow-remove') {
      await this.handleLockdownAllowListCommand(interaction, guild.id, subcommand === 'allow-add');
      return;
    }

    if (!this.restrictedRoleLockdownService) {
      await interaction.reply({
        content: 'Restricted-role lockdown is not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const report =
        subcommand === 'apply'
          ? await this.restrictedRoleLockdownService.applyGuild(guild, interaction.user.id, {
              unsyncAllowedChannels: interaction.options.getBoolean('unsync-allowed') ?? false,
            })
          : await this.restrictedRoleLockdownService.auditGuild(guild);

      await interaction.editReply({
        content: this.formatRestrictedLockdownReport(report, subcommand === 'apply'),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to run lockdown ${subcommand} for guild ${guild.id}:`, error);
      await interaction.editReply({
        content: 'Failed to run restricted-role lockdown. Please check permissions and try again.',
      });
    }
  }

  private async handleLockdownAllowListCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string,
    added: boolean
  ): Promise<void> {
    const channel = interaction.options.getChannel('channel', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getRestrictedLockdownSettings(serverConfig.settings);
    const isCategory = channel.type === ChannelType.GuildCategory;
    const channelIds = new Set(settings.allowedChannelIds);
    const categoryIds = new Set(settings.allowedCategoryIds);
    const targetIds = isCategory ? categoryIds : channelIds;

    if (added) {
      targetIds.add(channel.id);
    } else {
      targetIds.delete(channel.id);
    }

    await this.configService.updateServerSettings(guildId, {
      [RESTRICTED_LOCKDOWN_ALLOWED_CHANNEL_IDS_SETTING_KEY]: [...channelIds],
      [RESTRICTED_LOCKDOWN_ALLOWED_CATEGORY_IDS_SETTING_KEY]: [...categoryIds],
    });

    await interaction.editReply({
      content: `${isCategory ? 'Category' : 'Channel'} <#${channel.id}> ${added ? 'added to' : 'removed from'} the restricted lockdown allow-list. Run \`/config lockdown audit\` to check for conflicts.`,
      allowedMentions: { parse: [] },
    });
  }

  private formatRestrictedLockdownSettings(
    guildId: string,
    verificationChannelId: string | null,
    settings: ServerSettings
  ): string {
    const lockdownSettings = getRestrictedLockdownSettings(settings);
    const autoAllowedChannelIds = this.getRestrictedLockdownAutoAllowedChannelIds(
      verificationChannelId,
      settings
    );
    return [
      `Restricted lockdown: \`${lockdownSettings.enabled ? 'enabled' : 'disabled'}\``,
      `Explicit allowed channels: ${this.formatChannelIdList(lockdownSettings.allowedChannelIds)}`,
      `Explicit allowed categories: ${this.formatChannelIdList(lockdownSettings.allowedCategoryIds)}`,
      `Auto-allowed channels: ${this.formatChannelIdList(autoAllowedChannelIds)}`,
      `Guild ID: \`${guildId}\``,
      '',
      'Run `/config lockdown audit` to preview missing denies and `/config lockdown apply` to write them.',
      'Lockdown does not delete messages. Message cleanup should be a separate moderator-confirmed action.',
    ].join('\n');
  }

  private formatRestrictedLockdownReport(
    report: RestrictedLockdownReport,
    applied: boolean
  ): string {
    const actionLabel = applied ? 'apply' : 'audit';
    const status =
      report.errorCount > 0
        ? `Restricted lockdown ${actionLabel} found ${report.errorCount} error(s) and ${report.warningCount} warning(s).`
        : report.warningCount > 0
          ? `Restricted lockdown ${actionLabel} found ${report.warningCount} warning(s).`
          : `Restricted lockdown ${actionLabel} passed with no issues.`;

    const lines = [
      status,
      `Mode: \`${report.enabled ? 'enabled' : 'disabled'}\``,
      `Planned deny writes: \`${report.plannedActions.length}\``,
      `Applied deny writes: \`${report.appliedActions.length}\``,
      `Unsynced allowed channels: \`${report.unsyncedAllowedChannels.length}\``,
      `Allowed channels: ${this.formatChannelIdList(report.allowedChannelIds)}`,
      `Allowed categories: ${this.formatChannelIdList(report.allowedCategoryIds)}`,
      `Auto-allowed channels: ${this.formatChannelIdList(report.autoAllowedChannelIds)}`,
    ];

    if (report.syncedAllowedChannels.length > 0) {
      lines.push(
        '',
        'Synced allowed-channel blockers:',
        ...report.syncedAllowedChannels
          .slice(0, 8)
          .map((action) => `- #${action.channelName} (${action.channelId})`)
      );
      if (report.syncedAllowedChannels.length > 8) {
        lines.push(`- ... +${report.syncedAllowedChannels.length - 8} more blocker(s)`);
      }
    }

    if (report.unsyncedAllowedChannels.length > 0) {
      lines.push(
        '',
        'Allowed channels unsynced before apply:',
        ...report.unsyncedAllowedChannels
          .slice(0, 8)
          .map((action) => `- #${action.channelName} (${action.channelId})`)
      );
      if (report.unsyncedAllowedChannels.length > 8) {
        lines.push(`- ... +${report.unsyncedAllowedChannels.length - 8} more unsynced channel(s)`);
      }
    }

    if (report.issues.length > 0) {
      const sortedIssues = [...report.issues].sort((left, right) =>
        left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1
      );
      lines.push('', 'Issues:');
      for (const issue of sortedIssues.slice(0, 12)) {
        lines.push(`- [${issue.severity.toUpperCase()}] ${issue.message}`);
      }
      if (sortedIssues.length > 12) {
        lines.push(`- ... +${sortedIssues.length - 12} more issue(s)`);
      }
    }

    if (report.plannedActions.length > 0) {
      lines.push('', applied ? 'Remaining planned writes:' : 'Planned writes:');
      for (const action of report.plannedActions.slice(0, 8)) {
        lines.push(`- ${action.scope} #${action.channelName} (${action.channelId})`);
      }
      if (report.plannedActions.length > 8) {
        lines.push(`- ... +${report.plannedActions.length - 8} more write(s)`);
      }
    }

    lines.push(
      '',
      'Role-order note: keep the Drasil bot role above the restricted role for assignment. Channel overwrites, not role order, decide quarantine visibility.',
      'Message deletion is intentionally not part of lockdown V1.'
    );

    return truncatePreview(lines.join('\n'), 1900);
  }

  private getRestrictedLockdownAutoAllowedChannelIds(
    verificationChannelId: string | null,
    settings: ServerSettings
  ): string[] {
    const ids = new Set<string>();
    const reportInstructionsChannelId = settings.report_instructions_channel_id;

    if (verificationChannelId) {
      ids.add(verificationChannelId);
    }

    if (typeof reportInstructionsChannelId === 'string' && reportInstructionsChannelId) {
      ids.add(reportInstructionsChannelId);
    }

    return [...ids];
  }

  private formatChannelIdList(channelIds: readonly string[]): string {
    if (channelIds.length === 0) {
      return '`none`';
    }

    return channelIds.map((channelId) => `<#${channelId}>`).join(', ');
  }
}
