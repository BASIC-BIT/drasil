import { GuildMember, User } from 'discord.js';
import { IConfigService } from '../../config/ConfigService';
import { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  RoleQuarantineSnapshotPurpose,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';
import { AccountQuarantineService } from '../../services/AccountQuarantineService';
import { IActiveAccountQuarantineCache } from '../../services/ActiveAccountQuarantineCache';
import { IAdminActionService } from '../../services/AdminActionService';
import {
  CaseRoleLockdownMemberAudit,
  CaseRoleLockdownReport,
  ICaseRoleLockdownService,
} from '../../services/CaseRoleLockdownService';
import { IModerationOutcomeService } from '../../services/ModerationOutcomeService';
import { IModerationQueueService } from '../../services/ModerationQueueService';
import { INotificationManager } from '../../services/NotificationManager';
import { IRoleManager } from '../../services/RoleManager';
import {
  IRoleQuarantineService,
  RoleQuarantineApplyError,
  RoleQuarantineApplyResult,
  RoleQuarantinePreviewResult,
} from '../../services/RoleQuarantineService';

const event: VerificationEvent = {
  id: 'case-1',
  server_id: 'guild-1',
  user_id: 'user-1',
  detection_event_id: 'detection-1',
  thread_id: 'thread-1',
  private_evidence_thread_id: 'evidence-1',
  notification_channel_id: 'admin-1',
  notification_message_id: 'message-1',
  status: VerificationStatus.PENDING,
  case_revision: 0,
  created_at: new Date(),
  updated_at: new Date(),
  resolved_at: null,
  resolved_by: null,
  notes: null,
  metadata: {},
};

const rolePreview: RoleQuarantinePreviewResult = {
  purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
  originalRoleIds: ['role-1'],
  plannedRoleIds: ['role-1'],
  privilegedRoleIds: ['role-1'],
  skippedRoles: [],
};

const roleResult: RoleQuarantineApplyResult = {
  status: 'quarantined',
  mode: 'on',
  purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
  snapshotId: 'snapshot-1',
  originalRoleIds: ['role-1'],
  plannedRoleIds: ['role-1'],
  removedRoleIds: ['role-1'],
  skippedRoles: [],
  failedRemovals: [],
};

function lockdownReport(overrides: Partial<CaseRoleLockdownReport> = {}): CaseRoleLockdownReport {
  return {
    guildId: 'guild-1',
    checkedAt: new Date(),
    enabled: true,
    allowedChannelIds: [],
    allowedCategoryIds: [],
    autoAllowedChannelIds: [],
    issues: [],
    plannedActions: [],
    appliedActions: [],
    failedActions: [],
    syncedAllowedChannels: [],
    unsyncedAllowedChannels: [],
    errorCount: 0,
    warningCount: 0,
    ...overrides,
  };
}

function memberAudit(
  overrides: Partial<CaseRoleLockdownMemberAudit> = {}
): CaseRoleLockdownMemberAudit {
  return {
    memberId: 'user-1',
    bypasses: [],
    retainedPrivilegedRoleIds: [],
    retainedAdministratorRoleIds: [],
    unremovablePrivilegeReasons: [],
    ...overrides,
  };
}

function buildHarness(
  input: { enabled?: boolean; ready?: boolean; retainedPrivilegedRole?: boolean } = {}
) {
  const enabled = input.enabled ?? true;
  const ready = input.ready ?? true;
  const retainedPrivilegedRole = input.retainedPrivilegedRole ?? false;
  const member = {
    id: 'user-1',
    guild: { id: 'guild-1' },
    user: {
      username: 'target',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    },
  } as unknown as GuildMember;
  const verificationEvents = {
    claimQuarantineAttempt: jest.fn().mockResolvedValue({
      ...event,
      containment_status: CaseContainmentStatus.IN_PROGRESS,
    }),
    renewQuarantineAttempt: jest.fn().mockResolvedValue(true),
    recordQuarantineCaseRole: jest.fn().mockResolvedValue(true),
    updateQuarantineAttempt: jest
      .fn()
      .mockImplementation(
        async (_id: string, _attemptId: string, data: Partial<VerificationEvent>) => ({
          ...event,
          ...data,
        })
      ),
    update: jest.fn().mockImplementation(async (_id: string, data: Partial<VerificationEvent>) => ({
      ...event,
      ...data,
    })),
  } as unknown as jest.Mocked<IVerificationEventRepository>;
  const roleQuarantine = {
    previewCompromisedAccount: jest.fn().mockResolvedValue(rolePreview),
    quarantineCompromisedAccount: jest.fn().mockResolvedValue(roleResult),
  } as unknown as jest.Mocked<IRoleQuarantineService>;
  const lockdown = {
    auditGuild: jest.fn().mockResolvedValue(
      ready
        ? lockdownReport()
        : lockdownReport({
            plannedActions: [{ scope: 'channel', channelId: 'channel-1', channelName: 'general' }],
          })
    ),
    auditMemberBypasses: jest.fn().mockResolvedValue(
      memberAudit({
        retainedPrivilegedRoleIds: retainedPrivilegedRole ? ['privileged-role'] : [],
      })
    ),
  } as unknown as jest.Mocked<ICaseRoleLockdownService>;
  const roleManager = {
    assignCaseRole: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<IRoleManager>;
  const adminActions = {
    recordAction: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<IAdminActionService>;
  const moderationOutcomes = {
    recordOutcome: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<IModerationOutcomeService>;
  const moderationQueue = {
    deleteCaseMirror: jest.fn().mockResolvedValue(undefined),
    upsertCaseMirror: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IModerationQueueService>;
  const notificationManager = {
    logActionToMessage: jest.fn().mockResolvedValue(true),
    updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<INotificationManager>;
  const activeQuarantineCache = {
    getActiveUserIds: jest.fn(),
    noteActive: jest.fn(),
  } as unknown as jest.Mocked<IActiveAccountQuarantineCache>;
  const service = new AccountQuarantineService(
    {
      getServerConfig: jest.fn().mockResolvedValue({
        case_role_id: 'case-role',
        settings: { account_quarantine_enabled: enabled },
      }),
    } as unknown as IConfigService,
    verificationEvents,
    roleQuarantine,
    lockdown,
    roleManager,
    adminActions,
    moderationOutcomes,
    moderationQueue,
    notificationManager,
    activeQuarantineCache
  );

  return {
    adminActions,
    activeQuarantineCache,
    lockdown,
    member,
    moderationOutcomes,
    moderationQueue,
    notificationManager,
    roleManager,
    roleQuarantine,
    service,
    verificationEvents,
  };
}

describe('AccountQuarantineService', () => {
  it('previews privileged-role removal and containment readiness without mutating Discord', async () => {
    const harness = buildHarness();

    const preview = await harness.service.preview(harness.member, event);

    expect(preview.canContain).toBe(true);
    expect(preview.rolePreview.privilegedRoleIds).toEqual(['role-1']);
    expect(harness.roleQuarantine.quarantineCompromisedAccount).not.toHaveBeenCalled();
    expect(harness.roleManager.assignCaseRole).not.toHaveBeenCalled();
  });

  it('parks only after roles, case role, and lockdown checks are complete', async () => {
    const harness = buildHarness();
    const moderator = { id: 'moderator-1' } as User;

    const result = await harness.service.quarantine(
      harness.member,
      event,
      moderator,
      'Owner reported the account compromised.'
    );

    expect(result.status).toBe('parked');
    expect(harness.verificationEvents.updateQuarantineAttempt).toHaveBeenCalledWith(
      event.id,
      expect.any(String),
      expect.objectContaining({
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.CONTAINED,
        parked_by: moderator.id,
        quarantine_case_role_id: 'case-role',
      })
    );
    expect(harness.verificationEvents.recordQuarantineCaseRole).toHaveBeenCalledWith(
      event.id,
      expect.any(String),
      'case-role'
    );
    expect(
      harness.verificationEvents.recordQuarantineCaseRole.mock.invocationCallOrder[0]
    ).toBeLessThan(harness.roleManager.assignCaseRole.mock.invocationCallOrder[0]);
    expect(harness.adminActions.recordAction).toHaveBeenCalledTimes(1);
    expect(harness.moderationOutcomes.recordOutcome).toHaveBeenCalledTimes(1);
    expect(harness.notificationManager.logActionToMessage).toHaveBeenCalled();
    expect(harness.notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      expect.objectContaining({ attention_state: CaseAttentionState.PARKED }),
      VerificationStatus.PENDING
    );
    expect(harness.moderationQueue.deleteCaseMirror).toHaveBeenCalledWith(event.id);
    expect(harness.roleQuarantine.quarantineCompromisedAccount).toHaveBeenCalledTimes(2);
    expect(harness.lockdown.auditGuild).toHaveBeenCalledTimes(2);
    expect(harness.lockdown.auditMemberBypasses).toHaveBeenCalledTimes(2);
  });

  it('returns the committed parked result when queue cleanup fails', async () => {
    const harness = buildHarness();
    harness.moderationQueue.deleteCaseMirror.mockRejectedValue(new Error('Queue unavailable'));

    const result = await harness.service.quarantine(
      harness.member,
      event,
      { id: 'moderator-1' } as User,
      'Compromise report'
    );

    expect(result.status).toBe('parked');
    expect(result.verificationEvent).toEqual(
      expect.objectContaining({ attention_state: CaseAttentionState.PARKED })
    );
  });

  it('passes a live attempt-ownership guard into every compromised role sweep', async () => {
    const harness = buildHarness();
    harness.roleQuarantine.quarantineCompromisedAccount.mockImplementation(
      async (_member, _event, _moderator, attemptFence) => {
        await attemptFence.assertOwner();
        return roleResult;
      }
    );

    await harness.service.quarantine(
      harness.member,
      event,
      { id: 'moderator-1' } as User,
      'Compromise report'
    );

    expect(harness.roleQuarantine.quarantineCompromisedAccount).toHaveBeenCalledTimes(2);
    expect(harness.verificationEvents.renewQuarantineAttempt).toHaveBeenCalled();
  });

  it('captures a role added during containment in the final role sweep', async () => {
    const harness = buildHarness();
    harness.roleQuarantine.quarantineCompromisedAccount
      .mockResolvedValueOnce({ ...roleResult, removedRoleIds: [] })
      .mockResolvedValueOnce({
        ...roleResult,
        originalRoleIds: ['role-1', 'late-role'],
        plannedRoleIds: ['role-1', 'late-role'],
        removedRoleIds: ['role-1', 'late-role'],
      });

    await harness.service.quarantine(
      harness.member,
      event,
      { id: 'moderator-1' } as User,
      'Compromise report'
    );

    expect(harness.verificationEvents.updateQuarantineAttempt).toHaveBeenCalledWith(
      event.id,
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({
          account_quarantine: expect.objectContaining({
            removed_role_ids: ['role-1', 'late-role'],
          }),
        }),
      })
    );
  });

  it('keeps an incompletely contained account in review and reports it to the queue', async () => {
    const harness = buildHarness({ ready: false });

    const result = await harness.service.quarantine(
      harness.member,
      event,
      { id: 'moderator-1' } as User,
      'Compromise report'
    );

    expect(result.status).toBe('incomplete');
    expect(harness.activeQuarantineCache.noteActive).toHaveBeenCalledWith('guild-1', 'user-1');
    expect(harness.moderationOutcomes.recordOutcome).not.toHaveBeenCalled();
    expect(harness.moderationQueue.deleteCaseMirror).not.toHaveBeenCalled();
    expect(harness.moderationQueue.upsertCaseMirror).toHaveBeenCalled();
  });

  it('returns the committed incomplete result when queue mirroring fails', async () => {
    const harness = buildHarness({ ready: false });
    harness.moderationQueue.upsertCaseMirror.mockRejectedValue(new Error('Queue unavailable'));

    const result = await harness.service.quarantine(
      harness.member,
      event,
      { id: 'moderator-1' } as User,
      'Compromise report'
    );

    expect(result.status).toBe('incomplete');
    expect(result.verificationEvent).toEqual(
      expect.objectContaining({ attention_state: CaseAttentionState.REVIEW_REQUIRED })
    );
  });

  it('does not park while an unmanageable privileged role remains', async () => {
    const harness = buildHarness({ retainedPrivilegedRole: true });

    const preview = await harness.service.preview(harness.member, event);
    const result = await harness.service.quarantine(
      harness.member,
      event,
      { id: 'moderator-1' } as User,
      'Compromise report'
    );

    expect(preview.canContain).toBe(false);
    expect(result.status).toBe('incomplete');
    expect(harness.verificationEvents.updateQuarantineAttempt).toHaveBeenCalledWith(
      event.id,
      expect.any(String),
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
      })
    );
    expect(harness.moderationOutcomes.recordOutcome).not.toHaveBeenCalled();
  });

  it('does not park while guild ownership or everyone permissions bypass containment', async () => {
    const harness = buildHarness();
    harness.lockdown.auditMemberBypasses.mockResolvedValue(
      memberAudit({ unremovablePrivilegeReasons: ['guild_owner'] })
    );

    const preview = await harness.service.preview(harness.member, event);
    const result = await harness.service.quarantine(
      harness.member,
      event,
      { id: 'moderator-1' } as User,
      'Compromise report'
    );

    expect(preview.canContain).toBe(false);
    expect(result.status).toBe('incomplete');
    expect(harness.moderationOutcomes.recordOutcome).not.toHaveBeenCalled();
  });

  it('refuses to quarantine when the feature is disabled', async () => {
    const harness = buildHarness({ enabled: false });

    await expect(
      harness.service.quarantine(
        harness.member,
        event,
        { id: 'moderator-1' } as User,
        'Compromise report'
      )
    ).rejects.toThrow('disabled');
    expect(harness.roleQuarantine.quarantineCompromisedAccount).not.toHaveBeenCalled();
  });

  it('rejects a concurrent quarantine attempt before mutating Discord', async () => {
    const harness = buildHarness();
    harness.verificationEvents.claimQuarantineAttempt.mockResolvedValueOnce(null);

    await expect(
      harness.service.quarantine(
        harness.member,
        event,
        { id: 'moderator-1' } as User,
        'Compromise report'
      )
    ).rejects.toThrow('another quarantine attempt is in progress');

    expect(harness.roleQuarantine.quarantineCompromisedAccount).not.toHaveBeenCalled();
    expect(harness.roleManager.assignCaseRole).not.toHaveBeenCalled();
  });

  it('stops before assigning the case role when the attempt lease is lost', async () => {
    const harness = buildHarness();
    harness.verificationEvents.renewQuarantineAttempt.mockResolvedValueOnce(false);
    harness.verificationEvents.updateQuarantineAttempt.mockResolvedValueOnce(null);

    await expect(
      harness.service.quarantine(
        harness.member,
        event,
        { id: 'moderator-1' } as User,
        'Compromise report'
      )
    ).rejects.toThrow('superseded');

    expect(harness.roleManager.assignCaseRole).not.toHaveBeenCalled();
    expect(harness.moderationQueue.deleteCaseMirror).not.toHaveBeenCalled();
  });

  it('records and surfaces a failed attempt before role removal completes', async () => {
    const harness = buildHarness();
    harness.roleQuarantine.quarantineCompromisedAccount.mockRejectedValueOnce(
      new Error('Discord unavailable')
    );

    await expect(
      harness.service.quarantine(
        harness.member,
        event,
        { id: 'moderator-1' } as User,
        'Compromise report'
      )
    ).rejects.toThrow('Discord unavailable');

    expect(harness.verificationEvents.updateQuarantineAttempt).toHaveBeenCalledWith(
      event.id,
      expect.any(String),
      expect.objectContaining({
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        parked_at: null,
        parked_by: null,
      })
    );
    expect(harness.adminActions.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          result: 'failed',
          failure_stage: 'role_removal',
        }),
      })
    );
    expect(harness.notificationManager.updateNotificationButtons).toHaveBeenCalled();
    expect(harness.moderationQueue.upsertCaseMirror).toHaveBeenCalled();
  });

  it('surfaces partial role removal when applying the case role fails', async () => {
    const harness = buildHarness();
    harness.roleManager.assignCaseRole.mockRejectedValueOnce(new Error('Missing permissions'));

    await expect(
      harness.service.quarantine(
        harness.member,
        event,
        { id: 'moderator-1' } as User,
        'Compromise report'
      )
    ).rejects.toThrow('Missing permissions');

    expect(harness.verificationEvents.updateQuarantineAttempt).toHaveBeenCalledWith(
      event.id,
      expect.any(String),
      expect.objectContaining({
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        metadata: expect.objectContaining({
          account_quarantine: expect.objectContaining({
            result: 'failed',
            failure_stage: 'case_role_assignment',
            removed_role_ids: ['role-1'],
            snapshot_id: 'snapshot-1',
          }),
        }),
      })
    );
    expect(harness.adminActions.recordAction).toHaveBeenCalled();
    expect(harness.notificationManager.logActionToMessage).not.toHaveBeenCalled();
    expect(harness.notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      expect.objectContaining({ containment_status: CaseContainmentStatus.INCOMPLETE }),
      VerificationStatus.PENDING
    );
    expect(harness.moderationQueue.upsertCaseMirror).toHaveBeenCalled();
  });

  it('persists partial role effects when snapshot finalization fails', async () => {
    const harness = buildHarness();
    harness.roleQuarantine.quarantineCompromisedAccount.mockRejectedValueOnce(
      new RoleQuarantineApplyError('Snapshot write failed', roleResult)
    );

    await expect(
      harness.service.quarantine(
        harness.member,
        event,
        { id: 'moderator-1' } as User,
        'Compromise report'
      )
    ).rejects.toThrow('Snapshot write failed');

    expect(harness.verificationEvents.updateQuarantineAttempt).toHaveBeenCalledWith(
      event.id,
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({
          account_quarantine: expect.objectContaining({
            failure_stage: 'role_removal',
            removed_role_ids: ['role-1'],
            snapshot_id: 'snapshot-1',
          }),
        }),
      })
    );
  });

  it('records state-persistence rejection as a failed attempt', async () => {
    const harness = buildHarness();
    harness.verificationEvents.updateQuarantineAttempt
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockImplementationOnce(async (_id, _attemptId, data) => ({ ...event, ...data }));

    await expect(
      harness.service.quarantine(
        harness.member,
        event,
        { id: 'moderator-1' } as User,
        'Compromise report'
      )
    ).rejects.toThrow('Database unavailable');

    expect(harness.verificationEvents.updateQuarantineAttempt).toHaveBeenLastCalledWith(
      event.id,
      expect.any(String),
      expect.objectContaining({
        containment_status: CaseContainmentStatus.INCOMPLETE,
        metadata: expect.objectContaining({
          account_quarantine: expect.objectContaining({
            failure_stage: 'case_state_persistence',
            removed_role_ids: ['role-1'],
          }),
        }),
      })
    );
    expect(harness.notificationManager.updateNotificationButtons).toHaveBeenCalled();
    expect(harness.moderationQueue.upsertCaseMirror).toHaveBeenCalled();
  });

  it('keeps parked surfaces current when the audit write fails', async () => {
    const harness = buildHarness();
    harness.adminActions.recordAction.mockRejectedValueOnce(new Error('Audit unavailable'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      harness.service.quarantine(
        harness.member,
        event,
        { id: 'moderator-1' } as User,
        'Compromise report'
      )
    ).resolves.toEqual(expect.objectContaining({ status: 'parked' }));

    expect(harness.notificationManager.updateNotificationButtons).toHaveBeenCalled();
    expect(harness.moderationQueue.deleteCaseMirror).toHaveBeenCalledWith(event.id);
    errorSpy.mockRestore();
  });
});
