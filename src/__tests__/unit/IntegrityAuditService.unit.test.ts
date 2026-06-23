import { Guild } from 'discord.js';
import { IntegrityAuditService } from '../../services/IntegrityAuditService';
import {
  IntegrityAuditCandidates,
  IIntegrityAuditRepository,
} from '../../repositories/IntegrityAuditRepository';
import {
  AdminActionType,
  ModerationOutcomeSource,
  ModerationOutcomeType,
  ModerationQueueItemType,
  RoleQuarantineSnapshotStatus,
  VerificationStatus,
} from '../../repositories/types';

const baseDate = new Date('2026-01-01T00:00:00.000Z');

function buildCandidates(
  overrides: Partial<IntegrityAuditCandidates> = {}
): IntegrityAuditCandidates {
  return {
    pendingVerificationEvents: [],
    recentResolvedVerificationEvents: [],
    caseRoleMembers: [],
    activeRoleQuarantineSnapshots: [],
    moderationQueueItems: [],
    ...overrides,
  };
}

describe('IntegrityAuditService (unit)', () => {
  it('reports live Discord drift and missing durable rows without mutating state', async () => {
    const candidates = buildCandidates({
      pendingVerificationEvents: [
        {
          id: 'pending-1',
          server_id: 'guild-1',
          user_id: 'user-pending',
          detection_event_id: null,
          thread_id: 'thread-1',
          private_evidence_thread_id: null,
          notification_channel_id: 'notify-channel-1',
          notification_message_id: 'notify-message-1',
          status: VerificationStatus.PENDING,
          created_at: baseDate,
          updated_at: baseDate,
          resolved_at: null,
          resolved_by: null,
          notes: null,
          metadata: {},
          admin_actions: [],
          moderation_outcomes: [],
        },
      ],
      recentResolvedVerificationEvents: [
        {
          id: 'resolved-1',
          server_id: 'guild-1',
          user_id: 'user-resolved',
          detection_event_id: null,
          thread_id: 'thread-2',
          private_evidence_thread_id: null,
          notification_channel_id: 'notify-channel-1',
          notification_message_id: 'notify-message-2',
          status: VerificationStatus.BANNED,
          created_at: baseDate,
          updated_at: baseDate,
          resolved_at: baseDate,
          resolved_by: 'admin-1',
          notes: null,
          metadata: {},
          admin_actions: [
            {
              id: 'action-1',
              server_id: 'guild-1',
              user_id: 'user-resolved',
              admin_id: 'admin-1',
              verification_event_id: 'resolved-1',
              detection_event_id: null,
              action_type: AdminActionType.OPEN_CASE,
              action_at: baseDate,
              previous_status: null,
              new_status: VerificationStatus.PENDING,
              notes: null,
              metadata: {},
            },
          ],
          moderation_outcomes: [],
        },
      ],
      caseRoleMembers: [
        {
          server_id: 'guild-1',
          user_id: 'user-restricted',
          join_date: baseDate,
          case_role_active: true,
          last_verified_at: null,
          last_message_at: null,
          verification_status: VerificationStatus.PENDING,
          last_status_change: baseDate,
          created_by: null,
          updated_by: null,
        },
      ],
      activeRoleQuarantineSnapshots: [
        {
          id: 'snapshot-1',
          server_id: 'guild-1',
          user_id: 'user-restricted',
          verification_event_id: null,
          status: RoleQuarantineSnapshotStatus.ACTIVE,
          mode: 'automatic',
          original_role_ids: ['role-a'],
          planned_role_ids: [],
          removed_role_ids: ['role-a'],
          restored_role_ids: [],
          skipped_roles: [],
          failed_removals: [],
          failed_restores: [],
          created_at: baseDate,
          updated_at: baseDate,
          restored_at: null,
          restored_by: null,
          metadata: {},
        },
      ],
      moderationQueueItems: [
        {
          id: 'queue-1',
          server_id: 'guild-1',
          user_id: 'user-pending',
          item_type: ModerationQueueItemType.CASE_MIRROR,
          verification_event_id: 'resolved-1',
          detection_event_id: null,
          report_intake_id: null,
          source_thread_id: null,
          queue_channel_id: 'queue-channel-1',
          queue_message_id: 'missing-message-1',
          last_source_message_id: null,
          last_notified_at: null,
          created_at: baseDate,
          updated_at: baseDate,
          metadata: {},
          verification_event_status: VerificationStatus.BANNED,
        },
      ],
    });
    const repository: IIntegrityAuditRepository = {
      listCandidates: jest.fn().mockResolvedValue(candidates),
    };
    const service = new IntegrityAuditService(
      {
        channels: {
          fetch: jest.fn(async (channelId: string) => ({
            id: channelId,
            messages: {
              fetch: jest.fn(async (messageId: string) => {
                if (messageId === 'missing-message-1') {
                  throw { code: 10008, message: 'Unknown Message' };
                }
                return { id: messageId };
              }),
            },
          })),
        },
      } as any,
      {
        getServerConfig: jest.fn().mockResolvedValue({
          case_role_id: 'case-role-1',
          settings: { moderation_queue_channel_id: 'queue-channel-1' },
        }),
      } as any,
      repository
    );
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(async (userId: string) => {
          if (userId === 'user-pending') {
            throw { code: 10007, message: 'Unknown Member' };
          }
          return {
            id: userId,
            roles: { cache: { has: jest.fn().mockReturnValue(false) } },
          };
        }),
      },
      bans: {
        fetch: jest.fn(async (userId: string) => {
          if (userId === 'user-pending') {
            return { user: { id: userId } };
          }
          throw { code: 10026, message: 'Unknown Ban' };
        }),
      },
    } as unknown as Guild;

    const report = await service.auditGuild(guild, { scope: 'all', days: 30, limit: 50 });

    expect(repository.listCandidates).toHaveBeenCalledWith({
      serverId: 'guild-1',
      since: expect.any(Date),
      limit: 50,
      userId: undefined,
    });
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'pending_case_user_banned',
        'pending_case_member_missing',
        'resolved_case_missing_admin_action',
        'resolved_case_missing_moderation_outcome',
        'banned_case_not_in_ban_list',
        'case_role_member_role_missing',
        'queue_case_mirror_not_pending',
        'queue_message_missing',
      ])
    );
  });

  it('does not require admin actions for externally resolved cases with durable outcomes', async () => {
    const candidates = buildCandidates({
      recentResolvedVerificationEvents: [
        {
          id: 'external-ban-1',
          server_id: 'guild-1',
          user_id: 'user-external-ban',
          detection_event_id: null,
          thread_id: null,
          private_evidence_thread_id: null,
          notification_channel_id: null,
          notification_message_id: null,
          status: VerificationStatus.BANNED,
          created_at: baseDate,
          updated_at: baseDate,
          resolved_at: baseDate,
          resolved_by: 'native-mod-1',
          notes: null,
          metadata: { moderation_outcome_source: ModerationOutcomeSource.NATIVE_DISCORD },
          admin_actions: [],
          moderation_outcomes: [
            {
              id: 'outcome-1',
              server_id: 'guild-1',
              user_id: 'user-external-ban',
              detection_event_id: null,
              verification_event_id: 'external-ban-1',
              outcome_type: ModerationOutcomeType.BANNED,
              source: ModerationOutcomeSource.NATIVE_DISCORD,
              actor_id: 'native-mod-1',
              reason: null,
              occurred_at: baseDate,
              created_at: baseDate,
              metadata: {},
            },
          ],
        },
      ],
    });
    const repository: IIntegrityAuditRepository = {
      listCandidates: jest.fn().mockResolvedValue(candidates),
    };
    const service = new IntegrityAuditService(
      { channels: { fetch: jest.fn() } } as any,
      {
        getServerConfig: jest.fn().mockResolvedValue({ case_role_id: null, settings: {} }),
      } as any,
      repository
    );
    const guild = {
      id: 'guild-1',
      members: { fetch: jest.fn(async () => ({ roles: { cache: { has: jest.fn() } } })) },
      bans: { fetch: jest.fn(async (userId: string) => ({ user: { id: userId } })) },
    } as unknown as Guild;

    const report = await service.auditGuild(guild, { scope: 'cases', days: 30, limit: 50 });

    expect(report.findings.map((finding) => finding.code)).not.toContain(
      'resolved_case_missing_admin_action'
    );
    expect(report.findings.map((finding) => finding.code)).not.toContain(
      'resolved_case_missing_moderation_outcome'
    );
  });

  it('ignores banned case-role member rows because ban records keep that marker', async () => {
    const candidates = buildCandidates({
      caseRoleMembers: [
        {
          server_id: 'guild-1',
          user_id: 'user-banned',
          join_date: baseDate,
          case_role_active: true,
          last_verified_at: null,
          last_message_at: null,
          verification_status: VerificationStatus.BANNED,
          last_status_change: baseDate,
          created_by: null,
          updated_by: null,
        },
      ],
    });
    const repository: IIntegrityAuditRepository = {
      listCandidates: jest.fn().mockResolvedValue(candidates),
    };
    const service = new IntegrityAuditService(
      { channels: { fetch: jest.fn() } } as any,
      {
        getServerConfig: jest.fn().mockResolvedValue({
          case_role_id: 'case-role-1',
          settings: {},
        }),
      } as any,
      repository
    );
    const guild = {
      id: 'guild-1',
      members: { fetch: jest.fn() },
      bans: { fetch: jest.fn() },
    } as unknown as Guild;

    const report = await service.auditGuild(guild, { scope: 'case_role', days: 30, limit: 50 });

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(guild.bans.fetch).not.toHaveBeenCalled();
    const findingCodes = report.findings.map((finding) => finding.code);
    expect(findingCodes).not.toContain('case_role_member_missing');
    expect(findingCodes).not.toContain('case_role_member_role_missing');
    expect(findingCodes).not.toContain('case_role_member_resolved_status');
  });

  it('emits live fetch failures once for users in multiple audit categories', async () => {
    const candidates = buildCandidates({
      caseRoleMembers: [
        {
          server_id: 'guild-1',
          user_id: 'user-restricted',
          join_date: baseDate,
          case_role_active: true,
          last_verified_at: null,
          last_message_at: null,
          verification_status: VerificationStatus.PENDING,
          last_status_change: baseDate,
          created_by: null,
          updated_by: null,
        },
      ],
      activeRoleQuarantineSnapshots: [
        {
          id: 'snapshot-1',
          server_id: 'guild-1',
          user_id: 'user-restricted',
          verification_event_id: null,
          status: RoleQuarantineSnapshotStatus.ACTIVE,
          mode: 'automatic',
          original_role_ids: ['role-a'],
          planned_role_ids: [],
          removed_role_ids: ['role-a'],
          restored_role_ids: [],
          skipped_roles: [],
          failed_removals: [],
          failed_restores: [],
          created_at: baseDate,
          updated_at: baseDate,
          restored_at: null,
          restored_by: null,
          metadata: {},
        },
      ],
    });
    const repository: IIntegrityAuditRepository = {
      listCandidates: jest.fn().mockResolvedValue(candidates),
    };
    const service = new IntegrityAuditService(
      { channels: { fetch: jest.fn() } } as any,
      {
        getServerConfig: jest.fn().mockResolvedValue({
          case_role_id: 'case-role-1',
          settings: {},
        }),
      } as any,
      repository
    );
    const guild = {
      id: 'guild-1',
      members: { fetch: jest.fn(async () => Promise.reject(new Error('member api down'))) },
      bans: { fetch: jest.fn(async () => Promise.reject(new Error('ban api down'))) },
    } as unknown as Guild;

    const report = await service.auditGuild(guild, { scope: 'case_role', days: 30, limit: 50 });
    const findingCodes = report.findings.map((finding) => finding.code);

    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    expect(guild.bans.fetch).toHaveBeenCalledTimes(1);
    expect(findingCodes.filter((code) => code === 'member_fetch_failed')).toHaveLength(1);
    expect(findingCodes.filter((code) => code === 'ban_fetch_failed')).toHaveLength(1);
  });

  it('does not expect case-role findings for pending cases without active case-role state', async () => {
    const candidates = buildCandidates({
      pendingVerificationEvents: [
        {
          id: 'pending-open-case-1',
          server_id: 'guild-1',
          user_id: 'user-open-case',
          detection_event_id: null,
          thread_id: null,
          private_evidence_thread_id: null,
          notification_channel_id: null,
          notification_message_id: null,
          status: VerificationStatus.PENDING,
          created_at: baseDate,
          updated_at: baseDate,
          resolved_at: null,
          resolved_by: null,
          notes: null,
          metadata: {},
          admin_actions: [],
          moderation_outcomes: [],
        },
      ],
    });
    const repository: IIntegrityAuditRepository = {
      listCandidates: jest.fn().mockResolvedValue(candidates),
    };
    const service = new IntegrityAuditService(
      { channels: { fetch: jest.fn() } } as any,
      {
        getServerConfig: jest.fn().mockResolvedValue({
          case_role_id: 'case-role-1',
          settings: {},
        }),
      } as any,
      repository
    );
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(async (userId: string) => ({
          id: userId,
          roles: { cache: { has: jest.fn().mockReturnValue(false) } },
        })),
      },
      bans: { fetch: jest.fn(async () => Promise.reject({ code: 10026 })) },
    } as unknown as Guild;

    const report = await service.auditGuild(guild, { scope: 'cases', days: 30, limit: 50 });

    expect(report.findings.map((finding) => finding.code)).not.toContain(
      'pending_case_role_missing'
    );
  });

  it('uses case-role member findings instead of duplicate pending-case findings under all scope', async () => {
    const candidates = buildCandidates({
      pendingVerificationEvents: [
        {
          id: 'pending-restricted-1',
          server_id: 'guild-1',
          user_id: 'user-restricted',
          detection_event_id: null,
          thread_id: null,
          private_evidence_thread_id: null,
          notification_channel_id: null,
          notification_message_id: null,
          status: VerificationStatus.PENDING,
          created_at: baseDate,
          updated_at: baseDate,
          resolved_at: null,
          resolved_by: null,
          notes: null,
          metadata: {},
          admin_actions: [],
          moderation_outcomes: [],
        },
      ],
      caseRoleMembers: [
        {
          server_id: 'guild-1',
          user_id: 'user-restricted',
          join_date: baseDate,
          case_role_active: true,
          last_verified_at: null,
          last_message_at: null,
          verification_status: VerificationStatus.PENDING,
          last_status_change: baseDate,
          created_by: null,
          updated_by: null,
        },
      ],
    });
    const repository: IIntegrityAuditRepository = {
      listCandidates: jest.fn().mockResolvedValue(candidates),
    };
    const service = new IntegrityAuditService(
      { channels: { fetch: jest.fn() } } as any,
      {
        getServerConfig: jest.fn().mockResolvedValue({
          case_role_id: 'case-role-1',
          settings: {},
        }),
      } as any,
      repository
    );
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(async (userId: string) => ({
          id: userId,
          roles: { cache: { has: jest.fn().mockReturnValue(false) } },
        })),
      },
      bans: { fetch: jest.fn(async () => Promise.reject({ code: 10026 })) },
    } as unknown as Guild;

    const report = await service.auditGuild(guild, { scope: 'all', days: 30, limit: 50 });
    const findingCodes = report.findings.map((finding) => finding.code);

    expect(findingCodes).not.toContain('pending_case_role_missing');
    expect(findingCodes).toContain('case_role_member_role_missing');
  });
});
