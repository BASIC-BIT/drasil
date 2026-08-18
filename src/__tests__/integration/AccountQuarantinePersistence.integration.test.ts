import { PrismaClient } from '../../db/prisma';
import { AdminActionRepository } from '../../repositories/AdminActionRepository';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { ModerationOutcomeRepository } from '../../repositories/ModerationOutcomeRepository';
import { ModerationQueueRepository } from '../../repositories/ModerationQueueRepository';
import { RoleQuarantineSnapshotRepository } from '../../repositories/RoleQuarantineSnapshotRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import {
  AdminActionType,
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  DetectionType,
  ModerationOutcomeSource,
  ModerationOutcomeType,
  ModerationQueueItemType,
  RoleQuarantineSnapshotPurpose,
  VerificationStatus,
} from '../../repositories/types';
import { getPrismaClient } from '../testDb';
import { CASE_ROLE_RELEASE_LEASE_MS } from '../../utils/caseRoleRelease';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('compromised-account quarantine persistence (integration)', () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    prisma = getPrismaClient();
  });

  it('persists parked case state, queue classification, role provenance, and audit provenance', async () => {
    const serverId = 'guild-account-quarantine';
    const userId = 'user-account-quarantine';
    const moderatorId = 'moderator-account-quarantine';
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    const detections = new DetectionEventsRepository(prisma);
    const verifications = new VerificationEventRepository(prisma);
    const snapshots = new RoleQuarantineSnapshotRepository(prisma);
    const adminActions = new AdminActionRepository(prisma);
    const outcomes = new ModerationOutcomeRepository(prisma);

    await servers.getOrCreateServer(serverId);
    await users.getOrCreateUser(userId, 'target');
    const detection = await detections.create({
      server_id: serverId,
      user_id: userId,
      detection_type: DetectionType.ADMIN_FLAG,
      confidence: 1,
      reasons: ['Moderator-reported account compromise'],
      detected_at: new Date(),
    });
    const verification = await verifications.createFromDetection(
      detection.id,
      serverId,
      userId,
      VerificationStatus.PENDING
    );

    expect(verification).toEqual(
      expect.objectContaining({
        case_kind: CaseKind.STANDARD,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.NOT_APPLICABLE,
      })
    );

    const parkedAt = new Date('2026-08-18T12:00:00.000Z');
    await verifications.update(verification.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: parkedAt,
      parked_by: moderatorId,
    });
    await snapshots.create({
      serverId,
      userId,
      verificationEventId: verification.id,
      mode: 'on',
      purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
      originalRoleIds: ['role-1'],
      plannedRoleIds: ['role-1'],
      removedRoleIds: ['role-1'],
    });
    await adminActions.createAction({
      server_id: serverId,
      user_id: userId,
      admin_id: moderatorId,
      verification_event_id: verification.id,
      action_type: AdminActionType.QUARANTINE_COMPROMISED_ACCOUNT,
      previous_status: VerificationStatus.PENDING,
      new_status: VerificationStatus.PENDING,
      notes: 'Compromise report',
    });
    await outcomes.createOutcome({
      server_id: serverId,
      user_id: userId,
      detection_event_id: detection.id,
      verification_event_id: verification.id,
      outcome_type: ModerationOutcomeType.ACCOUNT_QUARANTINED,
      source: ModerationOutcomeSource.DRASIL,
      actor_id: moderatorId,
      reason: 'Compromise report',
    });

    await expect(verifications.findReviewablePendingByServer(serverId)).resolves.toEqual([]);
    await expect(verifications.findParkedByServer(serverId)).resolves.toEqual([
      expect.objectContaining({ id: verification.id, parked_by: moderatorId }),
    ]);
    await expect(verifications.findActiveByUserAndServer(userId, serverId)).resolves.toEqual(
      expect.objectContaining({ id: verification.id, attention_state: CaseAttentionState.PARKED })
    );
    await expect(snapshots.findActiveByServerAndUser(serverId, userId)).resolves.toEqual(
      expect.objectContaining({ purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT })
    );
    await expect(adminActions.findByVerificationEvent(verification.id)).resolves.toEqual([
      expect.objectContaining({ action_type: AdminActionType.QUARANTINE_COMPROMISED_ACCOUNT }),
    ]);
    await expect(outcomes.findByVerificationEvent(verification.id)).resolves.toEqual([
      expect.objectContaining({ outcome_type: ModerationOutcomeType.ACCOUNT_QUARANTINED }),
    ]);
  });

  it('atomically claims one quarantine attempt and permits stale-claim recovery', async () => {
    const serverId = 'guild-account-quarantine-claim';
    const userId = 'user-account-quarantine-claim';
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    const verifications = new VerificationEventRepository(prisma);
    const snapshots = new RoleQuarantineSnapshotRepository(prisma);

    await servers.getOrCreateServer(serverId);
    await users.getOrCreateUser(userId, 'target');
    const verification = await verifications.createFromDetection(
      null,
      serverId,
      userId,
      VerificationStatus.PENDING
    );
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);

    await expect(
      verifications.claimQuarantineAttempt(
        verification.id,
        serverId,
        userId,
        'attempt-1',
        staleBefore
      )
    ).resolves.toEqual(
      expect.objectContaining({
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        containment_status: CaseContainmentStatus.IN_PROGRESS,
        quarantine_attempt_id: 'attempt-1',
        quarantine_lease_renewed_at: expect.any(Date),
      })
    );
    await expect(
      verifications.claimQuarantineAttempt(
        verification.id,
        serverId,
        userId,
        'attempt-2',
        staleBefore
      )
    ).resolves.toBeNull();
    await expect(verifications.renewQuarantineAttempt(verification.id, 'attempt-1')).resolves.toBe(
      true
    );
    const snapshot = await snapshots.createForQuarantineAttempt(
      {
        serverId,
        userId,
        verificationEventId: verification.id,
        mode: 'on',
        purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
        originalRoleIds: ['role-1'],
        plannedRoleIds: ['role-1'],
      },
      verification.id,
      'attempt-1'
    );
    expect(snapshot).toEqual(expect.objectContaining({ removed_role_ids: [] }));
    if (!snapshot) {
      throw new Error('Expected an attempt-owned role quarantine snapshot');
    }
    await expect(
      verifications.update(verification.id, { status: VerificationStatus.VERIFIED })
    ).resolves.toBeNull();

    await verifications.update(verification.id, {
      quarantine_lease_renewed_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    await expect(
      verifications.claimQuarantineAttempt(
        verification.id,
        serverId,
        userId,
        'attempt-2',
        new Date()
      )
    ).resolves.toEqual(
      expect.objectContaining({
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        containment_status: CaseContainmentStatus.IN_PROGRESS,
        quarantine_attempt_id: 'attempt-2',
      })
    );
    await expect(verifications.renewQuarantineAttempt(verification.id, 'attempt-1')).resolves.toBe(
      false
    );
    await expect(
      verifications.updateQuarantineAttempt(verification.id, 'attempt-1', {
        containment_status: CaseContainmentStatus.CONTAINED,
      })
    ).resolves.toBeNull();
    await expect(
      snapshots.updateForQuarantineAttempt(
        snapshot.id,
        { removedRoleIds: ['stale-role'] },
        verification.id,
        'attempt-1'
      )
    ).resolves.toBeNull();
    await expect(
      snapshots.updateForQuarantineAttempt(
        snapshot.id,
        { removedRoleIds: ['role-1'] },
        verification.id,
        'attempt-2'
      )
    ).resolves.toEqual(expect.objectContaining({ removed_role_ids: ['role-1'] }));

    const parked = await verifications.updateQuarantineAttempt(verification.id, 'attempt-2', {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date(),
      parked_by: 'moderator-1',
    });
    expect(parked).toEqual(
      expect.objectContaining({
        attention_state: CaseAttentionState.PARKED,
        quarantine_attempt_id: null,
      })
    );

    const resolved = await verifications.update(verification.id, {
      status: VerificationStatus.VERIFIED,
      resolved_by: 'moderator-1',
    });
    expect(resolved).toEqual(
      expect.objectContaining({
        status: VerificationStatus.VERIFIED,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.NOT_APPLICABLE,
        parked_at: null,
        parked_by: null,
      })
    );

    const reopened = await verifications.update(verification.id, {
      status: VerificationStatus.PENDING,
    });
    expect(reopened).toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        case_kind: CaseKind.STANDARD,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.NOT_APPLICABLE,
        quarantine_lease_renewed_at: null,
        parked_at: null,
        parked_by: null,
      })
    );
  });

  it('atomically claims and reclaims an expired parked case-role release', async () => {
    const serverId = 'guild-case-role-release-claim';
    const userId = 'user-case-role-release-claim';
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    const verifications = new VerificationEventRepository(prisma);

    await servers.getOrCreateServer(serverId);
    await users.getOrCreateUser(userId, 'target');
    const verification = await verifications.createFromDetection(
      null,
      serverId,
      userId,
      VerificationStatus.PENDING
    );
    await verifications.update(verification.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date(),
      parked_by: 'moderator-1',
    });

    const staleBefore = new Date(Date.now() - CASE_ROLE_RELEASE_LEASE_MS);
    await expect(
      verifications.claimCaseRoleRelease(
        verification.id,
        serverId,
        userId,
        'case-role-release:1',
        staleBefore
      )
    ).resolves.toEqual(
      expect.objectContaining({
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.IN_PROGRESS,
        quarantine_attempt_id: 'case-role-release:1',
        quarantine_lease_renewed_at: expect.any(Date),
      })
    );
    await expect(
      verifications.claimCaseRoleRelease(
        verification.id,
        serverId,
        userId,
        'case-role-release:2',
        staleBefore
      )
    ).resolves.toBeNull();

    await prisma.verification_events.update({
      where: { id: verification.id },
      data: { quarantine_lease_renewed_at: staleBefore },
    });
    await expect(verifications.findExpiredCaseRoleReleases(staleBefore)).resolves.toEqual([
      expect.objectContaining({ id: verification.id }),
    ]);
    const reclaimed = await verifications.claimCaseRoleRelease(
      verification.id,
      serverId,
      userId,
      'case-role-release:2',
      staleBefore
    );
    expect(reclaimed).toEqual(
      expect.objectContaining({
        containment_status: CaseContainmentStatus.IN_PROGRESS,
        quarantine_attempt_id: 'case-role-release:2',
        quarantine_lease_renewed_at: expect.any(Date),
      })
    );
    await expect(
      verifications.completeCaseRoleRelease(
        verification.id,
        'case-role-release:wrong',
        'moderator-verify',
        new Date(),
        reclaimed?.metadata ?? {}
      )
    ).resolves.toBeNull();

    await verifications.update(
      verification.id,
      {
        status: VerificationStatus.BANNED,
        resolved_by: 'moderator-ban',
        resolved_at: new Date(),
      },
      { allowQuarantineOverride: true }
    );
    await expect(
      verifications.completeCaseRoleRelease(
        verification.id,
        'case-role-release:2',
        'moderator-verify',
        new Date(),
        reclaimed?.metadata ?? {}
      )
    ).resolves.toBeNull();
    await expect(
      verifications.rollbackCaseRoleRelease(verification.id, 'case-role-release:2')
    ).resolves.toBeNull();
    await expect(verifications.findById(verification.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.BANNED,
        resolved_by: 'moderator-ban',
      })
    );
  });

  it('rolls back every case when an atomic verification release conflicts', async () => {
    const serverId = 'guild-atomic-verification-release';
    const userId = 'user-atomic-verification-release';
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    const verifications = new VerificationEventRepository(prisma);
    await servers.getOrCreateServer(serverId);
    await users.getOrCreateUser(userId, 'target');
    const parkedCase = await verifications.createFromDetection(
      null,
      serverId,
      userId,
      VerificationStatus.PENDING
    );
    const conflictingCase = await verifications.createFromDetection(
      null,
      serverId,
      userId,
      VerificationStatus.PENDING
    );
    await verifications.update(parkedCase.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date(),
      parked_by: 'moderator-parked',
    });
    await verifications.claimCaseRoleRelease(
      parkedCase.id,
      serverId,
      userId,
      'case-role-release:atomic',
      new Date(0)
    );
    await verifications.update(conflictingCase.id, {
      containment_status: CaseContainmentStatus.IN_PROGRESS,
      quarantine_attempt_id: 'quarantine:concurrent',
      quarantine_lease_renewed_at: new Date(),
    });

    await expect(
      verifications.completeVerificationRelease(
        [
          {
            id: parkedCase.id,
            metadata: parkedCase.metadata,
            requiresCaseRoleReleaseClaim: true,
          },
          {
            id: conflictingCase.id,
            metadata: conflictingCase.metadata,
            requiresCaseRoleReleaseClaim: false,
          },
        ],
        'case-role-release:atomic',
        'moderator-verify',
        new Date()
      )
    ).resolves.toBeNull();
    await expect(verifications.findById(parkedCase.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        containment_status: CaseContainmentStatus.IN_PROGRESS,
        quarantine_attempt_id: 'case-role-release:atomic',
      })
    );
    await expect(verifications.findById(conflictingCase.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        quarantine_attempt_id: 'quarantine:concurrent',
      })
    );
  });

  it('stores same-channel quarantine breaches separately for each case', async () => {
    const serverId = 'guild-quarantine-breach-attention';
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    const verifications = new VerificationEventRepository(prisma);
    const queue = new ModerationQueueRepository(prisma);
    await servers.getOrCreateServer(serverId);
    await users.getOrCreateUser('user-breach-1', 'target-1');
    await users.getOrCreateUser('user-breach-2', 'target-2');
    const firstCase = await verifications.createFromDetection(
      null,
      serverId,
      'user-breach-1',
      VerificationStatus.PENDING
    );
    const secondCase = await verifications.createFromDetection(
      null,
      serverId,
      'user-breach-2',
      VerificationStatus.PENDING
    );

    await queue.upsert({
      serverId,
      userId: 'user-breach-1',
      itemType: ModerationQueueItemType.QUARANTINE_BREACH_ATTENTION,
      verificationEventId: firstCase.id,
      sourceThreadId: 'general-channel',
    });
    await queue.upsert({
      serverId,
      userId: 'user-breach-2',
      itemType: ModerationQueueItemType.QUARANTINE_BREACH_ATTENTION,
      verificationEventId: secondCase.id,
      sourceThreadId: 'general-channel',
    });

    await expect(queue.listByServer(serverId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ verification_event_id: firstCase.id }),
        expect.objectContaining({ verification_event_id: secondCase.id }),
      ])
    );
  });

  it('preserves pending-screening queue items without a case, detection, or thread identity', async () => {
    const serverId = 'guild-pending-screening-identity';
    const userId = 'user-pending-screening-identity';
    const servers = new ServerRepository(prisma);
    const users = new UserRepository(prisma);
    const queue = new ModerationQueueRepository(prisma);
    await servers.getOrCreateServer(serverId);
    await users.getOrCreateUser(userId, 'pending-target');

    await expect(
      queue.upsert({
        serverId,
        userId,
        itemType: ModerationQueueItemType.PENDING_SCREENING_MEMBER,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        item_type: ModerationQueueItemType.PENDING_SCREENING_MEMBER,
        verification_event_id: null,
        detection_event_id: null,
        source_thread_id: null,
      })
    );
  });
});
