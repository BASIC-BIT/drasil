import type { ReportActions, ReportCommand, ReportOutcome } from '@drasil/application';
import { createDiscordActionContext } from '../application/context';
import { requireReportOutcome } from '../application/adapters/reports';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ComponentType,
  Client,
  Guild,
  InteractionContextType,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  ThreadChannel,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { DiscordUserResolver } from '../services/DiscordUserResolver';
import {
  IReportIntakeService,
  getReportConfirmationUnavailableMessage,
  getReportConfirmationMessageIds,
  REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX,
  REPORT_INTAKE_REJECT_CUSTOM_ID_PREFIX,
} from '../services/ReportIntakeService';
import { ReportSubmissionService } from '../services/ReportSubmissionService';
import { IThreadManager } from '../services/ThreadManager';
import { ReportIntake, ReportIntakeStatus } from '../repositories/types';
import { formatInlineIdentifier } from '../utils/discordUserIdentity';
import { REPORT_MESSAGE_REASON_FIELD_ID } from '../utils/userReportSettings';
import { canModerateReportIntake } from '../utils/reportIntakeStaffAuthorization';
import {
  buildReportIntakeAdminBanCustomId,
  buildReportIntakeAdminCancelCustomId,
  buildReportIntakeAdminCloseCustomId,
  buildReportIntakeAdminConfirmCloseCustomId,
  isReportIntakeAdminActionCustomId,
  isReportIntakeActionChannel,
  parseReportIntakeAdminActionCustomId,
} from '../utils/reportIntakeAdminActions';

export const REPORT_USER_INITIATE_CUSTOM_ID = 'report_user_initiate';
export const REPORT_USER_TYPED_MODAL_ID = 'report_user_modal_submit';

const REPORT_USER_TARGET_FIELD_ID = 'report_target_user_input';
const REPORT_USER_REASON_FIELD_ID = 'report_reason';

type ReportIntakeThreadChannel = Pick<ThreadChannel, 'id' | 'send'> &
  Partial<Pick<ThreadChannel, 'archived' | 'setArchived'>>;

interface ReportIntakeAdminContext {
  intake: ReportIntake;
  thread: ReportIntakeThreadChannel | null;
  /** Whether the clicking user passes the report-intake staff check for this guild. */
  canModerate: boolean;
}

type ReportIntakeAdminResponseMode = 'reply' | 'update';

export class ReportInteractionHandler {
  private readonly userResolver: DiscordUserResolver;

  public constructor(
    private readonly client: Client,
    private readonly reportSubmissionService: ReportSubmissionService,
    private readonly configService: IConfigService,
    private readonly threadManager: IThreadManager,
    private readonly reportIntakeService?: IReportIntakeService,
    private readonly showReportBan?: (
      interaction: ButtonInteraction,
      intakeId: string
    ) => Promise<void>,
    private readonly reports?: ReportActions
  ) {
    this.userResolver = new DiscordUserResolver(client);
  }

  public async handleReportUserInitiate(interaction: ButtonInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let openedThreadUrl: string | null = null;

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

      const outcome = await this.executeReport(interaction, {
        kind: 'start_report_intake',
        channelId: interaction.channel.id,
      });
      if (outcome.kind !== 'start_report_intake') return;
      if (outcome.status === 'existing' && outcome.intake) {
        await interaction.editReply({
          content: this.buildExistingReportIntakeMessage(guildId, outcome.intake.threadId),
        });
        return;
      }
      if (outcome.status === 'opened') openedThreadUrl = outcome.threadUrl ?? null;
      const content =
        outcome.status === 'opened'
          ? `Opened a private report thread: ${outcome.threadUrl}\nAdd what happened there.`
          : outcome.status === 'activation_failed'
            ? 'Could not prepare the private report thread. Please ask a server admin to check Drasil thread permissions.'
            : 'Could not open a private report thread. Please ask a server admin to check Drasil thread permissions.';
      await interaction.editReply({ content });
    } catch (error) {
      console.error('Error opening report intake thread:', error);
      const content = openedThreadUrl
        ? `Opened a private report thread: ${openedThreadUrl}\nAdd what happened there.`
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
    if (customId.startsWith(`${REPORT_INTAKE_REJECT_CUSTOM_ID_PREFIX}:`)) {
      await this.handleReportIntakeReject(interaction, customId);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let selectionAccepted = false;
    let submissionSucceeded = false;
    let statusRecorded = false;

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

      const context = await this.resolveReportConfirmationContext(interaction, intakeId);
      if (!context) return;
      const guild = context.guild;
      const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
      if (!targetMember) {
        await interaction.editReply({
          content: 'The confirmed target is no longer available in this server.',
        });
        return;
      }

      const outcome = await this.executeReport(interaction, {
        kind: 'confirm_intake_candidate',
        intakeId,
        targetUserId,
        threadId: interaction.channelId,
        promptMessageId: interaction.message.id,
      });
      if (outcome.kind !== 'confirm_intake_candidate') return;
      if (outcome.status !== 'submitted') {
        await interaction.editReply({ content: outcome.message });
        return;
      }
      selectionAccepted = true;
      submissionSucceeded = true;
      statusRecorded = outcome.statusRecorded === true;
      const acknowledgement = statusRecorded
        ? 'Report submitted.'
        : "Report submitted. Drasil couldn't record its final status. Please ask a moderator to review this thread.";
      await interaction
        .editReply({ content: acknowledgement })
        .catch((error: unknown) => console.warn('Failed to deliver report receipt:', error));
    } catch (error) {
      console.error(
        'Error confirming report intake target:',
        { selectionAccepted, submissionSucceeded, statusRecorded },
        error
      );
      await interaction
        .editReply({
          content: submissionSucceeded
            ? "Report submitted. Drasil couldn't record its final status. Please ask a moderator to review this thread."
            : "Drasil couldn't finish submitting this report. Please ask a moderator to review this thread.",
        })
        .catch((replyError: unknown) =>
          console.warn('Failed to deliver report outcome:', replyError)
        );
    }
  }

  public async handleReportIntakeReject(
    interaction: ButtonInteraction,
    customId: string
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (!this.reportIntakeService) {
        await interaction.editReply({ content: 'Report intake tracking is not available.' });
        return;
      }

      const [, intakeId, promptToken] = customId.split(':');
      if (!intakeId || !promptToken) {
        await interaction.editReply({ content: 'This report answer button is invalid.' });
        return;
      }

      const context = await this.resolveReportConfirmationContext(interaction, intakeId);
      if (!context) return;

      const outcome = await this.executeReport(interaction, {
        kind: 'reject_intake_candidates',
        intakeId,
        threadId: interaction.channelId,
        promptMessageId: interaction.message.id,
        promptToken,
      });
      if (outcome.kind !== 'reject_intake_candidates') return;
      const result = outcome.result;
      await interaction.editReply({ content: result.message }).catch((error: unknown) => {
        console.warn('Failed to deliver report selection result:', error);
      });

      if (result.rejected) {
        const threadChannel = this.getThreadChannel(interaction.channel);
        if (threadChannel) {
          await threadChannel
            .send({
              content:
                'No report submitted. Add a username, user ID, message link, or another screenshot.',
              allowedMentions: { parse: [] },
            })
            .catch((error: unknown) => {
              console.warn('Failed to deliver saved report rejection follow-up:', error);
            });
        }
      }
    } catch (error) {
      console.error('Error rejecting report intake target:', error);
      await interaction.editReply({
        content: 'An error occurred while recording that answer. Please try again later.',
      });
    }
  }

  public isReportIntakeAdminActionCustomId(customId: string): boolean {
    return isReportIntakeAdminActionCustomId(customId);
  }

  public async handleReportIntakeAdminAction(
    interaction: ButtonInteraction,
    customId: string
  ): Promise<void> {
    const parsed = parseReportIntakeAdminActionCustomId(customId);
    const responseMode: ReportIntakeAdminResponseMode =
      !parsed || parsed.action === 'menu' || parsed.action === 'thread_close' ? 'reply' : 'update';

    try {
      if (!parsed) {
        await this.respondToReportIntakeAdminInteraction(
          interaction,
          { content: 'Unknown report admin action.', components: [] },
          responseMode
        );
        return;
      }

      if (parsed.action === 'ban') {
        if (this.showReportBan) await this.showReportBan(interaction, parsed.intakeId);
        else
          await interaction.reply({
            content: 'Report ban actions are unavailable.',
            flags: MessageFlags.Ephemeral,
          });
        return;
      }

      if (parsed.action === 'cancel') {
        await this.respondToReportIntakeAdminInteraction(
          interaction,
          { content: 'Cancelled.', components: [] },
          'update'
        );
        return;
      }

      await this.deferReportIntakeAdminInteraction(interaction, responseMode);

      const context = await this.resolveReportIntakeAdminContext(
        interaction,
        parsed.intakeId,
        responseMode,
        // The in-thread close button is reporter-facing; closeIntakeForThread applies the
        // reporter-or-staff rule itself, so do not gate the lookup on moderation permissions.
        { requireModerator: parsed.action !== 'thread_close' }
      );
      if (!context) {
        return;
      }

      if (parsed.action === 'menu') {
        await this.showReportIntakeAdminMenu(interaction, context);
        return;
      }

      if (parsed.action === 'close') {
        await this.showReportIntakeCloseConfirmation(interaction, context.intake);
        return;
      }

      const closed = await this.closeReportIntake(interaction, context);
      if (closed && parsed.action === 'thread_close') {
        await this.clearReportIntakeThreadButtons(interaction);
      }
    } catch (error) {
      console.error('Error handling report intake admin action:', error);
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        {
          content: 'An error occurred while processing this report admin action.',
          components: [],
        },
        responseMode
      ).catch((replyError) => {
        console.warn('Failed to respond to report intake admin action error:', replyError);
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
      const reasonRequired = await this.reportSubmissionService.getReasonRequired(guildId);
      if (reasonRequired && !reason) {
        await interaction.reply({
          content: 'Please include a reason for this report.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let reportSubmitted = false;
    try {
      const fetchedTargetUser = await this.client.users.fetch(targetUserId).catch(() => null);
      const contextNumber = Number(contextRaw);
      const interactionContext =
        contextRaw === 'x' || Number.isNaN(contextNumber)
          ? undefined
          : (contextNumber as InteractionContextType);

      const outcome = await this.executeReport(
        interaction,
        {
          kind: 'submit_message_report',
          targetUserId,
          messageId,
          channelId,
          reason: reason ?? null,
          ...(interactionContext === undefined ? {} : { interactionContext }),
        },
        guildId ?? '0'
      );
      if (outcome.kind !== 'submit_message_report') return;
      reportSubmitted = true;
      await interaction.editReply({
        content: fetchedTargetUser?.username
          ? `Report submitted for @${formatInlineIdentifier(fetchedTargetUser.username)}.`
          : `Report submitted for user ${formatInlineIdentifier(targetUserId)}.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to handle message report modal for ${targetUserId}:`, error);
      await interaction
        .editReply({
          content: reportSubmitted
            ? 'Report submitted.'
            : "Drasil couldn't finish submitting this report. Please ask a moderator to review it.",
        })
        .catch((replyError: unknown) =>
          console.warn('Failed to deliver direct report outcome:', replyError)
        );
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

    let reportSubmitted = false;
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

      const reasonRequired = await this.reportSubmissionService.getReasonRequired(
        interaction.guildId
      );
      if (reasonRequired && !reason) {
        await interaction.editReply({
          content: 'Please include a reason for this report.',
        });
        return;
      }

      const targetUserResolution = await this.userResolver.resolveGuildUserId(
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

      const outcome = await this.executeReport(interaction, {
        kind: 'submit_user_report',
        targetUserId,
        targetLabel: targetUserInputString,
        reason: reason ?? null,
      });
      if (outcome.kind !== 'submit_user_report') return;
      const submission = outcome.result;
      if (submission.status === 'member_not_found') {
        await interaction.editReply({
          content: `Could not find a user matching "${targetUserInputString}" in this server.`,
        });
        return;
      }
      if (submission.status === 'reason_required') {
        await interaction.editReply({
          content: 'Please include a reason for this report.',
        });
        return;
      }
      if (submission.status === 'self_report') {
        await interaction.editReply({
          content: 'You cannot report yourself.',
        });
        return;
      }

      reportSubmitted = true;
      await interaction.editReply({
        content: submission.targetUsername
          ? `Report submitted for @${formatInlineIdentifier(submission.targetUsername)}.`
          : `Report submitted for user ${formatInlineIdentifier(targetUserId)}.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[ReportInteractionHandler] Error handling report modal submission:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: reportSubmitted
              ? 'Report submitted.'
              : "Drasil couldn't finish submitting this report. Please ask a moderator to review it.",
            flags: MessageFlags.Ephemeral,
          })
          .catch((replyError: unknown) =>
            console.warn('Failed to deliver direct report outcome:', replyError)
          );
      } else if (interaction.deferred) {
        await interaction
          .editReply({
            content: reportSubmitted
              ? 'Report submitted.'
              : "Drasil couldn't finish submitting this report. Please ask a moderator to review it.",
          })
          .catch((replyError: unknown) =>
            console.warn('Failed to deliver direct report outcome:', replyError)
          );
      } else {
        await interaction
          .followUp({
            content: reportSubmitted
              ? 'Report submitted.'
              : "Drasil couldn't finish submitting this report. Please ask a moderator to review it.",
            flags: MessageFlags.Ephemeral,
          })
          .catch((replyError: unknown) =>
            console.warn('Failed to deliver direct report outcome:', replyError)
          );
      }
    }
  }

  private async resolveReportConfirmationContext(
    interaction: ButtonInteraction,
    intakeId: string
  ): Promise<{ intake: ReportIntake; guild: Guild; canModerate: boolean } | null> {
    const intake = await this.reportIntakeService?.findIntakeById(intakeId);
    if (!intake || !interaction.guildId || intake.server_id !== interaction.guildId) {
      await interaction.editReply({ content: 'This report could not be found.' });
      return null;
    }
    if (
      !this.client.user ||
      interaction.message.author.id !== this.client.user.id ||
      interaction.channelId !== intake.thread_id ||
      interaction.channel?.id !== intake.thread_id ||
      !this.getThreadChannel(interaction.channel)
    ) {
      await interaction.editReply({
        content: 'This confirmation does not match the report thread.',
      });
      return null;
    }
    const guild =
      (interaction.guild as Guild | null) ?? (await this.client.guilds.fetch(interaction.guildId));
    const canModerate =
      intake.reporter_id === interaction.user.id
        ? false
        : await canModerateReportIntake(guild, interaction.user.id, this.configService);
    if (intake.reporter_id !== interaction.user.id && !canModerate) {
      await interaction.editReply({
        content: 'Only the reporter or a moderator can change this selection.',
      });
      return null;
    }
    const stateUnavailable = getReportConfirmationUnavailableMessage(intake);
    const enabledControl = interaction.message.components.some(
      (row) =>
        row.type === ComponentType.ActionRow &&
        row.components.some(
          (button) =>
            button.type === ComponentType.Button &&
            'customId' in button &&
            button.customId === interaction.customId &&
            !button.disabled
        )
    );
    if (!stateUnavailable && !enabledControl) {
      await interaction.editReply({
        content: 'Use the latest confirmation message in this thread.',
      });
      return null;
    }
    const metadata = intake.metadata;
    const currentId =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata.last_confirmation_prompt_message_id
        : null;
    const stalePrompt = typeof currentId === 'string' && currentId !== interaction.message.id;
    const unavailable =
      stateUnavailable ??
      (stalePrompt ? 'Use the latest confirmation message in this thread.' : null);
    if (unavailable) {
      const ids = stalePrompt
        ? [interaction.message.id]
        : getReportConfirmationMessageIds(intake, interaction.message.id);
      await this.threadManager
        .retireReportConfirmationPrompts(intake, ids)
        .catch((error: unknown) =>
          console.warn('Failed to retire stale report confirmation:', error)
        );
      await interaction.editReply({ content: unavailable });
      return null;
    }
    return { intake, guild, canModerate };
  }

  private async resolveReportIntakeAdminContext(
    interaction: ButtonInteraction,
    intakeId: string,
    responseMode: ReportIntakeAdminResponseMode,
    options: { requireModerator: boolean } = { requireModerator: true }
  ): Promise<ReportIntakeAdminContext | null> {
    if (!this.reportIntakeService) {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        { content: 'Report intake tracking is not available.', components: [] },
        responseMode
      );
      return null;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        { content: 'Report admin actions can only be used in a server.', components: [] },
        responseMode
      );
      return null;
    }

    const intake = await this.reportIntakeService.findIntakeById(intakeId);
    if (!intake || intake.server_id !== guildId) {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        { content: 'This report intake could not be found.', components: [] },
        responseMode
      );
      return null;
    }

    const currentChannelId = interaction.channelId;
    if (
      intake.thread_id &&
      currentChannelId &&
      currentChannelId !== intake.thread_id &&
      !(await isReportIntakeActionChannel(
        this.configService,
        guildId,
        currentChannelId,
        intake.thread_id
      ))
    ) {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        { content: 'This report action does not match the current thread.', components: [] },
        responseMode
      );
      return null;
    }

    const guild = (interaction.guild as Guild | null) ?? (await this.client.guilds.fetch(guildId));
    const canModerate = await canModerateReportIntake(
      guild,
      interaction.user.id,
      this.configService
    );
    if (options.requireModerator && !canModerate) {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        { content: 'You need moderation permissions to use report admin actions.', components: [] },
        responseMode
      );
      return null;
    }

    const currentThread = this.getThreadChannel(interaction.channel);
    const thread =
      currentThread && (!intake.thread_id || currentThread.id === intake.thread_id)
        ? currentThread
        : await this.fetchReportIntakeThread(intake.thread_id);

    return { intake, thread, canModerate };
  }

  private async showReportIntakeAdminMenu(
    interaction: ButtonInteraction,
    context: ReportIntakeAdminContext
  ): Promise<void> {
    const config = await this.configService.getServerConfig(context.intake.server_id);
    const banEnabled = getDetectionResponseSettings(config.settings).moderatorBanActionEnabled;
    const banUnavailableReason =
      context.intake.status !== ReportIntakeStatus.SUBMITTED
        ? 'Only submitted reports can be banned.'
        : !context.intake.confirmed_target_user_id
          ? 'Confirm the report target before banning.'
          : context.intake.metadata &&
              typeof context.intake.metadata === 'object' &&
              !Array.isArray(context.intake.metadata) &&
              context.intake.metadata.report_ban_operation_id
            ? 'A ban is already being processed for this report.'
            : !interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)
              ? 'Requires Ban Members permission.'
              : !banEnabled
                ? 'Moderator ban actions are disabled for this server.'
                : !this.showReportBan
                  ? 'Report ban actions are unavailable.'
                  : null;
    await this.respondToReportIntakeAdminInteraction(
      interaction,
      {
        content: [
          this.buildReportIntakeAdminMenuMessage(context.intake),
          banUnavailableReason ? `Ban unavailable: ${banUnavailableReason}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(buildReportIntakeAdminCloseCustomId(context.intake.id))
              .setLabel('Close Report')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(!context.intake.thread_id),
            new ButtonBuilder()
              .setCustomId(buildReportIntakeAdminBanCustomId(context.intake.id))
              .setLabel('Ban')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(Boolean(banUnavailableReason))
          ),
        ],
      },
      'reply'
    );
  }

  private async showReportIntakeCloseConfirmation(
    interaction: ButtonInteraction,
    intake: ReportIntake
  ): Promise<void> {
    const unselected =
      !intake.confirmed_target_user_id &&
      (intake.status === ReportIntakeStatus.COLLECTING_EVIDENCE ||
        intake.status === ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION);
    const consequence = unselected
      ? 'No report has been submitted.'
      : intake.status === ReportIntakeStatus.SUBMITTED
        ? 'The submitted report will remain recorded.'
        : intake.confirmed_target_user_id
          ? 'The selected person and saved evidence will remain recorded.'
          : 'Saved evidence will remain recorded.';
    await this.respondToReportIntakeAdminInteraction(
      interaction,
      {
        content: `Close this report thread? ${consequence}`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(buildReportIntakeAdminConfirmCloseCustomId(intake.id))
              .setLabel('Close report')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(buildReportIntakeAdminCancelCustomId(intake.id))
              .setLabel('Keep open')
              .setStyle(ButtonStyle.Secondary)
          ),
        ],
      },
      'update'
    );
  }

  /**
   * Single close path shared by the moderator confirmation flow and the in-thread Close Report
   * button. Authorization is delegated to ReportIntakeService.closeIntakeForThread, which allows
   * the reporter who owns the intake or a report-intake staff member.
   *
   * @returns whether the intake was closed (including "already closed", which is a no-op close)
   */
  private async closeReportIntake(
    interaction: ButtonInteraction,
    context: ReportIntakeAdminContext
  ): Promise<boolean> {
    if (!this.reportIntakeService || !context.intake.thread_id) {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        { content: 'This report intake cannot be closed from this button.', components: [] },
        'update'
      );
      return false;
    }

    if (!context.thread) {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        {
          content: 'Could not load this report thread, so the report was not closed.',
          components: [],
        },
        'update'
      );
      return false;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }

    if (!this.reports) throw new Error('Report application is unavailable.');
    const action = await this.reports.execute(
      createDiscordActionContext({
        guildId: context.intake.server_id,
        userId: interaction.user.id,
        requestId: interaction.id,
      }),
      { kind: 'close_report_intake', intakeId: context.intake.id }
    );
    if (action.kind === 'denied') {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        { content: 'Only the reporter or a moderator can close this report.', components: [] },
        'update'
      );
      return false;
    }
    const outcome = action.outcome;
    if (outcome.kind !== 'close_report_intake') return false;
    const result = outcome.result;

    if (!result.closed) {
      await this.respondToReportIntakeAdminInteraction(
        interaction,
        { content: result.message, components: [] },
        'update'
      );
      return false;
    }

    await this.respondToReportIntakeAdminInteraction(
      interaction,
      { content: result.message, components: [] },
      'update'
    ).catch((error: unknown) => console.warn('Failed to deliver report closeout:', error));
    return true;
  }

  /**
   * Drop the buttons from the intake thread message so a closed report does not invite a second
   * click. Best-effort: the close already succeeded by the time this runs.
   */
  private async clearReportIntakeThreadButtons(interaction: ButtonInteraction): Promise<void> {
    const message = interaction.message as { edit?: (payload: unknown) => Promise<unknown> } | null;
    if (typeof message?.edit !== 'function') {
      return;
    }

    await message.edit({ components: [] }).catch((error) => {
      console.warn('Failed to clear report intake thread buttons after close:', error);
    });
  }

  private buildReportIntakeAdminMenuMessage(intake: ReportIntake): string {
    const targetLine = intake.confirmed_target_user_id
      ? `Target: <@${intake.confirmed_target_user_id}>`
      : 'Target: not confirmed yet.';

    return [
      `Admin actions for report intake \`${intake.id}\`.`,
      `Reporter: <@${intake.reporter_id}>`,
      targetLine,
      `Status: ${intake.status}`,
    ].join('\n');
  }

  private async respondToReportIntakeAdminInteraction(
    interaction: ButtonInteraction,
    response: { content: string; components?: ActionRowBuilder<ButtonBuilder>[] },
    mode: ReportIntakeAdminResponseMode
  ): Promise<void> {
    const responseWithMentions = {
      ...response,
      allowedMentions: { parse: [] },
    };

    if (mode === 'update') {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(responseWithMentions);
        return;
      }

      await interaction.update(responseWithMentions);
      return;
    }

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(responseWithMentions);
      return;
    }

    await interaction.reply({
      ...responseWithMentions,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async deferReportIntakeAdminInteraction(
    interaction: ButtonInteraction,
    mode: ReportIntakeAdminResponseMode
  ): Promise<void> {
    if (interaction.deferred || interaction.replied) {
      return;
    }

    if (mode === 'reply') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();
  }

  private async fetchReportIntakeThread(
    threadId: string | null
  ): Promise<ReportIntakeThreadChannel | null> {
    if (!threadId) {
      return null;
    }

    const channels = (this.client as { channels?: Client['channels'] }).channels;
    const channel = await channels?.fetch(threadId).catch(() => null);
    const isThread = Boolean(
      channel &&
      'isThread' in channel &&
      typeof channel.isThread === 'function' &&
      channel.isThread()
    );
    return isThread ? (channel as unknown as ReportIntakeThreadChannel) : null;
  }

  private buildExistingReportIntakeMessage(guildId: string, threadId: string | null): string {
    // Threads opened before the Close Report button shipped do not have one, so always offer the
    // text fallback as well.
    const cancelHint = 'To cancel, choose Close Report or send `close report` in that thread.';

    if (threadId) {
      return `Continue your report here: https://discord.com/channels/${guildId}/${threadId}\n${cancelHint}`;
    }

    return `Continue in your existing report thread. ${cancelHint}`;
  }

  private async executeReport(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    command: ReportCommand,
    guildId = interaction.guildId ?? '0'
  ): Promise<ReportOutcome> {
    if (!this.reports) throw new Error('Report application is unavailable.');
    return requireReportOutcome(
      await this.reports.execute(
        createDiscordActionContext({
          guildId,
          userId: interaction.user.id,
          requestId: interaction.id,
        }),
        command
      ),
      command.kind
    );
  }

  private getThreadChannel(
    channel: ButtonInteraction['channel']
  ): ReportIntakeThreadChannel | null {
    const isThread = Boolean(
      channel &&
      'isThread' in channel &&
      typeof channel.isThread === 'function' &&
      channel.isThread()
    );
    return isThread ? (channel as unknown as ReportIntakeThreadChannel) : null;
  }

  public isReportIntakeConfirmCustomId(customId: string): boolean {
    return (
      customId.startsWith(`${REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX}:`) ||
      customId.startsWith(`${REPORT_INTAKE_REJECT_CUSTOM_ID_PREFIX}:`)
    );
  }
}
