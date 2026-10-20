import {
  createReportActions,
  type ActionContext,
  type ActionResult,
  type ReportActions,
  type ReportOutcome,
  type ReportIntakeState,
  type ReportCommand,
  type ReportDependencies,
  type AuthorityPort,
} from '@drasil/application';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Client,
  type GuildMember,
  type ThreadChannel,
  type User,
} from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import {
  getReportConfirmationMessageIds,
  type IReportIntakeService,
} from '../../services/ReportIntakeService';
import { formatInlineIdentifier } from '../../utils/discordUserIdentity';
import { ReportSubmissionService } from '../../services/ReportSubmissionService';
import type { IThreadManager } from '../../services/ThreadManager';
import type { ISecurityActionService } from '../../services/SecurityActionService';
import type { ReportIntake } from '../../repositories/types';
import {
  getUserReportSettings,
  USER_REPORT_MESSAGE_CONTENT_MAX_LENGTH,
} from '../../utils/userReportSettings';
import { getCaseResponderSettings } from '../../utils/caseResponderSettings';
import { messageAttachmentsToReportMetadata } from '../../utils/reportAttachments';
import { buildReportIntakeAdminActionsCustomId } from '../../utils/reportIntakeAdminActions';
import { NotificationPresentationBuilder } from '../../services/NotificationPresentationBuilder';
import { createBotAuthority } from './authority';

export interface BotReportDependencies {
  readonly client: Client;
  readonly configService: IConfigService;
  readonly reportIntakeService: IReportIntakeService;
  readonly threadManager: IThreadManager;
  readonly securityActionService: ISecurityActionService;
}
export function projectReportIntake(intake: ReportIntake): ReportIntakeState {
  const metadata =
    intake.metadata && typeof intake.metadata === 'object' && !Array.isArray(intake.metadata)
      ? intake.metadata
      : {};
  const candidates = metadata.last_confirmation_prompt_candidate_ids;
  return {
    id: intake.id,
    guildId: intake.server_id,
    reporterId: intake.reporter_id,
    threadId: intake.thread_id,
    status: intake.status,
    confirmedTargetUserId: intake.confirmed_target_user_id,
    promptMessageId:
      typeof metadata.last_confirmation_prompt_message_id === 'string'
        ? metadata.last_confirmation_prompt_message_id
        : null,
    promptToken:
      typeof metadata.last_confirmation_prompt_token === 'string'
        ? metadata.last_confirmation_prompt_token
        : null,
    candidateIds: Array.isArray(candidates)
      ? candidates.filter((id): id is string => typeof id === 'string')
      : [],
    claimed:
      typeof metadata.report_ban_operation_id === 'string' &&
      metadata.report_ban_operation_id.length > 0,
  };
}
function actorId(context: ActionContext): string {
  if (context.actor.kind !== 'user')
    throw new Error('Report requires its authenticated reporter or staff actor.');
  return context.actor.userId;
}
export function createBotReportActions(
  deps: BotReportDependencies,
  authority: AuthorityPort = createBotAuthority(deps.client)
): ReportActions {
  const { client, reportIntakeService: intakes } = deps;
  const submission = new ReportSubmissionService(deps.configService, deps.securityActionService);
  const threads = createReportThreadPorts(deps);
  return createReportActions({
    authority,
    settings: {
      async loadFresh(guildId) {
        const config = await deps.configService.getServerConfig(guildId, {
          forceRefresh: true,
          failOnReadError: true,
        });
        return {
          reasonRequired: getUserReportSettings(config.settings).reasonRequired,
          staffRoleIds: getCaseResponderSettings(config.settings).roleIds,
        };
      },
    },
    intakes: {
      async load(id) {
        const intake = await intakes.findIntakeById(id);
        return intake ? projectReportIntake(intake) : null;
      },
      async findOpen(context) {
        const intake = await intakes.findOpenIntakeForReporter({
          serverId: context.guildId,
          reporterId: actorId(context),
        });
        return intake ? projectReportIntake(intake) : null;
      },
      async open(context, channelId, threadId) {
        const guild = await client.guilds.fetch(context.guildId);
        const reporter = await guild.members.fetch(actorId(context));
        return projectReportIntake(
          await intakes.openIntakeFromThread({
            serverId: context.guildId,
            reporter,
            channelId,
            threadId,
          })
        );
      },
      async markOpenFailed(intakeId) {
        await intakes.markOpenFailed({ intakeId, reason: 'thread_activation_failed' });
      },
      async confirm(context, command, staff) {
        return intakes.confirmCandidate({
          intakeId: command.intakeId,
          targetUserId: command.targetUserId,
          confirmedById: actorId(context),
          confirmedByStaff: staff,
          promptMessageId: command.promptMessageId,
        });
      },
      async reject(context, command, staff) {
        return intakes.rejectCandidates({
          intakeId: command.intakeId,
          rejectedById: actorId(context),
          rejectedByStaff: staff,
          promptToken: command.promptToken,
          promptMessageId: command.promptMessageId,
        });
      },
      async close(context, intake, staff) {
        if (!intake.threadId)
          throw new Error('Report intake does not have a Discord thread to close.');
        return intakes.closeIntakeForThread({
          threadId: intake.threadId,
          closedById: actorId(context),
          closedByStaff: staff,
        });
      },
      async markSubmitted(context, intake) {
        if (!intake.confirmedTargetUserId) return false;
        return intakes.markSubmitted({
          intakeId: intake.id,
          targetUserId: intake.confirmedTargetUserId,
          submittedById: actorId(context),
        });
      },
    },
    threads,
    submissions: {
      async user(context, command) {
        return submission.submitUserReport({
          guild: await client.guilds.fetch(context.guildId),
          reporter: await client.users.fetch(actorId(context)),
          targetUserId: command.targetUserId,
          targetLabel: command.targetLabel,
          reason: command.reason ?? undefined,
          passUndefinedReason: command.passUndefinedReason,
        });
      },
      async message(context, command) {
        const target = await client.users.fetch(command.targetUserId).catch(() => ({
          id: command.targetUserId,
          username: command.targetUserId,
          discriminator: '0',
          avatar: null,
          global_name: null,
        }));
        const reporter = await client.users.fetch(actorId(context));
        const channel = await client.channels.fetch(command.channelId).catch(() => null);
        const message =
          channel?.isTextBased() && 'messages' in channel
            ? await channel.messages.fetch(command.messageId).catch(() => null)
            : null;
        return submission.submitMessageReport(target, reporter, {
          messageId: command.messageId,
          channelId: command.channelId,
          guildId: context.guildId === '0' ? undefined : context.guildId,
          content: message?.content.slice(0, USER_REPORT_MESSAGE_CONTENT_MAX_LENGTH),
          reason: command.reason ?? undefined,
          interactionContext: command.interactionContext,
          ...(message && messageAttachmentsToReportMetadata(message).length
            ? { attachments: messageAttachmentsToReportMetadata(message) }
            : {}),
        });
      },
      async confirmed(context, intake, confirmation) {
        if (!intake.confirmedTargetUserId) throw new Error('Report target has not been confirmed.');
        const guild = await client.guilds.fetch(context.guildId);
        const member = await guild.members.fetch(intake.confirmedTargetUserId);
        const reporter = await client.users
          .fetch(intake.reporterId)
          .catch(() => ({ id: intake.reporterId, username: 'unknown', tag: 'unknown' }) as User);
        const result = await submission.submitConfirmedReportIntake(
          member,
          reporter,
          confirmation.reason,
          {
            intakeId: intake.id,
            attachments: confirmation.attachments,
          }
        );
        return result.status === 'submitted'
          ? { ...result, targetUsername: member.user.username }
          : result;
      },
    },
  });
}
function createReportThreadPorts(deps: BotReportDependencies): ReportDependencies['threads'] {
  const loaded = new Map<string, ThreadChannel>();
  async function thread(id: string): Promise<ThreadChannel> {
    const cached = loaded.get(id);
    if (cached) return cached;
    const channel = await deps.client.channels.fetch(id);
    if (!channel?.isThread()) throw new Error('Report intake thread could not be loaded.');
    return channel;
  }
  return {
    async notifySubmitted(context, intake, input): Promise<void> {
      await notifySubmitted(deps, context, intake, input);
    },
    async prepareClose(context, intake): ReturnType<ReportDependencies['threads']['prepareClose']> {
      if (!intake.threadId)
        throw new Error('Report intake does not have a Discord thread to close.');
      const loadedThread = await thread(intake.threadId);
      if (loadedThread.guildId !== context.guildId)
        throw new Error('Report intake thread does not belong to this server.');
      return { finish: async (result) => finishReportThreadClose(loadedThread, result) };
    },
    async create(
      context: ActionContext,
      channelId: string
    ): Promise<{ id: string; url: string } | null> {
      const channel = await deps.client.channels.fetch(channelId);
      if (channel?.type !== ChannelType.GuildText || channel.guildId !== context.guildId)
        throw new Error('Report intake channel is not a text channel in this server.');
      const guild = await deps.client.guilds.fetch(context.guildId);
      const reporter = await guild.members.fetch(actorId(context));
      const created = await deps.threadManager.createReportIntakeThread(channel, reporter);
      if (created) loaded.set(created.id, created);
      return created;
    },
    async activate(context: ActionContext, threadId: string, intakeId: string): Promise<boolean> {
      const guild = await deps.client.guilds.fetch(context.guildId);
      return deps.threadManager.activateReportIntakeThread(
        await thread(threadId),
        await guild.members.fetch(actorId(context)),
        intakeId
      );
    },
    async deleteFailed(threadId: string): Promise<void> {
      try {
        await (
          await thread(threadId)
        ).delete('Report intake setup failed before reporter activation.');
      } catch (error) {
        console.warn(`Failed to delete failed report intake thread ${threadId}:`, error);
      } finally {
        loaded.delete(threadId);
      }
    },
    async notifyOpened(context: ActionContext, threadId: string, intakeId: string): Promise<void> {
      try {
        const guild = await deps.client.guilds.fetch(context.guildId);
        await notifyOpened(
          deps,
          context.guildId,
          await guild.members.fetch(actorId(context)),
          await thread(threadId),
          intakeId
        );
      } finally {
        loaded.delete(threadId);
      }
    },
  };
}
async function notifySubmitted(
  deps: BotReportDependencies,
  context: ActionContext,
  intake: ReportIntakeState,
  input: { promptMessageId: string; statusRecorded: boolean; targetUsername?: string }
): Promise<void> {
  try {
    const current = await deps.reportIntakeService.findIntakeById(intake.id);
    const channel = intake.threadId
      ? await deps.client.channels.fetch(intake.threadId).catch(() => null)
      : null;
    const thread = channel?.isThread() && channel.guildId === context.guildId ? channel : null;
    const targetLabel = input.targetUsername?.trim()
      ? `@${formatInlineIdentifier(input.targetUsername)}`
      : `user ${formatInlineIdentifier(intake.confirmedTargetUserId ?? '')}`;
    const receipt = `Report submitted for ${targetLabel}.`;
    if (thread)
      await thread
        .send({
          content: input.statusRecorded
            ? receipt
            : `${receipt}\nDrasil couldn't record its final status. Please ask a moderator to review this thread.`,
          allowedMentions: { parse: [] },
        })
        .catch((error) => console.warn('Failed to post submitted report receipt:', error));
    if (current)
      await deps.threadManager
        .retireReportConfirmationPrompts(
          current,
          getReportConfirmationMessageIds(current, input.promptMessageId)
        )
        .catch((error) => console.warn('Failed to retire submitted report confirmations:', error));
    if (input.statusRecorded && thread && !thread.archived)
      await thread
        .setArchived(true, 'Report intake submitted')
        .catch((error) => console.warn('Failed to archive submitted report intake:', error));
  } catch (error) {
    console.warn('Failed to deliver submitted report follow-up:', error);
  }
}

async function finishReportThreadClose(
  thread: ThreadChannel,
  result: { message: string; shouldArchiveThread?: boolean }
): Promise<{ archived: boolean; message: string }> {
  await thread
    .send({ allowedMentions: { parse: [] }, content: result.message })
    .catch((error) => console.warn('Failed to post report intake closeout:', error));
  let archived = thread.archived ?? false;
  if (result.shouldArchiveThread && !archived) {
    try {
      await thread.setArchived(true, 'Report intake closed');
      archived = true;
    } catch (error) {
      console.warn('Failed to archive report intake thread:', error);
    }
  }
  return {
    archived,
    message:
      result.shouldArchiveThread && !archived
        ? `${result.message}\nDrasil couldn't archive this thread.`
        : result.message,
  };
}

async function notifyOpened(
  deps: BotReportDependencies,
  guildId: string,
  reporter: GuildMember,
  thread: ThreadChannel,
  intakeId: string
): Promise<void> {
  try {
    const builder = new NotificationPresentationBuilder();
    const admin = await deps.configService.getAdminChannel(guildId);
    const config = await deps.configService.getServerConfig(guildId);
    const roles = builder.getCaseNotificationRoleIds(config);
    const content = builder.formatRoleMentions(roles);
    await admin?.send({
      ...(content ? { content } : {}),
      allowedMentions: builder.createAdminAllowedMentions(roles),
      embeds: [builder.createReportIntakeStartedEmbed(reporter, thread)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(buildReportIntakeAdminActionsCustomId(intakeId))
            .setLabel('Admin Actions')
            .setStyle(ButtonStyle.Primary)
        ),
      ],
    });
  } catch (error) {
    console.warn(`Failed to notify admin channel for report intake thread ${thread.id}:`, error);
  }
}
export function requireReportOutcome<K extends ReportCommand['kind']>(
  result: ActionResult<ReportOutcome>,
  kind: K
): Extract<ReportOutcome, { kind: K }> {
  if (result.kind === 'denied')
    throw new Error(
      result.code === 'reason_required'
        ? 'Please include a reason for this report.'
        : result.code === 'confirmation_required'
          ? 'Use the latest confirmation message in this thread.'
          : `Report action denied: ${result.code}`
    );
  if (result.outcome.kind !== kind) throw new Error('Report outcome mismatch.');
  // The discriminant check above binds the outcome to the caller command.
  return result.outcome as Extract<ReportOutcome, { kind: K }>;
}
