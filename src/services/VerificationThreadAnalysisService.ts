import { injectable, inject } from 'inversify';
import type { Message } from 'discord.js';
import { TYPES } from '../di/symbols';
import type { IConfigService } from '../config/ConfigService';
import type { IGPTService, VerificationThreadAnalysisResult } from './GPTService';
import type { INotificationManager } from './NotificationManager';
import type { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import type { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { VerificationStatus } from '../repositories/types';
import {
  getVerificationThreadAnalysisSettings,
  VERIFICATION_THREAD_ANALYSIS_FETCH_LIMIT,
} from '../utils/verificationThreadAnalysisSettings';

interface ThreadAnalysisMetadata {
  analyzedMessageIds: string[];
  latestAnalysis?: {
    result: 'likely_legitimate' | 'needs_review' | 'likely_suspicious';
    confidence: number;
    summary: string;
    reasonCodes: string[];
    legitimacySignals: string[];
    suspicionSignals: string[];
    recommendedNextQuestion?: string;
    recommendedAction: 'none' | 'ask_followup' | 'manual_review' | 'restrict';
    analyzedMessageCount: number;
  };
}

const VERIFICATION_THREAD_NAME_PREFIX = 'Verification:';

export interface IVerificationThreadAnalysisService {
  handleThreadMessage(message: Message): Promise<boolean>;
}

@injectable()
export class VerificationThreadAnalysisService implements IVerificationThreadAnalysisService {
  private readonly analysisChains = new Map<string, Promise<void>>();

  constructor(
    @inject(TYPES.ConfigService) private configService: IConfigService,
    @inject(TYPES.GPTService) private gptService: IGPTService,
    @inject(TYPES.NotificationManager) private notificationManager: INotificationManager,
    @inject(TYPES.VerificationEventRepository)
    private verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.DetectionEventsRepository)
    private detectionEventsRepository: IDetectionEventsRepository
  ) {}

  public async handleThreadMessage(message: Message): Promise<boolean> {
    if (!message.guildId || !message.channel.isThread()) {
      return false;
    }

    if (!message.channel.name.startsWith(VERIFICATION_THREAD_NAME_PREFIX)) {
      return false;
    }

    const verificationEvent = await this.verificationEventRepository.findByThreadId(
      message.channelId
    );
    if (!verificationEvent || verificationEvent.status !== VerificationStatus.PENDING) {
      return false;
    }

    if (verificationEvent.user_id !== message.author.id) {
      return true;
    }

    await this.runSerialized(verificationEvent.id, async () => {
      await this.handleFlaggedUserThreadMessage(message, verificationEvent.id);
    });

    return true;
  }

  private async handleFlaggedUserThreadMessage(
    message: Message,
    verificationEventId: string
  ): Promise<void> {
    const verificationEvent = await this.verificationEventRepository.findById(verificationEventId);
    if (!verificationEvent || verificationEvent.status !== VerificationStatus.PENDING) {
      return;
    }

    await this.notificationManager.mirrorVerificationThreadMessageToEvidenceThread(
      verificationEvent,
      message
    );

    const serverConfig = await this.configService.getServerConfig(verificationEvent.server_id);
    const settings = getVerificationThreadAnalysisSettings(serverConfig.settings);
    if (!settings.enabled || settings.maxAction === 'off') {
      return;
    }

    const metadata = this.getThreadAnalysisMetadata(verificationEvent.metadata);
    if (metadata.analyzedMessageIds.includes(message.id)) {
      return;
    }
    if (metadata.analyzedMessageIds.length >= settings.messageLimit) {
      return;
    }

    const responses = await this.collectUserResponses(
      message,
      verificationEvent.user_id,
      settings.messageLimit
    );
    if (responses.length === 0) {
      return;
    }

    const detectionReasons = await this.getDetectionReasons(verificationEvent.detection_event_id);
    const rawAnalysis = await this.gptService.analyzeVerificationThreadResponses({
      serverId: verificationEvent.server_id,
      userId: verificationEvent.user_id,
      username: message.author.username,
      messages: responses,
      detectionReasons,
    });
    const analysis = this.capRecommendedAction(rawAnalysis, settings);

    const nextAnalyzedMessageIds = [...metadata.analyzedMessageIds, message.id].slice(
      -settings.messageLimit
    );
    const notified = await this.notificationManager.updateVerificationThreadAnalysis(
      verificationEvent,
      analysis,
      responses.length
    );
    if (!notified) {
      console.warn(
        `[VerificationThreadAnalysis] Failed to update notification for verification event ${verificationEvent.id}`
      );
      return;
    }

    try {
      await this.verificationEventRepository.update(verificationEvent.id, {
        metadata: {
          ...(this.asObject(verificationEvent.metadata) ?? {}),
          thread_analysis: {
            analyzedMessageIds: nextAnalyzedMessageIds,
            latestAnalysis: {
              result: analysis.result,
              confidence: analysis.confidence,
              summary: analysis.summary,
              reasonCodes: analysis.reasonCodes,
              legitimacySignals: analysis.legitimacySignals,
              suspicionSignals: analysis.suspicionSignals,
              recommendedNextQuestion: analysis.recommendedNextQuestion,
              recommendedAction: analysis.recommendedAction,
              analyzedMessageCount: responses.length,
            },
          },
        },
      });
    } catch (error) {
      console.warn(
        `[VerificationThreadAnalysis] Failed to persist metadata for verification event ${verificationEvent.id}`,
        error
      );
    }
  }

  private async runSerialized(id: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.analysisChains.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.analysisChains.set(id, next);

    try {
      await next;
    } finally {
      if (this.analysisChains.get(id) === next) {
        this.analysisChains.delete(id);
      }
    }
  }

  private capRecommendedAction(
    analysis: VerificationThreadAnalysisResult,
    settings: ReturnType<typeof getVerificationThreadAnalysisSettings>
  ): VerificationThreadAnalysisResult {
    if (analysis.recommendedAction !== 'restrict') {
      return analysis;
    }

    if (
      settings.maxAction === 'restrict' &&
      analysis.result === 'likely_suspicious' &&
      analysis.confidence >= settings.restrictThreshold
    ) {
      return analysis;
    }

    return { ...analysis, recommendedAction: 'manual_review' };
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private getThreadAnalysisMetadata(metadata: unknown): ThreadAnalysisMetadata {
    const root = this.asObject(metadata);
    const threadAnalysis = this.asObject(root?.thread_analysis);
    const analyzedMessageIds = Array.isArray(threadAnalysis?.analyzedMessageIds)
      ? threadAnalysis.analyzedMessageIds.filter(
          (value): value is string => typeof value === 'string'
        )
      : [];
    const latestAnalysis = this.asObject(threadAnalysis?.latestAnalysis);
    const rawResult = latestAnalysis?.result;
    const result =
      rawResult === 'likely_legitimate' ||
      rawResult === 'needs_review' ||
      rawResult === 'likely_suspicious'
        ? rawResult
        : rawResult === 'OK'
          ? 'likely_legitimate'
          : rawResult === 'SUSPICIOUS'
            ? 'likely_suspicious'
            : null;

    return {
      analyzedMessageIds,
      latestAnalysis:
        latestAnalysis &&
        result &&
        typeof latestAnalysis.confidence === 'number' &&
        typeof latestAnalysis.summary === 'string' &&
        typeof latestAnalysis.analyzedMessageCount === 'number'
          ? {
              result,
              confidence: latestAnalysis.confidence,
              summary: latestAnalysis.summary,
              reasonCodes: Array.isArray(latestAnalysis.reasonCodes)
                ? latestAnalysis.reasonCodes.filter(
                    (value): value is string => typeof value === 'string'
                  )
                : [],
              legitimacySignals: Array.isArray(latestAnalysis.legitimacySignals)
                ? latestAnalysis.legitimacySignals.filter(
                    (value): value is string => typeof value === 'string'
                  )
                : [],
              suspicionSignals: Array.isArray(latestAnalysis.suspicionSignals)
                ? latestAnalysis.suspicionSignals.filter(
                    (value): value is string => typeof value === 'string'
                  )
                : [],
              recommendedNextQuestion:
                typeof latestAnalysis.recommendedNextQuestion === 'string'
                  ? latestAnalysis.recommendedNextQuestion
                  : undefined,
              recommendedAction:
                latestAnalysis.recommendedAction === 'none' ||
                latestAnalysis.recommendedAction === 'ask_followup' ||
                latestAnalysis.recommendedAction === 'manual_review' ||
                latestAnalysis.recommendedAction === 'restrict'
                  ? latestAnalysis.recommendedAction
                  : 'manual_review',
              analyzedMessageCount: latestAnalysis.analyzedMessageCount,
            }
          : undefined,
    };
  }

  private async collectUserResponses(
    message: Message,
    userId: string,
    limit: number
  ): Promise<string[]> {
    const fetchedMessages = await message.channel.messages.fetch({
      limit: VERIFICATION_THREAD_ANALYSIS_FETCH_LIMIT,
    });
    return [...fetchedMessages.values()]
      .filter((entry) => entry.author.id === userId)
      .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
      .map((entry) => entry.content.trim())
      .filter((content) => content.length > 0)
      .slice(-limit);
  }

  private async getDetectionReasons(
    detectionEventId: string | null
  ): Promise<string[] | undefined> {
    if (!detectionEventId) {
      return undefined;
    }

    const detectionEvent = await this.detectionEventsRepository.findById(detectionEventId);
    return detectionEvent?.reasons;
  }
}
