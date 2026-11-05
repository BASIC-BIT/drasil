import { formatReportIdentity } from '../utils/reportIdentityPresentation';
import {
  projectReportIntakeState,
  reportAnalysisMetadataSchema,
  type ReportCommand,
  type ReportSubmissionProgress,
} from '@drasil/application';
import {
  withObservation,
  recordObservation,
  recordWorkflowOutcome,
} from '../observability/langfuse';
import { createHash, randomBytes } from 'node:crypto';
import { getReportIntakeSettings } from '../utils/reportIntakeSettings';
import { canModerateReportIntake } from '../utils/reportIntakeStaffAuthorization';
import { buildReportEvidenceBatch, activeReportEvidence } from '../utils/reportIntakeEvidence';
import { ownsPresentation, processingMetadata } from '../repositories/reportIntakeProcessing';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  Message,
  type PartialMessage,
} from 'discord.js';
import { injectable, inject, optional } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IReportIntakeRepository } from '../repositories/ReportIntakeRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import {
  ReportIntake,
  ReportPresentationClaim,
  ReportIntakeEvidenceKind,
  ReportIntakeStatus,
} from '../repositories/types';
import { IUserRepository } from '../repositories/UserRepository';
import { getReportAiSettings, ReportAttachmentMetadata } from '../utils/reportAiSettings';
import { selectEligibleMessageReportImageAttachments } from '../utils/reportAttachments';
import type { IThreadManager } from './ThreadManager';
import type { ReportIntakeEvidenceExtraction } from './GPTService';
import {
  IReportCandidateService,
  ReportCandidate,
  reportCandidateStillMatches,
} from './ReportCandidateService';
import type { ReportDirectoryMember } from './ReportMemberDirectory';
import { IModerationQueueService } from './ModerationQueueService';

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
  publishSavedConfirmation(
    intakeId: string,
    message: Message,
    claim?: ReportPresentationClaim
  ): Promise<boolean>;
  openIntakeFromThread(input: OpenReportIntakeInput): Promise<ReportIntake>;
  findOpenIntakeForReporter(input: {
    serverId: string;
    reporterId: string;
  }): Promise<ReportIntake | null>;
  findIntakeById(intakeId: string): Promise<ReportIntake | null>;
  handleThreadMessage(message: Message): Promise<boolean>;
  handleThreadMessageUpdate(message: Message | PartialMessage): Promise<boolean>;
  handleThreadMessageDelete(input: {
    guildId: string;
    threadId: string;
    messageId: string;
  }): Promise<boolean>;
  confirmCandidate(input: {
    intakeId: string;
    targetUserId: string;
    confirmedById: string;
    confirmedByStaff?: boolean;
    currentMember?: ReportDirectoryMember;
    promptMessageId?: string;
    expectedEvidenceRevision?: number;
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
    expectedEvidenceRevision?: number;
  }): Promise<{ rejected: boolean; message: string }>;
  closeIntakeForThread(input: {
    threadId: string;
    closedById: string;
    closedByStaff?: boolean;
    closeMode?: Extract<ReportCommand, { kind: 'close_report_intake' }>['closeMode'];
    acceptedSubmissionToken?: string;
    expectedEvidenceRevision?: number;
    promptMessageId?: string;
  }): Promise<ReportIntakeCloseResult>;
  recordAgentAnalysis(input: {
    intakeId: string;
    message: Message;
    candidates: ReportCandidate[];
    extraction?: ReportIntakeEvidenceExtraction;
    evidenceCount: number;
    imageCount: number;
  }): Promise<boolean>;
  beginConfirmedSubmission(intakeId: string, token: string): Promise<boolean>;
  settleConfirmedSubmission(
    intakeId: string,
    token: string,
    state: 'accepted' | 'unknown' | 'not_dispatched'
  ): Promise<boolean>;
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

  async publishSavedConfirmation(
    intakeId: string,
    message: Message,
    claim?: ReportPresentationClaim
  ): Promise<boolean> {
    const intake = await this.reportIntakeRepository.findById(intakeId);
    if (!intake || !(await this.canPublishSavedConfirmation(intake, claim))) return false;
    const { analysis, metadata } = processingMetadata(intake);
    if (analysis.outcome?.kind !== 'confirm') return false;
    const candidate: ReportCandidate = {
      ...analysis.outcome.candidate,
      matchReasons: [],
      confidence: 1,
      ambiguityNotes: [],
      platformBackedEvidence: [],
      confirmationRequired: true,
    };
    if (
      metadata.last_confirmation_prompt_revision === intake.evidence_revision &&
      typeof metadata.last_confirmation_prompt_message_id === 'string'
    ) {
      const sent = await message.channel.messages.fetch(
        metadata.last_confirmation_prompt_message_id
      );
      if (
        !message.client.user ||
        sent.author.id !== message.client.user.id ||
        !hasMessageSend(message.channel)
      )
        return false;
      const token = metadata.last_confirmation_prompt_token;
      if (typeof token !== 'string') return false;
      return this.finishConfirmationPrompt(
        intake,
        {
          message: sent,
          channel: message.channel,
          metadata: {},
          components: this.candidateConfirmationControls(
            intake.id,
            [candidate.discordUserId],
            token,
            false
          ),
        },
        intake,
        claim
      );
    }
    const prompt = await this.sendCandidateConfirmationPrompt(intake, message, [candidate]);
    if (!prompt) return false;
    const persisted = await this.reportIntakeRepository.updateIfCurrent(intake, {
      metadata: {
        ...metadata,
        ...prompt.metadata,
        candidate_suggestions: [candidate],
        last_confirmation_prompt_revision: intake.evidence_revision,
        last_confirmation_prompt_due_at: intake.analysis_due_at?.toISOString(),
      },
    });
    return this.finishConfirmationPrompt(intake, prompt, persisted, claim);
  }

  private async canPublishSavedConfirmation(
    intake: ReportIntake,
    claim?: ReportPresentationClaim
  ): Promise<boolean> {
    if (
      (claim && !ownsPresentation(intake, claim, new Date())) ||
      intake.closed_at ||
      intake.confirmed_target_user_id ||
      intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION ||
      intake.evidence_revision !== intake.analysis_revision ||
      !intake.analysis_due_at ||
      intake.analysis_due_at <= new Date()
    )
      return false;
    const config = await this.configService.getServerConfig(intake.server_id, {
      forceRefresh: true,
      failOnReadError: true,
    });
    return (
      getReportIntakeSettings(config.settings).stagedEnabled &&
      processingMetadata(intake).analysis.handoff.state === 'none'
    );
  }

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

    const config = await this.configService.getServerConfig(input.serverId);
    return this.reportIntakeRepository.create({
      serverId: input.serverId,
      reporterId: input.reporter.id,
      threadId: input.threadId,
      status: ReportIntakeStatus.COLLECTING_EVIDENCE,
      metadata: {
        source: 'report_button',
        ...(getReportIntakeSettings(config.settings).stagedEnabled ? { workflow: 'staged' } : {}),
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

    const config = await this.configService.getServerConfig(message.guild.id);
    const existing = await this.reportIntakeRepository.findByThreadId(message.channel.id);
    if (
      getReportIntakeSettings(config.settings).stagedEnabled ||
      (existing && projectReportIntakeState(existing).staged)
    ) {
      const intake = existing;
      if (!intake || intake.server_id !== message.guild.id) return false;
      const sources = processingMetadata(intake).analysis.sources;
      if (
        Object.prototype.hasOwnProperty.call(sources, message.id) &&
        sources[message.id].availability === 'unavailable'
      )
        return this.handleThreadMessageUpdate(message);
      return this.recordStagedEvidence(intake, message, true);
    }
    const intake = await this.reportIntakeRepository.findOpenByThreadId(message.channel.id);
    if (!intake) return false;

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

  async handleThreadMessageUpdate(message: Message | PartialMessage): Promise<boolean> {
    if (!message.guild || !message.channel.isThread()) return false;
    const config = await this.configService.getServerConfig(message.guild.id);
    const intake = await this.reportIntakeRepository.findByThreadId(message.channel.id);
    if (
      !getReportIntakeSettings(config.settings).stagedEnabled &&
      (!intake || !projectReportIntakeState(intake).staged)
    )
      return false;
    if (!intake || intake.server_id !== message.guild.id) return false;
    const sources = processingMetadata(intake).analysis.sources;
    const source = Object.prototype.hasOwnProperty.call(sources, message.id)
      ? sources[message.id]
      : undefined;
    const current = await message.fetch(true).catch(() => null);
    if (current) {
      if (
        current.id !== message.id ||
        current.channelId !== message.channel.id ||
        current.guildId !== intake.server_id
      )
        return true;
      return this.recordStagedEvidence(
        intake,
        current,
        false,
        source?.availabilityFailureToken ?? undefined
      );
    }
    if (source && source.operation !== 'delete' && source.sourceChannelId === message.channel.id) {
      await this.reportIntakeRepository.recordEvidenceBatch({
        ...source,
        intakeId: intake.id,
        sourceMessageId: message.id,
        observedAt: new Date(),
        editedAt: source.editedAt ? new Date(source.editedAt) : null,
        availability: 'unavailable',
        evidence: [],
      });
      await this.retireConfirmationPrompts(intake, getReportConfirmationMessageIds(intake));
    }
    return true;
  }

  async handleThreadMessageDelete(input: {
    guildId: string;
    threadId: string;
    messageId: string;
  }): Promise<boolean> {
    const config = await this.configService.getServerConfig(input.guildId);
    const intake = await this.reportIntakeRepository.findByThreadId(input.threadId);
    if (
      !getReportIntakeSettings(config.settings).stagedEnabled &&
      (!intake || !projectReportIntakeState(intake).staged)
    )
      return false;
    if (!intake || intake.server_id !== input.guildId) return false;
    const sources = processingMetadata(intake).analysis.sources;
    const source = Object.prototype.hasOwnProperty.call(sources, input.messageId)
      ? sources[input.messageId]
      : undefined;
    if (source && source.sourceChannelId !== input.threadId) return true;
    const result = await this.reportIntakeRepository.recordEvidenceBatch({
      intakeId: intake.id,
      sourceMessageId: input.messageId,
      sourceChannelId: input.threadId,
      sourceAuthorId: source?.sourceAuthorId ?? null,
      sourceVersion: source?.sourceVersion ?? 0,
      sourceFingerprint:
        source?.sourceFingerprint ??
        createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      operation: 'delete',
      observedAt: new Date(),
      editedAt: source?.editedAt ? new Date(source.editedAt) : null,
      evidence: [],
    });
    if (result === 'recorded') {
      const current = await this.reportIntakeRepository.findById(intake.id);
      // Unknown-source tombstones preserve the current confirmation's evidence revision.
      if (current && current.evidence_revision > intake.evidence_revision)
        await this.retireConfirmationPrompts(intake, getReportConfirmationMessageIds(intake));
    }
    return true;
  }

  private async recordStagedEvidence(
    intake: ReportIntake,
    message: Message,
    allowClose: boolean,
    recoveryToken?: string
  ): Promise<boolean> {
    if (!message.guild || message.author.bot || message.system) return true;
    if (
      message.author.id !== intake.reporter_id &&
      !(await canModerateReportIntake(message.guild, message.author.id, this.configService))
    )
      return true;
    if (this.isReporterCloseCommand(message.content)) {
      if (allowClose && message.author.id === intake.reporter_id) {
        const result = await this.closeIntakeForThread({
          threadId: message.channel.id,
          closedById: message.author.id,
        });
        if (hasMessageSend(message.channel))
          await message.channel.send({
            content: result.message,
            components: [],
            allowedMentions: { parse: [] },
          });
        if (result.shouldArchiveThread) await archiveClosedThread(message.channel);
      }
      return true;
    }
    const result = await this.reportIntakeRepository.recordEvidenceBatch({
      ...buildReportEvidenceBatch(message, intake, 'upsert'),
      recoveryToken,
    });
    if (result === 'recorded') {
      await this.retireConfirmationPrompts(intake, getReportConfirmationMessageIds(intake));
      await this.acknowledgeStagedEvidence(intake.id, message);
    }
    return true;
  }

  private async acknowledgeStagedEvidence(intakeId: string, message: Message): Promise<void> {
    if (!hasMessageSend(message.channel)) return;
    const current = await this.reportIntakeRepository.findById(intakeId);
    if (!current) return;
    const metadata = toRecord(current.metadata);
    if (metadata.evidence_acknowledgement) return;
    const reserved = await this.reportIntakeRepository.updateIfCurrent(current, {
      metadata: { ...metadata, evidence_acknowledgement: { state: 'reserved' } },
    });
    if (!reserved) return;
    let state = 'sent';
    try {
      await message.channel.send({
        content: 'Evidence saved.',
        components: [],
        allowedMentions: { parse: [] },
      });
    } catch {
      state = 'failed';
    }
    for (let attempt = 0; attempt < REPORT_INTAKE_STATE_WRITE_ATTEMPTS; attempt++) {
      const latest = await this.reportIntakeRepository.findById(intakeId);
      if (!latest) return;
      if (
        await this.reportIntakeRepository.updateIfCurrent(latest, {
          metadata: { ...toRecord(latest.metadata), evidence_acknowledgement: { state } },
        })
      )
        return;
    }
  }

  async confirmCandidate(input: {
    intakeId: string;
    targetUserId: string;
    confirmedById: string;
    confirmedByStaff?: boolean;
    currentMember?: ReportDirectoryMember;
    promptMessageId?: string;
    expectedEvidenceRevision?: number;
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
    const state = projectReportIntakeState(intake);
    if (
      state.staged &&
      (input.expectedEvidenceRevision !== state.evidenceRevision ||
        state.presentationRevision !== state.evidenceRevision ||
        input.promptMessageId !== state.promptMessageId)
    )
      return { confirmed: false, message: 'Use the latest report review message.' };
    const adminSelection =
      input.confirmedByStaff === true &&
      intake.status === ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION;
    if (
      (intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION && !adminSelection) ||
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
      !adminSelection &&
      typeof metadata.last_confirmation_prompt_message_id === 'string' &&
      metadata.last_confirmation_prompt_message_id !== input.promptMessageId
    ) {
      if (input.promptMessageId)
        await this.retireConfirmationPrompts(intake, [input.promptMessageId]);
      return { confirmed: false, message: 'Use the latest confirmation message in this thread.' };
    }
    if (!adminSelection && !this.hasSuggestedCandidate(metadata, input.targetUserId)) {
      return {
        confirmed: false,
        message: 'Use the latest confirmation message in this thread.',
      };
    }

    if (state.staged && !adminSelection) {
      const outcome = processingMetadata(intake).analysis.outcome;
      if (
        outcome?.kind !== 'confirm' ||
        !input.currentMember ||
        !reportCandidateStillMatches(outcome.candidate, input.currentMember)
      )
        return {
          confirmed: false,
          message: 'The suggested identity changed. Please ask a moderator to review this report.',
        };
    }

    const confirmedAt = new Date().toISOString();
    const confirmedIntake = await this.reportIntakeRepository.confirmTargetIfUnset(intake.id, {
      targetUserId: input.targetUserId,
      expectedMetadata: intake.metadata,
      expectedEvidenceRevision: intake.evidence_revision,
      expectedStatus: intake.status,
      metadata: {
        ...metadata,
        confirmed_target_user_id: input.targetUserId,
        confirmed_by: input.confirmedById,
        confirmed_at: confirmedAt,
        ...(state.staged
          ? {
              submission: {
                token: randomBytes(12).toString('base64url'),
                targetUserId: input.targetUserId,
                state: 'not_dispatched',
                claimedAt: confirmedAt,
              },
            }
          : {}),
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
      getReportConfirmationMessageIds(intake, adminSelection ? undefined : input.promptMessageId)
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

    const evidence = activeReportEvidence(
      confirmedIntake,
      await this.reportIntakeRepository.listEvidence(intake.id)
    );
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
    expectedEvidenceRevision?: number;
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

    const state = projectReportIntakeState(intake);
    if (
      state.staged &&
      (input.expectedEvidenceRevision !== state.evidenceRevision ||
        state.presentationRevision !== state.evidenceRevision ||
        input.promptMessageId !== state.promptMessageId)
    )
      return { rejected: false, message: 'Use the latest confirmation message in this thread.' };
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

    const staged = state.staged ? processingMetadata(intake).analysis : null;
    if (staged) {
      if (staged.outcome?.kind !== 'confirm')
        return { rejected: false, message: 'Use the latest confirmation message in this thread.' };
      const previous = staged.outcome;
      staged.outcome = {
        kind: 'admin_review',
        reason: 'rejected',
        candidates: [],
        coverage: previous.coverage,
        includedEvidenceIds: previous.includedEvidenceIds,
        excludedEvidenceIds: previous.excludedEvidenceIds,
      };
      if (staged.handoff.state === 'none')
        staged.handoff = {
          state: 'pending',
          reason: 'rejected',
          attempts: 0,
          nextDueAt: now,
          receipt: 'pending',
        };
      staged.presentation = {
        revision: intake.evidence_revision,
        attempts: 0,
        nextDueAt: now,
        lease: null,
      };
    }
    const updated = await this.reportIntakeRepository.updateIfCurrent(intake, {
      status: staged
        ? ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION
        : ReportIntakeStatus.COLLECTING_EVIDENCE,
      ...(staged
        ? { analysisDueAt: null, analysisLeaseToken: null, analysisLeaseUntil: null }
        : {}),
      metadata: {
        ...metadata,
        ...(staged
          ? {
              analysis: staged,
              last_confirmation_prompt_message_id: null,
              last_confirmation_prompt_token: null,
            }
          : {}),
        candidate_suggestions: remainingCandidates,
        rejected_candidate_ids: allRejectedCandidateIds,
        last_rejected_candidate_ids: rejectedCandidateIds,
        last_rejected_at: now,
        last_rejected_by: input.rejectedById,
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
      message: staged
        ? "Your evidence is saved for moderator review. You don't need to do anything else."
        : 'Selection cleared.',
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
      if (persisted) {
        if (
          !preserveAnalysis &&
          input.candidates.length === 0 &&
          candidateSuggestions.length === 0 &&
          hasMessageSend(input.message.channel)
        ) {
          const explanation = input.extraction?.isFallback
            ? "I couldn't analyze this evidence."
            : "I couldn't match this evidence to a current member of this server.";
          await input.message.channel
            .send({
              content: `${explanation} Please add an @mention, Discord user ID, or message link so I can identify the person you want to report.`,
              components: [],
              allowedMentions: { parse: [] },
            })
            .catch((error: unknown) => {
              console.warn('Failed to deliver report intake analysis notice:', error);
            });
        }
        return Boolean(ready && candidateSuggestions.length > 0);
      }
      if (attempt + 1 < REPORT_INTAKE_STATE_WRITE_ATTEMPTS)
        current = await this.reportIntakeRepository.findById(intake.id);
    }
    if (input.candidates.length)
      await this.reportUnavailableConfirmation(intake, input.message, input.candidates);
    return false;
  }

  private submissionRecoveryMetadata(
    intake: ReportIntake,
    submission: ReportSubmissionProgress
  ): Record<string, unknown> {
    const { metadata, analysis } = processingMetadata(intake);
    const prior = analysis.outcome;
    analysis.outcome = {
      kind: 'admin_review',
      reason: 'submission_recovery',
      candidates: prior?.kind === 'confirm' ? [prior.candidate] : (prior?.candidates ?? []),
      coverage: prior?.coverage ?? { kind: 'unavailable', reason: 'transport' },
      includedEvidenceIds: prior?.includedEvidenceIds ?? [],
      excludedEvidenceIds: prior?.excludedEvidenceIds ?? [],
    };
    if (analysis.handoff.state === 'none')
      analysis.handoff = {
        state: 'pending',
        reason: 'submission_recovery',
        attempts: 0,
        nextDueAt: new Date().toISOString(),
        receipt: 'pending',
      };
    analysis.presentation = {
      revision: intake.evidence_revision,
      attempts: analysis.presentation?.attempts ?? 0,
      nextDueAt: new Date().toISOString(),
      lease: null,
    };
    return { ...metadata, analysis, submission };
  }

  async beginConfirmedSubmission(intakeId: string, token: string): Promise<boolean> {
    const intake = await this.reportIntakeRepository.findById(intakeId);
    if (!intake || intake.closed_at || !this.isOpenIntakeStatus(intake.status)) return false;
    const submission = projectReportIntakeState(intake).submission;
    if (!submission || submission.token !== token || submission.state !== 'not_dispatched')
      return false;
    return Boolean(
      await this.reportIntakeRepository.updateIfCurrent(intake, {
        status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
        analysisDueAt: null,
        metadata: this.submissionRecoveryMetadata(intake, {
          ...submission,
          state: 'dispatching',
          dispatchedAt: new Date().toISOString(),
        }),
      })
    );
  }

  async settleConfirmedSubmission(
    intakeId: string,
    token: string,
    state: 'accepted' | 'unknown' | 'not_dispatched'
  ): Promise<boolean> {
    for (let attempt = 0; attempt < REPORT_INTAKE_STATE_WRITE_ATTEMPTS; attempt++) {
      const intake = await this.reportIntakeRepository.findById(intakeId);
      if (!intake) return false;
      const submission = projectReportIntakeState(intake).submission;
      if (
        !submission ||
        submission.token !== token ||
        submission.state !== (state === 'not_dispatched' ? 'not_dispatched' : 'dispatching') ||
        intake.closed_at
      )
        return false;
      if (
        await this.reportIntakeRepository.updateIfCurrent(intake, {
          status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
          analysisDueAt: null,
          metadata: this.submissionRecoveryMetadata(intake, {
            ...submission,
            state,
            settledAt: new Date().toISOString(),
          }),
        })
      )
        return true;
    }
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
          ...resolveReportHandoff(intake, input.submittedById, submittedAt),
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
    closeMode?: Extract<ReportCommand, { kind: 'close_report_intake' }>['closeMode'];
    acceptedSubmissionToken?: string;
    expectedEvidenceRevision?: number;
    promptMessageId?: string;
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
      if (input.closeMode?.kind === 'resolve_submission') {
        const submission = projectReportIntakeState(intake).submission;
        if (
          !input.closedByStaff ||
          !submission ||
          submission.token !== input.closeMode.token ||
          input.expectedEvidenceRevision !== intake.evidence_revision ||
          intake.closed_at ||
          !this.isOpenIntakeStatus(intake.status) ||
          !input.closeMode.reason.trim()
        )
          return { closed: false, message: 'The submission changed. Open Admin Actions again.' };
        const accepted =
          submission.state === 'accepted' || input.acceptedSubmissionToken === submission.token;
        if (!accepted && submission.state === 'dispatching')
          return {
            closed: false,
            message:
              'Submission may still be in progress. No completed outcome is recorded. Reconcile it before resolving this review.',
          };
        const now = new Date();
        const updated = await this.reportIntakeRepository.updateIfCurrent(intake, {
          status: accepted ? ReportIntakeStatus.SUBMITTED : ReportIntakeStatus.CLOSED_BY_REPORTER,
          closedAt: now,
          analysisDueAt: null,
          analysisLeaseToken: null,
          analysisLeaseUntil: null,
          metadata: {
            ...resolveReportHandoff(intake, input.closedById, now),
            ...(accepted
              ? {
                  submitted_by: input.closedById,
                  submitted_at: now.toISOString(),
                  closed_reason: 'submitted',
                }
              : {
                  closed_by: input.closedById,
                  closed_by_staff: true,
                  closed_reason: input.closeMode.reason.trim(),
                }),
            submission_resolution: {
              token: submission.token,
              actorId: input.closedById,
              at: now.toISOString(),
              reason: input.closeMode.reason.trim(),
              outcome: accepted ? 'accepted_receipt' : input.closeMode.verifiedOutcome,
              authority: accepted
                ? 'recorded_completion'
                : submission.state === 'not_dispatched'
                  ? 'not_dispatched'
                  : 'staff_verified_settled_unknown',
            },
          },
        });
        if (!updated) continue;
        await this.retireConfirmationPrompts(updated, getReportConfirmationMessageIds(updated));
        await this.clearReportThreadAttention(intake.id);
        return {
          closed: true,
          shouldArchiveThread: true,
          message: accepted
            ? 'Completed submission reconciled. No second report was submitted.'
            : 'Review resolved with your verified outcome. The selected target and saved evidence remain recorded; submission success is not asserted.',
        };
      }
      if (input.closeMode?.kind === 'resolve_review') {
        const state = projectReportIntakeState(intake);
        if (
          input.closedByStaff !== true ||
          !input.closeMode.reason.trim() ||
          intake.status !== ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION ||
          intake.confirmed_target_user_id ||
          input.expectedEvidenceRevision !== intake.evidence_revision ||
          state.presentationRevision !== intake.evidence_revision ||
          !input.promptMessageId ||
          input.promptMessageId !== state.promptMessageId
        )
          return {
            closed: false,
            message: 'Use the latest moderator review message and include a reason.',
          };
        const now = new Date();
        const updated = await this.reportIntakeRepository.updateIfCurrent(intake, {
          status: ReportIntakeStatus.CLOSED_BY_REPORTER,
          closedAt: now,
          analysisDueAt: null,
          analysisLeaseToken: null,
          analysisLeaseUntil: null,
          metadata: {
            ...resolveReportHandoff(intake, input.closedById, now),
            closed_by: input.closedById,
            closed_by_staff: true,
            closed_reason: input.closeMode.reason.trim(),
            review_resolved_at: now.toISOString(),
          },
        });
        if (!updated) continue;
        await this.retireConfirmationPrompts(updated, getReportConfirmationMessageIds(updated));
        await this.clearReportThreadAttention(intake.id);
        return {
          closed: true,
          message: 'Moderator review resolved. Saved evidence remains recorded.',
          shouldArchiveThread: true,
        };
      }
      if (intake.status === ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION) {
        const updated = await this.reportIntakeRepository.updateIfCurrent(intake, {
          metadata: {
            ...toRecord(intake.metadata),
            thread_closed_by: input.closedById,
            thread_closed_at: new Date().toISOString(),
            thread_closed_reason: 'thread_only',
          },
        });
        if (!updated) continue;
        return {
          closed: true,
          message: 'The thread is closed. Moderator review remains open.',
          shouldArchiveThread: true,
        };
      }
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
        if (
          typeof metadata.last_confirmation_prompt_message_id === 'string' &&
          sameStringArray(metadata.last_confirmation_prompt_candidate_ids, candidateIds) &&
          (metadata.last_confirmation_prompt_revision === undefined ||
            metadata.last_confirmation_prompt_revision === intake.evidence_revision)
        ) {
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

        const promptToken = this.createPromptToken(candidateIds);
        const components = this.candidateConfirmationControls(
          intake.id,
          candidateIds,
          promptToken,
          true
        );

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

  private candidateConfirmationControls(
    intakeId: string,
    candidateIds: string[],
    token: string,
    disabled: boolean
  ): ActionRowBuilder<ButtonBuilder>[] {
    const buttons = candidateIds.map((id, index) =>
      new ButtonBuilder()
        .setCustomId(`${REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX}:${intakeId}:${id}`)
        .setLabel(candidateIds.length === 1 ? 'Submit report' : `Report ${index + 1}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(buttons),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${REPORT_INTAKE_REJECT_CUSTOM_ID_PREFIX}:${intakeId}:${token}`)
          .setLabel(candidateIds.length === 1 ? 'Different person' : 'None of these')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled)
      ),
    ];
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
    persisted: ReportIntake | null,
    claim?: ReportPresentationClaim
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
    const beforeEnable = await this.reportIntakeRepository.findById(intake.id);
    if (
      !beforeEnable ||
      beforeEnable.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION ||
      beforeEnable.confirmed_target_user_id ||
      beforeEnable.closed_at ||
      toRecord(beforeEnable.metadata).last_confirmation_prompt_message_id !== prompt.message.id ||
      (toRecord(persisted.metadata).last_confirmation_prompt_revision !== undefined &&
        (beforeEnable.evidence_revision !== intake.evidence_revision ||
          !(await this.canPublishSavedConfirmation(beforeEnable, claim))))
    ) {
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
      toRecord(current.metadata).last_confirmation_prompt_message_id !== prompt.message.id ||
      (toRecord(persisted.metadata).last_confirmation_prompt_revision !== undefined &&
        (current.evidence_revision !== intake.evidence_revision ||
          !(await this.canPublishSavedConfirmation(current, claim))))
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
    return `${index === undefined ? '' : `${index}. `}${formatReportIdentity(candidate)}`;
  }

  private confirmationUnavailableMessage(intake: ReportIntake): string {
    return (
      getReportConfirmationUnavailableMessage(intake) ??
      'Use the latest confirmation message in this thread.'
    );
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
    intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION &&
    intake.status !== ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION
  )
    return 'This report is closed.';
  if (intake.confirmed_target_user_id)
    return 'A person is already selected. Submission is not confirmed. No second report was submitted.';
  if (intake.status === ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION)
    return 'This report is waiting for a moderator.';
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
      ...readStringArray([toRecord(intake.metadata).last_confirmation_prompt_message_id]),
      ...(clickedId ? [clickedId] : []),
    ]),
  ];
}

function resolveReportHandoff(
  intake: ReportIntake,
  actorId: string,
  at: Date
): Record<string, unknown> {
  const metadata = toRecord(intake.metadata);
  const parsed = reportAnalysisMetadataSchema.safeParse(metadata.analysis);
  if (!parsed.success || parsed.data.handoff.state === 'none') return metadata;
  const analysis = parsed.data;
  return {
    ...metadata,
    analysis: {
      ...analysis,
      handoff: {
        ...analysis.handoff,
        state: 'resolved',
        resolvedBy: actorId,
        resolvedAt: at.toISOString(),
        nextDueAt: null,
      },
      ...(analysis.presentation
        ? { presentation: { ...analysis.presentation, nextDueAt: null, lease: null } }
        : {}),
    },
  };
}
