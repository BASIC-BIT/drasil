import { PrismaClient } from '../../db/prisma';
import { AdminActionRepository } from '../../repositories/AdminActionRepository';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { ModerationOutcomeRepository } from '../../repositories/ModerationOutcomeRepository';
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
  RoleQuarantineSnapshotPurpose,
  VerificationStatus,
} from '../../repositories/types';
import { getPrismaClient } from '../testDb';

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
});
