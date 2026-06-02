import { ActionRowBuilder, ButtonBuilder, ButtonStyle, GuildMember, Message } from 'discord.js';
import { injectable, inject } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IReportIntakeRepository } from '../repositories/ReportIntakeRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { ReportIntake, ReportIntakeEvidenceKind, ReportIntakeStatus } from '../repositories/types';
import { IUserRepository } from '../repositories/UserRepository';
import {
  getReportAiSettings,
  ReportAttachmentMetadata,
  selectEligibleReportImageAttachments,
} from '../utils/reportAiSettings';
import { IReportCandidateService } from './ReportCandidateService';

const REPORT_INTAKE_CLOSE_COMMANDS = new Set(['close report', 'cancel report', 'close intake']);
const REPORT_INTAKE_REASON_TEXT_MAX_LENGTH = 1000;
const REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS = 5;

export const REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX = 'report_intake_confirm';

interface MessageSendChannel {
  send(options: {
    content: string;
    components: ActionRowBuilder<ButtonBuilder>[];
    allowedMentions: { parse: [] };
  }): Promise<unknown>;
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
  }): Promise<{ confirmed: boolean; message: string; reason?: string }>;
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
    @inject(TYPES.ReportCandidateService) private candidateService: IReportCandidateService
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
    return true;
  }

  async confirmCandidate(input: {
    intakeId: string;
    targetUserId: string;
    confirmedById: string;
  }): Promise<{ confirmed: boolean; message: string; reason?: string }> {
    const intake = await this.reportIntakeRepository.findById(input.intakeId);
    if (!intake) {
      return { confirmed: false, message: 'That report intake could not be found.' };
    }
    if (intake.reporter_id !== input.confirmedById) {
      return { confirmed: false, message: 'Only the reporter can confirm this target.' };
    }
    if (intake.status !== ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION) {
      return {
        confirmed: false,
        message: 'That report intake is no longer accepting target confirmations.',
      };
    }
    if (input.targetUserId === input.confirmedById) {
      return { confirmed: false, message: 'You cannot report yourself.' };
    }

    const metadata = toRecord(intake.metadata);
    if (!this.hasSuggestedCandidate(metadata, input.targetUserId)) {
      return {
        confirmed: false,
        message: 'That target is not a current candidate for this intake.',
      };
    }

    await this.reportIntakeRepository.addEvidence({
      intakeId: intake.id,
      kind: ReportIntakeEvidenceKind.CANDIDATE_CONFIRMATION,
      content: input.targetUserId,
      metadata: {
        confirmed_by: input.confirmedById,
        target_user_id: input.targetUserId,
        confirmed_at: new Date().toISOString(),
      },
    });

    await this.reportIntakeRepository.update(intake.id, {
      confirmedTargetUserId: input.targetUserId,
      metadata: {
        ...metadata,
        confirmed_target_user_id: input.targetUserId,
        confirmed_by: input.confirmedById,
        confirmed_at: new Date().toISOString(),
      },
    });

    const evidence = await this.reportIntakeRepository.listEvidence(intake.id);
    return {
      confirmed: true,
      message: `Confirmed <@${input.targetUserId}> as the report target.`,
      reason: this.buildSubmissionReason(intake, evidence),
    };
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

    await this.reportIntakeRepository.update(input.intakeId, {
      status: ReportIntakeStatus.SUBMITTED,
      confirmedTargetUserId: input.targetUserId,
      metadata: {
        ...toRecord(intake.metadata),
        submitted_by: input.submittedById,
        submitted_at: new Date().toISOString(),
      },
    });
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
    const nextMetadata = {
      ...metadata,
      last_evidence_message_id: message.id,
      last_evidence_author_id: message.author.id,
      last_evidence_recorded_at: now.toISOString(),
      candidate_signals: signals,
      candidate_suggestions: this.mergeCandidateSuggestions(metadata, candidates),
    };

    if (isReporterMessage && this.isReporterCloseCommand(trimmedContent)) {
      await this.reportIntakeRepository.update(intake.id, {
        status: ReportIntakeStatus.CLOSED_BY_REPORTER,
        closedAt: now,
        metadata: {
          ...nextMetadata,
          closed_by: message.author.id,
          closed_reason: 'reporter_request',
        },
      });
      if (hasMessageSend(message.channel)) {
        await message.channel.send({
          content: 'Report intake closed. No report has been filed.',
          components: [],
          allowedMentions: { parse: [] },
        });
      }
      return;
    }

    const promptMetadata =
      candidates.length > 0
        ? await this.sendCandidateConfirmationPrompt(intake, message, candidates)
        : {};

    const status = this.resolveNextStatus(intake.status, candidates.length);
    await this.reportIntakeRepository.update(intake.id, {
      status,
      metadata: { ...nextMetadata, ...promptMetadata },
    });
  }

  private async selectEligibleImageAttachments(
    serverId: string,
    message: Message
  ): Promise<ReportAttachmentMetadata[]> {
    const attachments = message.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      contentType: attachment.contentType ?? undefined,
      size: attachment.size,
    }));

    if (attachments.length === 0) {
      return [];
    }

    const serverConfig = await this.configService.getServerConfig(serverId);
    return selectEligibleReportImageAttachments(
      attachments,
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
    const candidateIds = candidates.map((candidate) => candidate.discordUserId);
    const metadata = toRecord(intake.metadata);
    if (sameStringArray(metadata.last_confirmation_prompt_candidate_ids, candidateIds)) {
      return {};
    }

    if (!hasMessageSend(message.channel)) {
      return {};
    }

    const rows = candidates
      .slice(0, REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS)
      .map((candidate) =>
        new ButtonBuilder()
          .setCustomId(
            `${REPORT_INTAKE_CONFIRM_CUSTOM_ID_PREFIX}:${intake.id}:${candidate.discordUserId}`
          )
          .setLabel(this.buildCandidateButtonLabel(candidate))
          .setStyle(ButtonStyle.Primary)
      );

    await message.channel.send({
      content: this.buildCandidateConfirmationMessage(candidates),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(rows)],
      allowedMentions: { parse: [] },
    });

    return {
      last_confirmation_prompt_candidate_ids: candidateIds,
      last_confirmation_prompt_at: new Date().toISOString(),
    };
  }

  private buildCandidateConfirmationMessage(
    candidates: Awaited<ReturnType<IReportCandidateService['resolvePlatformBackedCandidates']>>
  ): string {
    const lines = [
      'I found possible report target candidates. Please confirm the correct target before I submit this as a user report.',
      '',
      ...candidates.slice(0, REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS).map((candidate, index) => {
        const reasons = candidate.matchReasons.join(', ') || 'candidate match';
        return `${index + 1}. <@${candidate.discordUserId}> (${candidate.discordUserId}) - ${reasons}`;
      }),
    ];

    if (candidates.length > REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS) {
      lines.push('', `Showing first ${REPORT_INTAKE_MAX_CONFIRMATION_BUTTONS} candidates.`);
    }

    return lines.join('\n');
  }

  private buildCandidateButtonLabel(
    candidate: Awaited<
      ReturnType<IReportCandidateService['resolvePlatformBackedCandidates']>
    >[number]
  ): string {
    const label = candidate.displayName || candidate.username || candidate.discordUserId;
    return `Confirm ${label}`.slice(0, 80);
  }

  private hasSuggestedCandidate(metadata: Record<string, unknown>, targetUserId: string): boolean {
    const suggestions = metadata.candidate_suggestions;
    if (!Array.isArray(suggestions)) {
      return false;
    }

    return suggestions.some((candidate) => getCandidateDiscordUserId(candidate) === targetUserId);
  }

  private mergeCandidateSuggestions(
    metadata: Record<string, unknown>,
    candidates: Awaited<ReturnType<IReportCandidateService['resolvePlatformBackedCandidates']>>
  ): unknown[] {
    const merged = new Map<string, unknown>();
    const suggestions = metadata.candidate_suggestions;

    if (Array.isArray(suggestions)) {
      for (const candidate of suggestions) {
        const userId = getCandidateDiscordUserId(candidate);
        if (userId) {
          merged.set(userId, candidate);
        }
      }
    }

    for (const candidate of candidates) {
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
    const lines = [
      'Report intake target confirmed by reporter.',
      `Report intake ID: ${intake.id}`,
      intake.thread_id ? `Report thread ID: ${intake.thread_id}` : undefined,
      `Evidence entries: ${evidence.length}`,
      firstReporterText
        ? `Reporter context: ${truncate(firstReporterText, REPORT_INTAKE_REASON_TEXT_MAX_LENGTH)}`
        : undefined,
    ].filter((line): line is string => Boolean(line));

    return lines.join('\n');
  }

  private isReporterCloseCommand(content: string): boolean {
    return REPORT_INTAKE_CLOSE_COMMANDS.has(content.trim().toLowerCase());
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

function sameStringArray(value: unknown, expected: string[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) {
    return false;
  }

  const sortedValue = [...value].sort();
  const sortedExpected = [...expected].sort();
  return sortedValue.every((item, index) => item === sortedExpected[index]);
}

function getCandidateDiscordUserId(candidate: unknown): string | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const value = (candidate as Record<string, unknown>).discordUserId;
  return typeof value === 'string' ? value : null;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
