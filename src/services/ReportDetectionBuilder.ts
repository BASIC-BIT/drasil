import { APIUser, GuildMember, InteractionContextType, User } from 'discord.js';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { DetectionEvent, DetectionType } from '../repositories/types';
import { withDetectionTestingMetadata } from '../utils/detectionEventAccounting';
import type { DetectionResult } from './DetectionOrchestrator';
import { ReportAiAnalyzer } from './ReportAiAnalyzer';
import type { MessageReportAttachment, MessageReportContext } from './SecurityActionService';

export interface BuiltUserReportDetection {
  detectionEvent: DetectionEvent;
  detectionResult: DetectionResult;
}

export interface UserReportDetectionOptions {
  attachments?: MessageReportAttachment[];
  metadata?: Record<string, unknown>;
}

export class ReportDetectionBuilder {
  public constructor(
    private readonly detectionEventsRepository: IDetectionEventsRepository,
    private readonly reportAiAnalyzer: ReportAiAnalyzer
  ) {}

  public async createUserReportDetection(
    member: GuildMember,
    reporter: User,
    reason?: string,
    options: UserReportDetectionOptions = {}
  ): Promise<BuiltUserReportDetection> {
    const reasonText = reason ? `Reason: ${reason}` : 'No reason provided.';
    const attachments = this.serializeReportAttachments(options.attachments);
    const reportAiAnalysis = await this.reportAiAnalyzer
      .analyzeIfEnabled({
        serverId: member.guild.id,
        targetUserId: member.id,
        reporterId: reporter.id,
        reason,
        attachments,
      })
      .catch((error) => {
        console.warn(
          `Report AI analysis failed for guild ${member.guild.id}; continuing without AI triage:`,
          error
        );
        return undefined;
      });
    const detectionEvent = await this.detectionEventsRepository.create({
      server_id: member.guild.id,
      user_id: member.id,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: [`Reported by user ${reporter.id}. ${reasonText}`],
      detected_at: new Date(),
      metadata: withDetectionTestingMetadata(
        {
          type: 'user_report',
          reporterId: reporter.id,
          content: reason ?? 'User report',
          reason: reason ?? reasonText,
          ...(attachments ? { attachments } : {}),
          ...options.metadata,
          ...(reportAiAnalysis ? { report_ai: reportAiAnalysis } : {}),
        },
        'server'
      ),
    });

    return {
      detectionEvent,
      detectionResult: {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: [`Reported by user ${reporter.id}. ${reasonText}`],
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: reason ?? 'User report',
        detectionEventId: detectionEvent.id,
        reportAiAnalysis,
      },
    };
  }

  public createUserReportDetectionResult(detectionEvent: DetectionEvent): DetectionResult {
    const eventMetadata = this.toRecord(detectionEvent.metadata);
    const reasons = Array.isArray(detectionEvent.reasons) ? detectionEvent.reasons : [];
    const triggerContent =
      this.readString(eventMetadata.reason) ??
      this.readString(eventMetadata.content) ??
      'User report';

    return {
      label: 'SUSPICIOUS',
      confidence: detectionEvent.confidence,
      reasons: reasons.length ? reasons : ['User report'],
      triggerSource: DetectionType.USER_REPORT,
      triggerContent,
      detectionEventId: detectionEvent.id,
      reportAiAnalysis: this.reportAiAnalyzer.getAnalysisFromMetadata(eventMetadata),
    };
  }

  public async createGlobalMessageReportDetection(
    targetUser: User | APIUser,
    reporter: User | APIUser,
    report: MessageReportContext
  ): Promise<DetectionEvent> {
    const reasonText = report.reason ? `Reason: ${report.reason}` : 'No reason provided.';
    const reason = `Message reported by user ${reporter.id}. ${reasonText}`;
    const isGuildContext =
      report.interactionContext === InteractionContextType.Guild || !!report.guildId;
    const metadata: Record<string, unknown> = {
      type: isGuildContext ? 'guild_message_report' : 'user_installed_message_report',
      reporterId: reporter.id,
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      messageId: report.messageId,
    };
    if (report.guildId) metadata.guildId = report.guildId;
    if (report.channelId) metadata.channelId = report.channelId;
    if (report.content) metadata.content = report.content;
    if (report.reason) metadata.reason = report.reason;
    const attachments = this.serializeReportAttachments(report.attachments);
    if (attachments) metadata.attachments = attachments;
    if (report.interactionContext !== undefined) {
      metadata.interactionContext = report.interactionContext;
    }

    return this.detectionEventsRepository.create({
      server_id: null,
      user_id: targetUser.id,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: [reason],
      message_id: report.messageId,
      channel_id: report.channelId,
      metadata: withDetectionTestingMetadata(metadata, 'global'),
    });
  }

  public async createManagedMessageReportDetection(
    member: GuildMember,
    reporter: User | APIUser,
    report: MessageReportContext,
    globalReportId: string,
    isLocalReport: boolean
  ): Promise<DetectionEvent> {
    const metadata: Record<string, unknown> = {
      type: isLocalReport ? 'message_report' : 'external_message_report',
      globalReportId,
      reporterId: reporter.id,
      targetUserId: member.id,
      messageId: report.messageId,
    };
    if (report.guildId) metadata.sourceGuildId = report.guildId;
    if (report.channelId) metadata.sourceChannelId = report.channelId;
    if (report.content) metadata.content = report.content;
    if (report.reason) metadata.reason = report.reason;
    const attachments = this.serializeReportAttachments(report.attachments);
    if (attachments) metadata.attachments = attachments;
    if (report.interactionContext !== undefined) {
      metadata.interactionContext = report.interactionContext;
    }

    const reportAiAnalysis = isLocalReport
      ? await this.reportAiAnalyzer
          .analyzeIfEnabled({
            serverId: member.guild.id,
            targetUserId: member.id,
            reporterId: reporter.id,
            reason: report.reason,
            reportedMessageContent: report.content,
            attachments,
          })
          .catch((error) => {
            console.warn(
              `Report AI analysis failed for guild ${member.guild.id}; continuing without AI triage:`,
              error
            );
            return undefined;
          })
      : undefined;
    if (reportAiAnalysis) {
      metadata.report_ai = reportAiAnalysis;
    }

    return await this.detectionEventsRepository.create({
      server_id: member.guild.id,
      user_id: member.id,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: [this.buildManagedMessageReportReason(reporter, report, isLocalReport)],
      message_id: isLocalReport ? report.messageId : undefined,
      channel_id: isLocalReport ? report.channelId : undefined,
      metadata: withDetectionTestingMetadata(metadata, 'server'),
    });
  }

  public createManagedMessageReportDetectionResult(
    detectionEvent: DetectionEvent,
    reporter: User | APIUser,
    report: MessageReportContext,
    isLocalReport: boolean
  ): DetectionResult {
    const eventMetadata =
      detectionEvent.metadata &&
      typeof detectionEvent.metadata === 'object' &&
      !Array.isArray(detectionEvent.metadata)
        ? detectionEvent.metadata
        : {};

    return {
      label: 'SUSPICIOUS',
      confidence: 1.0,
      reasons: [this.buildManagedMessageReportReason(reporter, report, isLocalReport)],
      triggerSource: DetectionType.USER_REPORT,
      triggerContent: report.reason || report.content || 'Message report',
      detectionEventId: detectionEvent.id,
      reportAiAnalysis: this.reportAiAnalyzer.getAnalysisFromMetadata(eventMetadata),
    };
  }

  private buildManagedMessageReportReason(
    reporter: User | APIUser,
    report: MessageReportContext,
    isLocalReport: boolean
  ): string {
    const reasonText = report.reason ? ` Reason: ${report.reason}` : '';
    return isLocalReport
      ? `Message reported in this server by user ${reporter.id}.${reasonText}`
      : `External DM/GDM report submitted by user ${reporter.id}.${reasonText}`;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  private serializeReportAttachments(
    attachments: MessageReportAttachment[] | undefined
  ): MessageReportAttachment[] | undefined {
    if (!attachments?.length) {
      return undefined;
    }

    return attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      proxyUrl: attachment.proxyUrl,
      contentType: attachment.contentType,
      size: attachment.size,
    }));
  }
}
