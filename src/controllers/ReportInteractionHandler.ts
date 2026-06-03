import {
  ButtonInteraction,
  ChannelType,
  Client,
  GuildMember,
  InteractionContextType,
  MessageFlags,
  ModalSubmitInteraction,
  TextChannel,
  ThreadChannel,
  User,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import {
  IReportIntakeService,
  REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX,
} from '../services/ReportIntakeService';
import {
  ISecurityActionService,
  type MessageReportAttachment,
} from '../services/SecurityActionService';
import { IThreadManager } from '../services/ThreadManager';
import {
  DEFAULT_USER_REPORT_REASON_REQUIRED,
  getUserReportSettings,
  REPORT_MESSAGE_REASON_FIELD_ID,
  USER_REPORT_MESSAGE_CONTENT_MAX_LENGTH,
} from '../utils/userReportSettings';

export const REPORT_USER_INITIATE_CUSTOM_ID = 'report_user_initiate';
export const REPORT_USER_TYPED_MODAL_ID = 'report_user_modal_submit';

const REPORT_USER_TARGET_FIELD_ID = 'report_target_user_input';
const REPORT_USER_REASON_FIELD_ID = 'report_reason';

type UserResolution =
  | { status: 'found'; userId: string }
  | { status: 'not_found' }
  | { status: 'ambiguous' };

export class ReportInteractionHandler {
  public constructor(
    private readonly client: Client,
    private readonly securityActionService: ISecurityActionService,
    private readonly configService: IConfigService,
    private readonly threadManager: IThreadManager,
    private readonly reportIntakeService?: IReportIntakeService
  ) {}

  public async handleReportUserInitiate(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let thread: ThreadChannel | null = null;
    let intakeActivated = false;
    try {
      if (!this.reportIntakeService) {
        await interaction.editReply({ content: 'Report intake tracking is not available.' });
        return;
      }

      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.editReply({
          content: 'Report intake threads can only be opened in a server.',
        });
        return;
      }

      if (interaction.channel?.type !== ChannelType.GuildText) {
        await interaction.editReply({
          content: 'Report intake threads can only be opened from a server text channel.',
        });
        return;
      }

      const guild = await this.client.guilds.fetch(guildId);
      const reporter = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!reporter) {
        await interaction.editReply({
          content:
            'Could not open a report thread because your server membership could not be loaded.',
        });
        return;
      }

      const existingIntake = await this.reportIntakeService.findOpenIntakeForReporter({
        serverId: guildId,
        reporterId: reporter.id,
      });
      if (existingIntake) {
        await interaction.editReply({
          content: this.buildExistingReportIntakeMessage(guildId, existingIntake.thread_id),
        });
        return;
      }

      thread = await this.threadManager.createReportIntakeThread(
        interaction.channel as TextChannel,
        reporter
      );
      if (!thread) {
        await interaction.editReply({
          content:
            'Could not open a private report thread. Please ask a server admin to check Drasil thread permissions.',
        });
        return;
      }

      const intake = await this.reportIntakeService.openIntakeFromThread({
        serverId: guildId,
        reporter,
        threadId: thread.id,
        channelId: interaction.channel.id,
      });

      const activated = await this.threadManager.activateReportIntakeThread(thread, reporter);
      if (!activated) {
        await this.reportIntakeService.markOpenFailed({
          intakeId: intake.id,
          reason: 'thread_activation_failed',
        });
        await this.deleteFailedReportIntakeThread(thread);
        thread = null;
        await interaction.editReply({
          content:
            'Could not prepare the private report thread. Please ask a server admin to check Drasil thread permissions.',
        });
        return;
      }
      intakeActivated = true;

      await interaction.editReply({
        content: `Opened a private report thread: ${thread.url}\nPlease put the report context there.`,
      });

      await this.notifyReportIntakeThreadOpened(guildId, reporter, thread);
    } catch (error) {
      console.error('Error opening report intake thread:', error);
      if (thread && !intakeActivated) {
        await this.deleteFailedReportIntakeThread(thread);
      }
      const content =
        intakeActivated && thread
          ? `Opened a private report thread: ${thread.url}\nPlease put the report context there.`
          : 'An error occurred while opening the report thread. Please try again later.';
      await interaction.editReply({ content }).catch((replyError) => {
        console.warn('Failed to update report intake interaction after setup error:', replyError);
      });
    }
  }

  public async handleReportIntakeConfirm(
    interaction: ButtonInteraction,
    customId: string
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let targetConfirmed = false;

    try {
      if (!this.reportIntakeService) {
        await interaction.editReply({ content: 'Report intake tracking is not available.' });
        return;
      }

      const [, intakeId, targetUserId] = customId.split(':');
      if (!intakeId || !targetUserId) {
        await interaction.editReply({ content: 'This report confirmation button is invalid.' });
        return;
      }
      if (targetUserId === interaction.user.id) {
        await interaction.editReply({ content: 'You cannot report yourself.' });
        return;
      }

      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.editReply({
          content: 'Report confirmations can only be used in a server.',
        });
        return;
      }

      const guild = await this.client.guilds.fetch(guildId);
      const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
      if (!targetMember) {
        await interaction.editReply({
          content: 'The confirmed target is no longer available in this server.',
        });
        return;
      }

      const confirmation = await this.reportIntakeService.confirmCandidate({
        intakeId,
        targetUserId,
        confirmedById: interaction.user.id,
      });
      if (!confirmation.confirmed || !confirmation.reason) {
        await interaction.editReply({ content: confirmation.message });
        return;
      }
      targetConfirmed = true;

      await this.securityActionService.handleUserReport(
        targetMember,
        interaction.user,
        confirmation.reason
      );
      await this.reportIntakeService.markSubmitted({
        intakeId,
        targetUserId,
        submittedById: interaction.user.id,
      });

      await interaction.editReply({ content: `Submitted report for <@${targetUserId}>.` });

      const threadChannel = this.getThreadChannel(interaction.channel);
      if (threadChannel) {
        await threadChannel.send({
          content: `Report submitted for <@${targetUserId}>. Moderators have been notified.`,
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      console.error('Error confirming report intake target:', error);
      await interaction.editReply({
        content: targetConfirmed
          ? 'The report target was confirmed, but Drasil could not finish submitting it automatically. A moderator can review the intake thread.'
          : 'An error occurred while submitting this report. Please try again later.',
      });
    }
  }

  public async handleReportMessageModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const [, messageId, channelId, targetUserId, guildIdRaw, contextRaw] =
      interaction.customId.split(':');
    if (!messageId || !channelId || !targetUserId || !guildIdRaw || !contextRaw) {
      await interaction.reply({
        content: 'This report form is invalid. Please try reporting the message again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason =
      interaction.fields.getTextInputValue(REPORT_MESSAGE_REASON_FIELD_ID).trim() || undefined;
    const guildId = guildIdRaw === '0' ? undefined : guildIdRaw;
    if (guildId) {
      const reasonRequired = await this.getUserReportReasonRequired(guildId);
      if (reasonRequired && !reason) {
        await interaction.reply({
          content: 'Please include a reason for this report.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const targetUser = await this.client.users.fetch(targetUserId).catch(
        () =>
          ({
            id: targetUserId,
            username: targetUserId,
          }) as User
      );
      const message = await this.fetchReportMessage(channelId, messageId);
      const contextNumber = Number(contextRaw);
      const interactionContext =
        contextRaw === 'x' || Number.isNaN(contextNumber)
          ? undefined
          : (contextNumber as InteractionContextType);

      const reportPayload = {
        messageId,
        channelId,
        guildId,
        content: message?.content.slice(0, USER_REPORT_MESSAGE_CONTENT_MAX_LENGTH),
        reason,
        interactionContext,
        ...(message?.attachments.length ? { attachments: message.attachments } : {}),
      };

      await this.securityActionService.handleMessageReport(
        targetUser,
        interaction.user,
        reportPayload
      );

      await interaction.editReply({
        content: `Thank you for your report regarding <@${targetUserId}>. It has been submitted for review.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to handle message report modal for ${targetUserId}:`, error);
      await interaction.editReply({
        content: 'An error occurred while submitting your report. Please try again later.',
      });
    }
  }

  public async handleReportUserModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const targetUserInputString = interaction.fields.getTextInputValue(
        REPORT_USER_TARGET_FIELD_ID
      );
      const reason =
        interaction.fields.getTextInputValue(REPORT_USER_REASON_FIELD_ID).trim() || undefined;

      if (!targetUserInputString) {
        await interaction.reply({
          content:
            'Error: You must provide the user ID, mention, or username of the user to report.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const reasonRequired = await this.getUserReportReasonRequired(interaction.guildId);
      if (reasonRequired && !reason) {
        await interaction.editReply({
          content: 'Please include a reason for this report.',
        });
        return;
      }

      const targetUserResolution = await this.resolveUserId(
        interaction.guildId,
        targetUserInputString
      );
      if (targetUserResolution.status === 'not_found') {
        await interaction.editReply({
          content: `Could not find a user matching "${targetUserInputString}".`,
        });
        return;
      }

      if (targetUserResolution.status === 'ambiguous') {
        await interaction.editReply({
          content: 'Multiple users match that name. Please use their ID or @mention instead.',
        });
        return;
      }

      const targetUserId = targetUserResolution.userId;

      if (targetUserId === interaction.user.id) {
        await interaction.editReply({
          content: 'You cannot report yourself.',
        });
        return;
      }

      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(targetUserId).catch(() => null);
      if (!member) {
        await interaction.editReply({
          content: `Could not find a user matching "${targetUserInputString}" in this server.`,
        });
        return;
      }

      await this.securityActionService.handleUserReport(member, interaction.user, reason);

      await interaction.editReply({
        content: `Thank you for your report regarding <@${targetUserId}>. It has been submitted for review.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[InteractionHandler] Error handling report modal submission:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while submitting your report. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: 'An error occurred while submitting your report. Please try again later.',
        });
      } else {
        await interaction.followUp({
          content: 'An error occurred while submitting your report. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  private buildExistingReportIntakeMessage(guildId: string, threadId: string | null): string {
    if (threadId) {
      return `You already have an open report thread: https://discord.com/channels/${guildId}/${threadId}\nPlease continue there, or send \`close report\` in that thread if it was opened by mistake.`;
    }

    return 'You already have an open report intake. Please continue in the existing report thread, or send `close report` if it was opened by mistake.';
  }

  private async deleteFailedReportIntakeThread(thread: ThreadChannel): Promise<void> {
    try {
      await thread.delete('Report intake setup failed before reporter activation.');
    } catch (error) {
      console.warn(`Failed to delete failed report intake thread ${thread.id}:`, error);
    }
  }

  private async notifyReportIntakeThreadOpened(
    guildId: string,
    reporter: GuildMember,
    thread: ThreadChannel
  ): Promise<void> {
    try {
      const adminChannel = await this.configService.getAdminChannel(guildId);
      await adminChannel?.send({
        content: `Report intake thread opened by <@${reporter.id}>: ${thread.url}`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.warn(`Failed to notify admin channel for report intake thread ${thread.id}:`, error);
    }
  }

  private getThreadChannel(
    channel: ButtonInteraction['channel']
  ): Pick<ThreadChannel, 'send'> | null {
    const isThread = Boolean(
      channel &&
      'isThread' in channel &&
      typeof channel.isThread === 'function' &&
      channel.isThread()
    );
    return isThread ? (channel as unknown as Pick<ThreadChannel, 'send'>) : null;
  }

  private async fetchReportMessage(
    channelId: string,
    messageId: string
  ): Promise<{ content: string; attachments: MessageReportAttachment[] } | null> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !('messages' in channel)) {
      return null;
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message || typeof message.content !== 'string') {
      return null;
    }

    const attachments = [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      contentType: attachment.contentType ?? undefined,
      size: attachment.size,
    }));

    return { content: message.content, attachments };
  }

  private async resolveUserId(guildId: string, userInput: string): Promise<UserResolution> {
    const trimmedInput = userInput.trim();
    const mentionMatch = trimmedInput.match(/^<@!?(\d{17,19})>$/);
    const directUserId =
      mentionMatch?.[1] ?? (/^\d{17,19}$/.test(trimmedInput) ? trimmedInput : null);

    if (directUserId) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        await guild.members.fetch(directUserId);
        return { status: 'found', userId: directUserId };
      } catch {
        return { status: 'not_found' };
      }
    }

    const normalizedInput = trimmedInput.replace(/^@/, '').toLowerCase();
    if (!normalizedInput) {
      return { status: 'not_found' };
    }

    const tagMatch = trimmedInput.replace(/^@/, '').match(/^(.+)#(\d{4})$/);

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const members = await guild.members.search({
        query: tagMatch ? tagMatch[1] : normalizedInput,
        limit: 100,
      });
      const candidates = Array.from(members.values());

      if (tagMatch) {
        const foundMember = candidates.find(
          (member) =>
            member.user.username.toLowerCase() === tagMatch[1].toLowerCase() &&
            member.user.discriminator === tagMatch[2]
        );
        return foundMember ? { status: 'found', userId: foundMember.id } : { status: 'not_found' };
      }

      const usernameMatch = candidates.find((member) =>
        [member.user.username, member.user.tag]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase() === normalizedInput)
      );
      if (usernameMatch) {
        return { status: 'found', userId: usernameMatch.id };
      }

      const nonUniqueMatches = candidates.filter((member) => {
        const names = [member.user.globalName, member.displayName, member.nickname].filter(
          (value): value is string => Boolean(value)
        );

        return names.some((value) => value.toLowerCase() === normalizedInput);
      });

      if (nonUniqueMatches.length > 1) {
        return { status: 'ambiguous' };
      }

      if (nonUniqueMatches.length === 1) {
        return { status: 'found', userId: nonUniqueMatches[0].id };
      }

      return { status: 'not_found' };
    } catch (error) {
      console.error(`[InteractionHandler] Error fetching members for user resolution: ${error}`);
      return { status: 'not_found' };
    }
  }

  private async getUserReportReasonRequired(guildId: string | undefined): Promise<boolean> {
    if (!guildId) {
      return DEFAULT_USER_REPORT_REASON_REQUIRED;
    }

    try {
      const serverConfig = await this.configService.getServerConfig(guildId);
      return getUserReportSettings(serverConfig.settings).reasonRequired;
    } catch (error) {
      console.error(
        `[InteractionHandler] Failed to load report settings for guild ${guildId}:`,
        error
      );
      return DEFAULT_USER_REPORT_REASON_REQUIRED;
    }
  }

  public isReportIntakeConfirmCustomId(customId: string): boolean {
    return customId.startsWith(`${REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX}:`);
  }
}
