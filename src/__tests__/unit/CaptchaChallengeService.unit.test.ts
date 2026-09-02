import { createHash } from 'node:crypto';
import type { IConfigService } from '../../config/ConfigService';
import type {
  CaptchaChallengeIssueInput,
  ICaptchaChallengeRepository,
} from '../../repositories/CaptchaChallengeRepository';
import type { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import type { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import {
  CaptchaChallenge,
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaptchaProvider,
  CaseKind,
  DetectionType,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { CaptchaChallengeService } from '../../services/CaptchaChallengeService';
import type { IThreadManager } from '../../services/ThreadManager';
import type { INotificationManager } from '../../services/NotificationManager';
import type { IModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';

const now = new Date('2026-08-31T12:00:00.000Z');

function buildCase(overrides: Partial<VerificationEvent> = {}): VerificationEvent {
  return {
    id: 'case-1',
    server_id: 'guild-1',
    user_id: 'user-1',
    detection_event_id: 'detection-1',
    thread_id: 'thread-1',
    private_evidence_thread_id: null,
    notification_channel_id: null,
    notification_message_id: null,
    status: VerificationStatus.PENDING,
    case_revision: 2,
    case_kind: CaseKind.STANDARD,
    created_at: now,
    updated_at: now,
    resolved_at: null,
    resolved_by: null,
    notes: null,
    metadata: {},
    ...overrides,
  };
}

function buildChallenge(overrides: Partial<CaptchaChallenge> = {}): CaptchaChallenge {
  return {
    id: 'challenge-1',
    verification_event_id: 'case-1',
    server_id: 'guild-1',
    user_id: 'user-1',
    provider: CaptchaProvider.TURNSTILE,
    status: CaptchaChallengeStatus.PENDING,
    request_source: CaptchaChallengeRequestSource.MODERATOR,
    pass_effect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
    generation: 1,
    case_revision_at_issue: 2,
    link_token_hash: 'stored-hash',
    expires_at: new Date('2026-09-01T12:00:00.000Z'),
    submission_count: 0,
    requested_by: 'moderator-1',
    requested_at: now,
    delivered_at: null,
    delivery_error_code: null,
    passed_at: null,
    bypassed_by: null,
    bypassed_at: null,
    bypass_reason: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function createHarness(settings: Record<string, unknown> = { captcha_mode: 'manual' }) {
  const challenge = buildChallenge();
  const challenges: jest.Mocked<ICaptchaChallengeRepository> = {
    findById: jest.fn().mockResolvedValue(challenge),
    findByCaseId: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input: CaptchaChallengeIssueInput) => ({
      ...challenge,
      link_token_hash: input.tokenHash,
      expires_at: input.expiresAt,
      request_source: input.requestSource,
      pass_effect: input.passEffect,
      requested_by: input.requestedBy ?? null,
    })),
    retry: jest.fn().mockResolvedValue(challenge),
    recordDelivery: jest.fn().mockResolvedValue(true),
    recordDeliveryFailure: jest.fn().mockResolvedValue(true),
    bypass: jest
      .fn()
      .mockResolvedValue(buildChallenge({ status: CaptchaChallengeStatus.BYPASSED })),
    cancelPendingForCase: jest.fn().mockResolvedValue(true),
    cancelPendingForDisabledServers: jest.fn().mockResolvedValue([]),
    cancelPendingForTerminalCases: jest.fn().mockResolvedValue([]),
    markStaleUndelivered: jest.fn().mockResolvedValue([]),
    expirePending: jest.fn().mockResolvedValue([]),
    findDeliveryFailuresNeedingAttention: jest.fn().mockResolvedValue([]),
    findFailedNeedingAttention: jest.fn().mockResolvedValue([]),
    findExpiredNeedingAttention: jest.fn().mockResolvedValue([]),
    findCancelledNeedingPresentation: jest.fn().mockResolvedValue([]),
    findBypassedNeedingPresentation: jest.fn().mockResolvedValue([]),
    findPassedNeedingApplication: jest.fn().mockResolvedValue([]),
  };
  const verificationEvents = {
    findById: jest.fn().mockResolvedValue(buildCase()),
    findByUserAndServer: jest.fn().mockResolvedValue([buildCase()]),
  } as unknown as jest.Mocked<IVerificationEventRepository>;
  const detectionEvents = {
    findByVerificationEventId: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<IDetectionEventsRepository>;
  const config = {
    getServerConfig: jest.fn().mockResolvedValue({ settings }),
  } as unknown as jest.Mocked<IConfigService>;
  const threads = {
    closeResolvedVerificationThreads: jest.fn().mockResolvedValue({
      closedAny: true,
      results: [],
    }),
    sendCaptchaChallenge: jest.fn().mockResolvedValue(true),
    sendCaptchaStatus: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<IThreadManager>;
  const notifications = {
    notifyCaptchaAttention: jest.fn().mockResolvedValue(true),
    updateCaptchaChallengePresentation: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<INotificationManager>;
  const moderationActionRequests = {
    enqueue: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<IModerationActionRequestRepository>;
  const service = new CaptchaChallengeService(
    challenges,
    verificationEvents,
    detectionEvents,
    config,
    threads,
    notifications,
    moderationActionRequests
  );

  return {
    challenge,
    challenges,
    config,
    detectionEvents,
    moderationActionRequests,
    notifications,
    service,
    threads,
    verificationEvents,
  };
}

describe('CaptchaChallengeService', () => {
  const originalPublicUrl = process.env.DRASIL_WEB_PUBLIC_URL;

  beforeEach(() => {
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasil.example';
  });

  afterEach(() => {
    if (originalPublicUrl === undefined) {
      delete process.env.DRASIL_WEB_PUBLIC_URL;
    } else {
      process.env.DRASIL_WEB_PUBLIC_URL = originalPublicUrl;
    }
  });

  it('creates a case-scoped challenge and stores only the link token hash', async () => {
    const { challenges, notifications, service, threads } = createHarness();

    await expect(
      service.requestChallenge({
        verificationEventId: 'case-1',
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
        requestedBy: 'moderator-1',
      })
    ).resolves.toMatchObject({ delivered: true });

    const input = challenges.create.mock.calls[0][0];
    const deliveredUrl = threads.sendCaptchaChallenge.mock.calls[0][1];
    const token = new URL(deliveredUrl).pathname.split('/').at(-1) as string;
    expect(input.verificationEventId).toBe('case-1');
    expect(input.caseRevision).toBe(2);
    expect(input.passEffect).toBe(CaptchaChallengePassEffect.EVIDENCE_ONLY);
    expect(input.tokenHash).not.toBe(token);
    expect(input.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(challenges.recordDelivery).toHaveBeenCalledWith('challenge-1', 1);
    expect(notifications.updateCaptchaChallengePresentation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'case-1' }),
      expect.objectContaining({ id: 'challenge-1' })
    );
  });

  it('compensates and recloses a terminal case when delivery loses the case race', async () => {
    const { challenges, service, threads, verificationEvents } = createHarness();
    challenges.recordDelivery.mockResolvedValue(false);
    verificationEvents.findById
      .mockResolvedValueOnce(buildCase())
      .mockResolvedValueOnce(buildCase({ status: VerificationStatus.VERIFIED }));

    await expect(
      service.requestChallenge({
        verificationEventId: 'case-1',
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
      })
    ).resolves.toMatchObject({ delivered: false });
    expect(threads.sendCaptchaStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: VerificationStatus.VERIFIED }),
      'This security check is no longer active.'
    );
    expect(threads.closeResolvedVerificationThreads).toHaveBeenCalledWith(
      expect.objectContaining({ status: VerificationStatus.VERIFIED }),
      { execute: true }
    );
  });

  it('keeps an automatic pass evidence-only when that is the current setting', async () => {
    const { challenges, service } = createHarness({
      captcha_mode: 'suspicious_join',
      captcha_pass_action: 'evidence_only',
    });

    await service.requestChallenge({
      verificationEventId: 'case-1',
      requestSource: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
      caseWasCreatedBySuspiciousJoin: true,
    });

    expect(challenges.create.mock.calls[0][0].passEffect).toBe(
      CaptchaChallengePassEffect.EVIDENCE_ONLY
    );
  });

  it('rejects a moderator challenge for a compromised-account case', async () => {
    const { service, verificationEvents } = createHarness();
    verificationEvents.findById.mockResolvedValue(
      buildCase({ case_kind: CaseKind.COMPROMISED_ACCOUNT })
    );

    await expect(
      service.requestChallenge({
        verificationEventId: 'case-1',
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
      })
    ).rejects.toThrow('not eligible');
  });

  it('records a delivery failure when the public URL is unavailable', async () => {
    delete process.env.DRASIL_WEB_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { challenges, moderationActionRequests, notifications, service, threads } =
      createHarness();
    challenges.findById.mockResolvedValue(
      buildChallenge({ delivery_error_code: 'public_url_unavailable' })
    );

    await expect(
      service.requestChallenge({
        verificationEventId: 'case-1',
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
      })
    ).resolves.toMatchObject({ delivered: false });

    expect(challenges.recordDeliveryFailure).toHaveBeenCalledWith(
      'challenge-1',
      1,
      'public_url_unavailable'
    );
    expect(threads.sendCaptchaChallenge).not.toHaveBeenCalled();
    expect(moderationActionRequests.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'captcha:attention:challenge-1:1:delivery-failed',
        metadata: expect.objectContaining({ reason: 'delivery_failed' }),
      })
    );
    expect(notifications.updateCaptchaChallengePresentation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'case-1' }),
      expect.objectContaining({ delivery_error_code: 'public_url_unavailable' })
    );
  });

  it('leaves a delivery failure discoverable when its durable attention enqueue fails', async () => {
    delete process.env.DRASIL_WEB_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { challenges, moderationActionRequests, service } = createHarness();
    challenges.findById.mockResolvedValue(
      buildChallenge({ delivery_error_code: 'public_url_unavailable' })
    );
    moderationActionRequests.enqueue.mockRejectedValueOnce(new Error('Database unavailable'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      service.requestChallenge({
        verificationEventId: 'case-1',
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
      })
    ).resolves.toMatchObject({ delivered: false });

    expect(challenges.recordDeliveryFailure).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist browser security-check delivery attention'),
      expect.any(Error)
    );
    warn.mockRestore();
  });

  it('binds a retry to the displayed challenge generation', async () => {
    const { challenges, service } = createHarness();

    await service.requestChallenge({
      verificationEventId: 'case-1',
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      requestedBy: 'moderator-1',
      retry: true,
      expectedChallengeId: 'challenge-1',
      expectedGeneration: 3,
    });

    expect(challenges.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallengeId: 'challenge-1',
        expectedGeneration: 3,
        verificationEventId: 'case-1',
      })
    );
  });

  it('requires a pending standard case before bypassing', async () => {
    const { service, verificationEvents } = createHarness();
    verificationEvents.findById.mockResolvedValue(
      buildCase({ status: VerificationStatus.VERIFIED })
    );

    await expect(
      service.bypassChallenge({
        verificationEventId: 'case-1',
        moderatorId: 'moderator-1',
        reason: 'Reviewed manually',
        expectedChallengeId: 'challenge-1',
        expectedGeneration: 1,
      })
    ).rejects.toThrow('Only pending standard cases');
  });

  it('rejects a bypass submitted for an earlier challenge generation', async () => {
    const { challenges, service } = createHarness();
    challenges.findByCaseId.mockResolvedValue(buildChallenge({ generation: 2 }));

    await expect(
      service.bypassChallenge({
        verificationEventId: 'case-1',
        moderatorId: 'moderator-1',
        reason: 'Reviewed manually',
        expectedChallengeId: 'challenge-1',
        expectedGeneration: 1,
      })
    ).rejects.toThrow('The security check changed before it could be bypassed.');

    expect(challenges.bypass).not.toHaveBeenCalled();
  });

  it('queues bypassed presentation with a stable generation key', async () => {
    const { challenges, moderationActionRequests, service } = createHarness();
    challenges.findByCaseId.mockResolvedValue(buildChallenge());

    await service.bypassChallenge({
      verificationEventId: 'case-1',
      moderatorId: 'moderator-1',
      reason: 'Reviewed manually',
      expectedChallengeId: 'challenge-1',
      expectedGeneration: 1,
    });

    expect(moderationActionRequests.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'notify_captcha_attention',
        idempotencyKey: 'captcha:presentation:challenge-1:1:bypassed',
        metadata: expect.objectContaining({ reason: 'bypassed' }),
      })
    );
  });

  it('does not post expiry status after the challenge generation is retried', async () => {
    const { challenges, moderationActionRequests, service, threads } = createHarness();
    const expired = buildChallenge({ status: CaptchaChallengeStatus.EXPIRED, generation: 1 });
    challenges.expirePending.mockResolvedValue([expired]);
    challenges.findById.mockResolvedValue(
      buildChallenge({ status: CaptchaChallengeStatus.PENDING, generation: 2 })
    );

    await (
      service as unknown as {
        runExpirySweep(): Promise<void>;
      }
    ).runExpirySweep();

    expect(threads.sendCaptchaStatus).not.toHaveBeenCalled();
    expect(moderationActionRequests.enqueue).not.toHaveBeenCalled();
  });

  it('cancels disabled and terminal checks before expiring the remaining pending checks', async () => {
    const { challenges, service } = createHarness();
    const calls: string[] = [];
    challenges.cancelPendingForDisabledServers.mockImplementation(async () => {
      calls.push('disabled');
      return [];
    });
    challenges.cancelPendingForTerminalCases.mockImplementation(async () => {
      calls.push('terminal');
      return [];
    });
    challenges.expirePending.mockImplementation(async () => {
      calls.push('expire');
      return [];
    });

    await service.expireChallenges();

    expect(calls).toEqual(['disabled', 'terminal', 'expire']);
  });

  it('queues cancelled presentation with a stable generation key', async () => {
    const { challenges, moderationActionRequests, service, threads } = createHarness();
    const cancelled = buildChallenge({ status: CaptchaChallengeStatus.CANCELLED });
    challenges.cancelPendingForDisabledServers.mockResolvedValue([cancelled]);
    challenges.findCancelledNeedingPresentation.mockResolvedValue([cancelled]);

    await (
      service as unknown as {
        runExpirySweep(): Promise<void>;
      }
    ).runExpirySweep();

    expect(moderationActionRequests.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'notify_captcha_attention',
        idempotencyKey: 'captcha:presentation:challenge-1:1:cancelled',
        metadata: expect.objectContaining({ reason: 'cancelled' }),
      })
    );
    expect(threads.sendCaptchaStatus).not.toHaveBeenCalled();
  });

  it('recovers a bypassed presentation that has no active request', async () => {
    const { challenges, moderationActionRequests, service } = createHarness();
    const bypassed = buildChallenge({ status: CaptchaChallengeStatus.BYPASSED });
    challenges.findBypassedNeedingPresentation.mockResolvedValue([bypassed]);

    await (
      service as unknown as {
        runExpirySweep(): Promise<void>;
      }
    ).runExpirySweep();

    expect(moderationActionRequests.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'captcha:presentation:challenge-1:1:bypassed',
        metadata: expect.objectContaining({ reason: 'bypassed' }),
      })
    );
  });

  it('recovers a passed challenge whose application request failed', async () => {
    const { challenges, moderationActionRequests, service } = createHarness();
    const passed = buildChallenge({ status: CaptchaChallengeStatus.PASSED });
    challenges.findPassedNeedingApplication.mockResolvedValue([passed]);

    await (
      service as unknown as {
        runExpirySweep(): Promise<void>;
      }
    ).runExpirySweep();

    expect(moderationActionRequests.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'apply_captcha_pass',
        idempotencyKey: 'captcha:apply:challenge-1:1',
        metadata: {
          challenge_id: 'challenge-1',
          expected_case_revision: 2,
          generation: 1,
        },
      })
    );
  });

  it('queues durable attention after an interrupted delivery lease expires', async () => {
    const { challenges, moderationActionRequests, service, threads } = createHarness();
    const interrupted = buildChallenge({ delivery_error_code: 'delivery_interrupted' });
    challenges.markStaleUndelivered.mockResolvedValue([interrupted]);
    challenges.findDeliveryFailuresNeedingAttention.mockResolvedValue([interrupted]);
    challenges.findById.mockResolvedValue(interrupted);

    await (
      service as unknown as {
        runExpirySweep(): Promise<void>;
      }
    ).runExpirySweep();

    expect(challenges.markStaleUndelivered).toHaveBeenCalledWith(expect.any(Date), 50);
    expect(moderationActionRequests.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'captcha:attention:challenge-1:1:delivery-failed',
        metadata: expect.objectContaining({ reason: 'delivery_failed' }),
      })
    );
    expect(threads.sendCaptchaStatus).not.toHaveBeenCalled();
  });

  it('does not queue attention after an interrupted delivery is concurrently recorded', async () => {
    const { challenges, moderationActionRequests, service, threads } = createHarness();
    const interrupted = buildChallenge({ delivery_error_code: 'delivery_interrupted' });
    challenges.markStaleUndelivered.mockResolvedValue([interrupted]);
    challenges.findDeliveryFailuresNeedingAttention.mockResolvedValue([interrupted]);
    challenges.findById.mockResolvedValue(
      buildChallenge({ delivered_at: new Date(), delivery_error_code: null })
    );

    await (
      service as unknown as {
        runExpirySweep(): Promise<void>;
      }
    ).runExpirySweep();

    expect(threads.sendCaptchaStatus).not.toHaveBeenCalled();
    expect(moderationActionRequests.enqueue).not.toHaveBeenCalled();
  });

  it('queues expired moderator attention with a stable generation key', async () => {
    const { challenges, moderationActionRequests, service, threads } = createHarness();
    const expired = buildChallenge({ status: CaptchaChallengeStatus.EXPIRED });
    challenges.expirePending.mockResolvedValue([expired]);
    challenges.findExpiredNeedingAttention.mockResolvedValue([expired]);
    challenges.findById.mockResolvedValue(expired);

    await (
      service as unknown as {
        runExpirySweep(): Promise<void>;
      }
    ).runExpirySweep();

    expect(moderationActionRequests.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'notify_captcha_attention',
        idempotencyKey: 'captcha:attention:challenge-1:1:expired',
        metadata: expect.objectContaining({ reason: 'expired' }),
      })
    );
    expect(threads.sendCaptchaStatus).not.toHaveBeenCalled();
  });

  it('requeues failed submission-limit attention with a stable generation key', async () => {
    const { challenges, moderationActionRequests, service } = createHarness();
    const failed = buildChallenge({ status: CaptchaChallengeStatus.FAILED });
    challenges.findFailedNeedingAttention.mockResolvedValue([failed]);
    challenges.findById.mockResolvedValue(failed);

    await (
      service as unknown as {
        runExpirySweep(): Promise<void>;
      }
    ).runExpirySweep();

    expect(moderationActionRequests.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'notify_captcha_attention',
        idempotencyKey: 'captcha:attention:challenge-1:1:submission-limit',
        metadata: expect.objectContaining({ reason: 'submission_limit' }),
      })
    );
  });

  it('keeps a passed moderator challenge as evidence only', async () => {
    const { challenges, service } = createHarness();
    challenges.findById.mockResolvedValue(
      buildChallenge({ status: CaptchaChallengeStatus.PASSED })
    );

    await expect(
      service.evaluatePassedChallenge({
        challengeId: 'challenge-1',
        expectedCaseRevision: 2,
        generation: 1,
        targetUserId: 'user-1',
        verificationEventId: 'case-1',
      })
    ).resolves.toEqual({ status: 'evidence_only' });
  });

  it('allows an unchanged automatic join-only challenge to resolve', async () => {
    const { challenges, detectionEvents, service } = createHarness({
      captcha_mode: 'suspicious_join',
      captcha_pass_action: 'verify_join_only',
    });
    challenges.findById.mockResolvedValue(
      buildChallenge({
        pass_effect: CaptchaChallengePassEffect.VERIFY_JOIN_ONLY,
        request_source: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
        status: CaptchaChallengeStatus.PASSED,
      })
    );
    detectionEvents.findByVerificationEventId.mockResolvedValue([
      { detection_type: DetectionType.NEW_ACCOUNT } as any,
    ]);

    await expect(
      service.evaluatePassedChallenge({
        challengeId: 'challenge-1',
        expectedCaseRevision: 2,
        generation: 1,
        targetUserId: 'user-1',
        verificationEventId: 'case-1',
      })
    ).resolves.toEqual({ status: 'eligible' });
  });

  it('holds a previously passed automatic challenge after CAPTCHA is disabled', async () => {
    const { challenges, detectionEvents, service } = createHarness({
      captcha_mode: 'off',
      captcha_pass_action: 'verify_join_only',
    });
    challenges.findById.mockResolvedValue(
      buildChallenge({
        pass_effect: CaptchaChallengePassEffect.VERIFY_JOIN_ONLY,
        request_source: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
        status: CaptchaChallengeStatus.PASSED,
      })
    );
    detectionEvents.findByVerificationEventId.mockResolvedValue([
      { detection_type: DetectionType.NEW_ACCOUNT } as any,
    ]);

    await expect(
      service.evaluatePassedChallenge({
        challengeId: 'challenge-1',
        expectedCaseRevision: 2,
        generation: 1,
        targetUserId: 'user-1',
        verificationEventId: 'case-1',
      })
    ).resolves.toEqual({ status: 'held', reason: 'policy_changed' });
  });

  it('holds automatic resolution when another pending case exists', async () => {
    const { challenges, detectionEvents, service, verificationEvents } = createHarness({
      captcha_mode: 'suspicious_join',
      captcha_pass_action: 'verify_join_only',
    });
    challenges.findById.mockResolvedValue(
      buildChallenge({
        pass_effect: CaptchaChallengePassEffect.VERIFY_JOIN_ONLY,
        request_source: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
        status: CaptchaChallengeStatus.PASSED,
      })
    );
    detectionEvents.findByVerificationEventId.mockResolvedValue([
      { detection_type: DetectionType.NEW_ACCOUNT } as any,
    ]);
    verificationEvents.findByUserAndServer.mockResolvedValue([
      buildCase(),
      buildCase({ id: 'case-2' }),
    ]);

    await expect(
      service.evaluatePassedChallenge({
        challengeId: 'challenge-1',
        expectedCaseRevision: 2,
        generation: 1,
        targetUserId: 'user-1',
        verificationEventId: 'case-1',
      })
    ).resolves.toEqual({ status: 'held', reason: 'other_pending_case' });
  });
});
