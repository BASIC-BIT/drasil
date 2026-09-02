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
import {
  CaptchaChallenge,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaseKind,
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
import type { CaptchaAttentionReason, INotificationManager } from './NotificationManager';

const TOKEN_BYTES = 32;
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;

export interface RequestCaptchaChallengeInput {
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
    private readonly notifications?: INotificationManager
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
      await this.challenges.recordDeliveryFailure(
        challenge.id,
        challenge.generation,
        'public_url_unavailable'
      );
      await this.notifyAttention(verificationEvent, 'delivery_failed');
      return { challenge, delivered: false };
    }

    try {
      const delivered = await this.threads.sendCaptchaChallenge(verificationEvent, url);
      if (!delivered) {
        await this.challenges.recordDeliveryFailure(
          challenge.id,
          challenge.generation,
          'case_thread_unavailable'
        );
        await this.notifyAttention(verificationEvent, 'delivery_failed');
        return { challenge, delivered: false };
      }
      await this.challenges.recordDelivery(challenge.id, challenge.generation);
      return { challenge, delivered: true };
    } catch (error) {
      await this.challenges.recordDeliveryFailure(
        challenge.id,
        challenge.generation,
        'discord_delivery_failed'
      );
      await this.notifyAttention(verificationEvent, 'delivery_failed');
      throw error;
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
      input.reason
    );
    if (!bypassed) {
      throw new Error('The security check changed before it could be bypassed.');
    }
    return bypassed;
  }

  public async expireChallenges(limit = 50): Promise<CaptchaChallenge[]> {
    const [cancelled, expired] = await Promise.all([
      this.challenges.cancelPendingForDisabledServers(limit),
      this.challenges.expirePending(new Date(), limit),
    ]);
    return [...cancelled, ...expired];
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
      const expired = await this.expireChallenges();
      for (const challenge of expired) {
        const verificationEvent = await this.verificationEvents.findById(
          challenge.verification_event_id
        );
        if (
          verificationEvent?.status === VerificationStatus.PENDING &&
          (await this.isCurrentChallengeState(challenge))
        ) {
          await this.threads
            .sendCaptchaStatus(
              verificationEvent,
              challenge.status === CaptchaChallengeStatus.CANCELLED
                ? 'This security check is no longer active.'
                : 'This security check expired. Ask a moderator to issue a new check.'
            )
            .catch((error) => {
              console.warn(
                `Failed to notify case ${verificationEvent.id} about an expired security check:`,
                error
              );
              return false;
            });
          if (challenge.status === CaptchaChallengeStatus.EXPIRED) {
            if (await this.isCurrentChallengeState(challenge)) {
              await this.notifyAttention(verificationEvent, 'expired');
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to expire CAPTCHA challenges:', error);
    }
  }

  private async isCurrentChallengeState(challenge: CaptchaChallenge): Promise<boolean> {
    const current = await this.challenges.findById(challenge.id);
    return current?.generation === challenge.generation && current.status === challenge.status;
  }

  private async notifyAttention(
    verificationEvent: VerificationEvent,
    reason: CaptchaAttentionReason
  ): Promise<void> {
    if (!this.notifications?.notifyCaptchaAttention) {
      return;
    }
    await this.notifications.notifyCaptchaAttention(verificationEvent, reason).catch((error) => {
      console.warn(
        `Failed to queue browser security-check attention for case ${verificationEvent.id}:`,
        error
      );
      return false;
    });
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
