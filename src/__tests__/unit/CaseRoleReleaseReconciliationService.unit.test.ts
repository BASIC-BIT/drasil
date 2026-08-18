import { CaseRoleReleaseReconciliationService } from '../../services/CaseRoleReleaseReconciliationService';
import {
  CASE_ATTENTION_ATTEMPT_PREFIX,
  CASE_ROLE_RELEASE_ATTEMPT_PREFIX,
  CASE_ROLE_RELEASE_LEASE_MS,
  CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX,
  isCaseRoleReleaseLeaseActive,
} from '../../utils/caseRoleRelease';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  RoleQuarantineSnapshotPurpose,
  RoleQuarantineSnapshotStatus,
  VerificationStatus,
} from '../../repositories/types';
import { InMemoryVerificationEventRepository } from '../fakes/inMemoryRepositories';

const readyLockdown = {
  enabled: true,
  issues: [],
  plannedActions: [],
  unsyncedAllowedChannels: [],
  errorCount: 0,
  warningCount: 0,
};
const readyMemberAudit = {
  memberId: 'user-1',
  bypasses: [],
  retainedPrivilegedRoleIds: [],
  retainedAdministratorRoleIds: [],
  unremovablePrivilegeReasons: [],
};

function buildService(options: {
  client: any;
  verificationEvents: InMemoryVerificationEventRepository;
  roleManager?: any;
  snapshots?: any;
  roleQuarantine?: any;
  lockdown?: any;
  config?: any;
  notifications?: any;
  queue?: any;
}): CaseRoleReleaseReconciliationService {
  return new CaseRoleReleaseReconciliationService(
    options.client,
    options.verificationEvents,
    options.roleManager ?? {
      assignCaseRole: jest.fn().mockResolvedValue(true),
      removeCaseRole: jest.fn(),
    },
    options.snapshots ?? { findActiveCompletedCompromised: jest.fn().mockResolvedValue([]) },
    options.roleQuarantine ?? { restoreMemberRoles: jest.fn() },
    options.lockdown ?? {
      auditGuild: jest.fn().mockResolvedValue(readyLockdown),
      auditMemberBypasses: jest.fn().mockResolvedValue(readyMemberAudit),
    },
    options.config ?? {
      getServerConfig: jest.fn().mockResolvedValue({ case_role_id: 'case-role-1' }),
    },
    options.notifications ?? {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    },
    options.queue ?? { upsertCaseMirror: jest.fn().mockResolvedValue(undefined) }
  );
}

describe('CaseRoleReleaseReconciliationService (unit)', () => {
  it('restores the case role with a non-release reconciliation claim', async () => {
    const now = new Date('2026-08-18T12:00:00.000Z');
    const staleBefore = new Date(now.getTime() - CASE_ROLE_RELEASE_LEASE_MS);
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T10:00:00.000Z'),
      parked_by: 'moderator-1',
    });
    await verificationEvents.claimCaseRoleRelease(
      verificationEvent.id,
      'guild-1',
      'user-1',
      `${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}crashed`,
      new Date(0)
    );
    await verificationEvents.update(verificationEvent.id, {
      quarantine_lease_renewed_at: staleBefore,
    });

    const member = { id: 'user-1', roles: { cache: new Map() } };
    const guild = { id: 'guild-1', members: { fetch: jest.fn().mockResolvedValue(member) } };
    const client = {
      guilds: { cache: new Map([['guild-1', guild]]), fetch: jest.fn() },
    };
    let reconciliationAttemptId: string | null = null;
    const roleManager = {
      assignCaseRole: jest.fn().mockImplementation(async () => {
        const claimed = await verificationEvents.findById(verificationEvent.id);
        reconciliationAttemptId = claimed?.quarantine_attempt_id ?? null;
        member.roles.cache.set('case-role-1', { id: 'case-role-1' });
        return true;
      }),
      removeCaseRole: jest.fn(),
    };
    const service = buildService({ client, verificationEvents, roleManager });

    await service.runOnce(now);

    expect(reconciliationAttemptId).toEqual(
      expect.stringMatching(`^${CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX}`)
    );
    expect(isCaseRoleReleaseLeaseActive(reconciliationAttemptId, new Date(), now)).toBe(false);
    expect(roleManager.assignCaseRole).toHaveBeenCalledWith(member);
    await expect(verificationEvents.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.CONTAINED,
        quarantine_attempt_id: null,
        quarantine_lease_renewed_at: null,
      })
    );
  });

  it('immediately surfaces a failed expired-release reconciliation', async () => {
    const now = new Date('2026-08-18T12:00:00.000Z');
    const staleBefore = new Date(now.getTime() - CASE_ROLE_RELEASE_LEASE_MS);
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
    });
    await verificationEvents.claimCaseRoleRelease(
      verificationEvent.id,
      'guild-1',
      'user-1',
      `${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}crashed`,
      new Date(0)
    );
    await verificationEvents.update(verificationEvent.id, {
      quarantine_lease_renewed_at: staleBefore,
    });
    const member = { id: 'user-1', roles: { cache: new Map() } };
    const guild = { id: 'guild-1', members: { fetch: jest.fn().mockResolvedValue(member) } };
    const notifications = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const queue = { upsertCaseMirror: jest.fn().mockResolvedValue(undefined) };
    const service = buildService({
      client: { guilds: { cache: new Map([['guild-1', guild]]), fetch: jest.fn() } },
      verificationEvents,
      roleManager: {
        assignCaseRole: jest.fn().mockResolvedValue(false),
        removeCaseRole: jest.fn(),
      },
      notifications,
      queue,
    });

    await service.runOnce(now);

    const updated = await verificationEvents.findById(verificationEvent.id);
    expect(updated).toEqual(
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
      })
    );
    expect(notifications.notifyAccountQuarantineAttention).toHaveBeenCalledWith(
      updated,
      'containment_incomplete'
    );
    expect(queue.upsertCaseMirror).toHaveBeenCalledWith(updated);
  });

  it('returns an expired quarantine-entry attempt to review automatically', async () => {
    const now = new Date('2026-08-18T12:00:00.000Z');
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.IN_PROGRESS,
      quarantine_attempt_id: 'abandoned-entry-attempt',
      quarantine_lease_renewed_at: new Date('2026-08-18T11:00:00.000Z'),
    });
    const notifications = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const queue = { upsertCaseMirror: jest.fn().mockResolvedValue(undefined) };
    const service = buildService({
      client: { guilds: { cache: new Map(), fetch: jest.fn() } },
      verificationEvents,
      notifications,
      queue,
    });

    await service.runOnce(now);

    const recovered = await verificationEvents.findById(verificationEvent.id);
    expect(recovered).toEqual(
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        quarantine_attempt_id: null,
        quarantine_lease_renewed_at: null,
      })
    );
    expect(notifications.notifyAccountQuarantineAttention).toHaveBeenCalledWith(
      recovered,
      'containment_incomplete'
    );
    expect(queue.upsertCaseMirror).toHaveBeenCalledWith(recovered);
  });

  it('returns an expired attention lease to durable moderator review', async () => {
    const now = new Date('2026-08-18T12:00:00.000Z');
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.IN_PROGRESS,
      quarantine_attempt_id: `${CASE_ATTENTION_ATTEMPT_PREFIX}abandoned`,
      quarantine_lease_renewed_at: new Date('2026-08-18T11:00:00.000Z'),
      parked_at: new Date('2026-08-18T10:00:00.000Z'),
      parked_by: 'moderator-1',
    });
    const notifications = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const queue = { upsertCaseMirror: jest.fn().mockResolvedValue(undefined) };
    const service = buildService({
      client: { guilds: { cache: new Map(), fetch: jest.fn() } },
      verificationEvents,
      notifications,
      queue,
    });

    await service.runOnce(now);

    await expect(verificationEvents.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        quarantine_attempt_id: null,
        parked_at: null,
        parked_by: null,
      })
    );
    expect(notifications.notifyAccountQuarantineAttention).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      'attention_delivery_incomplete'
    );
    expect(queue.upsertCaseMirror).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id })
    );
  });

  it('audits the persisted quarantine role after the configured case role changes', async () => {
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_case_role_id: 'original-case-role',
      parked_at: new Date('2026-08-18T10:00:00.000Z'),
      parked_by: 'moderator-1',
    });
    const member = {
      id: 'user-1',
      roles: { cache: new Map([['original-case-role', { id: 'original-case-role' }]]) },
    };
    const guild = { id: 'guild-1', members: { fetch: jest.fn().mockResolvedValue(member) } };
    const service = buildService({
      client: { guilds: { cache: new Map([['guild-1', guild]]), fetch: jest.fn() } },
      verificationEvents,
      config: {
        getServerConfig: jest.fn().mockResolvedValue({ case_role_id: 'replacement-case-role' }),
      },
    });

    await service.runOnce(new Date('2026-08-18T12:00:00.000Z'));

    await expect(verificationEvents.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.CONTAINED,
      })
    );
  });

  it('regresses and surfaces a parked case when periodic permission audit finds drift', async () => {
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
    });
    const member = {
      id: 'user-1',
      roles: { cache: new Map([['case-role-1', { id: 'case-role-1' }]]) },
    };
    const guild = { id: 'guild-1', members: { fetch: jest.fn().mockResolvedValue(member) } };
    const notifications = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const queue = { upsertCaseMirror: jest.fn().mockResolvedValue(undefined) };
    const service = buildService({
      client: { guilds: { cache: new Map([['guild-1', guild]]), fetch: jest.fn() } },
      verificationEvents,
      lockdown: {
        auditGuild: jest.fn().mockResolvedValue(readyLockdown),
        auditMemberBypasses: jest.fn().mockResolvedValue({
          ...readyMemberAudit,
          bypasses: [
            {
              channelId: 'channel-1',
              channelName: 'general',
              subjectType: 'member',
              subjectId: 'user-1',
              permissions: ['Send Messages'],
            },
          ],
        }),
      },
      notifications,
      queue,
    });

    await service.runOnce(new Date('2026-08-18T12:00:00.000Z'));

    const updated = await verificationEvents.findById(verificationEvent.id);
    expect(updated).toEqual(
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
      })
    );
    expect(notifications.notifyAccountQuarantineAttention).toHaveBeenCalledWith(
      updated,
      'containment_incomplete'
    );
    expect(queue.upsertCaseMirror).toHaveBeenCalledWith(updated);
  });

  it('resumes role restoration for a verified case with an active compromised snapshot', async () => {
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      status: VerificationStatus.VERIFIED,
      resolved_by: 'moderator-1',
      resolved_at: new Date(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
    });
    const snapshot = {
      id: 'snapshot-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      verification_event_id: verificationEvent.id,
      status: RoleQuarantineSnapshotStatus.ACTIVE,
      mode: 'on',
      purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
      original_role_ids: ['role-1'],
      planned_role_ids: ['role-1'],
      removed_role_ids: ['role-1'],
      restored_role_ids: [],
      skipped_roles: [],
      failed_removals: [],
      failed_restores: [],
      created_at: new Date(),
      updated_at: new Date(),
      restored_at: null,
      restored_by: null,
      metadata: {},
    };
    const member = { id: 'user-1' };
    const guild = { id: 'guild-1', members: { fetch: jest.fn().mockResolvedValue(member) } };
    const roleQuarantine = {
      restoreMemberRoles: jest.fn().mockResolvedValue({ status: 'restored' }),
    };
    const service = buildService({
      client: { guilds: { cache: new Map([['guild-1', guild]]), fetch: jest.fn() } },
      verificationEvents,
      snapshots: {
        findActiveCompletedCompromised: jest.fn().mockResolvedValue([snapshot]),
      },
      roleQuarantine,
    });

    await service.runOnce();

    expect(roleQuarantine.restoreMemberRoles).toHaveBeenCalledWith(member);
  });

  it('does not restore a prior membership snapshot after the user rejoins', async () => {
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      status: VerificationStatus.VERIFIED,
      resolved_by: 'moderator-1',
      resolved_at: new Date(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
    });
    const snapshot = {
      id: 'snapshot-rejoined',
      server_id: 'guild-1',
      user_id: 'user-1',
      verification_event_id: verificationEvent.id,
      status: RoleQuarantineSnapshotStatus.ACTIVE,
      mode: 'on',
      purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
      original_role_ids: ['role-1'],
      planned_role_ids: ['role-1'],
      removed_role_ids: ['role-1'],
      restored_role_ids: [],
      skipped_roles: [],
      failed_removals: [],
      failed_restores: [],
      created_at: new Date('2026-08-18T10:00:00.000Z'),
      updated_at: new Date(),
      restored_at: null,
      restored_by: null,
      metadata: {},
    };
    const member = { id: 'user-1', joinedAt: new Date('2026-08-18T11:00:00.000Z') };
    const guild = { id: 'guild-1', members: { fetch: jest.fn().mockResolvedValue(member) } };
    const roleQuarantine = {
      restoreMemberRoles: jest.fn(),
      abandonActiveSnapshot: jest.fn().mockResolvedValue({ status: 'abandoned' }),
    };
    const service = buildService({
      client: { guilds: { cache: new Map([['guild-1', guild]]), fetch: jest.fn() } },
      verificationEvents,
      snapshots: { findActiveCompletedCompromised: jest.fn().mockResolvedValue([snapshot]) },
      roleQuarantine,
    });

    await service.runOnce();

    expect(roleQuarantine.restoreMemberRoles).not.toHaveBeenCalled();
    expect(roleQuarantine.abandonActiveSnapshot).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'membership_replaced_before_role_restoration'
    );
  });

  it('retries an incomplete restoration alert when delivery returns false', async () => {
    const verificationEvents = new InMemoryVerificationEventRepository();
    const verificationEvent = await verificationEvents.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationEvents.update(verificationEvent.id, {
      status: VerificationStatus.VERIFIED,
      resolved_by: 'moderator-1',
      resolved_at: new Date(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
    });
    const snapshot = {
      id: 'snapshot-alert-retry',
      server_id: 'guild-1',
      user_id: 'user-1',
      verification_event_id: verificationEvent.id,
      status: RoleQuarantineSnapshotStatus.ACTIVE,
      mode: 'on',
      purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
      original_role_ids: ['role-1'],
      planned_role_ids: ['role-1'],
      removed_role_ids: ['role-1'],
      restored_role_ids: [],
      skipped_roles: [],
      failed_removals: [],
      failed_restores: [],
      created_at: new Date('2026-08-18T10:00:00.000Z'),
      updated_at: new Date(),
      restored_at: null,
      restored_by: null,
      metadata: {},
    };
    const member = { id: 'user-1', joinedAt: new Date('2026-08-18T09:00:00.000Z') };
    const guild = { id: 'guild-1', members: { fetch: jest.fn().mockResolvedValue(member) } };
    const notifications = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(false),
    };
    const service = buildService({
      client: { guilds: { cache: new Map([['guild-1', guild]]), fetch: jest.fn() } },
      verificationEvents,
      snapshots: { findActiveCompletedCompromised: jest.fn().mockResolvedValue([snapshot]) },
      roleQuarantine: {
        restoreMemberRoles: jest.fn().mockResolvedValue({ status: 'partially_restored' }),
      },
      notifications,
    });

    await service.runOnce();
    await service.runOnce();

    expect(notifications.notifyAccountQuarantineAttention).toHaveBeenCalledTimes(2);
  });
});
