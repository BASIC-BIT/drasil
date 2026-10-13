import {
  withObservation,
  recordObservation,
  recordWorkflowOutcome,
} from '../observability/langfuse';
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
import type { IThreadManager } from './ThreadManager';
import type { ReportIntakeEvidenceExtraction } from './GPTService';
import { IReportCandidateService, ReportCandidate } from './ReportCandidateService';
import { IModerationQueueService } from './ModerationQueueService';
import { formatInlineIdentifier } from '../utils/discordUserIdentity';

const REPORT_INTAKE_CLOSE_COMMANDS = new Set(['close report', 'cancel report', 'close intake']);
const REPORT_INTAKE_REASON_TEXT_MAX_LENGTH = 1000;
const REPORT_INTAKE_STATE_WRITE_ATTEMPTS = 2;
const REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS = 5;
const REPORT_INTAKE_CANCELLED_MESSAGE = 'Report cancelled. No report was submitted.';
export const REPORT_INTAKE_SUBMITTED_CLOSEOUT_MESSAGE = 'Report submitted.';
const REPORT_INTAKE_REVIEWED_CLOSEOUT_MESSAGE = 'Moderators have reviewed this report.';
const REPORT_INTAKE_ALREADY_CLOSED_MESSAGE = 'This report is closed.';

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

interface ConfirmationPrompt {
  message: Pick<Message, 'id' | 'edit'>;
  metadata: Record<string, unknown>;
  components: ActionRowBuilder<ButtonBuilder>[];
  channel: MessageSendChannel;
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
  findIntakeById(intakeId: string): Promise<ReportIntake | null>;
  handleThreadMessage(message: Message): Promise<boolean>;
  confirmCandidate(input: {
    intakeId: string;
    targetUserId: string;
    confirmedById: string;
    confirmedByStaff?: boolean;
    promptMessageId?: string;
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
    promptMessageId?: string;
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
  }): Promise<boolean>;
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
    @inject(TYPES.ThreadManager) private threadManager: IThreadManager,
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

  async findIntakeById(intakeId: string): Promise<ReportIntake | null> {
    return this.reportIntakeRepository.findById(intakeId);
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
    promptMessageId?: string;
  }): Promise<{
    confirmed: boolean;
    message: string;
    reporterId?: string;
    reason?: string;
    attachments?: ReportAttachmentMetadata[];
  }> {
    const intake = await this.reportIntakeRepository.findById(input.intakeId);
    if (!intake) {
      return { confirmed: false, message: 'This report could not be found.' };
    }
    const confirmedByReporter = intake.reporter_id === input.confirmedById;
    if (!confirmedByReporter && input.confirmedByStaff !== true) {
      return {
        confirmed: false,
        message: 'Only the reporter or a moderator can confirm the person.',
      };
    }
    if (
      intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION ||
      intake.confirmed_target_user_id
    ) {
      await this.retireConfirmationPrompts(
        intake,
        input.promptMessageId ? [input.promptMessageId] : []
      );
      return {
        confirmed: false,
        message: this.confirmationUnavailableMessage(intake),
      };
    }
    if (input.targetUserId === intake.reporter_id || input.targetUserId === input.confirmedById) {
      return { confirmed: false, message: 'You cannot report yourself.' };
    }
    const metadata = toRecord(intake.metadata);
    if (
      typeof metadata.last_confirmation_prompt_message_id === 'string' &&
      metadata.last_confirmation_prompt_message_id !== input.promptMessageId
    ) {
      if (input.promptMessageId)
        await this.retireConfirmationPrompts(intake, [input.promptMessageId]);
      return { confirmed: false, message: 'Use the latest confirmation message in this thread.' };
    }
    if (!this.hasSuggestedCandidate(metadata, input.targetUserId)) {
      return {
        confirmed: false,
        message: 'Use the latest confirmation message in this thread.',
      };
    }

    const confirmedAt = new Date().toISOString();
    const confirmedIntake = await this.reportIntakeRepository.confirmTargetIfUnset(intake.id, {
      targetUserId: input.targetUserId,
      expectedMetadata: intake.metadata,
      metadata: {
        ...metadata,
        confirmed_target_user_id: input.targetUserId,
        confirmed_by: input.confirmedById,
        confirmed_at: confirmedAt,
      },
    });
    if (!confirmedIntake) {
      const current = await this.reportIntakeRepository.findById(intake.id);
      return {
        confirmed: false,
        message: current
          ? this.confirmationUnavailableMessage(current)
          : 'This report could not be found.',
      };
    }

    await this.retireConfirmationPrompts(
      intake,
      getReportConfirmationMessageIds(intake, input.promptMessageId)
    );

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
    promptMessageId?: string;
  }): Promise<{ rejected: boolean; message: string }> {
    const intake = await this.reportIntakeRepository.findById(input.intakeId);
    if (!intake) {
      return { rejected: false, message: 'This report could not be found.' };
    }
    const rejectedByReporter = intake.reporter_id === input.rejectedById;
    if (!rejectedByReporter && input.rejectedByStaff !== true) {
      return {
        rejected: false,
        message: 'Only the reporter or a moderator can change this selection.',
      };
    }
    if (
      intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION ||
      intake.confirmed_target_user_id
    ) {
      await this.retireConfirmationPrompts(
        intake,
        input.promptMessageId ? [input.promptMessageId] : []
      );
      return {
        rejected: false,
        message: this.confirmationUnavailableMessage(intake),
      };
    }

    const metadata = toRecord(intake.metadata);
    if (
      typeof metadata.last_confirmation_prompt_message_id === 'string' &&
      metadata.last_confirmation_prompt_message_id !== input.promptMessageId
    ) {
      if (input.promptMessageId)
        await this.retireConfirmationPrompts(intake, [input.promptMessageId]);
      return { rejected: false, message: 'Use the latest confirmation message in this thread.' };
    }
    if (metadata.last_confirmation_prompt_token !== input.promptToken) {
      return {
        rejected: false,
        message: 'Use the latest confirmation message in this thread.',
      };
    }

    const promptCandidateIdsByToken = toRecord(metadata.confirmation_prompt_candidate_ids_by_token);
    const rejectedCandidateIds = readStringArray(promptCandidateIdsByToken[input.promptToken]);
    if (rejectedCandidateIds.length === 0) {
      return {
        rejected: false,
        message: 'Use the latest confirmation message in this thread.',
      };
    }

    const remainingCandidates = this.getCandidateSuggestions(metadata).filter(
      (candidate) => !rejectedCandidateIds.includes(candidate.discordUserId)
    );
    const allRejectedCandidateIds = Array.from(
      new Set([...readStringArray(metadata.rejected_candidate_ids), ...rejectedCandidateIds])
    );
    const now = new Date().toISOString();

    const updated = await this.reportIntakeRepository.updateIfCurrent(intake, {
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

    if (!updated) {
      const current = await this.reportIntakeRepository.findById(intake.id);
      return {
        rejected: false,
        message: current
          ? this.confirmationUnavailableMessage(current)
          : 'This report could not be found.',
      };
    }

    await this.retireConfirmationPrompts(
      intake,
      getReportConfirmationMessageIds(intake, input.promptMessageId)
    );

    await this.reportIntakeRepository
      .addEvidence({
        intakeId: intake.id,
        kind: ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION,
        content: 'rejected',
        metadata: {
          rejected_by: input.rejectedById,
          rejected_candidate_ids: rejectedCandidateIds,
          rejected_at: now,
        },
      })
      .catch((error: unknown) => {
        console.warn(`Failed to append evidence for saved report rejection ${intake.id}:`, error);
      });

    return {
      rejected: true,
      message: 'Selection cleared.',
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
    if (
      !intake ||
      intake.status !== ReportIntakeStatus.COLLECTING_EVIDENCE ||
      intake.confirmed_target_user_id
    ) {
      recordWorkflowOutcome({
        output: { actual_outcome: 'intake_unavailable', persistence_completed: false },
      });
      return false;
    }

    let current: ReportIntake | null = intake;
    for (let attempt = 0; attempt < REPORT_INTAKE_STATE_WRITE_ATTEMPTS; attempt++) {
      if (!current || current.confirmed_target_user_id || !this.isOpenIntakeStatus(current.status))
        return false;
      const snapshot = current;
      const metadata = toRecord(snapshot.metadata);
      const candidateSuggestions = this.mergeCandidateSuggestions(metadata, input.candidates);
      const storedEvidenceCount = toRecord(metadata.report_intake_agent).evidence_count;
      const preserveAnalysis =
        typeof storedEvidenceCount === 'number' && storedEvidenceCount > input.evidenceCount;
      const aiSummary = input.extraction?.abuseSignals.length
        ? input.extraction.abuseSignals.join('; ')
        : null;
      const prompt =
        candidateSuggestions.length > 0
          ? await this.sendCandidateConfirmationPrompt(
              snapshot,
              input.message,
              candidateSuggestions
            )
          : null;

      recordWorkflowOutcome({
        output: {
          actual_outcome: prompt?.metadata.last_confirmation_prompt_token
            ? 'confirmation_sent'
            : candidateSuggestions.length
              ? 'confirmation_suppressed'
              : 'no_candidates',
          confirmation_sent: Boolean(prompt?.metadata.last_confirmation_prompt_token),
          persistence_completed: false,
        },
      });
      const persisted = await withObservation('persist-result', 'span', () =>
        this.reportIntakeRepository.updateIfCurrent(snapshot, {
          status: this.resolveNextStatus(snapshot.status, candidateSuggestions.length),
          summary: preserveAnalysis ? snapshot.summary : (aiSummary ?? snapshot.summary),
          metadata: {
            ...metadata,
            candidate_suggestions: candidateSuggestions,
            ...(preserveAnalysis
              ? {}
              : {
                  ...(aiSummary ? { summary_source: 'ai_report_intake_extraction' } : {}),
                  report_intake_agent: {
                    extraction: input.extraction,
                    evidence_count: input.evidenceCount,
                    image_count: input.imageCount,
                    candidate_count: candidateSuggestions.length,
                    analyzed_at: new Date().toISOString(),
                  },
                }),
            ...prompt?.metadata,
          },
        })
      ).catch(async (error: unknown) => {
        await this.finishConfirmationPrompt(snapshot, prompt, null);
        throw error;
      });
      recordWorkflowOutcome({
        output: {
          actual_outcome: persisted
            ? candidateSuggestions.length
              ? 'candidates_suggested'
              : 'no_candidates'
            : 'persistence_failed',
          confirmation_sent: Boolean(prompt?.metadata.last_confirmation_prompt_token),
          persistence_completed: Boolean(persisted),
          candidate_count: candidateSuggestions.length,
        },
        ...(persisted || attempt + 1 < REPORT_INTAKE_STATE_WRITE_ATTEMPTS
          ? {}
          : { level: 'ERROR' as const, statusMessage: 'persistence_failed' }),
      });

      const ready = await this.finishConfirmationPrompt(snapshot, prompt, persisted);
      if (persisted) return Boolean(ready && candidateSuggestions.length > 0);
      if (attempt + 1 < REPORT_INTAKE_STATE_WRITE_ATTEMPTS)
        current = await this.reportIntakeRepository.findById(intake.id);
    }
    if (input.candidates.length)
      await this.reportUnavailableConfirmation(intake, input.message, input.candidates);
    return false;
  }

  async markSubmitted(input: {
    intakeId: string;
    targetUserId: string;
    submittedById: string;
  }): Promise<boolean> {
    for (let attempt = 0; attempt < REPORT_INTAKE_STATE_WRITE_ATTEMPTS; attempt++) {
      const intake = await this.reportIntakeRepository.findById(input.intakeId);
      if (
        !intake ||
        (intake.confirmed_target_user_id && intake.confirmed_target_user_id !== input.targetUserId)
      )
        return false;
      const submittedAt = new Date();
      const metadata = toRecord(intake.metadata);
      const updated = await this.reportIntakeRepository.updateIfCurrent(intake, {
        status: this.isOpenIntakeStatus(intake.status)
          ? ReportIntakeStatus.SUBMITTED
          : intake.status,
        confirmedTargetUserId: input.targetUserId,
        closedAt: intake.closed_at ?? submittedAt,
        metadata: {
          ...metadata,
          submitted_by: input.submittedById,
          submitted_at: submittedAt.toISOString(),
          ...(metadata.closed_reason ? {} : { closed_reason: 'submitted' }),
        },
      });
      if (updated) {
        await this.retireConfirmationPrompts(updated, getReportConfirmationMessageIds(updated));
        await this.clearReportThreadAttention(input.intakeId);
        return true;
      }
    }
    return false;
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
    for (let attempt = 0; attempt < REPORT_INTAKE_STATE_WRITE_ATTEMPTS; attempt++) {
      const intake = await this.reportIntakeRepository.findByThreadId(input.threadId);
      if (!intake) return { closed: false, message: 'This thread does not have a report.' };
      const closedByReporter = intake.reporter_id === input.closedById;
      if (!closedByReporter && input.closedByStaff !== true)
        return {
          closed: false,
          message: 'Only the reporter or a moderator can close this report.',
        };
      if (this.isOpenIntakeStatus(intake.status) && !intake.confirmed_target_user_id) {
        if (
          !(await this.closeIntake(intake, {
            closedById: input.closedById,
            closedByStaff: !closedByReporter && input.closedByStaff === true,
          }))
        )
          continue;
        return {
          closed: true,
          message: REPORT_INTAKE_CANCELLED_MESSAGE,
          shouldArchiveThread: true,
        };
      }
      if (
        this.isOpenIntakeStatus(intake.status) ||
        intake.status === ReportIntakeStatus.SUBMITTED ||
        this.isReviewedIntakeStatus(intake.status)
      ) {
        const reason =
          intake.status === ReportIntakeStatus.SUBMITTED
            ? 'submitted_thread_close'
            : this.isReviewedIntakeStatus(intake.status)
              ? 'reviewed_thread_close'
              : 'selected_thread_close';
        if (
          !(await this.recordThreadClose(intake, {
            closedById: input.closedById,
            closedByStaff: !closedByReporter && input.closedByStaff === true,
            reason,
          }))
        )
          continue;
        const message =
          intake.status === ReportIntakeStatus.SUBMITTED
            ? REPORT_INTAKE_SUBMITTED_CLOSEOUT_MESSAGE
            : this.isReviewedIntakeStatus(intake.status)
              ? REPORT_INTAKE_REVIEWED_CLOSEOUT_MESSAGE
              : 'The selected person remains recorded for moderator review.';
        return { closed: true, message, shouldArchiveThread: true };
      }
      return {
        closed: true,
        message: REPORT_INTAKE_ALREADY_CLOSED_MESSAGE,
        shouldArchiveThread: true,
      };
    }
    return { closed: false, message: 'The report changed. Please try closing it again.' };
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

    if (isReporterMessage && this.isReporterCloseCommand(trimmedContent)) {
      const result = await this.closeIntakeForThread({
        threadId: message.channel.id,
        closedById: message.author.id,
      });
      if (hasMessageSend(message.channel))
        await message.channel
          .send({
            content: result.message,
            components: [],
            allowedMentions: { parse: [] },
          })
          .catch((error: unknown) => {
            console.error(
              `Failed to post report closeout for thread ${message.channel.id}:`,
              error
            );
          });
      if (result.shouldArchiveThread) await archiveClosedThread(message.channel);
      return;
    }
    let current: ReportIntake | null = intake;
    for (let attempt = 0; attempt < REPORT_INTAKE_STATE_WRITE_ATTEMPTS; attempt++) {
      if (!current || current.confirmed_target_user_id || !this.isOpenIntakeStatus(current.status))
        return;
      const metadata = toRecord(current.metadata);
      const candidateSuggestions = this.mergeCandidateSuggestions(metadata, candidates);
      const nextMetadata = {
        ...metadata,
        last_evidence_message_id: message.id,
        last_evidence_author_id: message.author.id,
        last_evidence_recorded_at: now.toISOString(),
        ...(isReporterMessage ? { candidate_signals: signals } : {}),
        candidate_suggestions: candidateSuggestions,
      };
      const prompt =
        isReporterMessage && candidateSuggestions.length > 0
          ? await this.sendCandidateConfirmationPrompt(current, message, candidateSuggestions)
          : null;
      let persisted: ReportIntake | null;
      try {
        persisted = await this.reportIntakeRepository.updateIfCurrent(current, {
          status: this.resolveNextStatus(current.status, candidateSuggestions.length),
          metadata: { ...nextMetadata, ...prompt?.metadata },
        });
      } catch (error) {
        await this.finishConfirmationPrompt(current, prompt, null);
        throw error;
      }
      await this.finishConfirmationPrompt(current, prompt, persisted);
      if (persisted) return;
      if (attempt + 1 < REPORT_INTAKE_STATE_WRITE_ATTEMPTS)
        current = await this.reportIntakeRepository.findById(intake.id);
    }
    if (isReporterMessage && candidates.length)
      await this.reportUnavailableConfirmation(intake, message, candidates);
  }

  private async reportUnavailableConfirmation(
    intake: ReportIntake,
    message: Message,
    candidates: ReportCandidate[]
  ): Promise<void> {
    const current = await this.reportIntakeRepository.findById(intake.id);
    if (
      !current ||
      current.confirmed_target_user_id ||
      !this.isOpenIntakeStatus(current.status) ||
      !this.mergeCandidateSuggestions(toRecord(current.metadata), candidates).length ||
      !hasMessageSend(message.channel)
    )
      return;
    await message.channel
      .send({
        content:
          "Drasil couldn't prepare the confirmation buttons. Please ask a moderator to review this thread.",
        components: [],
        allowedMentions: { parse: [] },
      })
      .catch((error: unknown) => {
        console.warn('Failed to deliver unavailable report confirmation notice:', error);
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
  ): Promise<ConfirmationPrompt | null> {
    return withObservation(
      'send-confirmation',
      'tool',
      async (): Promise<ConfirmationPrompt | null> => {
        const eligibleCandidates = candidates.filter(
          (candidate) => candidate.discordUserId !== intake.reporter_id
        );
        const visibleCandidates = eligibleCandidates.slice(
          0,
          REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS
        );
        const candidateIds = visibleCandidates.map((candidate) => candidate.discordUserId);
        if (candidateIds.length === 0) {
          recordObservation('tool', {
            output: { confirmation_sent: false, reason: 'no_visible_candidates' },
          });
          return null;
        }

        const metadata = toRecord(intake.metadata);
        if (sameStringArray(metadata.last_confirmation_prompt_candidate_ids, candidateIds)) {
          recordObservation('tool', {
            output: { confirmation_sent: false, reason: 'unchanged_candidates' },
          });
          return null;
        }

        if (!hasMessageSend(message.channel)) {
          recordObservation('tool', {
            output: { confirmation_sent: false, reason: 'channel_unavailable' },
            level: 'WARNING',
            statusMessage: 'channel_unavailable',
          });
          return null;
        }

        const confirmButtons = visibleCandidates.map((candidate, index) =>
          new ButtonBuilder()
            .setCustomId(
              `${REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX}:${intake.id}:${candidate.discordUserId}`
            )
            .setLabel(visibleCandidates.length === 1 ? 'Submit report' : `Report ${index + 1}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
        );
        const promptToken = this.createPromptToken(candidateIds);
        const rejectButton = new ButtonBuilder()
          .setCustomId(`${REPORT_INTAKE_REJECT_CUSTOM_ID_PREFIX}:${intake.id}:${promptToken}`)
          .setLabel(visibleCandidates.length === 1 ? 'Different person' : 'None of these')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);
        const components = [
          new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButtons),
          new ActionRowBuilder<ButtonBuilder>().addComponents(rejectButton),
        ];

        const sent = await message.channel.send({
          content: this.buildCandidateConfirmationMessage(
            visibleCandidates,
            eligibleCandidates.length
          ),
          components,
          allowedMentions: { parse: [] },
        });

        if (!isEditablePrompt(sent)) throw new Error('Confirmation message could not be tracked');

        recordObservation('tool', {
          output: { confirmation_sent: true, visible_candidate_count: candidateIds.length },
        });
        return {
          message: sent,
          channel: message.channel,
          components: components.map((row) =>
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              row.components.map((button) => ButtonBuilder.from(button).setDisabled(false))
            )
          ),
          metadata: {
            confirmation_prompt_message_ids: [
              ...new Set([...readStringArray(metadata.confirmation_prompt_message_ids), sent.id]),
            ],
            last_confirmation_prompt_message_id: sent.id,
            last_confirmation_prompt_candidate_ids: candidateIds,
            last_confirmation_prompt_token: promptToken,
            last_confirmation_prompt_at: new Date().toISOString(),
            confirmation_prompt_candidate_ids_by_token: {
              ...toRecord(metadata.confirmation_prompt_candidate_ids_by_token),
              [promptToken]: candidateIds,
            },
          },
        };
      }
    );
  }

  private async retireConfirmationPrompts(
    intake: ReportIntake,
    ids: readonly string[]
  ): Promise<void> {
    if (ids.length)
      await this.threadManager
        .retireReportConfirmationPrompts(intake, ids)
        .catch((error: unknown) => console.warn('Failed to retire report confirmations:', error));
  }

  private async finishConfirmationPrompt(
    intake: ReportIntake,
    prompt: ConfirmationPrompt | null,
    persisted: ReportIntake | null
  ): Promise<boolean> {
    if (!prompt) return Boolean(persisted);
    const removeControls = async (): Promise<void> => {
      await prompt.message
        .edit({ components: [] })
        .catch((error: unknown) =>
          console.warn(`Failed to retire unpublished report prompt ${prompt.message.id}:`, error)
        );
    };
    if (!persisted) {
      await removeControls();
      return false;
    }
    try {
      await prompt.message.edit({ components: prompt.components });
    } catch (error) {
      console.warn(`Failed to enable report confirmation ${prompt.message.id}:`, error);
      await removeControls();
      if (persisted.thread_id) {
        await prompt.channel
          .send({
            content:
              "Drasil couldn't enable the confirmation buttons. Please ask a moderator to review this thread.",
            components: [],
            allowedMentions: { parse: [] },
          })
          .catch((sendError: unknown) =>
            console.warn('Failed to report unavailable confirmation:', sendError)
          );
      }
      return false;
    }
    const current = await this.reportIntakeRepository.findById(intake.id);
    if (
      !current ||
      current.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION ||
      current.confirmed_target_user_id ||
      toRecord(current.metadata).last_confirmation_prompt_message_id !== prompt.message.id
    ) {
      await removeControls();
      return false;
    }
    const oldIds = readStringArray(
      toRecord(intake.metadata).confirmation_prompt_message_ids
    ).filter((id) => id !== prompt.message.id);
    if (oldIds.length)
      await this.threadManager
        .retireReportConfirmationPrompts(current, oldIds)
        .catch((error: unknown) =>
          console.warn('Failed to retire replaced report confirmations:', error)
        );
    return true;
  }

  private buildCandidateConfirmationMessage(
    visibleCandidates: Awaited<
      ReturnType<IReportCandidateService['resolvePlatformBackedCandidates']>
    >,
    totalCandidateCount: number
  ): string {
    const hasSingleCandidate = visibleCandidates.length === 1;
    const lines = [
      hasSingleCandidate ? 'Report this person?' : 'Who do you want to report?',
      '',
      ...visibleCandidates.map((candidate, index) =>
        this.formatCandidateLine(candidate, hasSingleCandidate ? undefined : index + 1)
      ),
    ];

    if (totalCandidateCount > REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS) {
      lines.push(
        '',
        `Showing ${REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS} of ${totalCandidateCount} matches. If the person isn't listed, add their username, user ID, or a message link.`
      );
    }

    return lines.join('\n');
  }

  private formatCandidateLine(candidate: ReportCandidate, index?: number): string {
    const name = this.formatCandidateDisplayName(candidate);
    const username = candidate.username?.trim();
    const nickname = candidate.nickname?.trim();
    const identity =
      username && username !== name
        ? `${formatInlineIdentifier(name)} (@${formatInlineIdentifier(username)})`
        : username
          ? `@${formatInlineIdentifier(username)}`
          : formatInlineIdentifier(name);
    const serverName =
      nickname && nickname !== name && nickname !== username
        ? `, server nickname ${formatInlineIdentifier(nickname)}`
        : '';
    return `${index === undefined ? '' : `${index}. `}${identity}${serverName}\nUser ID: ${formatInlineIdentifier(candidate.discordUserId)}`;
  }

  private confirmationUnavailableMessage(intake: ReportIntake): string {
    return (
      getReportConfirmationUnavailableMessage(intake) ??
      'Use the latest confirmation message in this thread.'
    );
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
  ): Promise<boolean> {
    const updated = await this.reportIntakeRepository.updateIfCurrent(intake, {
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
    if (!updated) return false;
    await this.retireConfirmationPrompts(updated, getReportConfirmationMessageIds(updated));
    await this.clearReportThreadAttention(intake.id);
    return true;
  }

  private async recordThreadClose(
    intake: ReportIntake,
    input: {
      closedById: string;
      closedByStaff?: boolean;
      reason: string;
    }
  ): Promise<boolean> {
    const now = new Date();
    const updated = await this.reportIntakeRepository.updateIfCurrent(intake, {
      closedAt: intake.closed_at ?? now,
      metadata: {
        ...toRecord(intake.metadata),
        thread_closed_by: input.closedById,
        thread_closed_at: now.toISOString(),
        thread_closed_reason: input.reason,
        ...(input.closedByStaff ? { thread_closed_by_staff: true } : {}),
      },
    });
    if (!updated) return false;
    await this.retireConfirmationPrompts(updated, getReportConfirmationMessageIds(updated));
    await this.clearReportThreadAttention(intake.id);
    return true;
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

function isEditablePrompt(value: unknown): value is Pick<Message, 'id' | 'edit'> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'edit' in value &&
    typeof value.edit === 'function'
  );
}

export function getReportConfirmationUnavailableMessage(intake: ReportIntake): string | null {
  if (intake.status === ReportIntakeStatus.SUBMITTED)
    return 'This report has already been submitted.';
  if (
    intake.status !== ReportIntakeStatus.COLLECTING_EVIDENCE &&
    intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
  )
    return 'This report is closed.';
  if (intake.confirmed_target_user_id)
    return 'A person is already selected. Submission is not confirmed. No second report was submitted.';
  return intake.status === ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
    ? null
    : 'Use the latest confirmation message in this thread.';
}

export function getReportConfirmationMessageIds(
  intake: ReportIntake,
  clickedId?: string
): string[] {
  return [
    ...new Set([
      ...readStringArray(toRecord(intake.metadata).confirmation_prompt_message_ids),
      ...(clickedId ? [clickedId] : []),
    ]),
  ];
}
