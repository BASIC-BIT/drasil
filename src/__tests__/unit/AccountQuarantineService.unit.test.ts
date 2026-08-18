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
import { IAdminActionService } from '../../services/AdminActionService';
import {
  CaseRoleLockdownMemberAudit,
  CaseRoleLockdownReport,
  ICaseRoleLockdownService,
} from '../../services/CaseRoleLockdownService';
import { IModerationOutcomeService } from '../../services/ModerationOutcomeService';
import { IModerationQueueService } from '../../services/ModerationQueueService';
import { IRoleManager } from '../../services/RoleManager';
import {
  IRoleQuarantineService,
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
    ...overrides,
  };
}

function buildHarness(
  input: { enabled?: boolean; ready?: boolean; retainedPrivilegedRole?: boolean } = {}
) {
  const enabled = input.enabled ?? true;
  const ready = input.ready ?? true;
  const retainedPrivilegedRole = input.retainedPrivilegedRole ?? false;
  const containmentReady = ready && !retainedPrivilegedRole;
  const member = {
    id: 'user-1',
    guild: { id: 'guild-1' },
    user: {
      username: 'target',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    },
  } as unknown as GuildMember;
  const updatedEvent = {
    ...event,
    case_kind: CaseKind.COMPROMISED_ACCOUNT,
    attention_state: containmentReady
      ? CaseAttentionState.PARKED
      : CaseAttentionState.REVIEW_REQUIRED,
    containment_status: containmentReady
      ? CaseContainmentStatus.CONTAINED
      : CaseContainmentStatus.INCOMPLETE,
  };
  const verificationEvents = {
    update: jest.fn().mockResolvedValue(updatedEvent),
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
    moderationQueue
  );

  return {
    adminActions,
    lockdown,
    member,
    moderationOutcomes,
    moderationQueue,
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
    expect(harness.verificationEvents.update).toHaveBeenCalledWith(
      event.id,
      expect.objectContaining({
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.CONTAINED,
        parked_by: moderator.id,
      })
    );
    expect(harness.adminActions.recordAction).toHaveBeenCalledTimes(1);
    expect(harness.moderationOutcomes.recordOutcome).toHaveBeenCalledTimes(1);
    expect(harness.moderationQueue.deleteCaseMirror).toHaveBeenCalledWith(event.id);
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
    expect(harness.moderationOutcomes.recordOutcome).not.toHaveBeenCalled();
    expect(harness.moderationQueue.deleteCaseMirror).not.toHaveBeenCalled();
    expect(harness.moderationQueue.upsertCaseMirror).toHaveBeenCalled();
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
    expect(harness.verificationEvents.update).toHaveBeenCalledWith(
      event.id,
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
      })
    );
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
});
