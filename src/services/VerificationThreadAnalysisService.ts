import {
  withObservation,
  recordObservation,
  recordWorkflowOutcome,
} from '../observability/langfuse';
import { hashIdentifier } from '../observability/hash';
import { injectable, inject, optional } from 'inversify';
import type { Message, ThreadChannel } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { TYPES } from '../di/symbols';
import type { IConfigService } from '../config/ConfigService';
import type {
  IGPTService,
  VerificationThreadAnalysisData,
  VerificationThreadAnalysisResult,
} from './GPTService';
import type { JevProfileAnalysis, JevService } from './JevService';
import type { INotificationManager } from './NotificationManager';
import type { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import type { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  DetectionEvent,
  DetectionType,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';
import type { IModerationQueueService } from './ModerationQueueService';
import {
  getVerificationThreadAnalysisSettings,
  VERIFICATION_THREAD_ANALYSIS_FETCH_LIMIT,
} from '../utils/verificationThreadAnalysisSettings';
import {
  getSupportThreadReminderState,
  markSupportThreadReminderUserResponded,
} from '../utils/supportThreadReminderState';
import {
  CASE_ATTENTION_ATTEMPT_PREFIX,
  isCaseRoleReleaseLeaseActive,
} from '../utils/caseRoleRelease';

interface ThreadAnalysisMetadata {
  analyzedMessageIds: string[];
  latestAnalysis?: {
    gptResult?: VerificationThreadAnalysisResult['result'];
    gptSummary?: string;
    jevAnalysis?: JevProfileAnalysis;
    result: 'likely_legitimate' | 'needs_review' | 'likely_suspicious';
    confidence: number;
    summary: string;
    reasonCodes: string[];
    legitimacySignals: string[];
    suspicionSignals: string[];
    recommendedNextQuestion?: string;
    recommendedAction: 'none' | 'ask_followup' | 'manual_review' | 'restrict';
    isFallback: boolean;
    analyzedMessageCount: number;
  };
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
    private detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.ModerationQueueService)
    @optional()
    private moderationQueueService?: IModerationQueueService,
    @inject(TYPES.JevService) @optional() private jevService?: JevService
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
    let verificationEvent = await this.verificationEventRepository.findById(verificationEventId);
    if (!verificationEvent || verificationEvent.status !== VerificationStatus.PENDING) {
      return;
    }

    const evidenceEvent = await this.verificationEventRepository.recordSubjectCaseEvidence(
      verificationEvent.id,
      message.id
    );
    if (!evidenceEvent) {
      return;
    }
    verificationEvent = evidenceEvent;

    if (
      isCaseRoleReleaseLeaseActive(
        verificationEvent.quarantine_attempt_id,
        verificationEvent.quarantine_lease_renewed_at
      )
    ) {
      return;
    }

    const parkedAccountRecovery =
      verificationEvent.case_kind === CaseKind.COMPROMISED_ACCOUNT &&
      verificationEvent.attention_state === CaseAttentionState.PARKED;
    if (parkedAccountRecovery) {
      const attentionAttemptId = `${CASE_ATTENTION_ATTEMPT_PREFIX}${randomUUID()}`;
      const claimed = await this.verificationEventRepository.claimAccountQuarantineAttention(
        verificationEvent.id,
        verificationEvent.server_id,
        verificationEvent.user_id,
        attentionAttemptId
      );
      if (!claimed) {
        return;
      }
      let responseEvent = claimed;
      let attentionDelivered = false;
      try {
        const responseState = await this.markSupportThreadReminderResponded(claimed, message);
        responseEvent = responseState.verificationEvent;
        const queuePromise = this.moderationQueueService
          ? this.moderationQueueService.recordSupportThreadAttention(responseEvent, message)
          : null;
        const [mirrorResult, queueResult] = await Promise.allSettled([
          this.notificationManager.mirrorVerificationThreadMessageToEvidenceThread(
            responseEvent,
            message
          ),
          queuePromise ?? Promise.resolve({ delivered: false, created: false }),
        ]);
        if (mirrorResult.status === 'rejected') {
          console.warn(
            `[VerificationThreadAnalysis] Failed to mirror parked recovery reply for verification event ${claimed.id}:`,
            mirrorResult.reason
          );
        }
        if (queueResult.status === 'rejected') {
          console.warn(
            `[VerificationThreadAnalysis] Failed to queue parked recovery attention for verification event ${claimed.id}:`,
            queueResult.reason
          );
        }
        const queueDelivered =
          queueResult.status === 'fulfilled' && queueResult.value.delivered === true;
        const shouldNotifyDirectly =
          responseState.firstResponse ||
          (queueResult.status === 'fulfilled' && queueResult.value.created === true);
        let directDelivered = false;
        if (shouldNotifyDirectly) {
          try {
            directDelivered =
              (await this.notificationManager.notifyVerificationThreadUserResponse(
                responseEvent,
                message
              )) === true;
          } catch (error) {
            console.warn(
              `[VerificationThreadAnalysis] Failed to send parked recovery alert for verification event ${claimed.id}:`,
              error
            );
          }
        }
        attentionDelivered = queueDelivered || directDelivered || !responseState.firstResponse;
      } finally {
        await this.verificationEventRepository.updateQuarantineAttempt(
          claimed.id,
          attentionAttemptId,
          {
            attention_state: attentionDelivered
              ? CaseAttentionState.PARKED
              : CaseAttentionState.REVIEW_REQUIRED,
            containment_status: attentionDelivered
              ? claimed.containment_status === CaseContainmentStatus.IN_PROGRESS
                ? CaseContainmentStatus.CONTAINED
                : claimed.containment_status
              : CaseContainmentStatus.INCOMPLETE,
            parked_at: attentionDelivered ? claimed.parked_at : null,
            parked_by: attentionDelivered ? claimed.parked_by : null,
            metadata: attentionDelivered
              ? undefined
              : {
                  ...(this.asObject(responseEvent.metadata) ?? {}),
                  recovery_attention_delivery_failed_at: new Date().toISOString(),
                  recovery_attention_message_id: message.id,
                },
          }
        );
      }
      return;
    }

    const responseState = await this.markSupportThreadReminderResponded(verificationEvent, message);
    verificationEvent = responseState.verificationEvent;

    await this.notificationManager.mirrorVerificationThreadMessageToEvidenceThread(
      verificationEvent,
      message
    );
    if (responseState.firstResponse) {
      await this.notificationManager.notifyVerificationThreadUserResponse(
        verificationEvent,
        message
      );
    }

    if (verificationEvent.case_kind === CaseKind.COMPROMISED_ACCOUNT) {
      return;
    }

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

    const caseEvent = verificationEvent;
    return withObservation(
      'verification-review',
      'chain',
      async (): Promise<void> => {
        const threadMessages = await withObservation('collect-context', 'retriever', () =>
          this.fetchThreadMessages(message.channel as ThreadChannel)
        );
        const responses = threadMessages.filter((entry) => entry.author.id === caseEvent.user_id);
        if (responses.length === 0) {
          recordWorkflowOutcome({ output: { actual_outcome: 'no_responses' } });
          return;
        }

        const detectionEvent = caseEvent.detection_event_id
          ? await this.detectionEventsRepository.findById(caseEvent.detection_event_id)
          : null;
        const analysisData: VerificationThreadAnalysisData = {
          serverId: caseEvent.server_id,
          userId: caseEvent.user_id,
          username: message.author.username,
          messages: threadMessages.map((entry) =>
            this.formatThreadMessage(entry, caseEvent.user_id)
          ),
          detectionReasons: detectionEvent?.reasons,
          detectionType: detectionEvent?.detection_type,
          flaggedMessage: await this.getFlaggedMessage(message, detectionEvent),
          staffNotes: await this.getStaffNotes(message, verificationEvent),
          profileImageDescription: this.getProfileImageDescription(caseEvent.metadata),
        };
        const [gptAnalysis, jevAnalysis] = await Promise.all([
          this.gptService.analyzeVerificationThreadResponses(analysisData),
          this.jevService?.analyzeVerificationReplies(analysisData),
        ]);
        const analysis = await withObservation(
          'combine-verdicts',
          'span',
          async (): Promise<VerificationThreadAnalysisResult> => {
            const jevFlagged = jevAnalysis?.result === 'SUSPICIOUS';
            const rawAnalysis: VerificationThreadAnalysisResult = jevAnalysis
              ? {
                  ...gptAnalysis,
                  gptResult: gptAnalysis.isFallback ? undefined : gptAnalysis.result,
                  gptSummary: gptAnalysis.isFallback ? undefined : gptAnalysis.summary,
                  jevAnalysis,
                  result: jevFlagged ? 'likely_suspicious' : gptAnalysis.result,
                  confidence: jevFlagged
                    ? Math.max(
                        gptAnalysis.result === 'likely_suspicious' ? gptAnalysis.confidence : 0,
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
                  recommendedAction: jevFlagged ? 'restrict' : gptAnalysis.recommendedAction,
                  summary:
                    jevFlagged && gptAnalysis.result !== 'likely_suspicious'
                      ? 'Verification replies need moderator review.'
                      : gptAnalysis.summary,
                  isFallback: gptAnalysis.isFallback && jevAnalysis.result === 'UNAVAILABLE',
                }
              : gptAnalysis;
            const capped = this.capRecommendedAction(rawAnalysis, settings);
            recordObservation('span', {
              output: {
                verdict: capped.result,
                gpt_verdict: gptAnalysis.result,
                jev_verdict: jevAnalysis?.result,
                requested_action: rawAnalysis.recommendedAction,
                recommended_action: capped.recommendedAction,
                reason_codes: capped.reasonCodes,
              },
            });
            return capped;
          },
          undefined,
          undefined
        );
        const nextAnalyzedMessageIds = [...metadata.analyzedMessageIds, message.id].slice(
          -settings.messageLimit
        );
        const notified = await withObservation('apply-outcome', 'tool', () =>
          this.notificationManager.updateVerificationThreadAnalysis(
            caseEvent,
            analysis,
            responses.length
          )
        );
        if (!notified) {
          recordWorkflowOutcome({
            output: {
              verdict: analysis.result,
              recommended_action: analysis.recommendedAction,
              actual_outcome: 'delivery_failed',
              case_id: caseEvent.id,
            },
            level: 'ERROR',
            statusMessage: 'delivery_failed',
          });
          console.warn(
            `[VerificationThreadAnalysis] Failed to update notification for verification event ${caseEvent.id}`
          );
          return;
        }

        try {
          const persisted = await withObservation('persist-result', 'span', () =>
            this.verificationEventRepository.update(caseEvent.id, {
              metadata: {
                ...(this.asObject(caseEvent.metadata) ?? {}),
                thread_analysis: {
                  analyzedMessageIds: nextAnalyzedMessageIds,
                  latestAnalysis: {
                    ...(analysis.gptResult ? { gptResult: analysis.gptResult } : {}),
                    ...(analysis.gptSummary ? { gptSummary: analysis.gptSummary } : {}),
                    ...(analysis.jevAnalysis ? { jevAnalysis: { ...analysis.jevAnalysis } } : {}),
                    result: analysis.result,
                    confidence: analysis.confidence,
                    summary: analysis.summary,
                    reasonCodes: analysis.reasonCodes,
                    legitimacySignals: analysis.legitimacySignals,
                    suspicionSignals: analysis.suspicionSignals,
                    recommendedNextQuestion: analysis.recommendedNextQuestion,
                    recommendedAction: analysis.recommendedAction,
                    isFallback: analysis.isFallback,
                    analyzedMessageCount: responses.length,
                  },
                },
              },
            })
          );
          recordWorkflowOutcome({
            output: {
              verdict: analysis.result,
              recommended_action: analysis.recommendedAction,
              actual_outcome: persisted ? 'notified_and_persisted' : 'notified_persistence_failed',
              case_id: caseEvent.id,
            },
            ...(persisted ? {} : { level: 'ERROR' as const, statusMessage: 'persistence_failed' }),
          });
        } catch (error) {
          recordWorkflowOutcome({
            output: {
              verdict: analysis.result,
              recommended_action: analysis.recommendedAction,
              actual_outcome: 'notified_persistence_failed',
              case_id: caseEvent.id,
            },
            level: 'ERROR',
            statusMessage: 'persistence_failed',
          });
          console.warn(
            `[VerificationThreadAnalysis] Failed to persist metadata for verification event ${caseEvent.id}`,
            error
          );
        }
      },
      {
        metadata: {
          case_id: verificationEvent.id,
          guild_hash: hashIdentifier(verificationEvent.server_id),
          user_hash: hashIdentifier(verificationEvent.user_id),
        },
      },
      {
        sessionId: `${process.env.LANGFUSE_TRACING_ENVIRONMENT ?? 'development'}:case:${verificationEvent.id}`,
      }
    );
  }

  private async markSupportThreadReminderResponded(
    verificationEvent: VerificationEvent,
    message: Message
  ): Promise<{ verificationEvent: VerificationEvent; firstResponse: boolean }> {
    if (getSupportThreadReminderState(verificationEvent.metadata).userRespondedAt) {
      return { verificationEvent, firstResponse: false };
    }

    const metadata = markSupportThreadReminderUserResponded(
      verificationEvent.metadata,
      new Date(message.createdTimestamp || Date.now())
    ) as VerificationEvent['metadata'];
    try {
      const updatedEvent = await this.verificationEventRepository.update(verificationEvent.id, {
        metadata,
      });
      return {
        verificationEvent: updatedEvent ?? { ...verificationEvent, metadata },
        firstResponse: true,
      };
    } catch (error) {
      console.warn(
        `[VerificationThreadAnalysis] Failed to persist support-thread response metadata for verification event ${verificationEvent.id}`,
        error
      );
      return { verificationEvent: { ...verificationEvent, metadata }, firstResponse: true };
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

    const reasonCodes = Array.isArray(latestAnalysis?.reasonCodes)
      ? latestAnalysis.reasonCodes.filter((value): value is string => typeof value === 'string')
      : [];

    return {
      analyzedMessageIds,
      latestAnalysis:
        latestAnalysis &&
        result &&
        typeof latestAnalysis.confidence === 'number' &&
        typeof latestAnalysis.summary === 'string' &&
        typeof latestAnalysis.analyzedMessageCount === 'number'
          ? {
              gptResult:
                latestAnalysis.gptResult === 'likely_legitimate' ||
                latestAnalysis.gptResult === 'needs_review' ||
                latestAnalysis.gptResult === 'likely_suspicious'
                  ? latestAnalysis.gptResult
                  : undefined,
              gptSummary:
                typeof latestAnalysis.gptSummary === 'string'
                  ? latestAnalysis.gptSummary
                  : undefined,
              jevAnalysis: this.asObject(latestAnalysis.jevAnalysis) as unknown as
                | JevProfileAnalysis
                | undefined,
              result,
              confidence: latestAnalysis.confidence,
              summary: latestAnalysis.summary,
              reasonCodes,
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
              isFallback:
                latestAnalysis.isFallback === true ||
                (latestAnalysis.isFallback !== false &&
                  reasonCodes.includes('ai_analysis_unavailable')),
              analyzedMessageCount: latestAnalysis.analyzedMessageCount,
            }
          : undefined,
    };
  }

  private async fetchThreadMessages(thread: ThreadChannel): Promise<Message[]> {
    const messages = new Map<string, Message>();
    let before: string | undefined;
    do {
      const page = await thread.messages.fetch({
        limit: VERIFICATION_THREAD_ANALYSIS_FETCH_LIMIT,
        ...(before ? { before } : {}),
      });
      for (const entry of page.values()) messages.set(entry.id, entry);
      before =
        page.size === VERIFICATION_THREAD_ANALYSIS_FETCH_LIMIT
          ? [...page.values()].reduce((oldest, entry) =>
              entry.createdTimestamp < oldest.createdTimestamp ? entry : oldest
            ).id
          : undefined;
    } while (before);
    return [...messages.values()].sort(
      (left, right) => left.createdTimestamp - right.createdTimestamp
    );
  }

  private formatThreadMessage(message: Message, userId: string): string {
    const role = message.author.id === userId ? 'member' : message.author.bot ? 'bot' : 'moderator';
    const attachments = [...((message as Partial<Message>).attachments?.values() ?? [])].map(
      (attachment) => ({ name: attachment.name, contentType: attachment.contentType })
    );
    return JSON.stringify({ role, content: message.content.trim(), attachments });
  }

  private async getStaffNotes(message: Message, event: VerificationEvent): Promise<string[]> {
    if (!event.private_evidence_thread_id || event.private_evidence_thread_id === event.thread_id) {
      return [];
    }
    const channel = await message.client.channels
      .fetch(event.private_evidence_thread_id)
      .catch(() => null);
    if (!channel?.isThread()) return [];
    const notes = await this.fetchThreadMessages(channel).catch((error: unknown) => {
      console.warn(
        `[VerificationThreadAnalysis] Could not load staff notes for case ${event.id}:`,
        error
      );
      return [];
    });
    return notes
      .filter((entry) => !entry.author.bot && entry.author.id !== event.user_id)
      .map((entry) => this.formatThreadMessage(entry, event.user_id));
  }

  private async getFlaggedMessage(
    message: Message,
    detectionEvent: DetectionEvent | null
  ): Promise<string | undefined> {
    const metadata = this.asObject(detectionEvent?.metadata);
    const storedContent = metadata?.content;
    const isReportedMessage =
      detectionEvent?.detection_type === DetectionType.USER_REPORT &&
      (metadata?.type === 'message_report' || metadata?.type === 'external_message_report');
    const storedMessage =
      (detectionEvent?.detection_type === DetectionType.SUSPICIOUS_CONTENT || isReportedMessage) &&
      typeof storedContent === 'string'
        ? JSON.stringify({ role: 'member', content: storedContent, attachments: [] })
        : undefined;
    if (storedMessage) return storedMessage;
    if (!detectionEvent?.channel_id || !detectionEvent.message_id) {
      return undefined;
    }
    const channel = await message.client.channels
      .fetch(detectionEvent.channel_id)
      .catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) return undefined;
    const source = await channel.messages.fetch(detectionEvent.message_id).catch(() => null);
    return source ? this.formatThreadMessage(source, detectionEvent.user_id) : undefined;
  }

  private getProfileImageDescription(metadata: unknown): string | undefined {
    const description = this.asObject(this.asObject(metadata)?.profile_image_description);
    if (!description) return undefined;
    if (typeof description.summary === 'string' && description.summary.trim()) {
      return description.summary;
    }
    // Cases opened before profile-image-description-v2 store separate avatar and banner fields.
    const fields = ['avatar_description', 'banner_description'] as const;
    const lines = fields.flatMap((field) =>
      typeof description[field] === 'string' ? [`${field}: ${description[field]}`] : []
    );
    return lines.length ? lines.join('\n') : undefined;
  }
}
