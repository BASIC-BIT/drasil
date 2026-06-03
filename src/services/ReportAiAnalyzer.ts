import { IServerRepository } from '../repositories/ServerRepository';
import {
  getReportAiSettings,
  ReportAttachmentMetadata,
  selectEligibleReportImageAttachments,
} from '../utils/reportAiSettings';
import type { IGPTService, ReportAIAnalysis } from './GPTService';

export interface ReportAiAnalysisInput {
  serverId: string;
  targetUserId: string;
  reporterId: string;
  reason?: string;
  reportedMessageContent?: string;
  attachments?: ReportAttachmentMetadata[];
}

export class ReportAiAnalyzer {
  public constructor(
    private readonly serverRepository: IServerRepository,
    private readonly gptService?: IGPTService
  ) {}

  public getAnalysisFromMetadata(metadata: Record<string, unknown>): ReportAIAnalysis | undefined {
    const reportAi = metadata.report_ai;
    return reportAi && typeof reportAi === 'object' && !Array.isArray(reportAi)
      ? (reportAi as ReportAIAnalysis)
      : undefined;
  }

  public async analyzeIfEnabled(
    data: ReportAiAnalysisInput
  ): Promise<ReportAIAnalysis | undefined> {
    const server = await this.serverRepository.findByGuildId(data.serverId);
    const settings = getReportAiSettings(server?.settings);
    if (!settings.enabled || settings.maxAction === 'off') {
      return undefined;
    }
    if (!this.gptService) {
      return undefined;
    }

    const eligibleImages = selectEligibleReportImageAttachments(data.attachments, settings);
    const reportReason = settings.analyzeText ? data.reason : undefined;
    const reportedMessageContent = settings.analyzeText ? data.reportedMessageContent : undefined;
    if (!reportReason && !reportedMessageContent && eligibleImages.length === 0) {
      return undefined;
    }

    const analysis = await this.gptService.analyzeReportEvidence({
      serverId: data.serverId,
      targetUserId: data.targetUserId,
      reporterId: data.reporterId,
      reportReason,
      reportedMessageContent,
      attachments: eligibleImages,
    });

    return this.capAction(analysis, settings);
  }

  private capAction(
    analysis: ReportAIAnalysis,
    settings: ReturnType<typeof getReportAiSettings>
  ): ReportAIAnalysis {
    const recommendedAction = this.capRecommendedAction(
      analysis.recommendedAction,
      analysis.confidence,
      settings
    );

    return recommendedAction === analysis.recommendedAction
      ? analysis
      : { ...analysis, recommendedAction };
  }

  private capRecommendedAction(
    action: ReportAIAnalysis['recommendedAction'],
    confidence: number,
    settings: ReturnType<typeof getReportAiSettings>
  ): ReportAIAnalysis['recommendedAction'] {
    if (action === 'none' || action === 'monitor' || action === 'manual_review') {
      return action;
    }

    if (settings.maxAction === 'hints' || settings.maxAction === 'off') {
      return 'manual_review';
    }

    if (action === 'restrict') {
      if (settings.maxAction === 'restrict' && confidence >= settings.restrictThreshold) {
        return 'restrict';
      }

      return confidence >= settings.openCaseThreshold ? 'open_case' : 'manual_review';
    }

    return confidence >= settings.openCaseThreshold ? 'open_case' : 'manual_review';
  }
}
