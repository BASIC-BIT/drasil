import { createHash, randomBytes } from 'node:crypto';
import { inject, injectable, optional } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import {
  CaptchaChallengeIssueInput,
  ICaptchaChallengeRepository,
} from '../repositories/CaptchaChallengeRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IModerationActionRequestRepository } from '../repositories/ModerationActionRequestRepository';
import {
  CaptchaChallenge,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaseKind,
  ModerationActionRequestType,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';
import { getCaptchaSettings } from '../utils/captchaSettings';
import { buildCaptchaChallengeUrl } from '../utils/publicWebLinks';
import {
  canRequestCaptcha,
  CaptchaAutoResolutionDecision,
  evaluateCaptchaAutoResolution,
  selectCaptchaPassEffect,
} from './CaptchaChallengePolicy';
import { IThreadManager } from './ThreadManager';
import type { INotificationManager } from './NotificationManager';

const TOKEN_BYTES = 32;
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;
const DELIVERY_LEASE_MS = 5 * 60_000;

export interface RequestCaptchaChallengeInput {
  actionRequestId?: string;
  verificationEventId: string;
  requestSource: CaptchaChallengeRequestSource;
  requestedBy?: string | null;
  retry?: boolean;
  expectedChallengeId?: string;
  expectedGeneration?: number;
  caseWasCreatedBySuspiciousJoin?: boolean;
}

export interface CaptchaChallengeRequestResult {
  challenge: CaptchaChallenge;
  delivered: boolean;
}

export interface EvaluateCaptchaPassInput {
  challengeId: string;
  verificationEventId: string;
  targetUserId: string;
  generation: number;
  expectedCaseRevision: number;
}

export interface BypassCaptchaChallengeInput {
  actionRequestId?: string;
  verificationEventId: string;
  moderatorId: string;
  reason: string;
  expectedChallengeId: string;
  expectedGeneration: number;
}

export interface ICaptchaChallengeService {
  start(): void;
  stop(): void;
  findById(id: string): Promise<CaptchaChallenge | null>;
  findByCaseId(verificationEventId: string): Promise<CaptchaChallenge | null>;
  requestChallenge(input: RequestCaptchaChallengeInput): Promise<CaptchaChallengeRequestResult>;
  bypassChallenge(input: BypassCaptchaChallengeInput): Promise<CaptchaChallenge>;
  expireChallenges(limit?: number): Promise<CaptchaChallenge[]>;
  evaluatePassedChallenge(input: EvaluateCaptchaPassInput): Promise<CaptchaAutoResolutionDecision>;
}

@injectable()
export class CaptchaChallengeService implements ICaptchaChallengeService {
  private expirySweepTimer: ReturnType<typeof setInterval> | null = null;

  public constructor(
    @inject(TYPES.CaptchaChallengeRepository)
    private readonly challenges: ICaptchaChallengeRepository,
    @inject(TYPES.VerificationEventRepository)
    private readonly verificationEvents: IVerificationEventRepository,
    @inject(TYPES.DetectionEventsRepository)
    private readonly detectionEvents: IDetectionEventsRepository,
    @inject(TYPES.ConfigService) private readonly config: IConfigService,
    @inject(TYPES.ThreadManager) private readonly threads: IThreadManager,
    @inject(TYPES.NotificationManager)
    @optional()
    private readonly notifications?: INotificationManager,
    @inject(TYPES.ModerationActionRequestRepository)
    @optional()
    private readonly moderationActionRequests?: IModerationActionRequestRepository
  ) {}

  public start(): void {
    if (this.expirySweepTimer) {
      return;
    }
    this.expirySweepTimer = setInterval(() => {
      void this.runExpirySweep();
    }, EXPIRY_SWEEP_INTERVAL_MS);
    this.expirySweepTimer.unref();
    void this.runExpirySweep();
  }

  public stop(): void {
    if (!this.expirySweepTimer) {
      return;
    }
    clearInterval(this.expirySweepTimer);
    this.expirySweepTimer = null;
  }

  public findByCaseId(verificationEventId: string): Promise<CaptchaChallenge | null> {
    return this.challenges.findByCaseId(verificationEventId);
  }

  public findById(id: string): Promise<CaptchaChallenge | null> {
    return this.challenges.findById(id);
  }

  public async requestChallenge(
    input: RequestCaptchaChallengeInput
  ): Promise<CaptchaChallengeRequestResult> {
    const verificationEvent = await this.requireEligibleCase(input);
    const server = await this.config.getServerConfig(verificationEvent.server_id, {
      failOnReadError: true,
      forceRefresh: true,
    });
    const settings = getCaptchaSettings(server.settings);
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const challengeInput: CaptchaChallengeIssueInput = {
      actionRequestId: input.actionRequestId,
      verificationEventId: verificationEvent.id,
      serverId: verificationEvent.server_id,
      userId: verificationEvent.user_id,
      requestSource: input.requestSource,
      passEffect: selectCaptchaPassEffect(input.requestSource, settings.passAction),
      caseRevision: verificationEvent.case_revision,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + settings.challengeLifetimeHours * 60 * 60 * 1000),
      requestedBy: input.requestedBy ?? null,
    };
    let challenge: CaptchaChallenge;
    if (input.retry) {
      const expectedGeneration = input.expectedGeneration;
      if (
        !input.expectedChallengeId ||
        expectedGeneration === undefined ||
        !Number.isInteger(expectedGeneration) ||
        expectedGeneration < 1
      ) {
        throw new Error(
          'The displayed security check is no longer available. Refresh and try again.'
        );
      }
      challenge = await this.challenges.retry({
        ...challengeInput,
        expectedChallengeId: input.expectedChallengeId,
        expectedGeneration,
      });
    } else {
      challenge = await this.challenges.create(challengeInput);
    }
    const url = buildCaptchaChallengeUrl(token);
    if (!url) {
      const recorded = await this.challenges.recordDeliveryFailure(
        challenge.id,
        challenge.generation,
        'public_url_unavailable'
      );
      if (recorded) {
        await this.queueDeliveryFailureAttention(challenge, verificationEvent);
      }
      await this.refreshCaptchaPresentation(verificationEvent, challenge);
      return { challenge, delivered: false };
    }

    try {
      const deliveryMessageId = await this.threads.sendCaptchaChallenge(verificationEvent, url);
      if (!deliveryMessageId) {
        const recorded = await this.challenges.recordDeliveryFailure(
          challenge.id,
          challenge.generation,
          'case_thread_unavailable'
        );
        if (recorded) {
          await this.queueDeliveryFailureAttention(challenge, verificationEvent);
        }
        await this.refreshCaptchaPresentation(verificationEvent, challenge);
        return { challenge, delivered: false };
      }
      const recorded = await this.challenges.recordDelivery(challenge.id, challenge.generation);
      if (!recorded) {
        await this.threads.retractCaptchaChallenge(verificationEvent, deliveryMessageId);
        await this.compensateRejectedDelivery(verificationEvent);
      }
      await this.refreshCaptchaPresentation(verificationEvent, challenge);
      return { challenge, delivered: recorded };
    } catch (error) {
      const recorded = await this.challenges.recordDeliveryFailure(
        challenge.id,
        challenge.generation,
        'discord_delivery_failed'
      );
      if (recorded) {
        await this.queueDeliveryFailureAttention(challenge, verificationEvent);
      }
      await this.refreshCaptchaPresentation(verificationEvent, challenge);
      throw error;
    }
  }

  private async compensateRejectedDelivery(verificationEvent: VerificationEvent): Promise<void> {
    const current = await this.verificationEvents.findById(verificationEvent.id);
    if (!current) {
      return;
    }
    await this.threads.sendCaptchaStatus(current, 'This security check is no longer active.');
    if (current.status !== VerificationStatus.PENDING) {
      await this.threads.closeResolvedVerificationThreads(current, { execute: true });
    }
  }

  public async bypassChallenge(input: BypassCaptchaChallengeInput): Promise<CaptchaChallenge> {
    const verificationEvent = await this.verificationEvents.findById(input.verificationEventId);
    if (
      !verificationEvent ||
      verificationEvent.status !== VerificationStatus.PENDING ||
      verificationEvent.case_kind === CaseKind.COMPROMISED_ACCOUNT
    ) {
      throw new Error('Only pending standard cases can bypass a security check.');
    }
    const challenge = await this.challenges.findByCaseId(input.verificationEventId);
    if (!challenge || challenge.status === CaptchaChallengeStatus.PASSED) {
      throw new Error('This case does not have a bypassable security check.');
    }
    if (
      challenge.id !== input.expectedChallengeId ||
      challenge.generation !== input.expectedGeneration
    ) {
      throw new Error('The security check changed before it could be bypassed.');
    }
    const bypassed = await this.challenges.bypass(
      challenge.id,
      challenge.generation,
      input.moderatorId,
      input.reason,
      input.actionRequestId
    );
    if (!bypassed) {
      throw new Error('The security check changed before it could be bypassed.');
    }
    try {
      await this.queueBypassedPresentation(bypassed);
    } catch (error) {
      console.warn(
        `Failed to queue bypassed browser security-check presentation for case ${verificationEvent.id}:`,
        error
      );
    }
    return bypassed;
  }

  public async expireChallenges(limit = 50): Promise<CaptchaChallenge[]> {
    const disabled = await this.challenges.cancelPendingForDisabledServers(limit);
    const terminal = await this.challenges.cancelPendingForTerminalCases(limit);
    const expired = await this.challenges.expirePending(new Date(), limit);
    return [...disabled, ...terminal, ...expired];
  }

  public async evaluatePassedChallenge(
    input: EvaluateCaptchaPassInput
  ): Promise<CaptchaAutoResolutionDecision> {
    const challenge = await this.challenges.findById(input.challengeId);
    if (
      !challenge ||
      challenge.status !== CaptchaChallengeStatus.PASSED ||
      challenge.verification_event_id !== input.verificationEventId ||
      challenge.user_id !== input.targetUserId ||
      challenge.generation !== input.generation ||
      challenge.case_revision_at_issue !== input.expectedCaseRevision
    ) {
      return { status: 'held', reason: 'case_changed' };
    }
    const verificationEvent = await this.verificationEvents.findById(input.verificationEventId);
    if (
      !verificationEvent ||
      verificationEvent.server_id !== challenge.server_id ||
      verificationEvent.user_id !== challenge.user_id
    ) {
      return { status: 'held', reason: 'case_changed' };
    }
    const [linkedDetections, cases, server] = await Promise.all([
      this.detectionEvents.findByVerificationEventId(verificationEvent.id),
      this.verificationEvents.findByUserAndServer(challenge.user_id, challenge.server_id),
      this.config.getServerConfig(challenge.server_id, {
        failOnReadError: true,
        forceRefresh: true,
      }),
    ]);
    const settings = getCaptchaSettings(server.settings);
    return evaluateCaptchaAutoResolution({
      currentMode: settings.mode,
      requestSource: challenge.request_source,
      issuedPassEffect: challenge.pass_effect,
      currentPassAction: settings.passAction,
      caseKind: verificationEvent.case_kind ?? CaseKind.STANDARD,
      caseStatus: verificationEvent.status,
      caseRevision: verificationEvent.case_revision,
      issuedCaseRevision: challenge.case_revision_at_issue,
      linkedDetectionTypes: linkedDetections.map((detection) => detection.detection_type),
      otherPendingCaseCount: cases.filter(
        (candidate) =>
          candidate.id !== verificationEvent.id && candidate.status === VerificationStatus.PENDING
      ).length,
    });
  }

  private async runExpirySweep(): Promise<void> {
    try {
      await this.challenges.markStaleUndelivered(new Date(Date.now() - DELIVERY_LEASE_MS), 50);
      const completed = await this.expireChallenges();
      for (const challenge of completed) {
        if (challenge.status === CaptchaChallengeStatus.CANCELLED) {
          continue;
        }
        const verificationEvent = await this.verificationEvents.findById(
          challenge.verification_event_id
        );
        if (verificationEvent) {
          await this.refreshCaptchaPresentation(verificationEvent, challenge);
        }
      }
      const [
        deliveredNeedingPresentation,
        cancelledNeedingPresentation,
        bypassedNeedingPresentation,
        passedNeedingApplication,
        deliveryFailuresNeedingAttention,
        failedNeedingAttention,
        expiredNeedingAttention,
      ] = await Promise.all([
        this.challenges.findDeliveredNeedingPresentation(50),
        this.challenges.findCancelledNeedingPresentation(50),
        this.challenges.findBypassedNeedingPresentation(50),
        this.challenges.findPassedNeedingApplication(50),
        this.challenges.findDeliveryFailuresNeedingAttention(50),
        this.challenges.findFailedNeedingAttention(50),
        this.challenges.findExpiredNeedingAttention(50),
      ]);
      for (const challenge of deliveredNeedingPresentation) {
        const verificationEvent = await this.verificationEvents.findById(
          challenge.verification_event_id
        );
        if (verificationEvent?.status === VerificationStatus.PENDING) {
          await this.refreshCaptchaPresentation(verificationEvent, challenge);
        }
      }
      for (const challenge of cancelledNeedingPresentation) {
        await this.queueCancelledPresentation(challenge);
      }
      for (const challenge of bypassedNeedingPresentation) {
        await this.queueBypassedPresentation(challenge);
      }
      for (const challenge of passedNeedingApplication) {
        await this.queuePassedApplication(challenge);
      }
      for (const challenge of deliveryFailuresNeedingAttention) {
        await this.queueAttention(challenge, 'delivery_failed');
      }
      for (const challenge of failedNeedingAttention) {
        await this.queueAttention(challenge, 'submission_limit');
      }
      for (const challenge of expiredNeedingAttention) {
        await this.queueAttention(challenge, 'expired');
      }
    } catch (error) {
      console.error('Failed to expire CAPTCHA challenges:', error);
    }
  }

  private async queueAttention(
    challenge: CaptchaChallenge,
    reason: 'delivery_failed' | 'submission_limit' | 'expired'
  ): Promise<void> {
    if (!this.moderationActionRequests) {
      throw new Error('Moderation action requests are unavailable for CAPTCHA attention.');
    }
    const verificationEvent = await this.verificationEvents.findById(
      challenge.verification_event_id
    );
    if (
      verificationEvent?.status !== VerificationStatus.PENDING ||
      !(await this.isCurrentAttentionState(challenge, reason))
    ) {
      return;
    }
    await this.moderationActionRequests.enqueue({
      serverId: challenge.server_id,
      actionType: ModerationActionRequestType.NOTIFY_CAPTCHA_ATTENTION,
      actorId: 'drasil:captcha',
      actorSurface: 'captcha',
      targetUserId: challenge.user_id,
      verificationEventId: challenge.verification_event_id,
      idempotencyKey: `captcha:attention:${challenge.id}:${challenge.generation}:${this.attentionReasonKey(reason)}`,
      metadata: {
        challenge_id: challenge.id,
        generation: challenge.generation,
        reason,
      },
    });
  }

  private async queueCancelledPresentation(challenge: CaptchaChallenge): Promise<void> {
    await this.queueTerminalPresentation(challenge, 'cancelled');
  }

  private async queueBypassedPresentation(challenge: CaptchaChallenge): Promise<void> {
    await this.queueTerminalPresentation(challenge, 'bypassed');
  }

  private async queueTerminalPresentation(
    challenge: CaptchaChallenge,
    reason: 'bypassed' | 'cancelled'
  ): Promise<void> {
    if (!this.moderationActionRequests) {
      throw new Error('Moderation action requests are unavailable for CAPTCHA presentation.');
    }
    await this.moderationActionRequests.enqueue({
      serverId: challenge.server_id,
      actionType: ModerationActionRequestType.NOTIFY_CAPTCHA_ATTENTION,
      actorId: 'drasil:captcha',
      actorSurface: 'captcha',
      targetUserId: challenge.user_id,
      verificationEventId: challenge.verification_event_id,
      idempotencyKey: `captcha:presentation:${challenge.id}:${challenge.generation}:${reason}`,
      metadata: {
        challenge_id: challenge.id,
        generation: challenge.generation,
        reason,
      },
    });
  }

  private async queuePassedApplication(challenge: CaptchaChallenge): Promise<void> {
    if (!this.moderationActionRequests) {
      throw new Error('Moderation action requests are unavailable for CAPTCHA completion.');
    }
    await this.moderationActionRequests.enqueue({
      serverId: challenge.server_id,
      actionType: ModerationActionRequestType.APPLY_CAPTCHA_PASS,
      actorId: 'drasil:captcha',
      actorSurface: 'captcha',
      targetUserId: challenge.user_id,
      verificationEventId: challenge.verification_event_id,
      idempotencyKey: `captcha:apply:${challenge.id}:${challenge.generation}`,
      metadata: {
        challenge_id: challenge.id,
        generation: challenge.generation,
        expected_case_revision: challenge.case_revision_at_issue,
      },
    });
  }

  private async queueDeliveryFailureAttention(
    challenge: CaptchaChallenge,
    verificationEvent: VerificationEvent
  ): Promise<void> {
    if (!this.moderationActionRequests) {
      if (!this.notifications?.notifyCaptchaAttention) {
        return;
      }
      await this.notifications
        .notifyCaptchaAttention(verificationEvent, 'delivery_failed')
        .catch((error) => {
          console.warn(
            `Failed to notify moderators about browser security-check delivery for case ${verificationEvent.id}:`,
            error
          );
          return false;
        });
      return;
    }
    await this.queueAttention(challenge, 'delivery_failed').catch((error) => {
      console.warn(
        `Failed to persist browser security-check delivery attention for case ${verificationEvent.id}:`,
        error
      );
    });
  }

  private async isCurrentAttentionState(
    challenge: CaptchaChallenge,
    reason: 'delivery_failed' | 'submission_limit' | 'expired'
  ): Promise<boolean> {
    const current = await this.challenges.findById(challenge.id);
    if (!current || current.generation !== challenge.generation) {
      return false;
    }
    if (reason === 'delivery_failed') {
      return (
        current.status === CaptchaChallengeStatus.PENDING &&
        current.delivered_at === null &&
        Boolean(current.delivery_error_code)
      );
    }
    return current.status === challenge.status;
  }

  private attentionReasonKey(reason: 'delivery_failed' | 'submission_limit' | 'expired'): string {
    if (reason === 'delivery_failed') {
      return 'delivery-failed';
    }
    return reason === 'submission_limit' ? 'submission-limit' : 'expired';
  }

  private async refreshCaptchaPresentation(
    verificationEvent: VerificationEvent,
    challenge: CaptchaChallenge
  ): Promise<void> {
    if (!this.notifications?.updateCaptchaChallengePresentation) {
      return;
    }
    try {
      const current = (await this.challenges.findById(challenge.id)) ?? challenge;
      const presented = await this.notifications.updateCaptchaChallengePresentation(
        verificationEvent,
        current
      );
      if (presented) {
        await this.challenges.recordPresentation(current.id, current.generation);
      }
    } catch (error) {
      console.warn(
        `Failed to refresh browser security-check presentation for case ${verificationEvent.id}:`,
        error
      );
    }
  }

  private async requireEligibleCase(
    input: RequestCaptchaChallengeInput
  ): Promise<VerificationEvent> {
    const verificationEvent = await this.verificationEvents.findById(input.verificationEventId);
    if (!verificationEvent) {
      throw new Error('Case not found.');
    }
    const server = await this.config.getServerConfig(verificationEvent.server_id, {
      failOnReadError: true,
      forceRefresh: true,
    });
    const settings = getCaptchaSettings(server.settings);
    if (
      !canRequestCaptcha({
        mode: settings.mode,
        requestSource: input.requestSource,
        caseKind: verificationEvent.case_kind ?? CaseKind.STANDARD,
        caseStatus: verificationEvent.status,
        caseWasCreatedBySuspiciousJoin: input.caseWasCreatedBySuspiciousJoin ?? false,
      })
    ) {
      throw new Error('This case is not eligible for a security check.');
    }
    const existing = await this.challenges.findByCaseId(verificationEvent.id);
    if (!input.retry && existing) {
      throw new Error(
        existing.status === CaptchaChallengeStatus.PASSED
          ? 'This case has already passed its security check.'
          : 'This case already has a security check.'
      );
    }
    return verificationEvent;
  }
}
