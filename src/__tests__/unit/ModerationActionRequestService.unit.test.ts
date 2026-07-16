import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';
import { ChannelType } from 'discord.js';
import {
  AdminActionType,
  MessageDeletionBanStatus,
  MessageDeletionCaseFinalizationStatus,
  MessageDeletionCoverage,
  MessageDeletionJobMode,
  MessageDeletionJobStatus,
  MessageDeletionScope,
  ModerationActionRequest,
  ModerationActionRequestStatus,
  ModerationActionRequestType,
  type MessageDeletionJobWithItems,
} from '../../repositories/types';
import type { IModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';

const baseRequest: ModerationActionRequest = {
  id: 'request-1',
  server_id: 'guild-1',
  action_type: ModerationActionRequestType.OPEN_CASE_FROM_OBSERVED_DETECTION,
  status: ModerationActionRequestStatus.PROCESSING,
  actor_id: 'moderator-1',
  actor_surface: 'web',
  target_user_id: 'user-1',
  detection_event_id: 'det-1',
  report_intake_id: 'report-1',
  verification_event_id: null,
  message_deletion_job_id: null,
  idempotency_key: 'web:report-open-case:guild-1:report-1:det-1',
  requested_at: new Date('2026-07-08T18:00:00.000Z'),
  updated_at: new Date('2026-07-08T18:00:00.000Z'),
  started_at: null,
  completed_at: null,
  failed_at: null,
  attempts: 1,
  last_error: null,
  metadata: {},
  result: {},
};

const messageCleanupJob: MessageDeletionJobWithItems = {
  id: 'cleanup-job-1',
  server_id: 'guild-1',
  user_id: 'user-1',
  verification_event_id: 'ver-1',
  requested_by: 'moderator-1',
  actor_surface: 'web',
  mode: MessageDeletionJobMode.DELETE_ONLY,
  ban_status: MessageDeletionBanStatus.NOT_REQUESTED,
  case_finalization_status: MessageDeletionCaseFinalizationStatus.NOT_APPLICABLE,
  scope: MessageDeletionScope.LAST_DAY,
  status: MessageDeletionJobStatus.READY,
  coverage: MessageDeletionCoverage.READY,
  reason: 'Repeated unsolicited links',
  evidence_thread_id: 'evidence-thread-1',
  requested_window_start: new Date('2026-07-07T18:00:00.000Z'),
  requested_window_end: new Date('2026-07-08T18:00:00.000Z'),
  previewed_at: new Date('2026-07-08T18:00:00.000Z'),
  started_at: null,
  completed_at: null,
  failed_at: null,
  created_at: new Date('2026-07-08T18:00:00.000Z'),
  updated_at: new Date('2026-07-08T18:00:00.000Z'),
  candidate_count: 2,
  preserved_count: 0,
  deleted_count: 0,
  already_missing_count: 0,
  changed_count: 0,
  evidence_failed_count: 0,
  delete_failed_count: 0,
  permission_denied_count: 0,
  last_error: null,
  metadata: {},
  items: [],
};

const previewMessageCleanupRequest: ModerationActionRequest = {
  ...baseRequest,
  id: 'preview-cleanup-request-1',
  action_type: ModerationActionRequestType.PREVIEW_CASE_MESSAGE_DELETION,
  detection_event_id: null,
  report_intake_id: null,
  verification_event_id: 'ver-1',
  message_deletion_job_id: 'cleanup-job-1',
  idempotency_key: 'web:message-cleanup:preview:cleanup-job-1',
};

const executeMessageCleanupRequest: ModerationActionRequest = {
  ...previewMessageCleanupRequest,
  id: 'execute-cleanup-request-1',
  action_type: ModerationActionRequestType.EXECUTE_CASE_MESSAGE_DELETION,
  idempotency_key: 'web:message-cleanup:execute:cleanup-job-1',
};

const combinedBanCleanupRequest: ModerationActionRequest = {
  ...previewMessageCleanupRequest,
  id: 'combined-cleanup-request-1',
  action_type: ModerationActionRequestType.BAN_CASE_USER_WITH_MESSAGE_CLEANUP,
  idempotency_key: 'web:message-cleanup:ban:cleanup-job-1',
};

const verifyRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.VERIFY_CASE_USER,
  detection_event_id: null,
  id: 'verify-request-1',
  idempotency_key: 'web:case-action:verify_user:guild-1:ver-1',
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const openAdminCaseRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.OPEN_ADMIN_CASE,
  detection_event_id: null,
  id: 'open-admin-case-request-1',
  idempotency_key: 'web:member-open-case:guild-1:user-1:request-1',
  metadata: { reason: 'Manual case reason.' },
  report_intake_id: null,
};

const manualFlagRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.MANUAL_FLAG_USER,
  detection_event_id: null,
  id: 'manual-flag-request-1',
  idempotency_key: 'web:member-manual-flag:guild-1:user-1:request-1',
  metadata: { reason: 'Manual flag reason.' },
  report_intake_id: null,
};

const submitUserReportRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.SUBMIT_USER_REPORT,
  detection_event_id: null,
  id: 'submit-user-report-request-1',
  idempotency_key: 'web:report:submit_user_report:guild-1:user-1:request-1',
  metadata: { reason: 'Report reason.', target_label: 'Target User' },
  report_intake_id: null,
};

const startReportIntakeRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.START_REPORT_INTAKE,
  detection_event_id: null,
  id: 'start-report-intake-request-1',
  idempotency_key: 'web:report:start_report_intake:guild-1:request-1',
  metadata: { channel_id: 'report-channel-1' },
  report_intake_id: null,
  target_user_id: null,
};

const closeReportIntakeRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.CLOSE_REPORT_INTAKE,
  detection_event_id: null,
  id: 'close-report-intake-request-1',
  idempotency_key: 'web:report:close_report_intake:guild-1:intake-1:request-1',
  report_intake_id: 'intake-1',
  target_user_id: null,
};

const dismissObservedRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.DISMISS_OBSERVED_DETECTION,
  id: 'dismiss-observed-request-1',
  idempotency_key: 'web:observed-action:dismiss_no_action:guild-1:det-1',
  report_intake_id: null,
};

const falsePositiveObservedRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.MARK_OBSERVED_DETECTION_FALSE_POSITIVE,
  id: 'false-positive-observed-request-1',
  idempotency_key: 'web:observed-action:mark_false_positive:guild-1:det-1',
  report_intake_id: null,
};

const undoObservedRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.UNDO_OBSERVED_DETECTION_ACTION,
  id: 'undo-observed-request-1',
  idempotency_key: 'web:observed-action:undo:guild-1:det-1',
  report_intake_id: null,
};

const ignoreDetectionAccountingRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.IGNORE_DETECTION_ACCOUNTING,
  id: 'ignore-detection-request-1',
  idempotency_key: 'web:detection-accounting:ignore_detection:guild-1:det-1',
  metadata: { reason: 'Accounting ignore reason.' },
  report_intake_id: null,
};

const restoreDetectionAccountingRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.RESTORE_DETECTION_ACCOUNTING,
  id: 'restore-detection-request-1',
  idempotency_key: 'web:detection-accounting:restore_detection:guild-1:det-1',
  metadata: { reason: 'Accounting restore reason.' },
  report_intake_id: null,
};

const kickObservedRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.KICK_OBSERVED_DETECTION,
  id: 'kick-observed-request-1',
  idempotency_key: 'web:observed-action:kick_user:guild-1:det-1',
  metadata: { reason: 'Observed kick reason.' },
  report_intake_id: null,
};

const banObservedRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
  id: 'ban-observed-request-1',
  idempotency_key: 'web:observed-action:ban_user:guild-1:det-1',
  metadata: { reason: 'Observed ban reason.' },
  report_intake_id: null,
};

const closeNoActionRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.CLOSE_CASE_NO_ACTION,
  detection_event_id: null,
  id: 'close-request-1',
  idempotency_key: 'web:case-action:close_no_action:guild-1:ver-1',
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const kickRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.KICK_CASE_USER,
  detection_event_id: null,
  id: 'kick-request-1',
  idempotency_key: 'web:case-action:kick_user:guild-1:ver-1',
  metadata: { reason: 'Kick reason.' },
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const banRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.BAN_CASE_USER,
  detection_event_id: null,
  id: 'ban-request-1',
  idempotency_key: 'web:case-action:ban_user:guild-1:ver-1',
  metadata: { reason: 'Ban reason.' },
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const banByIdRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.BAN_CASE_USER_BY_ID,
  detection_event_id: null,
  id: 'ban-id-request-1',
  idempotency_key: 'web:case-action:ban_by_id:guild-1:ver-1',
  metadata: { reason: 'Ban by ID reason.' },
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const repairRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.REPAIR_ACTIVE_CASE,
  detection_event_id: null,
  id: 'repair-request-1',
  idempotency_key: 'web:case-action:repair_thread:guild-1:ver-1',
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const reopenRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.REOPEN_CASE,
  detection_event_id: null,
  id: 'reopen-request-1',
  idempotency_key: 'web:case-action:reopen_case:guild-1:ver-1',
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const refreshNotificationRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.REFRESH_CASE_NOTIFICATION,
  detection_event_id: null,
  id: 'refresh-notification-request-1',
  idempotency_key: 'web:case-action:refresh_notification:guild-1:ver-1',
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const syncModerationQueueRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.SYNC_MODERATION_QUEUE,
  detection_event_id: null,
  id: 'sync-queue-request-1',
  idempotency_key: 'web:operation:sync_moderation_queue:guild-1:request-1',
  report_intake_id: null,
  target_user_id: null,
  verification_event_id: null,
};

const clearModerationQueueRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.CLEAR_MODERATION_QUEUE,
  detection_event_id: null,
  id: 'clear-queue-request-1',
  idempotency_key: 'web:operation:clear_moderation_queue:guild-1:request-1',
  report_intake_id: null,
  target_user_id: null,
  verification_event_id: null,
};

const closeResolvedThreadsRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.CLOSE_RESOLVED_CASE_THREADS,
  detection_event_id: null,
  id: 'close-resolved-threads-request-1',
  idempotency_key: 'web:operation:close_resolved_case_threads:guild-1:request-1',
  metadata: { days: 45, execute: true, limit: 50 },
  report_intake_id: null,
  target_user_id: null,
  verification_event_id: null,
};

const auditCaseRoleLockdownRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.AUDIT_CASE_ROLE_LOCKDOWN,
  detection_event_id: null,
  id: 'audit-lockdown-request-1',
  idempotency_key: 'web:operation:audit_case_role_lockdown:guild-1:request-1',
  report_intake_id: null,
  target_user_id: null,
  verification_event_id: null,
};

const applyCaseRoleLockdownRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.APPLY_CASE_ROLE_LOCKDOWN,
  detection_event_id: null,
  id: 'apply-lockdown-request-1',
  idempotency_key: 'web:operation:apply_case_role_lockdown:guild-1:request-1',
  metadata: { unsync_allowed_channels: true },
  report_intake_id: null,
  target_user_id: null,
  verification_event_id: null,
};

const roleIntakeRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.INTAKE_ROLE_MEMBERS,
  detection_event_id: null,
  id: 'role-intake-request-1',
  idempotency_key: 'web:operation:intake_role_members:guild-1:request-1',
  metadata: { execute: true, limit: 25, reason: 'Bulk intake reason.', role_id: 'role-1' },
  report_intake_id: null,
  target_user_id: null,
  verification_event_id: null,
};

const syncExistingBanRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.SYNC_EXISTING_BAN,
  detection_event_id: null,
  id: 'sync-ban-request-1',
  idempotency_key: 'web:case-action:sync_existing_ban:guild-1:ver-1',
  report_intake_id: null,
  verification_event_id: 'ver-1',
};

const completeSetupVerificationRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.COMPLETE_SETUP_VERIFICATION,
  detection_event_id: null,
  id: 'setup-verification-request-1',
  idempotency_key: 'web:setup:complete_setup_verification:guild-1:request-1',
  metadata: {
    admin_channel_id: 'admin-channel-1',
    case_role_id: 'role-1',
    report_instructions_channel_id: 'report-channel-1',
  },
  report_intake_id: null,
  target_user_id: null,
  verification_event_id: null,
};

const upsertReportInstructionsRequest: ModerationActionRequest = {
  ...baseRequest,
  action_type: ModerationActionRequestType.UPSERT_REPORT_INSTRUCTIONS,
  detection_event_id: null,
  id: 'report-instructions-request-1',
  idempotency_key: 'web:setup:upsert_report_instructions:guild-1:request-1',
  metadata: { channel_id: 'report-channel-1' },
  report_intake_id: null,
  target_user_id: null,
  verification_event_id: null,
};

class FakeModerationActionRequestRepository implements IModerationActionRequestRepository {
  public requests: ModerationActionRequest[] = [];
  public completed: Array<{ id: string; result: unknown }> = [];
  public failed: Array<{ error: string; id: string }> = [];
  public heartbeats: string[] = [];

  public async enqueue(): Promise<ModerationActionRequest> {
    throw new Error('not used');
  }

  public async claimNext(): Promise<ModerationActionRequest | null> {
    return this.requests.shift() ?? null;
  }

  public async heartbeat(id: string): Promise<ModerationActionRequest | null> {
    this.heartbeats.push(id);
    return { ...baseRequest, id, status: ModerationActionRequestStatus.PROCESSING };
  }

  public complete = jest.fn(
    async (id: string, result?: unknown): Promise<ModerationActionRequest | null> => {
      this.completed.push({ id, result });
      return { ...baseRequest, id, status: ModerationActionRequestStatus.COMPLETED };
    }
  );

  public async fail(id: string, error: string): Promise<ModerationActionRequest | null> {
    this.failed.push({ id, error });
    return { ...baseRequest, id, status: ModerationActionRequestStatus.FAILED, last_error: error };
  }
}

describe('ModerationActionRequestService', () => {
  function buildService(
    requests: ModerationActionRequest[] = [baseRequest],
    serverSettings: Record<string, unknown> = {}
  ) {
    const repository = new FakeModerationActionRequestRepository();
    repository.requests = requests.map((request) => ({ ...request }));
    const moderator = { id: 'moderator-1' };
    const targetUser = { id: 'user-1', tag: 'target#0001', username: 'target' };
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(),
        fetchMe: jest.fn(),
        me: {
          permissions: {
            has: jest.fn(() => true),
          },
        },
      },
      bans: {
        create: jest.fn(),
      },
    };
    const member = { guild, id: 'user-1', user: targetUser };
    const reporterMember = {
      guild,
      id: 'moderator-1',
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      permissions: { has: jest.fn(() => true) },
      user: { id: 'moderator-1', tag: 'moderator#0001', username: 'moderator' },
    };
    const role = { guild, id: 'role-1', name: 'Manual Intake' };
    const sourceMessage = {
      channelId: 'source-channel-1',
      id: 'source-message-1',
    };
    const sourceChannel = {
      messages: {
        fetch: jest.fn(async (id: string) => (id === sourceMessage.id ? sourceMessage : null)),
      },
    };
    const reportInstructionsMessage = { id: 'report-message-1' };
    const reportInstructionsChannel = {
      guildId: 'guild-1',
      id: 'report-channel-1',
      messages: {
        fetch: jest.fn(async () => null),
      },
      send: jest.fn(async () => reportInstructionsMessage),
      type: ChannelType.GuildText,
    };
    const adminChannel = {
      guildId: 'guild-1',
      id: 'admin-channel-1',
      send: jest.fn(async () => ({ id: 'admin-message-1' })),
      type: ChannelType.GuildText,
    };
    const verificationChannel = {
      guildId: 'guild-1',
      id: 'verification-channel-1',
      type: ChannelType.GuildText,
    };
    const reportIntakeThread = {
      archived: false,
      delete: jest.fn(async () => undefined),
      guildId: 'guild-1',
      id: 'report-thread-1',
      isThread: jest.fn(() => true),
      send: jest.fn(async () => ({ id: 'thread-message-1' })),
      setArchived: jest.fn(async () => undefined),
      url: 'https://discord.com/channels/guild-1/report-thread-1',
    };
    guild.members.fetch.mockImplementation(async (id: string) => {
      if (id === 'moderator-1') {
        return reporterMember;
      }
      if (id === 'user-1') {
        return member;
      }
      return null;
    });
    guild.members.fetchMe.mockResolvedValue(guild.members.me);
    (guild as any).roles = {
      fetch: jest.fn(async (id: string) => (id === role.id ? role : null)),
    };
    const client = {
      channels: {
        fetch: jest.fn(async (id: string) => {
          if (id === sourceMessage.channelId) {
            return sourceChannel;
          }
          if (id === reportInstructionsChannel.id) {
            return reportInstructionsChannel;
          }
          if (id === adminChannel.id) {
            return adminChannel;
          }
          if (id === verificationChannel.id) {
            return verificationChannel;
          }
          if (id === reportIntakeThread.id) {
            return reportIntakeThread;
          }
          return null;
        }),
      },
      guilds: {
        fetch: jest.fn(async () => guild),
      },
      user: { id: 'bot-1' },
      users: {
        fetch: jest.fn(async (id: string) => (id === 'user-1' ? targetUser : moderator)),
      },
    };
    const threadManager = {
      activateReportIntakeThread: jest.fn(async () => true),
      createReportIntakeThread: jest.fn(async () => reportIntakeThread),
    };
    const reportIntakeService = {
      closeIntakeForThread: jest.fn(async () => ({
        closed: true,
        message: 'Report intake closed. No report has been filed.',
        shouldArchiveThread: true,
      })),
      findIntakeById: jest.fn(async () => ({
        id: 'intake-1',
        reporter_id: 'moderator-1',
        server_id: 'guild-1',
        thread_id: 'report-thread-1',
      })),
      findOpenIntakeForReporter: jest.fn(async () => null),
      markOpenFailed: jest.fn(async () => undefined),
      openIntakeFromThread: jest.fn(async () => ({
        id: 'intake-1',
        server_id: 'guild-1',
        thread_id: 'report-thread-1',
      })),
    };
    const securityActionService = {
      banObservedDetection: jest.fn(async () => true),
      banObservedDetectionById: jest.fn(async () => true),
      dismissObservedDetection: jest.fn(async () => true),
      excludeDetectionFromAccounting: jest.fn(async () => ({ id: 'det-1' })),
      kickObservedDetection: jest.fn(async () => true),
      handleManualFlag: jest.fn(async () => true),
      handleUserReport: jest.fn(async () => true),
      intakeRoleMembers: jest.fn(async () => ({
        action: 'open_case',
        batchId: 'role-intake-batch-1',
        eligibleMembers: 10,
        execute: true,
        failed: 1,
        failures: [{ message: 'Case role failed', userId: 'user-failed' }],
        opened: 8,
        processed: 9,
        roleId: 'role-1',
        roleName: 'Manual Intake',
        skippedActiveCases: 1,
        skippedBots: 2,
        skippedOverLimit: 3,
        totalMembers: 15,
      })),
      openAdminCase: jest.fn(async () => ({
        caseRoleActive: true,
        caseRoleAttempted: true,
        opened: true,
      })),
      openObservedDetectionCase: jest.fn(async () => true),
      repairActiveCase: jest.fn(async () => ({
        message: 'Case repaired.',
        repaired: true,
        threadCreated: true,
        verificationEventId: 'ver-1',
      })),
      refreshCaseNotification: jest.fn(async () => ({
        message: 'Refreshed pending case notification for target#0001.',
        notificationChannelId: 'admin-channel-1',
        notificationMessageId: 'admin-message-1',
        refreshed: true,
        status: 'pending',
        verificationEventId: 'ver-1',
      })),
      reopenVerification: jest.fn(async () => true),
      restoreDetectionAccounting: jest.fn(async () => ({ id: 'det-1' })),
      undoObservedDetectionAction: jest.fn(async () => AdminActionType.FALSE_POSITIVE),
    };
    const userModerationService = {
      banUser: jest.fn(async () => true),
      banUserById: jest.fn(async () => true),
      clearCombinedBanCleanupMarker: jest.fn(async () => true),
      closeCaseNoAction: jest.fn(async () => 1),
      finalizeSuccessfulCombinedBan: jest.fn(async () => true),
      finalizeSuccessfulMemberBan: jest.fn(async () => true),
      kickUser: jest.fn(async () => true),
      markCombinedBanCleanupPending: jest.fn(async () => ({ id: 'ver-1' })),
      performDiscordBanById: jest.fn(async () => undefined),
      performDiscordMemberBan: jest.fn(async () => undefined),
      syncAlreadyBannedUser: jest.fn(async () => 1),
      verifyUser: jest.fn(async () => true),
    };
    const moderationQueueService = {
      clearServerQueue: jest.fn(async () => 3),
      syncServerQueue: jest.fn(async () => undefined),
    };
    const caseThreadClosureSweepService = {
      sweepResolvedCaseThreads: jest.fn(async () => ({
        alreadyClosedThreads: 2,
        cases: [],
        checkedCases: 7,
        checkedThreads: 10,
        closedThreads: 4,
        days: 45,
        execute: true,
        failedThreads: 1,
        limit: 50,
        missingThreads: 3,
        wouldCloseThreads: 4,
      })),
    };
    const caseRoleLockdownReport = {
      allowedCategoryIds: [],
      allowedChannelIds: [],
      appliedActions: [
        { channelId: 'category-1', channelName: 'public', scope: 'category' },
        { channelId: 'channel-1', channelName: 'general', scope: 'channel' },
      ],
      autoAllowedChannelIds: ['verification-channel-1'],
      checkedAt: new Date('2026-07-08T18:00:00.000Z'),
      enabled: true,
      errorCount: 1,
      failedActions: [{ channelId: 'channel-2', channelName: 'chat', scope: 'channel' }],
      guildId: 'guild-1',
      issues: [
        {
          code: 'lockdown-case-role-global-permissions',
          message: 'Case role has global permissions.',
          severity: 'warning',
        },
        {
          code: 'lockdown-apply-failed',
          message: 'Failed to apply lockdown.',
          severity: 'error',
        },
      ],
      plannedActions: [{ channelId: 'channel-3', channelName: 'forum', scope: 'channel' }],
      syncedAllowedChannels: [{ channelId: 'allowed-1', channelName: 'rules', scope: 'channel' }],
      unsyncedAllowedChannels: [
        { channelId: 'verification-channel-1', channelName: 'verification', scope: 'channel' },
      ],
      warningCount: 1,
    };
    const caseRoleLockdownService = {
      applyGuild: jest.fn(async () => caseRoleLockdownReport),
      auditGuild: jest.fn(async () => caseRoleLockdownReport),
    };
    const configService = {
      getAdminChannel: jest.fn(async () => adminChannel),
      getServerConfig: jest.fn(async () => ({
        guild_id: 'guild-1',
        settings: serverSettings,
      })),
      updateServerConfig: jest.fn(async () => undefined),
      updateServerSettings: jest.fn(async () => undefined),
    };
    const notificationManager = {
      setupVerificationChannel: jest.fn(async (...args: unknown[]) => {
        const onChannelCreated = args[3];
        if (typeof onChannelCreated === 'function') {
          onChannelCreated('created-verification-channel');
        }
        return 'created-verification-channel';
      }),
    };
    const productAnalyticsService = {
      captureGuildEvent: jest.fn(async () => undefined),
    };
    const setupDiagnosticsReport = {
      errorCount: 0,
      guildId: 'guild-1',
      issues: [],
      warningCount: 0,
    };
    const setupDiagnosticsService = {
      validateSetupCandidate: jest.fn(async () => setupDiagnosticsReport),
    };
    const messageDeletionJobs = {
      fail: jest.fn(async () => null),
      findById: jest.fn(async (id: string): Promise<MessageDeletionJobWithItems | null> => {
        void id;
        return null;
      }),
      updateCaseFinalizationStatus: jest.fn(async () => null),
      updateBanStatus: jest.fn(async () => null),
    };
    const messageCleanupService = {
      executeJob: jest.fn(async () => ({
        jobId: 'cleanup-job-1',
        alreadyCompleted: false,
        preservedCount: 2,
        deletedCount: 1,
        alreadyMissingCount: 0,
        changedCount: 1,
        evidenceFailedCount: 0,
        deleteFailedCount: 0,
        permissionDeniedCount: 0,
      })),
      previewJob: jest.fn(async () => messageCleanupJob),
    };
    const service = new ModerationActionRequestService(
      repository,
      {
        findById: jest.fn(async () => ({
          id: 'ver-1',
          server_id: 'guild-1',
          user_id: 'user-1',
        })),
      } as any,
      client as any,
      threadManager as any,
      reportIntakeService as any,
      configService as any,
      securityActionService as any,
      userModerationService as any,
      moderationQueueService as any,
      caseThreadClosureSweepService as any,
      caseRoleLockdownService as any,
      notificationManager as any,
      productAnalyticsService as any,
      setupDiagnosticsService as any,
      messageDeletionJobs as any,
      messageCleanupService as any
    );

    return {
      adminChannel,
      client,
      guild,
      member,
      moderator,
      reporterMember,
      configService,
      notificationManager,
      productAnalyticsService,
      repository,
      reportInstructionsChannel,
      reportInstructionsMessage,
      reportIntakeService,
      reportIntakeThread,
      role,
      securityActionService,
      service,
      setupDiagnosticsService,
      sourceChannel,
      sourceMessage,
      targetUser,
      threadManager,
      verificationChannel,
      caseThreadClosureSweepService,
      caseRoleLockdownService,
      moderationQueueService,
      messageCleanupService,
      messageDeletionJobs,
      userModerationService,
    };
  }

  it('opens observed cases through the logged-in bot Discord client', async () => {
    const { repository, securityActionService, service, member, moderator } = buildService();

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.openObservedDetectionCase).toHaveBeenCalledWith(
      member,
      'det-1',
      moderator
    );
    expect(repository.completed).toEqual([
      {
        id: 'request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.OPEN_CASE_FROM_OBSERVED_DETECTION,
          detection_event_id: 'det-1',
          opened: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('opens admin cases by user through the logged-in bot Discord client', async () => {
    const { member, moderator, repository, securityActionService, service } = buildService([
      openAdminCaseRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.openAdminCase).toHaveBeenCalledWith(member, moderator, {
      action: 'open_case',
      metadata: {
        requested_surface: 'web',
        web_action: 'open_admin_case',
      },
      reason: 'Manual case reason.',
    });
    expect(repository.completed).toEqual([
      {
        id: 'open-admin-case-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.OPEN_ADMIN_CASE,
          case_role_active: true,
          case_role_attempted: true,
          opened: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('opens admin cases with selected source message context from web history', async () => {
    const sourceRequest: ModerationActionRequest = {
      ...openAdminCaseRequest,
      detection_event_id: 'det-source-1',
      id: 'open-admin-source-request-1',
      metadata: {
        reason: 'Source message review.',
        source: 'message_context_case',
        source_channel_id: 'source-channel-1',
        source_message_id: 'source-message-1',
      },
    };
    const { member, moderator, repository, securityActionService, service, sourceMessage } =
      buildService([sourceRequest]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.openAdminCase).toHaveBeenCalledWith(member, moderator, {
      action: 'open_case',
      metadata: {
        requested_surface: 'web',
        source: 'message_context_case',
        source_channel_id: 'source-channel-1',
        source_message_id: 'source-message-1',
        web_action: 'open_admin_case',
      },
      reason: 'Source message review.',
      sourceMessage,
    });
    expect(repository.completed).toEqual([
      {
        id: 'open-admin-source-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.OPEN_ADMIN_CASE,
          detection_event_id: 'det-source-1',
          opened: true,
          source_channel_id: 'source-channel-1',
          source_message_fetched: true,
          source_message_id: 'source-message-1',
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('manually flags users through the logged-in bot Discord client', async () => {
    const { member, moderator, repository, securityActionService, service } = buildService([
      manualFlagRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.handleManualFlag).toHaveBeenCalledWith(
      member,
      moderator,
      'Manual flag reason.'
    );
    expect(repository.completed).toEqual([
      {
        id: 'manual-flag-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.MANUAL_FLAG_USER,
          flagged: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('submits user reports through the logged-in bot Discord client', async () => {
    const { member, moderator, repository, securityActionService, service } = buildService([
      submitUserReportRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      member,
      moderator,
      'Report reason.'
    );
    expect(repository.completed).toEqual([
      {
        id: 'submit-user-report-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.SUBMIT_USER_REPORT,
          reporter_id: 'moderator-1',
          server_id: 'guild-1',
          submitted: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('starts guided report intake through the logged-in bot Discord client', async () => {
    const {
      adminChannel,
      reportInstructionsChannel,
      reportIntakeService,
      reportIntakeThread,
      reporterMember,
      repository,
      service,
      threadManager,
    } = buildService([startReportIntakeRequest]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(reportIntakeService.findOpenIntakeForReporter).toHaveBeenCalledWith({
      reporterId: 'moderator-1',
      serverId: 'guild-1',
    });
    expect(threadManager.createReportIntakeThread).toHaveBeenCalledWith(
      reportInstructionsChannel,
      reporterMember
    );
    expect(reportIntakeService.openIntakeFromThread).toHaveBeenCalledWith({
      channelId: 'report-channel-1',
      reporter: reporterMember,
      serverId: 'guild-1',
      threadId: 'report-thread-1',
    });
    expect(threadManager.activateReportIntakeThread).toHaveBeenCalledWith(
      reportIntakeThread,
      reporterMember,
      'intake-1'
    );
    expect(adminChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.any(Array),
        embeds: expect.any(Array),
      })
    );
    expect(repository.completed).toEqual([
      {
        id: 'start-report-intake-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.START_REPORT_INTAKE,
          channel_id: 'report-channel-1',
          intake_id: 'intake-1',
          opened: true,
          reporter_id: 'moderator-1',
          server_id: 'guild-1',
          thread_id: 'report-thread-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('closes open report intake threads through the logged-in bot Discord client', async () => {
    const { reportIntakeService, reportIntakeThread, repository, service } = buildService([
      closeReportIntakeRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(reportIntakeService.findIntakeById).toHaveBeenCalledWith('intake-1');
    expect(reportIntakeService.closeIntakeForThread).toHaveBeenCalledWith({
      closedById: 'moderator-1',
      threadId: 'report-thread-1',
    });
    expect(reportIntakeThread.send).toHaveBeenCalledWith({
      allowedMentions: { parse: [] },
      content: 'Report intake closed. No report has been filed.',
    });
    expect(reportIntakeThread.setArchived).toHaveBeenCalledWith(true, 'Report intake closed');
    expect(repository.completed).toEqual([
      {
        id: 'close-report-intake-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.CLOSE_REPORT_INTAKE,
          closed: true,
          report_intake_id: 'intake-1',
          server_id: 'guild-1',
          thread_archived: true,
          thread_id: 'report-thread-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('fails invalid manual-flag requests without calling moderation side effects', async () => {
    const { repository, securityActionService, service } = buildService([
      { ...manualFlagRequest, target_user_id: null },
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.handleManualFlag).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'manual-flag-request-1',
        error: 'Manual-flag request is missing target user.',
      },
    ]);
  });

  it('dismisses observed detections through the logged-in bot Discord client', async () => {
    const { moderator, repository, securityActionService, service } = buildService([
      dismissObservedRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.dismissObservedDetection).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'det-1',
      moderator,
      AdminActionType.DISMISS
    );
    expect(repository.completed).toEqual([
      {
        id: 'dismiss-observed-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.DISMISS_OBSERVED_DETECTION,
          detection_event_id: 'det-1',
          dismissed: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('marks observed detections false positive through the logged-in bot Discord client', async () => {
    const { moderator, repository, securityActionService, service } = buildService([
      falsePositiveObservedRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.dismissObservedDetection).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'det-1',
      moderator,
      AdminActionType.FALSE_POSITIVE
    );
    expect(repository.completed).toEqual([
      {
        id: 'false-positive-observed-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.MARK_OBSERVED_DETECTION_FALSE_POSITIVE,
          detection_event_id: 'det-1',
          dismissed: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('undoes observed detection dismissals through the logged-in bot Discord client', async () => {
    const { moderator, repository, securityActionService, service } = buildService([
      undoObservedRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.undoObservedDetectionAction).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'det-1',
      moderator
    );
    expect(repository.completed).toEqual([
      {
        id: 'undo-observed-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.UNDO_OBSERVED_DETECTION_ACTION,
          detection_event_id: 'det-1',
          target_user_id: 'user-1',
          undone_action: AdminActionType.FALSE_POSITIVE,
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('ignores detections for future accounting through the logged-in bot Discord client', async () => {
    const { moderator, repository, securityActionService, service } = buildService([
      ignoreDetectionAccountingRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.excludeDetectionFromAccounting).toHaveBeenCalledWith(
      'guild-1',
      'det-1',
      moderator,
      'Accounting ignore reason.'
    );
    expect(repository.completed).toEqual([
      {
        id: 'ignore-detection-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.IGNORE_DETECTION_ACCOUNTING,
          detection_event_id: 'det-1',
          ignored: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('restores detections to future accounting through the logged-in bot Discord client', async () => {
    const { moderator, repository, securityActionService, service } = buildService([
      restoreDetectionAccountingRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.restoreDetectionAccounting).toHaveBeenCalledWith(
      'guild-1',
      'det-1',
      moderator,
      'Accounting restore reason.'
    );
    expect(repository.completed).toEqual([
      {
        id: 'restore-detection-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.RESTORE_DETECTION_ACCOUNTING,
          detection_event_id: 'det-1',
          restored: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('kicks observed alert users through the logged-in bot Discord client', async () => {
    const { member, moderator, repository, securityActionService, service } = buildService(
      [kickObservedRequest],
      { observed_action_kick_enabled: true }
    );

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.kickObservedDetection).toHaveBeenCalledWith(
      member,
      'det-1',
      moderator,
      'Observed kick reason.'
    );
    expect(repository.completed).toEqual([
      {
        id: 'kick-observed-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.KICK_OBSERVED_DETECTION,
          detection_event_id: 'det-1',
          kicked: true,
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('bans observed alert users through the logged-in bot Discord client', async () => {
    const { member, moderator, repository, securityActionService, service } = buildService([
      banObservedRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.banObservedDetection).toHaveBeenCalledWith(
      member,
      'det-1',
      moderator,
      'Observed ban reason.'
    );
    expect(securityActionService.banObservedDetectionById).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([
      {
        id: 'ban-observed-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
          ban_by_id: false,
          banned: true,
          detection_event_id: 'det-1',
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('bans departed observed alert users by ID through the logged-in bot Discord client', async () => {
    const { guild, moderator, repository, securityActionService, service } = buildService([
      banObservedRequest,
    ]);
    guild.members.fetch.mockRejectedValueOnce(new Error('Unknown member'));

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.banObservedDetection).not.toHaveBeenCalled();
    expect(securityActionService.banObservedDetectionById).toHaveBeenCalledWith(
      guild,
      'user-1',
      'det-1',
      moderator,
      'Observed ban reason.'
    );
    expect(repository.completed).toEqual([
      {
        id: 'ban-observed-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
          ban_by_id: true,
          banned: true,
          detection_event_id: 'det-1',
          target_user_id: 'user-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('verifies case users through the logged-in bot Discord client', async () => {
    const { member, moderator, repository, service, userModerationService } = buildService([
      verifyRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.verifyUser).toHaveBeenCalledWith(member, moderator);
    expect(repository.completed).toEqual([
      {
        id: 'verify-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.VERIFY_CASE_USER,
          target_user_id: 'user-1',
          verification_event_id: 'ver-1',
          verified: true,
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('closes cases with no action through the logged-in bot Discord client', async () => {
    const { guild, moderator, repository, service, userModerationService } = buildService([
      closeNoActionRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.closeCaseNoAction).toHaveBeenCalledWith(
      guild,
      'user-1',
      moderator,
      'Closed with no action from the web moderation workbench.'
    );
    expect(repository.completed).toEqual([
      {
        id: 'close-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.CLOSE_CASE_NO_ACTION,
          closed_count: 1,
          target_user_id: 'user-1',
          verification_event_id: 'ver-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('kicks case users through the logged-in bot Discord client', async () => {
    const { member, moderator, repository, service, userModerationService } = buildService([
      kickRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.kickUser).toHaveBeenCalledWith(
      member,
      'Kick reason.',
      moderator,
      undefined
    );
    expect(repository.completed).toEqual([
      {
        id: 'kick-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.KICK_CASE_USER,
          kicked: true,
          target_user_id: 'user-1',
          verification_event_id: 'ver-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('bans case users through the logged-in bot Discord client', async () => {
    const { member, moderator, repository, service, userModerationService } = buildService([
      banRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.banUser).toHaveBeenCalledWith(
      member,
      'Ban reason.',
      moderator,
      undefined
    );
    expect(repository.completed).toEqual([
      {
        id: 'ban-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.BAN_CASE_USER,
          banned: true,
          target_user_id: 'user-1',
          verification_event_id: 'ver-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('bans departed case users by ID through the logged-in bot Discord client', async () => {
    const { guild, moderator, repository, service, userModerationService } = buildService([
      banByIdRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.banUserById).toHaveBeenCalledWith(
      guild,
      'user-1',
      'Ban by ID reason.',
      moderator,
      undefined
    );
    expect(repository.completed).toEqual([
      {
        id: 'ban-id-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.BAN_CASE_USER_BY_ID,
          banned: true,
          target_user_id: 'user-1',
          verification_event_id: 'ver-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('fails destructive case requests when server policy blocks them', async () => {
    const { repository, service, userModerationService } = buildService([banRequest], {
      moderator_ban_action_enabled: false,
    });

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.banUser).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'ban-request-1',
        error: 'Moderator ban action is disabled for this server.',
      },
    ]);
  });

  it('fails destructive case requests when a required reason is missing', async () => {
    const { repository, service, userModerationService } = buildService(
      [{ ...kickRequest, metadata: {} }],
      {
        moderator_kick_action_requires_reason: true,
      }
    );

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.kickUser).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'kick-request-1',
        error: 'Moderator kick action requires a reason.',
      },
    ]);
  });

  it('fails observed kick requests when server policy blocks them', async () => {
    const { repository, securityActionService, service } = buildService([kickObservedRequest]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.kickObservedDetection).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'kick-observed-request-1',
        error: 'Observed alert kick actions are disabled for this server.',
      },
    ]);
  });

  it('fails observed destructive requests when a required reason is missing', async () => {
    const { repository, securityActionService, service } = buildService(
      [{ ...banObservedRequest, metadata: {} }],
      {
        moderator_ban_action_requires_reason: true,
      }
    );

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.banObservedDetection).not.toHaveBeenCalled();
    expect(securityActionService.banObservedDetectionById).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'ban-observed-request-1',
        error: 'Moderator ban action requires a reason.',
      },
    ]);
  });

  it('fails open-admin-case requests when a required reason is missing', async () => {
    const { repository, securityActionService, service } = buildService(
      [{ ...openAdminCaseRequest, metadata: {} }],
      {
        admin_case_open_requires_reason: true,
      }
    );

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.openAdminCase).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'open-admin-case-request-1',
        error: 'Open case action requires a reason.',
      },
    ]);
  });

  it('repairs active cases through the logged-in bot Discord client', async () => {
    const { member, repository, securityActionService, service } = buildService([repairRequest]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.repairActiveCase).toHaveBeenCalledWith(member);
    expect(repository.completed).toEqual([
      {
        id: 'repair-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.REPAIR_ACTIVE_CASE,
          repaired: true,
          target_user_id: 'user-1',
          thread_created: true,
          verification_event_id: 'ver-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('reopens cases through the logged-in bot Discord client', async () => {
    const { moderator, repository, securityActionService, service } = buildService([reopenRequest]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.reopenVerification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ver-1', server_id: 'guild-1', user_id: 'user-1' }),
      moderator
    );
    expect(repository.completed).toEqual([
      {
        id: 'reopen-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.REOPEN_CASE,
          reopened: true,
          target_user_id: 'user-1',
          verification_event_id: 'ver-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('refreshes case notifications through the logged-in bot Discord client', async () => {
    const { repository, securityActionService, service, targetUser } = buildService([
      refreshNotificationRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.refreshCaseNotification).toHaveBeenCalledWith(
      'guild-1',
      targetUser,
      'ver-1'
    );
    expect(repository.completed).toEqual([
      {
        id: 'refresh-notification-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.REFRESH_CASE_NOTIFICATION,
          message: 'Refreshed pending case notification for target#0001.',
          notification_channel_id: 'admin-channel-1',
          notification_message_id: 'admin-message-1',
          refreshed: true,
          status: 'pending',
          target_user_id: 'user-1',
          verification_event_id: 'ver-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('syncs existing Discord bans through the logged-in bot Discord client', async () => {
    const { guild, moderator, repository, service, userModerationService } = buildService([
      syncExistingBanRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.syncAlreadyBannedUser).toHaveBeenCalledWith(
      guild,
      'user-1',
      moderator
    );
    expect(repository.completed).toEqual([
      {
        id: 'sync-ban-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.SYNC_EXISTING_BAN,
          synced_count: 1,
          target_user_id: 'user-1',
          verification_event_id: 'ver-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('completes setup verification through the bot-owned setup workflow', async () => {
    const {
      configService,
      notificationManager,
      productAnalyticsService,
      reportInstructionsChannel,
      repository,
      service,
      setupDiagnosticsService,
    } = buildService([completeSetupVerificationRequest]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledTimes(2);
    expect(notificationManager.setupVerificationChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'guild-1' }),
      'role-1',
      false,
      expect.any(Function)
    );
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      admin_channel_id: 'admin-channel-1',
      case_role_id: 'role-1',
      verification_channel_id: 'created-verification-channel',
    });
    expect(productAnalyticsService.captureGuildEvent).toHaveBeenCalledWith(
      'guild-1',
      'verification setup completed',
      expect.objectContaining({
        admin_channel_configured: true,
        case_role_configured: true,
        verification_channel_configured: true,
        verification_channel_created: true,
      })
    );
    expect(reportInstructionsChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.any(Array),
        embeds: expect.any(Array),
      })
    );
    expect(repository.completed).toEqual([
      {
        id: 'setup-verification-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.COMPLETE_SETUP_VERIFICATION,
          admin_channel_id: 'admin-channel-1',
          case_role_id: 'role-1',
          report_instructions_action: 'sent',
          report_instructions_channel_id: 'report-channel-1',
          report_instructions_message_id: 'report-message-1',
          server_id: 'guild-1',
          verification_channel_action: 'created',
          verification_channel_id: 'created-verification-channel',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('repairs report instructions through the logged-in bot Discord client', async () => {
    const { configService, reportInstructionsChannel, repository, service } = buildService([
      upsertReportInstructionsRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(reportInstructionsChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.any(Array),
        embeds: expect.any(Array),
      })
    );
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'report-channel-1',
      report_instructions_message_id: 'report-message-1',
    });
    expect(repository.completed).toEqual([
      {
        id: 'report-instructions-request-1',
        result: expect.objectContaining({
          action: 'sent',
          action_type: ModerationActionRequestType.UPSERT_REPORT_INSTRUCTIONS,
          channel_id: 'report-channel-1',
          message_id: 'report-message-1',
          server_id: 'guild-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('syncs moderation queue mirrors through the logged-in bot Discord client', async () => {
    const { moderationQueueService, repository, service } = buildService([
      syncModerationQueueRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(moderationQueueService.syncServerQueue).toHaveBeenCalledWith('guild-1');
    expect(repository.completed).toEqual([
      {
        id: 'sync-queue-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.SYNC_MODERATION_QUEUE,
          server_id: 'guild-1',
          synced: true,
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('clears moderation queue mirrors through the logged-in bot Discord client', async () => {
    const { moderationQueueService, repository, service } = buildService([
      clearModerationQueueRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(moderationQueueService.clearServerQueue).toHaveBeenCalledWith('guild-1');
    expect(repository.completed).toEqual([
      {
        id: 'clear-queue-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.CLEAR_MODERATION_QUEUE,
          removed_count: 3,
          server_id: 'guild-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('queues resolved-thread closure sweeps through the bot-owned sweep service', async () => {
    const { caseThreadClosureSweepService, repository, service } = buildService([
      closeResolvedThreadsRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(caseThreadClosureSweepService.sweepResolvedCaseThreads).toHaveBeenCalledWith({
      days: 45,
      execute: true,
      limit: 50,
      serverId: 'guild-1',
    });
    expect(repository.completed).toEqual([
      {
        id: 'close-resolved-threads-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.CLOSE_RESOLVED_CASE_THREADS,
          already_closed_threads: 2,
          checked_cases: 7,
          checked_threads: 10,
          closed_threads: 4,
          days: 45,
          execute: true,
          failed_threads: 1,
          limit: 50,
          missing_threads: 3,
          server_id: 'guild-1',
          would_close_threads: 4,
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('queues case-role lockdown audits through the bot-owned lockdown service', async () => {
    const { caseRoleLockdownService, guild, repository, service } = buildService([
      auditCaseRoleLockdownRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(caseRoleLockdownService.auditGuild).toHaveBeenCalledWith(guild);
    expect(repository.completed).toEqual([
      {
        id: 'audit-lockdown-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.AUDIT_CASE_ROLE_LOCKDOWN,
          applied_writes: 2,
          enabled: true,
          error_count: 1,
          failed_writes: 1,
          planned_writes: 1,
          server_id: 'guild-1',
          synced_allowed_channel_blockers: 1,
          unsynced_allowed_channels: 1,
          warning_count: 1,
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('queues case-role lockdown applies with unsync confirmation metadata', async () => {
    const { caseRoleLockdownService, guild, repository, service } = buildService([
      applyCaseRoleLockdownRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(caseRoleLockdownService.applyGuild).toHaveBeenCalledWith(guild, 'moderator-1', {
      unsyncAllowedChannels: true,
    });
    expect(repository.completed).toEqual([
      {
        id: 'apply-lockdown-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.APPLY_CASE_ROLE_LOCKDOWN,
          applied_writes: 2,
          planned_writes: 1,
          server_id: 'guild-1',
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('queues role intake through the bot-owned security service', async () => {
    const { moderator, repository, role, securityActionService, service } = buildService([
      roleIntakeRequest,
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.intakeRoleMembers).toHaveBeenCalledWith({
      action: 'open_case',
      execute: true,
      limit: 25,
      moderator,
      reason: 'Bulk intake reason.',
      role,
    });
    expect(repository.completed).toEqual([
      {
        id: 'role-intake-request-1',
        result: expect.objectContaining({
          action_type: ModerationActionRequestType.INTAKE_ROLE_MEMBERS,
          batch_id: 'role-intake-batch-1',
          eligible_members: 10,
          execute: true,
          failed: 1,
          opened: 8,
          processed: 9,
          role_id: 'role-1',
          role_name: 'Manual Intake',
          server_id: 'guild-1',
          skipped_active_cases: 1,
          skipped_bots: 2,
          skipped_over_limit: 3,
          total_members: 15,
        }),
      },
    ]);
    expect(repository.failed).toEqual([]);
  });

  it('fails role intake execution when configured policy requires a reason', async () => {
    const { repository, securityActionService, service } = buildService(
      [{ ...roleIntakeRequest, metadata: { execute: true, role_id: 'role-1' } }],
      { admin_case_open_requires_reason: true }
    );

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.intakeRoleMembers).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'role-intake-request-1',
        error: 'Role intake execution requires a case reason.',
      },
    ]);
  });

  it('previews a case-scoped cleanup job for a current administrator', async () => {
    const { messageCleanupService, messageDeletionJobs, repository, service } = buildService([
      previewMessageCleanupRequest,
    ]);
    messageDeletionJobs.findById.mockResolvedValue(messageCleanupJob);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(messageCleanupService.previewJob).toHaveBeenCalledWith('cleanup-job-1');
    expect(repository.completed[0]).toEqual({
      id: 'preview-cleanup-request-1',
      result: expect.objectContaining({
        candidate_count: 2,
        coverage: MessageDeletionCoverage.READY,
        message_deletion_job_id: 'cleanup-job-1',
      }),
    });
    expect(repository.failed).toEqual([]);
  });

  it('fails the preview job when worker Administrator preflight fails', async () => {
    const { messageCleanupService, messageDeletionJobs, reporterMember, repository, service } =
      buildService([previewMessageCleanupRequest]);
    messageDeletionJobs.findById.mockResolvedValue(messageCleanupJob);
    reporterMember.permissions.has.mockReturnValue(false);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(messageCleanupService.previewJob).not.toHaveBeenCalled();
    expect(messageDeletionJobs.fail).toHaveBeenCalledWith(
      'cleanup-job-1',
      'Message cleanup requires current Administrator permission.'
    );
    expect(repository.failed).toEqual([
      {
        id: 'preview-cleanup-request-1',
        error: 'Message cleanup requires current Administrator permission.',
      },
    ]);
  });

  it('executes a frozen delete-only cleanup job', async () => {
    const { messageCleanupService, messageDeletionJobs, repository, service } = buildService([
      executeMessageCleanupRequest,
    ]);
    messageDeletionJobs.findById.mockResolvedValue(messageCleanupJob);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(messageCleanupService.executeJob).toHaveBeenCalledWith('cleanup-job-1');
    expect(repository.completed[0]).toEqual({
      id: 'execute-cleanup-request-1',
      result: expect.objectContaining({
        deleted_count: 1,
        changed_since_preview_count: 1,
        preserved_count: 2,
      }),
    });
  });

  it('revalidates Administrator permission in the worker', async () => {
    const { messageCleanupService, messageDeletionJobs, reporterMember, repository, service } =
      buildService([executeMessageCleanupRequest]);
    messageDeletionJobs.findById.mockResolvedValue(messageCleanupJob);
    reporterMember.permissions.has.mockReturnValue(false);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(messageCleanupService.executeJob).not.toHaveBeenCalled();
    expect(repository.failed).toEqual([
      {
        id: 'execute-cleanup-request-1',
        error: 'Message cleanup requires current Administrator permission.',
      },
    ]);
  });

  it('bans first, cleans up second, and finalizes the case last', async () => {
    const {
      messageCleanupService,
      messageDeletionJobs,
      repository,
      service,
      userModerationService,
    } = buildService([combinedBanCleanupRequest]);
    messageDeletionJobs.findById.mockResolvedValue({
      ...messageCleanupJob,
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
    });

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.markCombinedBanCleanupPending).toHaveBeenCalledWith(
      'ver-1',
      'cleanup-job-1'
    );
    expect(userModerationService.performDiscordBanById.mock.invocationCallOrder[0]).toBeLessThan(
      messageCleanupService.executeJob.mock.invocationCallOrder[0]
    );
    expect(messageCleanupService.executeJob.mock.invocationCallOrder[0]).toBeLessThan(
      userModerationService.finalizeSuccessfulCombinedBan.mock.invocationCallOrder[0]
    );
    expect(repository.completed[0]).toEqual({
      id: 'combined-cleanup-request-1',
      result: expect.objectContaining({
        banned: true,
        case_finalized: true,
        deleted_count: 1,
      }),
    });
    expect(repository.complete.mock.invocationCallOrder[0]).toBeLessThan(
      userModerationService.clearCombinedBanCleanupMarker.mock.invocationCallOrder[0]
    );
  });

  it('clears the combined marker and skips cleanup when the Discord ban fails', async () => {
    const {
      messageCleanupService,
      messageDeletionJobs,
      repository,
      service,
      userModerationService,
    } = buildService([combinedBanCleanupRequest]);
    messageDeletionJobs.findById.mockResolvedValue({
      ...messageCleanupJob,
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
    });
    userModerationService.performDiscordBanById.mockRejectedValue(new Error('ban denied'));

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.clearCombinedBanCleanupMarker).toHaveBeenCalledWith(
      'ver-1',
      'cleanup-job-1'
    );
    expect(messageCleanupService.executeJob).not.toHaveBeenCalled();
    expect(repository.failed).toEqual([{ id: 'combined-cleanup-request-1', error: 'ban denied' }]);
  });

  it('retries a combined cleanup job whose previous ban attempt failed', async () => {
    const { messageDeletionJobs, repository, service, userModerationService } = buildService([
      combinedBanCleanupRequest,
    ]);
    messageDeletionJobs.findById.mockResolvedValue({
      ...messageCleanupJob,
      ban_status: MessageDeletionBanStatus.FAILED,
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
    });

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.performDiscordBanById).toHaveBeenCalled();
    expect(messageDeletionJobs.updateBanStatus).toHaveBeenNthCalledWith(
      1,
      'cleanup-job-1',
      MessageDeletionBanStatus.PENDING
    );
    expect(messageDeletionJobs.updateBanStatus).toHaveBeenNthCalledWith(
      2,
      'cleanup-job-1',
      MessageDeletionBanStatus.SUCCEEDED
    );
    expect(repository.completed).toHaveLength(1);
  });

  it('resumes cleanup without repeating a durable successful ban', async () => {
    const { messageCleanupService, messageDeletionJobs, service, userModerationService } =
      buildService([combinedBanCleanupRequest]);
    messageDeletionJobs.findById.mockResolvedValue({
      ...messageCleanupJob,
      ban_status: MessageDeletionBanStatus.SUCCEEDED,
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
      status: MessageDeletionJobStatus.EXECUTING,
    });

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.performDiscordBanById).not.toHaveBeenCalled();
    expect(messageCleanupService.executeJob).toHaveBeenCalledWith('cleanup-job-1');
    expect(userModerationService.finalizeSuccessfulCombinedBan).toHaveBeenCalled();
  });

  it('completes a recovered request without repeating durable case finalization', async () => {
    const {
      messageCleanupService,
      messageDeletionJobs,
      repository,
      service,
      userModerationService,
    } = buildService([combinedBanCleanupRequest]);
    messageDeletionJobs.findById.mockResolvedValue({
      ...messageCleanupJob,
      ban_status: MessageDeletionBanStatus.SUCCEEDED,
      case_finalization_status: MessageDeletionCaseFinalizationStatus.SUCCEEDED,
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
      status: MessageDeletionJobStatus.COMPLETED,
    });

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.performDiscordBanById).not.toHaveBeenCalled();
    expect(messageCleanupService.executeJob).toHaveBeenCalledWith('cleanup-job-1');
    expect(userModerationService.finalizeSuccessfulCombinedBan).not.toHaveBeenCalled();
    expect(repository.completed).toHaveLength(1);
    expect(userModerationService.clearCombinedBanCleanupMarker).toHaveBeenCalledWith(
      'ver-1',
      'cleanup-job-1'
    );
  });

  it('leaves finalization untouched and clears the marker when cleanup fails after the ban', async () => {
    const {
      messageCleanupService,
      messageDeletionJobs,
      repository,
      service,
      userModerationService,
    } = buildService([combinedBanCleanupRequest]);
    messageDeletionJobs.findById.mockResolvedValue({
      ...messageCleanupJob,
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
    });
    messageCleanupService.executeJob.mockRejectedValue(new Error('cleanup interrupted'));

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.finalizeSuccessfulCombinedBan).not.toHaveBeenCalled();
    expect(messageDeletionJobs.updateCaseFinalizationStatus).not.toHaveBeenCalled();
    expect(userModerationService.clearCombinedBanCleanupMarker).toHaveBeenCalledWith(
      'ver-1',
      'cleanup-job-1'
    );
    expect(repository.failed).toEqual([
      { id: 'combined-cleanup-request-1', error: 'cleanup interrupted' },
    ]);
  });

  it('records failed finalization and clears the marker after cleanup completes', async () => {
    const { messageDeletionJobs, repository, service, userModerationService } = buildService([
      combinedBanCleanupRequest,
    ]);
    messageDeletionJobs.findById.mockResolvedValue({
      ...messageCleanupJob,
      mode: MessageDeletionJobMode.BAN_WITH_CLEANUP,
    });
    userModerationService.finalizeSuccessfulCombinedBan.mockRejectedValue(
      new Error('thread finalization failed')
    );

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(messageDeletionJobs.updateCaseFinalizationStatus).toHaveBeenLastCalledWith(
      'cleanup-job-1',
      MessageDeletionCaseFinalizationStatus.FAILED
    );
    expect(userModerationService.clearCombinedBanCleanupMarker).toHaveBeenCalledWith(
      'ver-1',
      'cleanup-job-1'
    );
    expect(repository.failed).toEqual([
      { id: 'combined-cleanup-request-1', error: 'thread finalization failed' },
    ]);
  });

  it('fails invalid open-case requests without calling moderation side effects', async () => {
    const { repository, securityActionService, service, userModerationService } = buildService([
      { ...baseRequest, target_user_id: null },
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.openObservedDetectionCase).not.toHaveBeenCalled();
    expect(securityActionService.openAdminCase).not.toHaveBeenCalled();
    expect(securityActionService.handleManualFlag).not.toHaveBeenCalled();
    expect(securityActionService.banObservedDetection).not.toHaveBeenCalled();
    expect(securityActionService.banObservedDetectionById).not.toHaveBeenCalled();
    expect(securityActionService.dismissObservedDetection).not.toHaveBeenCalled();
    expect(securityActionService.kickObservedDetection).not.toHaveBeenCalled();
    expect(securityActionService.repairActiveCase).not.toHaveBeenCalled();
    expect(securityActionService.reopenVerification).not.toHaveBeenCalled();
    expect(userModerationService.verifyUser).not.toHaveBeenCalled();
    expect(userModerationService.kickUser).not.toHaveBeenCalled();
    expect(userModerationService.banUser).not.toHaveBeenCalled();
    expect(userModerationService.banUserById).not.toHaveBeenCalled();
    expect(userModerationService.closeCaseNoAction).not.toHaveBeenCalled();
    expect(userModerationService.syncAlreadyBannedUser).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'request-1',
        error: 'Open-case request is missing target user or detection event.',
      },
    ]);
  });

  it('fails invalid case action requests without calling moderation side effects', async () => {
    const { repository, securityActionService, service, userModerationService } = buildService([
      { ...verifyRequest, verification_event_id: null },
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(userModerationService.verifyUser).not.toHaveBeenCalled();
    expect(userModerationService.kickUser).not.toHaveBeenCalled();
    expect(userModerationService.banUser).not.toHaveBeenCalled();
    expect(userModerationService.banUserById).not.toHaveBeenCalled();
    expect(userModerationService.closeCaseNoAction).not.toHaveBeenCalled();
    expect(userModerationService.syncAlreadyBannedUser).not.toHaveBeenCalled();
    expect(securityActionService.refreshCaseNotification).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'verify-request-1',
        error: 'Verify-case request is missing target user or case id.',
      },
    ]);
  });

  it('fails invalid refresh-notification requests without calling Discord updates', async () => {
    const { repository, securityActionService, service } = buildService([
      { ...refreshNotificationRequest, verification_event_id: null },
    ]);

    await expect(service.processPendingRequests()).resolves.toBe(1);

    expect(securityActionService.refreshCaseNotification).not.toHaveBeenCalled();
    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([
      {
        id: 'refresh-notification-request-1',
        error: 'Refresh-notification request is missing target user or case id.',
      },
    ]);
  });

  it('returns zero when no action request is queued', async () => {
    const { repository, service } = buildService([]);

    await expect(service.processPendingRequests()).resolves.toBe(0);

    expect(repository.completed).toEqual([]);
    expect(repository.failed).toEqual([]);
  });
});
