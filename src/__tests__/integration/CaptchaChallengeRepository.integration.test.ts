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

  it('refuses exact-case CAPTCHA completion while another case is pending', async () => {
    const { verification } = await createCase(
      'guild-captcha-exact-case',
      'user-captcha-exact-case'
    );
    const verifications = new VerificationEventRepository(prisma);
    const otherCase = await verifications.createFromDetection(
      null,
      verification.server_id,
      verification.user_id,
      VerificationStatus.PENDING
    );
    const completion = {
      challengeId: 'challenge-exact-case',
      expectedCaseRevision: verification.case_revision,
      generation: 1,
      id: verification.id,
      resolvedAt: new Date(),
      resolvedBy: 'drasil:captcha',
      serverId: verification.server_id,
      userId: verification.user_id,
    };

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
});
