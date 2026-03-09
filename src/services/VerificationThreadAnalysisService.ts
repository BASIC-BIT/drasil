import { injectable, inject } from 'inversify';
import type { Message } from 'discord.js';
import { TYPES } from '../di/symbols';
import type { IConfigService } from '../config/ConfigService';
import type { IGPTService } from './GPTService';
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
}

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

    const serverConfig = await this.configService.getServerConfig(verificationEvent.server_id);
    const settings = getVerificationThreadAnalysisSettings(serverConfig.settings);
    if (!settings.enabled) {
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
    const analysis = await this.gptService.analyzeVerificationThreadResponses({
      serverId: verificationEvent.server_id,
      userId: verificationEvent.user_id,
      username: message.author.username,
      messages: responses,
      detectionReasons,
    });

    const nextAnalyzedMessageIds = [...metadata.analyzedMessageIds, message.id].slice(
      -settings.messageLimit
    );
    const notified = await this.notificationManager.updateVerificationThreadAnalysis(
      verificationEvent,
      analysis,
      nextAnalyzedMessageIds.length
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

    return {
      analyzedMessageIds,
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
