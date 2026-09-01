import { PrismaClient } from '../../db/prisma';
import { CaptchaChallengeRepository } from '../../repositories/CaptchaChallengeRepository';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import {
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaseContainmentStatus,
  DetectionType,
  VerificationStatus,
} from '../../repositories/types';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('CaptchaChallengeRepository (integration)', () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = getPrismaClient();
  });

  async function createCase(serverId: string, userId: string) {
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    const detections = new DetectionEventsRepository(prisma);
    const verifications = new VerificationEventRepository(prisma);
    await servers.getOrCreateServer(serverId);
    await users.getOrCreateUser(userId, 'captcha-target');
    const detection = await detections.create({
      server_id: serverId,
      user_id: userId,
      detection_type: DetectionType.NEW_ACCOUNT,
      confidence: 0.9,
      reasons: ['New account'],
      detected_at: new Date(),
    });
    const verification = await verifications.createFromDetection(
      detection.id,
      serverId,
      userId,
      VerificationStatus.PENDING
    );
    return { detection, detections, verification };
  }

  it('keeps one aggregate per case and advances the generation on retry', async () => {
    const { verification } = await createCase('guild-captcha-retry', 'user-captcha-retry');
    const challenges = new CaptchaChallengeRepository(prisma);
    const initial = await challenges.create({
      verificationEventId: verification.id,
      serverId: verification.server_id,
      userId: verification.user_id,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: verification.case_revision,
      tokenHash: 'initial-hash',
      expiresAt: new Date(Date.now() - 60_000),
      requestedBy: 'moderator-1',
    });
    await challenges.expirePending(new Date(), 10);

    const retried = await challenges.retry({
      verificationEventId: verification.id,
      serverId: verification.server_id,
      userId: verification.user_id,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: verification.case_revision,
      tokenHash: 'replacement-hash',
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: 'moderator-2',
    });

    expect(retried).toMatchObject({
      id: initial.id,
      generation: 2,
      link_token_hash: 'replacement-hash',
      status: CaptchaChallengeStatus.PENDING,
      submission_count: 0,
      requested_by: 'moderator-2',
    });
    await expect(prisma.captcha_challenges.count()).resolves.toBe(1);
  });

  it('distinguishes duplicate cases from public-link token collisions', async () => {
    const first = await createCase('guild-captcha-unique', 'user-captcha-unique-1');
    const second = await createCase('guild-captcha-unique', 'user-captcha-unique-2');
    const challenges = new CaptchaChallengeRepository(prisma);
    const baseInput = {
      serverId: first.verification.server_id,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: 0,
      expiresAt: new Date(Date.now() + 60_000),
    };
    await challenges.create({
      ...baseInput,
      verificationEventId: first.verification.id,
      userId: first.verification.user_id,
      tokenHash: 'shared-token-hash',
    });

    await expect(
      challenges.create({
        ...baseInput,
        verificationEventId: first.verification.id,
        userId: first.verification.user_id,
        tokenHash: 'different-token-hash',
      })
    ).rejects.toThrow('This case already has a CAPTCHA challenge.');
    await expect(
      challenges.create({
        ...baseInput,
        verificationEventId: second.verification.id,
        userId: second.verification.user_id,
        tokenHash: 'shared-token-hash',
      })
    ).rejects.toThrow('Could not create a unique CAPTCHA link. Try issuing the check again.');
  });

  it('requires the bound case to remain pending when creating or retrying a challenge', async () => {
    const { verification } = await createCase(
      'guild-captcha-pending-guard',
      'user-captcha-pending-guard'
    );
    const challenges = new CaptchaChallengeRepository(prisma);
    const verifications = new VerificationEventRepository(prisma);
    const input = {
      verificationEventId: verification.id,
      serverId: verification.server_id,
      userId: verification.user_id,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: verification.case_revision,
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: 'moderator-1',
    };
    const challenge = await challenges.create({
      ...input,
      tokenHash: 'pending-guard-initial',
    });
    await challenges.recordDeliveryFailure(challenge.id, challenge.generation, 'delivery_failed');
    await verifications.update(verification.id, {
      resolved_at: new Date(),
      resolved_by: 'moderator-2',
      status: VerificationStatus.VERIFIED,
    });

    await expect(challenges.retry({ ...input, tokenHash: 'pending-guard-retry' })).rejects.toThrow(
      'The case changed before the security check could be retried.'
    );
    await expect(
      challenges.create({
        ...input,
        verificationEventId: '2e35afe7-51bf-4b57-8807-699946696aa2',
        tokenHash: 'pending-guard-create',
      })
    ).rejects.toThrow('The case changed before the security check could be created.');
    await expect(challenges.findById(challenge.id)).resolves.toEqual(
      expect.objectContaining({ generation: challenge.generation })
    );
  });

  it('expires a generation exactly once', async () => {
    const { verification } = await createCase('guild-captcha-expiry', 'user-captcha-expiry');
    const challenges = new CaptchaChallengeRepository(prisma);
    const challenge = await challenges.create({
      verificationEventId: verification.id,
      serverId: verification.server_id,
      userId: verification.user_id,
      requestSource: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
      passEffect: CaptchaChallengePassEffect.VERIFY_JOIN_ONLY,
      caseRevision: verification.case_revision,
      tokenHash: 'expiry-hash',
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(challenges.expirePending(new Date(), 10)).resolves.toEqual([
      expect.objectContaining({ id: challenge.id, status: CaptchaChallengeStatus.EXPIRED }),
    ]);
    await expect(challenges.expirePending(new Date(), 10)).resolves.toEqual([]);
  });

  it('allows an immediate retry after challenge delivery fails', async () => {
    const { verification } = await createCase(
      'guild-captcha-delivery-retry',
      'user-captcha-delivery-retry'
    );
    const challenges = new CaptchaChallengeRepository(prisma);
    const initial = await challenges.create({
      verificationEventId: verification.id,
      serverId: verification.server_id,
      userId: verification.user_id,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: verification.case_revision,
      tokenHash: 'delivery-failed-hash',
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: 'moderator-1',
    });
    await challenges.recordDeliveryFailure(
      initial.id,
      initial.generation,
      'discord_delivery_failed'
    );

    await expect(
      challenges.retry({
        verificationEventId: verification.id,
        serverId: verification.server_id,
        userId: verification.user_id,
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
        passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
        caseRevision: verification.case_revision,
        tokenHash: 'delivery-retry-hash',
        expiresAt: new Date(Date.now() + 120_000),
        requestedBy: 'moderator-2',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        delivery_error_code: null,
        generation: 2,
        link_token_hash: 'delivery-retry-hash',
        status: CaptchaChallengeStatus.PENDING,
      })
    );
  });

  it('cancels pending challenges exactly once after the server disables the feature', async () => {
    const { verification } = await createCase('guild-captcha-disabled', 'user-captcha-disabled');
    const challenges = new CaptchaChallengeRepository(prisma);
    const challenge = await challenges.create({
      verificationEventId: verification.id,
      serverId: verification.server_id,
      userId: verification.user_id,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: verification.case_revision,
      tokenHash: 'disabled-hash',
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: 'moderator-1',
    });

    await expect(challenges.cancelPendingForDisabledServers(10)).resolves.toEqual([
      expect.objectContaining({ id: challenge.id, status: CaptchaChallengeStatus.CANCELLED }),
    ]);
    await expect(challenges.cancelPendingForDisabledServers(10)).resolves.toEqual([]);
  });

  it('retries a cancelled challenge after its case is reopened', async () => {
    const { verification } = await createCase('guild-captcha-reopened', 'user-captcha-reopened');
    const challenges = new CaptchaChallengeRepository(prisma);
    const challenge = await challenges.create({
      verificationEventId: verification.id,
      serverId: verification.server_id,
      userId: verification.user_id,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: verification.case_revision,
      tokenHash: 'cancelled-hash',
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: 'moderator-1',
    });
    await challenges.cancelPendingForCase(verification.id);

    await expect(
      challenges.retry({
        verificationEventId: verification.id,
        serverId: verification.server_id,
        userId: verification.user_id,
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
        passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
        caseRevision: verification.case_revision,
        tokenHash: 'reopened-hash',
        expiresAt: new Date(Date.now() + 120_000),
        requestedBy: 'moderator-2',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        cancelled_at: null,
        generation: challenge.generation + 1,
        status: CaptchaChallengeStatus.PENDING,
      })
    );
  });

  it('refuses exact-case CAPTCHA completion while another case is pending', async () => {
    const { verification } = await createCase(
      'guild-captcha-exact-case',
      'user-captcha-exact-case'
    );
    const verifications = new VerificationEventRepository(prisma);
    const challenges = new CaptchaChallengeRepository(prisma);
    const challenge = await challenges.create({
      verificationEventId: verification.id,
      serverId: verification.server_id,
      userId: verification.user_id,
      requestSource: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
      passEffect: CaptchaChallengePassEffect.VERIFY_JOIN_ONLY,
      caseRevision: verification.case_revision,
      tokenHash: 'exact-case-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const otherCase = await verifications.createFromDetection(
      null,
      verification.server_id,
      verification.user_id,
      VerificationStatus.PENDING
    );
    const completion = {
      challengeId: challenge.id,
      expectedCaseRevision: verification.case_revision,
      generation: challenge.generation,
      id: verification.id,
      resolvedAt: new Date(),
      resolvedBy: 'drasil:captcha',
      serverId: verification.server_id,
      userId: verification.user_id,
    };

    await expect(verifications.completeCaptchaVerification(completion)).resolves.toBeNull();
    await prisma.captcha_challenges.update({
      where: { id: challenge.id },
      data: { status: CaptchaChallengeStatus.PASSED, passed_at: new Date() },
    });
    await expect(
      verifications.completeCaptchaVerification({
        ...completion,
        challengeId: '2e35afe7-51bf-4b57-8807-699946696aa2',
      })
    ).resolves.toBeNull();
    await expect(
      verifications.completeCaptchaVerification({
        ...completion,
        generation: challenge.generation + 1,
      })
    ).resolves.toBeNull();
    await expect(verifications.completeCaptchaVerification(completion)).resolves.toBeNull();
    await verifications.update(otherCase.id, {
      resolved_at: new Date(),
      resolved_by: 'moderator-1',
      status: VerificationStatus.VERIFIED,
    });
    await verifications.update(verification.id, {
      containment_status: CaseContainmentStatus.IN_PROGRESS,
      quarantine_attempt_id: 'quarantine-race',
      quarantine_lease_renewed_at: new Date(),
      parked_at: new Date(),
      parked_by: 'moderator-2',
    });
    await expect(verifications.completeCaptchaVerification(completion)).resolves.toBeNull();
    await verifications.update(verification.id, {
      containment_status: CaseContainmentStatus.INCOMPLETE,
    });
    await expect(verifications.completeCaptchaVerification(completion)).resolves.toEqual(
      expect.objectContaining({
        id: verification.id,
        quarantine_attempt_id: null,
        quarantine_lease_renewed_at: null,
        parked_at: null,
        parked_by: null,
        resolved_by: 'drasil:captcha',
        status: VerificationStatus.VERIFIED,
      })
    );
  });

  it('increments case revision only when new evidence is linked', async () => {
    const { detections, verification } = await createCase(
      'guild-captcha-revision',
      'user-captcha-revision'
    );
    const added = await detections.create({
      server_id: verification.server_id,
      user_id: verification.user_id,
      detection_type: DetectionType.REJOIN_AFTER_KICK,
      confidence: 1,
      reasons: ['Rejoined'],
      detected_at: new Date(),
    });

    await detections.linkToVerificationEvent(added.id, verification.id);
    await detections.linkToVerificationEvent(added.id, verification.id);

    await expect(
      prisma.verification_events.findUnique({ where: { id: verification.id } })
    ).resolves.toEqual(expect.objectContaining({ case_revision: 1 }));
  });

  it('increments case revision once for each newly accepted subject message', async () => {
    const { verification } = await createCase(
      'guild-captcha-subject-evidence',
      'user-captcha-subject-evidence'
    );
    const verifications = new VerificationEventRepository(prisma);

    await expect(
      verifications.recordSubjectCaseEvidence(verification.id, 'message-1')
    ).resolves.toEqual(
      expect.objectContaining({
        case_revision: 1,
        metadata: expect.objectContaining({
          subject_evidence_message_ids: ['message-1'],
        }),
      })
    );
    await expect(
      verifications.recordSubjectCaseEvidence(verification.id, 'message-1')
    ).resolves.toBeNull();
    await expect(
      verifications.recordSubjectCaseEvidence(verification.id, 'message-2')
    ).resolves.toEqual(expect.objectContaining({ case_revision: 2 }));
  });
});
