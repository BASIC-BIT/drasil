import { IServerRepository } from '../repositories/ServerRepository';
import {
  getReportAiSettings,
  ReportAttachmentMetadata,
  selectEligibleReportImageAttachments,
} from '../utils/reportAiSettings';
import type { IGPTService, ReportAIAnalysis } from './GPTService';
import type { JevProfileAnalysis, JevService } from './JevService';

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
    private readonly gptService?: IGPTService,
    private readonly jevService?: JevService
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

    const [gptAnalysis, jevAnalysis] = await Promise.all([
      this.gptService.analyzeReportEvidence({
        serverId: data.serverId,
        targetUserId: data.targetUserId,
        reporterId: data.reporterId,
        reportReason,
        reportedMessageContent,
        attachments: eligibleImages,
      }),
      reportReason || reportedMessageContent
        ? this.jevService?.analyzeReportText(reportReason, reportedMessageContent)
        : undefined,
    ]);

    return this.capAction(this.combineAnalysis(gptAnalysis, jevAnalysis), settings);
  }

  private combineAnalysis(
    gptAnalysis: ReportAIAnalysis,
    jevAnalysis?: JevProfileAnalysis
  ): ReportAIAnalysis {
    if (!jevAnalysis) return gptAnalysis;
    const jevFlagged = jevAnalysis.result === 'SUSPICIOUS';
    return {
      ...gptAnalysis,
      gptResult: gptAnalysis.isFallback ? undefined : gptAnalysis.result,
      jevAnalysis,
      result: jevFlagged ? 'likely_abusive' : gptAnalysis.result,
      confidence: jevFlagged
        ? Math.max(
            gptAnalysis.result === 'likely_abusive' ? gptAnalysis.confidence : 0,
            jevAnalysis.suspiciousProbability ?? 0
          )
        : gptAnalysis.confidence,
      reasonCodes: jevFlagged
        ? [
            ...new Set([
              ...(gptAnalysis.isFallback ? [] : gptAnalysis.reasonCodes),
              ...jevAnalysis.reasonCodes,
            ]),
          ]
        : gptAnalysis.reasonCodes,
      recommendedAction: jevFlagged ? 'open_case' : gptAnalysis.recommendedAction,
      summary:
        jevFlagged && gptAnalysis.result === 'low_risk'
          ? 'Reported text was flagged for moderator review.'
          : gptAnalysis.summary,
      isFallback: gptAnalysis.isFallback && jevAnalysis.result === 'UNAVAILABLE',
    };
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

    return confidence >= settings.openCaseThreshold ? 'open_case' : 'manual_review';
  }
}
