import { createHash } from 'crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, GuildMember, Message } from 'discord.js';
import { injectable, inject, optional } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IReportIntakeRepository } from '../repositories/ReportIntakeRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { ReportIntake, ReportIntakeEvidenceKind, ReportIntakeStatus } from '../repositories/types';
import { IUserRepository } from '../repositories/UserRepository';
import { getReportAiSettings, ReportAttachmentMetadata } from '../utils/reportAiSettings';
import { selectEligibleMessageReportImageAttachments } from '../utils/reportAttachments';
import type { ReportIntakeEvidenceExtraction } from './GPTService';
import { IReportCandidateService, ReportCandidate } from './ReportCandidateService';
import { IModerationQueueService } from './ModerationQueueService';

const REPORT_INTAKE_CLOSE_COMMANDS = new Set(['close report', 'cancel report', 'close intake']);
const REPORT_INTAKE_REASON_TEXT_MAX_LENGTH = 1000;
const REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS = 5;
const REPORT_INTAKE_CANCELLED_MESSAGE = 'Report intake closed. No report has been filed.';
export const REPORT_INTAKE_SUBMITTED_CLOSEOUT_MESSAGE =
  'Report submitted. Moderators have been notified, so this intake thread is now closed.';
const REPORT_INTAKE_REVIEWED_CLOSEOUT_MESSAGE =
  'Report reviewed. Moderators have completed this intake, so this thread is now closed.';
const REPORT_INTAKE_ALREADY_CLOSED_MESSAGE =
  'This report intake is already closed. Archiving the thread now.';

export const REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX = 'report_intake_confirm';
export const REPORT_INTAKE_REJECT_CUSTOM_ID_PREFIX = 'report_intake_reject';

export interface ReportIntakeCloseResult {
  closed: boolean;
  message: string;
  shouldArchiveThread?: boolean;
}

interface MessageSendChannel {
  send(options: {
    content: string;
    components: ActionRowBuilder<ButtonBuilder>[];
    allowedMentions: { parse: [] };
  }): Promise<unknown>;
}

interface ArchivableThreadChannel {
  id: string;
  archived: boolean;
  setArchived(archived: boolean, reason?: string): Promise<unknown>;
}

export interface OpenReportIntakeInput {
  serverId: string;
  reporter: GuildMember;
  threadId: string;
  channelId: string;
}

export interface IReportIntakeService {
  openIntakeFromThread(input: OpenReportIntakeInput): Promise<ReportIntake>;
  findOpenIntakeForReporter(input: {
    serverId: string;
    reporterId: string;
  }): Promise<ReportIntake | null>;
  handleThreadMessage(message: Message): Promise<boolean>;
  confirmCandidate(input: {
    intakeId: string;
    targetUserId: string;
    confirmedById: string;
    confirmedByStaff?: boolean;
  }): Promise<{
    confirmed: boolean;
    message: string;
    reporterId?: string;
    reason?: string;
    attachments?: ReportAttachmentMetadata[];
  }>;
  rejectCandidates(input: {
    intakeId: string;
    rejectedById: string;
    promptToken: string;
    rejectedByStaff?: boolean;
  }): Promise<{ rejected: boolean; message: string }>;
  closeIntakeForThread(input: {
    threadId: string;
    closedById: string;
    closedByStaff?: boolean;
  }): Promise<ReportIntakeCloseResult>;
  recordAgentAnalysis(input: {
    intakeId: string;
    message: Message;
    candidates: ReportCandidate[];
    extraction?: ReportIntakeEvidenceExtraction;
    evidenceCount: number;
    imageCount: number;
  }): Promise<boolean>;
  markSubmitted(input: {
    intakeId: string;
    targetUserId: string;
    submittedById: string;
  }): Promise<void>;
  markOpenFailed(input: { intakeId: string; reason: string }): Promise<void>;
}

@injectable()
export class ReportIntakeService implements IReportIntakeService {
  constructor(
    @inject(TYPES.ReportIntakeRepository)
    private reportIntakeRepository: IReportIntakeRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.ConfigService) private configService: IConfigService,
    @inject(TYPES.ReportCandidateService) private candidateService: IReportCandidateService,
    @inject(TYPES.ModerationQueueService)
    @optional()
    private moderationQueueService?: IModerationQueueService
  ) {}

  async openIntakeFromThread(input: OpenReportIntakeInput): Promise<ReportIntake> {
    await this.serverRepository.getOrCreateServer(input.serverId);
    await this.userRepository.getOrCreateUser(
      input.reporter.id,
      input.reporter.user.username,
      input.reporter.user.createdAt
    );
    await this.serverMemberRepository.getOrCreateMember(
      input.serverId,
      input.reporter.id,
      input.reporter.joinedAt ?? undefined
    );

    return this.reportIntakeRepository.create({
      serverId: input.serverId,
      reporterId: input.reporter.id,
      threadId: input.threadId,
      status: ReportIntakeStatus.COLLECTING_EVIDENCE,
      metadata: {
        source: 'report_button',
        intake_channel_id: input.channelId,
        opened_at: new Date().toISOString(),
      },
    });
  }

  async findOpenIntakeForReporter(input: {
    serverId: string;
    reporterId: string;
  }): Promise<ReportIntake | null> {
    return this.reportIntakeRepository.findOpenByReporterAndServer(
      input.serverId,
      input.reporterId
    );
  }

  async handleThreadMessage(message: Message): Promise<boolean> {
    if (!message.guild || !message.channel.isThread()) {
      return false;
    }

    const intake = await this.reportIntakeRepository.findOpenByThreadId(message.channel.id);
    if (!intake) {
      return false;
    }

    await this.recordMessageEvidence(intake, message);
    if (message.author.id === intake.reporter_id && !this.isReporterCloseCommand(message.content)) {
      await this.moderationQueueService
        ?.recordReportThreadAttention(intake, message)
        .catch((error) => {
          console.warn(
            `[ReportIntake] Failed to queue report-thread attention for intake ${intake.id}`,
            error
          );
        });
    }
    return true;
  }

  async confirmCandidate(input: {
    intakeId: string;
    targetUserId: string;
    confirmedById: string;
    confirmedByStaff?: boolean;
  }): Promise<{
    confirmed: boolean;
    message: string;
    reporterId?: string;
    reason?: string;
    attachments?: ReportAttachmentMetadata[];
  }> {
    const intake = await this.reportIntakeRepository.findById(input.intakeId);
    if (!intake) {
      return { confirmed: false, message: 'That report intake could not be found.' };
    }
    const confirmedByReporter = intake.reporter_id === input.confirmedById;
    if (!confirmedByReporter && input.confirmedByStaff !== true) {
      return { confirmed: false, message: 'Only the reporter or staff can confirm this target.' };
    }
    if (intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION) {
      return {
        confirmed: false,
        message: 'That report intake is no longer accepting target confirmations.',
      };
    }
    if (input.targetUserId === intake.reporter_id || input.targetUserId === input.confirmedById) {
      return { confirmed: false, message: 'You cannot report yourself.' };
    }
    if (intake.confirmed_target_user_id) {
      if (intake.confirmed_target_user_id === input.targetUserId) {
        return {
          confirmed: false,
          message: 'That report target has already been confirmed for this intake.',
        };
      }

      return {
        confirmed: false,
        message: 'A different report target has already been confirmed for this intake.',
      };
    }

    const metadata = toRecord(intake.metadata);
    if (!this.hasSuggestedCandidate(metadata, input.targetUserId)) {
      return {
        confirmed: false,
        message: 'That target is not a current candidate for this intake.',
      };
    }

    const confirmedAt = new Date().toISOString();
    const confirmedIntake = await this.reportIntakeRepository.confirmTargetIfUnset(intake.id, {
      targetUserId: input.targetUserId,
      metadata: {
        ...metadata,
        confirmed_target_user_id: input.targetUserId,
        confirmed_by: input.confirmedById,
        confirmed_at: confirmedAt,
      },
    });
    if (!confirmedIntake) {
      return {
        confirmed: false,
        message: 'That report target has already been confirmed for this intake.',
      };
    }

    await this.reportIntakeRepository.addEvidence({
      intakeId: intake.id,
      kind: ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION,
      content: input.targetUserId,
      metadata: {
        confirmed_by: input.confirmedById,
        target_user_id: input.targetUserId,
        confirmed_at: confirmedAt,
      },
    });

    const evidence = await this.reportIntakeRepository.listEvidence(intake.id);
    return {
      confirmed: true,
      message: `Confirmed <@${input.targetUserId}> as the report target.`,
      reporterId: confirmedIntake.reporter_id,
      reason: this.buildSubmissionReason(confirmedIntake, evidence),
      attachments: this.buildSubmissionAttachments(evidence),
    };
  }

  async rejectCandidates(input: {
    intakeId: string;
    rejectedById: string;
    promptToken: string;
    rejectedByStaff?: boolean;
  }): Promise<{ rejected: boolean; message: string }> {
    const intake = await this.reportIntakeRepository.findById(input.intakeId);
    if (!intake) {
      return { rejected: false, message: 'That report intake could not be found.' };
    }
    const rejectedByReporter = intake.reporter_id === input.rejectedById;
    if (!rejectedByReporter && input.rejectedByStaff !== true) {
      return {
        rejected: false,
        message: 'Only the reporter or staff can answer this target question.',
      };
    }
    if (intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION) {
      return {
        rejected: false,
        message: 'That report intake is no longer waiting for a target answer.',
      };
    }

    const metadata = toRecord(intake.metadata);
    if (metadata.last_confirmation_prompt_token !== input.promptToken) {
      return {
        rejected: false,
        message: 'That target question is no longer current. Please answer the latest prompt.',
      };
    }

    const promptCandidateIdsByToken = toRecord(metadata.confirmation_prompt_candidate_ids_by_token);
    const rejectedCandidateIds = readStringArray(promptCandidateIdsByToken[input.promptToken]);
    if (rejectedCandidateIds.length === 0) {
      return {
        rejected: false,
        message: 'That target question is no longer current. Please answer the latest prompt.',
      };
    }

    const remainingCandidates = this.getCandidateSuggestions(metadata).filter(
      (candidate) => !rejectedCandidateIds.includes(candidate.discordUserId)
    );
    const allRejectedCandidateIds = Array.from(
      new Set([...readStringArray(metadata.rejected_candidate_ids), ...rejectedCandidateIds])
    );
    const now = new Date().toISOString();

    await this.reportIntakeRepository.addEvidence({
      intakeId: intake.id,
      kind: ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION,
      content: 'rejected',
      metadata: {
        rejected_by: input.rejectedById,
        rejected_candidate_ids: rejectedCandidateIds,
        rejected_at: now,
      },
    });

    await this.reportIntakeRepository.update(intake.id, {
      status: ReportIntakeStatus.COLLECTING_EVIDENCE,
      metadata: {
        ...metadata,
        candidate_suggestions: remainingCandidates,
        rejected_candidate_ids: allRejectedCandidateIds,
        last_rejected_candidate_ids: rejectedCandidateIds,
        last_rejected_at: now,
        last_confirmation_prompt_candidate_ids: [],
      },
    });

    return {
      rejected: true,
      message:
        'Okay, I will not submit a report for that target. Please add more context, a message link, ID, or screenshot if you want me to keep looking.',
    };
  }

  async recordAgentAnalysis(input: {
    intakeId: string;
    message: Message;
    candidates: ReportCandidate[];
    extraction?: ReportIntakeEvidenceExtraction;
    evidenceCount: number;
    imageCount: number;
  }): Promise<boolean> {
    const intake = await this.reportIntakeRepository.findById(input.intakeId);
    if (!intake || intake.status !== ReportIntakeStatus.COLLECTING_EVIDENCE) {
      return false;
    }

    const metadata = toRecord(intake.metadata);
    const candidateSuggestions = this.mergeCandidateSuggestions(metadata, input.candidates);
    const promptMetadata =
      candidateSuggestions.length > 0
        ? await this.sendCandidateConfirmationPrompt(intake, input.message, candidateSuggestions)
        : {};

    await this.reportIntakeRepository.update(intake.id, {
      status: this.resolveNextStatus(intake.status, candidateSuggestions.length),
      summary: input.extraction?.abuseSignals.length
        ? input.extraction.abuseSignals.join('; ')
        : intake.summary,
      metadata: {
        ...metadata,
        candidate_suggestions: candidateSuggestions,
        report_intake_agent: {
          extraction: input.extraction,
          evidence_count: input.evidenceCount,
          image_count: input.imageCount,
          candidate_count: candidateSuggestions.length,
          analyzed_at: new Date().toISOString(),
        },
        ...promptMetadata,
      },
    });

    return candidateSuggestions.length > 0;
  }

  async markSubmitted(input: {
    intakeId: string;
    targetUserId: string;
    submittedById: string;
  }): Promise<void> {
    const intake = await this.reportIntakeRepository.findById(input.intakeId);
    if (!intake) {
      return;
    }

    const submittedAt = new Date();
    await this.reportIntakeRepository.update(input.intakeId, {
      status: ReportIntakeStatus.SUBMITTED,
      confirmedTargetUserId: input.targetUserId,
      closedAt: submittedAt,
      metadata: {
        ...toRecord(intake.metadata),
        submitted_by: input.submittedById,
        submitted_at: submittedAt.toISOString(),
        closed_reason: 'submitted',
      },
    });
    await this.clearReportThreadAttention(input.intakeId);
  }

  async markOpenFailed(input: { intakeId: string; reason: string }): Promise<void> {
    const intake = await this.reportIntakeRepository.findById(input.intakeId);
    if (!intake) {
      return;
    }

    await this.reportIntakeRepository.update(input.intakeId, {
      status: ReportIntakeStatus.EXPIRED,
      closedAt: new Date(),
      metadata: {
        ...toRecord(intake.metadata),
        open_failed_reason: input.reason,
        open_failed_at: new Date().toISOString(),
      },
    });
    await this.clearReportThreadAttention(input.intakeId);
  }

  async closeIntakeForThread(input: {
    threadId: string;
    closedById: string;
    closedByStaff?: boolean;
  }): Promise<ReportIntakeCloseResult> {
    const intake = await this.reportIntakeRepository.findByThreadId(input.threadId);
    if (!intake) {
      return { closed: false, message: 'This thread does not have a report intake.' };
    }

    const closedByReporter = intake.reporter_id === input.closedById;
    if (!closedByReporter && input.closedByStaff !== true) {
      return {
        closed: false,
        message: 'Only the reporter or staff can close this report intake.',
      };
    }

    if (this.isOpenIntakeStatus(intake.status)) {
      await this.closeIntake(intake, {
        closedById: input.closedById,
        closedByStaff: !closedByReporter && input.closedByStaff === true,
      });

      return {
        closed: true,
        message: REPORT_INTAKE_CANCELLED_MESSAGE,
        shouldArchiveThread: true,
      };
    }

    if (intake.status === ReportIntakeStatus.SUBMITTED) {
      await this.recordThreadClose(intake, {
        closedById: input.closedById,
        closedByStaff: !closedByReporter && input.closedByStaff === true,
        reason: 'submitted_thread_close',
      });

      return {
        closed: true,
        message: REPORT_INTAKE_SUBMITTED_CLOSEOUT_MESSAGE,
        shouldArchiveThread: true,
      };
    }

    if (this.isReviewedIntakeStatus(intake.status)) {
      await this.recordThreadClose(intake, {
        closedById: input.closedById,
        closedByStaff: !closedByReporter && input.closedByStaff === true,
        reason: 'reviewed_thread_close',
      });

      return {
        closed: true,
        message: REPORT_INTAKE_REVIEWED_CLOSEOUT_MESSAGE,
        shouldArchiveThread: true,
      };
    }

    return {
      closed: true,
      message: REPORT_INTAKE_ALREADY_CLOSED_MESSAGE,
      shouldArchiveThread: true,
    };
  }

  private async recordMessageEvidence(intake: ReportIntake, message: Message): Promise<void> {
    const isReporterMessage = message.author.id === intake.reporter_id;
    const trimmedContent = message.content.trim();

    if (trimmedContent) {
      await this.reportIntakeRepository.addEvidence({
        intakeId: intake.id,
        kind: isReporterMessage
          ? ReportIntakeEvidenceKind.REPORTER_TEXT
          : ReportIntakeEvidenceKind.ADMIN_NOTE,
        sourceMessageId: message.id,
        sourceChannelId: message.channelId,
        content: trimmedContent,
        metadata: { author_id: message.author.id },
      });
    }

    const signals = isReporterMessage
      ? this.candidateService.extractCandidateSignals(trimmedContent)
      : { mentions: [], explicitUserIds: [], messageLinks: [] };
    for (const link of signals.messageLinks) {
      await this.reportIntakeRepository.addEvidence({
        intakeId: intake.id,
        kind: ReportIntakeEvidenceKind.MESSAGE_LINK,
        sourceMessageId: message.id,
        sourceChannelId: message.channelId,
        content: link.url,
        metadata: {
          author_id: message.author.id,
          guild_id: link.guildId,
          channel_id: link.channelId,
          message_id: link.messageId,
        },
      });
    }

    const eligibleImages = isReporterMessage
      ? await this.selectEligibleImageAttachments(intake.server_id, message)
      : [];
    for (const attachment of eligibleImages) {
      await this.reportIntakeRepository.addEvidence({
        intakeId: intake.id,
        kind: ReportIntakeEvidenceKind.SCREENSHOT,
        sourceMessageId: message.id,
        sourceChannelId: message.channelId,
        attachmentId: attachment.id ?? null,
        metadata: { ...attachment, author_id: message.author.id },
      });
    }

    const candidates = isReporterMessage
      ? await this.candidateService.resolvePlatformBackedCandidates(message)
      : [];
    const now = new Date();
    const metadata = toRecord(intake.metadata);
    const candidateSuggestions = this.mergeCandidateSuggestions(metadata, candidates);
    const nextMetadata = {
      ...metadata,
      last_evidence_message_id: message.id,
      last_evidence_author_id: message.author.id,
      last_evidence_recorded_at: now.toISOString(),
      ...(isReporterMessage ? { candidate_signals: signals } : {}),
      candidate_suggestions: candidateSuggestions,
    };

    if (isReporterMessage && this.isReporterCloseCommand(trimmedContent)) {
      await this.closeIntake(intake, {
        closedById: message.author.id,
        metadata: nextMetadata,
      });
      if (hasMessageSend(message.channel)) {
        await message.channel.send({
          content: REPORT_INTAKE_CANCELLED_MESSAGE,
          components: [],
          allowedMentions: { parse: [] },
        });
      }
      await archiveClosedThread(message.channel);
      return;
    }

    const promptMetadata =
      isReporterMessage && candidateSuggestions.length > 0
        ? await this.sendCandidateConfirmationPrompt(intake, message, candidateSuggestions)
        : {};

    const status = this.resolveNextStatus(intake.status, candidateSuggestions.length);
    await this.reportIntakeRepository.update(intake.id, {
      status,
      metadata: { ...nextMetadata, ...promptMetadata },
    });
  }

  private async selectEligibleImageAttachments(
    serverId: string,
    message: Message
  ): Promise<ReportAttachmentMetadata[]> {
    if (message.attachments.size === 0) {
      return [];
    }

    const serverConfig = await this.configService.getServerConfig(serverId);
    return selectEligibleMessageReportImageAttachments(
      message,
      getReportAiSettings(serverConfig.settings)
    );
  }

  private resolveNextStatus(
    currentStatus: ReportIntakeStatus,
    candidateCount: number
  ): ReportIntakeStatus {
    if (currentStatus !== ReportIntakeStatus.COLLECTING_EVIDENCE) {
      return currentStatus;
    }

    return candidateCount > 0
      ? ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
      : ReportIntakeStatus.COLLECTING_EVIDENCE;
  }

  private async sendCandidateConfirmationPrompt(
    intake: ReportIntake,
    message: Message,
    candidates: Awaited<ReturnType<IReportCandidateService['resolvePlatformBackedCandidates']>>
  ): Promise<Record<string, unknown>> {
    const visibleCandidates = candidates
      .filter((candidate) => candidate.discordUserId !== intake.reporter_id)
      .slice(0, REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS);
    const candidateIds = visibleCandidates.map((candidate) => candidate.discordUserId);
    if (candidateIds.length === 0) {
      return {};
    }

    const metadata = toRecord(intake.metadata);
    if (sameStringArray(metadata.last_confirmation_prompt_candidate_ids, candidateIds)) {
      return {};
    }

    if (!hasMessageSend(message.channel)) {
      return {};
    }

    const confirmButtons = visibleCandidates.map((candidate) =>
      new ButtonBuilder()
        .setCustomId(
          `${REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX}:${intake.id}:${candidate.discordUserId}`
        )
        .setLabel(this.buildCandidateButtonLabel(candidate))
        .setStyle(ButtonStyle.Primary)
    );
    const promptToken = this.createPromptToken(candidateIds);
    const rejectButton = new ButtonBuilder()
      .setCustomId(`${REPORT_INTAKE_REJECT_CUSTOM_ID_PREFIX}:${intake.id}:${promptToken}`)
      .setLabel(visibleCandidates.length === 1 ? 'No, not this person' : 'No, none of these')
      .setStyle(ButtonStyle.Secondary);
    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButtons),
      new ActionRowBuilder<ButtonBuilder>().addComponents(rejectButton),
    ];

    await message.channel.send({
      content: this.buildCandidateConfirmationMessage(visibleCandidates, candidates.length),
      components,
      allowedMentions: { parse: [] },
    });

    return {
      last_confirmation_prompt_candidate_ids: candidateIds,
      last_confirmation_prompt_token: promptToken,
      last_confirmation_prompt_at: new Date().toISOString(),
      confirmation_prompt_candidate_ids_by_token: {
        ...toRecord(metadata.confirmation_prompt_candidate_ids_by_token),
        [promptToken]: candidateIds,
      },
    };
  }

  private buildCandidateConfirmationMessage(
    visibleCandidates: Awaited<
      ReturnType<IReportCandidateService['resolvePlatformBackedCandidates']>
    >,
    totalCandidateCount: number
  ): string {
    const hasSingleCandidate = visibleCandidates.length === 1;
    const lines = hasSingleCandidate
      ? [
          'Are you trying to report this person?',
          '',
          this.formatCandidateLine(visibleCandidates[0], 1),
          '',
          'Select Yes to submit this as a user report, or No if this is not the person you meant.',
        ]
      : [
          'I found possible report targets. Are you trying to report one of these people?',
          '',
          ...visibleCandidates.map((candidate, index) =>
            this.formatCandidateLine(candidate, index + 1)
          ),
          '',
          'Select the matching Yes button to submit a report, or No if none of these are right.',
        ];

    if (totalCandidateCount > REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS) {
      lines.push(
        '',
        `Showing first ${REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS} candidates. Add more context if none match.`
      );
    }

    return lines.join('\n');
  }

  private formatCandidateLine(candidate: ReportCandidate, index: number): string {
    return `${index}. <@${candidate.discordUserId}> (${this.formatCandidateDisplayName(candidate)}) (${candidate.discordUserId})`;
  }

  private formatCandidateDisplayName(candidate: ReportCandidate): string {
    const names = [
      candidate.displayName,
      candidate.nickname,
      candidate.globalName,
      candidate.username,
    ]
      .map((name) => name?.trim())
      .filter((name): name is string => Boolean(name));
    const uniqueNames = [...new Set(names)];
    return uniqueNames[0] ?? 'unknown user';
  }

  private createPromptToken(candidateIds: string[]): string {
    return createHash('sha256').update(candidateIds.join('\0')).digest('base64url').slice(0, 16);
  }

  private buildCandidateButtonLabel(
    candidate: Awaited<
      ReturnType<IReportCandidateService['resolvePlatformBackedCandidates']>
    >[number]
  ): string {
    const label = candidate.displayName || candidate.username || candidate.discordUserId;
    return `Yes, report ${label}`.slice(0, 80);
  }

  private hasSuggestedCandidate(metadata: Record<string, unknown>, targetUserId: string): boolean {
    return this.getCandidateSuggestions(metadata).some(
      (candidate) => candidate.discordUserId === targetUserId
    );
  }

  private getCandidateSuggestions(metadata: Record<string, unknown>): ReportCandidate[] {
    const suggestions = metadata.candidate_suggestions;
    if (!Array.isArray(suggestions)) {
      return [];
    }

    return suggestions.filter(isReportCandidate);
  }

  private mergeCandidateSuggestions(
    metadata: Record<string, unknown>,
    candidates: ReportCandidate[]
  ): ReportCandidate[] {
    const merged = new Map<string, ReportCandidate>();
    const rejectedCandidateIds = new Set(readStringArray(metadata.rejected_candidate_ids));
    for (const candidate of this.getCandidateSuggestions(metadata)) {
      if (rejectedCandidateIds.has(candidate.discordUserId)) {
        continue;
      }
      merged.set(candidate.discordUserId, candidate);
    }

    for (const candidate of candidates) {
      if (rejectedCandidateIds.has(candidate.discordUserId)) {
        continue;
      }
      merged.set(candidate.discordUserId, candidate);
    }

    return Array.from(merged.values());
  }

  private buildSubmissionReason(
    intake: ReportIntake,
    evidence: Awaited<ReturnType<IReportIntakeRepository['listEvidence']>>
  ): string {
    const firstReporterText = evidence.find(
      (item) => item.kind === ReportIntakeEvidenceKind.REPORTER_TEXT && item.content
    )?.content;
    const confirmationEvidence = evidence.find(
      (item) =>
        item.kind === ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION &&
        Boolean(readOptionalString(toRecord(item.metadata).confirmed_by))
    );
    const confirmedBy = readOptionalString(toRecord(confirmationEvidence?.metadata).confirmed_by);
    const confirmerType = confirmedBy && confirmedBy !== intake.reporter_id ? 'staff' : 'reporter';
    const lines = [
      `Report intake target confirmed by ${confirmerType}.`,
      `Report intake ID: ${intake.id}`,
      intake.thread_id ? `Report thread ID: ${intake.thread_id}` : undefined,
      `Evidence entries: ${evidence.length}`,
      firstReporterText
        ? `Reporter context: ${truncate(firstReporterText, REPORT_INTAKE_REASON_TEXT_MAX_LENGTH)}`
        : undefined,
    ].filter((line): line is string => Boolean(line));

    return lines.join('\n');
  }

  private buildSubmissionAttachments(
    evidence: Awaited<ReturnType<IReportIntakeRepository['listEvidence']>>
  ): ReportAttachmentMetadata[] {
    return evidence
      .filter((item) => item.kind === ReportIntakeEvidenceKind.SCREENSHOT)
      .map((item) => {
        const metadata = toRecord(item.metadata);
        return {
          id: readOptionalString(metadata.id) ?? item.attachment_id ?? undefined,
          name: readOptionalString(metadata.name),
          url: readOptionalString(metadata.url),
          proxyUrl: readOptionalString(metadata.proxyUrl),
          contentType: readOptionalString(metadata.contentType),
          size: readOptionalNumber(metadata.size),
        };
      })
      .filter((attachment) => Boolean(attachment.url));
  }

  private isReporterCloseCommand(content: string): boolean {
    return REPORT_INTAKE_CLOSE_COMMANDS.has(content.trim().toLowerCase());
  }

  private isOpenIntakeStatus(status: ReportIntakeStatus): boolean {
    return [
      ReportIntakeStatus.COLLECTING_EVIDENCE,
      ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
      ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
    ].includes(status);
  }

  private isReviewedIntakeStatus(status: ReportIntakeStatus): boolean {
    return [
      ReportIntakeStatus.ACTIONED,
      ReportIntakeStatus.DISMISSED,
      ReportIntakeStatus.FALSE_POSITIVE,
    ].includes(status);
  }

  private async closeIntake(
    intake: ReportIntake,
    input: {
      closedById: string;
      closedByStaff?: boolean;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.reportIntakeRepository.update(intake.id, {
      status: ReportIntakeStatus.CLOSED_BY_REPORTER,
      closedAt: new Date(),
      metadata: {
        ...toRecord(intake.metadata),
        ...input.metadata,
        closed_by: input.closedById,
        closed_reason: input.closedByStaff ? 'staff_request' : 'reporter_request',
        ...(input.closedByStaff ? { closed_by_staff: true } : {}),
      },
    });
    await this.clearReportThreadAttention(intake.id);
  }

  private async recordThreadClose(
    intake: ReportIntake,
    input: {
      closedById: string;
      closedByStaff?: boolean;
      reason: string;
    }
  ): Promise<void> {
    const now = new Date();
    await this.reportIntakeRepository.update(intake.id, {
      closedAt: intake.closed_at ?? now,
      metadata: {
        ...toRecord(intake.metadata),
        thread_closed_by: input.closedById,
        thread_closed_at: now.toISOString(),
        thread_closed_reason: input.reason,
        ...(input.closedByStaff ? { thread_closed_by_staff: true } : {}),
      },
    });
    await this.clearReportThreadAttention(intake.id);
  }

  private async clearReportThreadAttention(intakeId: string): Promise<void> {
    await this.moderationQueueService?.deleteReportThreadAttention(intakeId).catch((error) => {
      console.warn(
        `[ReportIntake] Failed to clear report-thread attention for intake ${intakeId}`,
        error
      );
    });
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function hasMessageSend(channel: unknown): channel is MessageSendChannel {
  const candidate = channel as Partial<MessageSendChannel> | null;
  return typeof candidate?.send === 'function';
}

async function archiveClosedThread(channel: unknown): Promise<void> {
  const candidate = channel as Partial<ArchivableThreadChannel> | null;
  if (!candidate || candidate.archived || typeof candidate.setArchived !== 'function') {
    return;
  }

  try {
    await candidate.setArchived(true, 'Report intake closed');
  } catch (error) {
    console.warn(`Failed to archive closed report intake thread ${candidate.id}:`, error);
  }
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) {
    return false;
  }

  const sortedValue = [...value].sort();
  const sortedExpected = [...expected].sort();
  return sortedValue.every((item, index) => item === sortedExpected[index]);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isReportCandidate(candidate: unknown): candidate is ReportCandidate {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }

  const value = candidate as Record<string, unknown>;
  return (
    typeof value.candidateId === 'string' &&
    typeof value.discordUserId === 'string' &&
    typeof value.serverId === 'string' &&
    Array.isArray(value.matchReasons) &&
    value.matchReasons.every((item) => typeof item === 'string') &&
    typeof value.confidence === 'number' &&
    Array.isArray(value.ambiguityNotes) &&
    value.ambiguityNotes.every((item) => typeof item === 'string') &&
    Array.isArray(value.platformBackedEvidence) &&
    value.platformBackedEvidence.every((item) => typeof item === 'string') &&
    typeof value.confirmationRequired === 'boolean'
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
