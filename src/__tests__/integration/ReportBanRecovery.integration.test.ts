import { mock } from 'jest-mock-extended';
import type { IIntegrityAuditService } from '../../services/IntegrityAuditService';
import type { ICaseRoleLockdownService } from '../../services/CaseRoleLockdownService';
import type { ICaseThreadClosureSweepService } from '../../services/CaseThreadClosureSweepService';
import { ModerationCommandHandler } from '../../controllers/ModerationCommandHandler';
import { handleSlashCommandConfirmationButton } from '../../utils/slashCommandConfirmations';
import { createBotApplication } from '../../application/createBotApplication';
import { Prisma, PrismaClient } from '../../db/prisma';
import { CaseRoleReleaseReconciliationService } from '../../services/CaseRoleReleaseReconciliationService';
import { RoleQuarantineSnapshotRepository } from '../../repositories/RoleQuarantineSnapshotRepository';
import { Pool } from 'pg';
import { insertModerationActionRequestWithReceipt } from '../../../apps/web/lib/moderationActionRequestQueue';
jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
import { MessageContextRepository } from '../../repositories/MessageContextRepository';
import {
  RoleQuarantineService,
  IRoleQuarantineService,
} from '../../services/RoleQuarantineService';
import { NotificationManager } from '../../services/NotificationManager';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  Role,
  User,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from 'discord.js';
import { SecurityActionService } from '../../services/SecurityActionService';
import { UserModerationService } from '../../services/UserModerationService';
import { AdminActionService } from '../../services/AdminActionService';
import { ModerationOutcomeService } from '../../services/ModerationOutcomeService';
import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';
import { ModerationEvidenceService } from '../../services/ModerationEvidenceService';
import {
  AdminActionType,
  CaseKind,
  ModerationOutcomeSource,
  DetectionType,
  ModerationActionRequestType,
  ModerationActionRequestCreate,
  ReportIntakeStatus,
  VerificationStatus,
} from '../../repositories/types';
import { getPrismaClient } from '../testDb';
import {
  getReportBanAttemptToken,
  ModerationActionRequestRepository,
} from '../../repositories/ModerationActionRequestRepository';
import { AdminActionRepository } from '../../repositories/AdminActionRepository';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { ModerationOutcomeRepository } from '../../repositories/ModerationOutcomeRepository';
import { ReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import { ServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';

async function fixture(withReport = true, quarantine?: IRoleQuarantineService) {
  const prisma = getPrismaClient();
  const detections = new DetectionEventsRepository(prisma);
  const reports = new ReportIntakeRepository(prisma);
  const requests = new ModerationActionRequestRepository(prisma);
  const cases = new VerificationEventRepository(prisma);
  const members = new ServerMemberRepository(prisma);
  const servers = new ServerRepository(prisma);
  const users = new UserRepository(prisma);
  const actionRepo = new AdminActionRepository(prisma);
  const outcomeRepo = new ModerationOutcomeRepository(prisma);
  const actions = new AdminActionService(actionRepo, users, servers);
  const outcomes = new ModerationOutcomeService(outcomeRepo, servers, users);
  const user = {
    id: 'target',
    username: 'target',
    tag: 'target#0001',
    createdTimestamp: 1,
    displayAvatarURL: () => 'https://example.test/avatar.png',
  } as User;
  const moderator = { id: 'moderator' } as User;
  const ban = jest.fn().mockResolvedValue(undefined);
  const banFetch = jest.fn().mockResolvedValue({ user });
  const guild = {
    id: 'guild',
    roles: { fetch: jest.fn() },
    bans: { create: ban, fetch: banFetch },
    members: {
      fetch: jest.fn(),
      fetchMe: jest.fn().mockResolvedValue({ permissions: { has: () => true } }),
    },
  } as unknown as Guild;
  const client = {
    guilds: { fetch: jest.fn().mockResolvedValue(guild), cache: new Map() },
    users: { fetch: jest.fn().mockResolvedValue(moderator) },
    channels: { fetch: jest.fn() },
  } as unknown as Client;
  const member = {
    id: user.id,
    joinedAt: new Date('2025-01-01T00:00:00Z'),
    guild,
    user,
    client: { users: { fetch: jest.fn().mockResolvedValue(user) } },
    ban,
  } as unknown as GuildMember;
  (guild.members.fetch as jest.Mock).mockImplementation(async (id) =>
    (typeof id === 'object' ? id.user : id) === moderator.id
      ? {
          id: moderator.id,
          permissions: { has: () => true, bitfield: 8n },
          roles: { cache: new Map() },
        }
      : member
  );
  const notifications = {
    markObservedDetectionActionTaken: jest.fn().mockResolvedValue(true),
    restoreObservedDetectionActions: jest.fn().mockResolvedValue(true),
    updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
    logActionToMessage: jest.fn().mockResolvedValue(true),
    upsertSuspiciousUserNotification: jest
      .fn()
      .mockResolvedValue({ id: 'notice', channelId: 'admin' }),
  };
  const threads = {
    resolveVerificationThread: jest.fn().mockResolvedValue(true),
    closeResolvedVerificationThreads: jest.fn().mockResolvedValue({ results: [] }),
    createVerificationThread: jest.fn().mockResolvedValue({ id: 'case-thread' }),
    createPrivateEvidenceThread: jest.fn().mockResolvedValue({
      id: 'evidence-thread',
      send: jest.fn().mockResolvedValue({ id: 'evidence' }),
    }),
    createReportReviewThread: jest.fn(),
    retireReportConfirmationPrompts: jest.fn().mockResolvedValue(undefined),
  };
  const roles = {
    getCaseRoleId: jest.fn().mockResolvedValue('case-role'),
    assignCaseRole: jest.fn().mockResolvedValue(true),
    removeCaseRole: jest.fn().mockResolvedValue(true),
  };
  const queue = {
    upsertCaseMirror: jest.fn().mockResolvedValue(undefined),
    upsertObservedAlertMirror: jest.fn().mockResolvedValue(undefined),
    deletePendingScreeningMember: jest.fn().mockResolvedValue(undefined),
    deleteObservedAlertMirror: jest.fn().mockResolvedValue(undefined),
    deleteReportThreadAttention: jest.fn().mockResolvedValue(undefined),
    deleteCaseMirror: jest.fn().mockResolvedValue(undefined),
    deleteCaseAttention: jest.fn().mockResolvedValue(undefined),
  };
  const moderation = new UserModerationService(
    members,
    notifications as never,
    roles as never,
    cases,
    actions,
    threads as never,
    undefined,
    outcomes,
    queue as never,
    quarantine
  );
  const analytics = { captureUserEvent: jest.fn().mockResolvedValue(undefined) };
  const contexts = new MessageContextRepository(prisma);
  const evidence = new ModerationEvidenceService(detections, contexts);
  const security = new SecurityActionService(
    notifications as never,
    detections,
    members,
    cases,
    users,
    servers,
    actions,
    threads as never,
    moderation,
    client,
    undefined,
    analytics as never,
    queue as never,
    undefined,
    undefined,
    reports,
    undefined,
    undefined,
    evidence,
    requests
  );
  await servers.getOrCreateServer('guild');
  await Promise.all(['target', 'moderator', 'reporter'].map((id) => users.getOrCreateUser(id)));
  const report = await reports.create({
    serverId: guild.id,
    reporterId: 'reporter',
    confirmedTargetUserId: user.id,
    status: ReportIntakeStatus.SUBMITTED,
    metadata: { reporter_evidence: 'kept' },
  });
  const detection = await detections.create({
    server_id: guild.id,
    user_id: user.id,
    detection_type: DetectionType.USER_REPORT,
    confidence: 1,
    metadata: withReport ? { reportIntakeId: report.id } : {},
  });
  const request = await requests.enqueue({
    serverId: guild.id,
    actorId: moderator.id,
    actorSurface: 'web',
    targetUserId: user.id,
    ...(withReport ? { reportIntakeId: report.id } : {}),
    detectionEventId: detection.id,
    actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
    idempotencyKey: 'ban:report',
    metadata: { reason: 'Confirmed spam' },
  });
  const execute = (byId = false) =>
    byId
      ? security.banObservedDetectionById(
          guild,
          user.id,
          detection.id,
          moderator,
          'Confirmed spam',
          request
        )
      : security.banObservedDetection(member, detection.id, moderator, 'Confirmed spam', request);
  const config = {
    getServerConfig: jest
      .fn()
      .mockResolvedValue({ settings: { moderator_ban_action_enabled: true } }),
  };
  const application = createBotApplication({
    reportIntakeService: {} as any,
    integrityAuditService: mock<IIntegrityAuditService>(),
    caseRoleLockdownService: mock<ICaseRoleLockdownService>(),
    caseThreadClosureSweepService: mock<ICaseThreadClosureSweepService>(),
    messageDeletionJobs: {} as never,
    messageCleanupService: {} as never,
    captchaChallengeService: null,
    threadManager: threads as never,
    notificationManager: notifications as never,
    accountQuarantineService: null,
    client,
    actionRequests: requests,
    configService: config as never,
    securityActionService: security,
    userModerationService: moderation,
    detectionEventsRepository: detections,
    verificationEventRepository: cases,
    roleGateService: null,
    queueService: queue as never,
    queueRepository: {} as never,
  });
  const worker = () =>
    new ModerationActionRequestService(
      requests,
      cases,
      client,
      threads as never,
      {} as never,
      config as never,
      security,
      moderation,
      queue as never,
      {} as never,
      {} as never,
      notifications as never,
      {} as never,
      {} as never,
      application
    );
  return {
    application,
    config,
    analytics,
    detections,
    reports,
    requests,
    cases,
    members,
    actions,
    outcomes,
    actionRepo,
    outcomeRepo,
    user,
    moderator,
    guild,
    client,
    member,
    ban,
    banFetch,
    notifications,
    threads,
    roles,
    queue,
    moderation,
    evidence,
    contexts,
    security,
    report,
    detection,
    request,
    execute,
    worker,
  };
}

const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration('report-ban stale worker recovery with real services and Postgres', () => {
  it.each(
    ['observed', 'case'].flatMap((path) =>
      [
        'stored-deleted',
        'stored-fallback-deleted',
        'unknown-config',
        'configured-deleted',
        'stored-valid-unconfigured',
        'stored-valid-changed',
        'stored-null',
        'stored-wrong-guild',
        'stored-wrong-type',
        'stored-permission',
        'stored-network',
        'no-channel',
      ].map((mode) => ({
        path,
        mode,
      }))
    )
  )('resolves existing notification provenance: $path $mode', async ({ path, mode }) => {
    const f = await fixture();
    const stored = mode.startsWith('stored') ? 'stored-channel' : null;
    if (path === 'observed')
      await f.detections.patchMetadata(f.detection.id, {
        observed_notification_message_id: 'notice',
        observed_notification_channel_id: stored,
      });
    else {
      const event = await f.cases.createFromDetection(
        f.detection.id,
        'guild',
        'target',
        VerificationStatus.PENDING
      );
      await f.cases.update(event.id, {
        notification_message_id: 'notice',
        notification_channel_id: stored,
      });
    }
    const fetchMessage = jest.fn().mockResolvedValue({
      embeds: [new EmbedBuilder().setTitle('Notice')],
      edit: jest.fn().mockResolvedValue(undefined),
    });
    const channel = {
      id: 'stored-channel',
      type: ChannelType.GuildText,
      guildId: 'guild',
      messages: { fetch: fetchMessage },
    };
    (f.client.channels.fetch as jest.Mock).mockImplementation(async () => {
      if (mode.endsWith('deleted')) throw { code: 10003 };
      if (mode === 'stored-null') return null;
      if (mode === 'stored-wrong-guild') return { ...channel, guildId: 'other-guild' };
      if (mode === 'stored-wrong-type') return { ...channel, type: ChannelType.DM };
      if (mode === 'stored-permission') throw { code: 50013 };
      if (mode === 'stored-network') throw new Error('channel lookup timeout');
      return channel;
    });
    const config = {
      getServerConfig: jest.fn().mockResolvedValue({
        settings: ['configured-deleted', 'stored-valid-changed'].includes(mode)
          ? { observed_detection_notification_channel_id: 'configured-channel' }
          : {},
      }),
      getAdminChannel: jest
        .fn()
        .mockResolvedValue(mode === 'stored-fallback-deleted' ? channel : undefined),
    };
    if (mode === 'unknown-config')
      config.getServerConfig.mockRejectedValue(new Error('config lookup failed'));
    const manager = new NotificationManager(f.client, config as never, f.detections);
    f.notifications.markObservedDetectionActionTaken.mockImplementation(
      manager.markObservedDetectionActionTaken.bind(manager)
    );
    f.notifications.logActionToMessage.mockImplementation(manager.logActionToMessage.bind(manager));
    f.notifications.updateNotificationButtons.mockImplementation(
      manager.updateNotificationButtons.bind(manager)
    );
    const result = await f.execute();
    if (mode.endsWith('deleted') || mode.startsWith('stored-valid'))
      expect(result).toEqual({ status: 'banned' });
    else {
      expect(result).toMatchObject({ status: 'banned_updates_pending' });
      expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
        report_ban_phase: 'discord_confirmed',
      });
      (f.client.channels.fetch as jest.Mock).mockResolvedValue(channel);
      config.getAdminChannel.mockResolvedValue(channel as never);
      config.getServerConfig.mockResolvedValue({ settings: {} });
      expect(
        await f.security.reconcileReportBan((await f.requests.findById(f.request.id))!)
      ).toEqual({ status: 'banned' });
    }
    expect((await f.requests.findById(f.request.id))?.status).toBe('completed');
    expect((await f.reports.findById(f.report.id))?.status).toBe('actioned');
    expect(f.ban).toHaveBeenCalledTimes(1);
    expect(
      (await f.actionRepo.getActionHistory('target', 'guild')).filter(
        (action) => action.action_type === 'ban'
      )
    ).toHaveLength(1);
    if (stored) expect(config.getAdminChannel).not.toHaveBeenCalled();
    if (mode.endsWith('deleted')) expect(fetchMessage).not.toHaveBeenCalled();
  });
  it.each(
    ['bot', 'web'].flatMap((surface) =>
      [true, false].map((withReport) => ({ surface, withReport }))
    )
  )(
    'explicitly requeues an undone dismissal after its queued ban no-op: $surface report=$withReport',
    async ({ surface, withReport }) => {
      const f = await fixture(withReport);
      expect(
        await f.security.dismissObservedDetection(
          'guild',
          'target',
          f.detection.id,
          f.moderator,
          AdminActionType.DISMISS
        )
      ).toBe(true);
      await f.worker().processPendingRequests();
      const completed = (await f.requests.findById(f.request.id))!;
      expect(completed).toMatchObject({
        status: 'completed',
        result: { observed_ban_result: { status: 'already_handled' } },
      });
      expect(f.ban).not.toHaveBeenCalled();
      expect(
        await f.security.undoObservedDetectionAction('guild', 'target', f.detection.id, f.moderator)
      ).toBe(AdminActionType.DISMISS);
      expect((await f.reports.findById(f.report.id))?.status).toBe('submitted');
      const input = {
        serverId: 'guild',
        targetUserId: 'target',
        actorId: 'new-moderator',
        actorSurface: 'web',
        detectionEventId: f.detection.id,
        reportIntakeId: withReport ? f.report.id : undefined,
        idempotencyKey: f.request.idempotency_key,
        actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
        metadata: {
          reason: 'Fresh explicit decision',
          report_ban_attempt_token: 'untrusted-token',
          observed_ban_reviews: [],
        },
      };
      await new UserRepository(getPrismaClient()).getOrCreateUser('new-moderator');
      (f.guild.members.fetch as jest.Mock).mockImplementation(async (input) =>
        (typeof input === 'object' ? input.user : input) === 'target'
          ? f.member
          : {
              id: typeof input === 'object' ? input.user : input,
              permissions: { has: () => true, bitfield: 8n },
              roles: { cache: new Map() },
            }
      );
      (f.client.users.fetch as jest.Mock).mockImplementation(async (id) => ({ id }));
      await getPrismaClient().moderation_action_requests.update({
        where: { id: f.request.id },
        data: {
          metadata: {
            ...(completed.metadata as Record<string, never>),
            observed_ban_reviews: [{ reason: 'retained review' }],
          },
        },
      });
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      try {
        const requeue = () =>
          surface === 'bot'
            ? f.requests.enqueue(input)
            : insertModerationActionRequestWithReceipt(pool, input);
        const [receipt] = await Promise.all([requeue(), requeue()]);
        expect(receipt.status).toBe('queued');
        const fresh = (await f.requests.findById(f.request.id))!;
        expect(getReportBanAttemptToken(fresh)).not.toBe(getReportBanAttemptToken(completed));
        expect(getReportBanAttemptToken(fresh)).not.toBe('untrusted-token');
        expect(fresh).toMatchObject({
          actor_id: 'new-moderator',
          result: {},
          completed_at: null,
          started_at: null,
          attempts: 0,
          metadata: {
            reason: 'Fresh explicit decision',
            observed_ban_reviews: [{ reason: 'retained review' }],
          },
        });
        await requeue();
        expect(getReportBanAttemptToken((await f.requests.findById(fresh.id))!)).toBe(
          getReportBanAttemptToken(fresh)
        );
        await f.requests.complete(
          fresh.id,
          { observed_ban_result: { status: 'banned' } },
          getReportBanAttemptToken(completed)
        );
        expect((await f.requests.findById(fresh.id))?.status).toBe('queued');
        await f.worker().processPendingRequests();
        expect(f.ban).toHaveBeenCalledTimes(1);
        expect((await f.requests.findById(fresh.id))?.result).toMatchObject({
          observed_ban_result: { status: 'banned' },
        });
        expect(
          (await f.actionRepo.getActionHistory('target', 'guild')).filter(
            (action) => action.action_type === 'ban'
          )
        ).toHaveLength(1);
      } finally {
        await pool.end();
      }
    }
  );
  it.each(
    ['bot', 'web'].flatMap((surface) =>
      [
        'banned',
        'banned_updates_pending',
        'ban_outcome_unknown',
        'nonexact-receipt',
        'processing',
        'phase',
        'enforcement',
        'enforcement-operation',
        'confirmation',
        'handled',
        'detection-owned',
        'dismissed',
        'report-owned',
        'changed-report-target',
        'changed-target',
        'changed-server',
        'changed-detection',
        'changed-report',
        'changed-action',
      ].map((guard) => ({ surface, guard }))
    )
  )('preserves a protected no-op retry: $surface $guard', async ({ surface, guard }) => {
    const f = await fixture();
    await f.requests.complete(
      f.request.id,
      { observed_ban_result: { status: 'already_handled' } },
      getReportBanAttemptToken(f.request)
    );
    const input: ModerationActionRequestCreate & { metadata: Record<string, string> } = {
      serverId: 'guild',
      actorId: 'moderator',
      actorSurface: 'web',
      targetUserId: 'target',
      actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
      detectionEventId: f.detection.id,
      reportIntakeId: f.report.id,
      idempotencyKey: f.request.idempotency_key,
      metadata: { reason: 'Must not replace protected request' },
    };
    const prisma = getPrismaClient();
    if (
      ['banned', 'banned_updates_pending', 'ban_outcome_unknown', 'nonexact-receipt'].includes(
        guard
      )
    )
      await prisma.moderation_action_requests.update({
        where: { id: f.request.id },
        data: {
          result: {
            observed_ban_result:
              guard === 'nonexact-receipt'
                ? { status: 'already_handled', enforcement: true }
                : { status: guard },
          },
        },
      });
    if (guard === 'processing')
      await prisma.moderation_action_requests.update({
        where: { id: f.request.id },
        data: { status: 'processing' },
      });
    const marker = {
      phase: 'report_ban_phase',
      enforcement: 'report_ban_enforcement_id',
      'enforcement-operation': 'report_ban_enforcement_operation_id',
      confirmation: 'report_ban_confirmed_at',
    }[guard];
    if (marker)
      await prisma.moderation_action_requests.update({
        where: { id: f.request.id },
        data: {
          metadata: {
            ...(f.request.metadata as Record<string, never>),
            [marker]: marker === 'report_ban_phase' ? 'preparing' : 'existing-evidence',
          },
        },
      });
    if (guard === 'handled')
      await f.detections.patchMetadata(f.detection.id, { observed_action: { action: 'dismiss' } });
    if (guard === 'detection-owned')
      await f.detections.patchMetadata(f.detection.id, {
        report_ban_operation_id: 'other-operation',
      });
    if (guard === 'dismissed')
      await prisma.report_intakes.update({
        where: { id: f.report.id },
        data: { status: 'dismissed' },
      });
    if (guard === 'report-owned')
      await prisma.report_intakes.update({
        where: { id: f.report.id },
        data: { metadata: { report_ban_operation_id: 'other-operation' } },
      });
    if (guard === 'changed-report-target')
      await prisma.report_intakes.update({
        where: { id: f.report.id },
        data: { confirmed_target_user_id: 'reporter' },
      });
    if (guard === 'changed-target') input.targetUserId = 'reporter';
    if (guard === 'changed-server') {
      await new ServerRepository(prisma).getOrCreateServer('other-guild');
      input.serverId = 'other-guild';
    }
    if (guard === 'changed-detection')
      input.detectionEventId = (
        await f.detections.create({
          server_id: 'guild',
          user_id: 'target',
          detection_type: DetectionType.USER_REPORT,
          confidence: 1,
          metadata: { reportIntakeId: f.report.id },
        })
      ).id;
    if (guard === 'changed-report') input.reportIntakeId = undefined;
    if (guard === 'changed-action')
      input.actionType = ModerationActionRequestType.OPEN_CASE_FROM_OBSERVED_DETECTION;
    const before = await f.requests.findById(f.request.id);
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      if (surface === 'bot') await f.requests.enqueue(input);
      else await insertModerationActionRequestWithReceipt(pool, input);
      expect(await f.requests.findById(f.request.id)).toEqual(before);
      expect(f.ban).not.toHaveBeenCalled();
    } finally {
      await pool.end();
    }
  });
  it.each(['bot', 'web'])(
    'stops a stale explicit retry when dismissal wins before the worker claim: %s',
    async (surface) => {
      const f = await fixture();
      const dismiss = () =>
        f.security.dismissObservedDetection(
          'guild',
          'target',
          f.detection.id,
          f.moderator,
          AdminActionType.DISMISS
        );
      expect(await dismiss()).toBe(true);
      await f.worker().processPendingRequests();
      expect(
        await f.security.undoObservedDetectionAction('guild', 'target', f.detection.id, f.moderator)
      ).toBe(AdminActionType.DISMISS);
      const input = {
        serverId: 'guild',
        actorId: 'moderator',
        actorSurface: 'web',
        targetUserId: 'target',
        actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
        detectionEventId: f.detection.id,
        reportIntakeId: f.report.id,
        idempotencyKey: f.request.idempotency_key,
      };
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      try {
        const queued =
          surface === 'bot'
            ? await f.requests.enqueue(input)
            : await insertModerationActionRequestWithReceipt(pool, input);
        expect(queued.status).toBe('queued');
        expect(await dismiss()).toBe(true);
        await f.worker().processPendingRequests();
        expect(f.ban).not.toHaveBeenCalled();
        expect((await f.requests.findById(f.request.id))?.result).toMatchObject({
          observed_ban_result: { status: 'already_handled' },
        });
        expect((await f.reports.findById(f.report.id))?.status).toBe('dismissed');
        expect(
          (await f.actionRepo.getActionHistory('target', 'guild')).filter(
            (action) => action.action_type === 'ban'
          )
        ).toHaveLength(0);
      } finally {
        await pool.end();
      }
    }
  );
  it.each(
    ['fetch', 'send', 'archive'].flatMap((boundary) =>
      ['deleted', 'permission', 'network'].map((failure) => ({ boundary, failure }))
    )
  )('handles a missing report thread at $boundary: $failure', async ({ boundary, failure }) => {
    const f = await fixture();
    await getPrismaClient().report_intakes.update({
      where: { id: f.report.id },
      data: { thread_id: 'report-thread' },
    });
    const thread = {
      isThread: () => true,
      archived: false,
      send: jest.fn().mockResolvedValue({ id: 'closeout' }),
      setArchived: jest.fn().mockResolvedValue(undefined),
    };
    (f.client.channels.fetch as jest.Mock).mockResolvedValue(thread);
    const error =
      failure === 'deleted'
        ? { code: 10003 }
        : failure === 'permission'
          ? { code: 50013 }
          : new Error('thread fetch timed out');
    if (boundary === 'fetch') (f.client.channels.fetch as jest.Mock).mockRejectedValue(error);
    else if (boundary === 'send') thread.send.mockRejectedValue(error);
    else thread.setArchived.mockRejectedValue(error);
    const result = await f.execute();
    if (failure === 'deleted') expect(result).toEqual({ status: 'banned' });
    else {
      expect(result).toMatchObject({ status: 'banned_updates_pending' });
      (f.client.channels.fetch as jest.Mock).mockResolvedValue(thread);
      thread.send.mockResolvedValue({ id: 'closeout' });
      thread.setArchived.mockResolvedValue(undefined);
      expect(
        await f.security.reconcileReportBan((await f.requests.findById(f.request.id))!)
      ).toEqual({ status: 'banned' });
    }
    expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
    expect((await f.reports.findById(f.report.id))?.status).toBe('actioned');
    expect((await f.requests.findById(f.request.id))?.status).toBe('completed');
    expect(f.ban).toHaveBeenCalledTimes(1);
  });
  it.each(['revoked', 'departed', 'failure', 'allowed'])(
    'forces fresh queued ban actor permission: %s',
    async (state) => {
      const f = await fixture();
      (f.guild.members.fetch as jest.Mock).mockImplementation(async (input) => {
        const id = typeof input === 'object' ? input.user : input;
        if (id !== 'moderator') return f.member;
        if (typeof input === 'string' || !input.force) return { permissions: { has: () => true } };
        if (state === 'departed') throw { code: 10007 };
        if (state === 'failure') throw new Error('member fetch unavailable');
        return {
          id: 'moderator',
          permissions: { has: () => state === 'allowed', bitfield: state === 'allowed' ? 4n : 0n },
          roles: { cache: new Map() },
        };
      });
      await f.worker().processPendingRequests();
      expect(f.ban).toHaveBeenCalledTimes(state === 'allowed' ? 1 : 0);
      expect((await f.requests.findById(f.request.id))?.status).toBe(
        state === 'allowed' ? 'completed' : 'failed'
      );
      expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(
        state === 'allowed' ? 1 : 0
      );
    }
  );
  it('persists only message references after source context expires', async () => {
    const f = await fixture();
    const expiry = new Date(Date.now() + 60_000);
    await f.contexts.recordMessage({
      serverId: 'guild',
      userId: 'target',
      messageId: 'source-message',
      channelId: 'source-channel',
      contentPreview: 'ephemeral private preview',
      contentFeatures: { tokens: ['ephemeral-feature'] },
      createdAt: new Date(),
      expiresAt: expiry,
    });
    const transient = await f.evidence.capture({
      guildId: 'guild',
      userId: 'target',
      member: null,
    });
    expect(transient.recent_messages[0].content_preview).toBe('ephemeral private preview');
    expect(await f.execute()).toEqual({ status: 'banned' });
    await f.contexts.pruneExpired(new Date(expiry.getTime() + 1));
    expect(await f.contexts.findRecentByServerAndUser('guild', 'target')).toEqual([]);
    const stored = (await f.detections.findById(f.detection.id))!;
    const durable = JSON.stringify([
      stored,
      await f.requests.findById(f.request.id),
      await f.actionRepo.getActionHistory('target', 'guild'),
      await f.outcomeRepo.findByUserAndServer('target', 'guild'),
      await f.cases.findByUserAndServer('target', 'guild'),
      await f.reports.findById(f.report.id),
    ]);
    expect(durable).not.toContain('ephemeral private preview');
    expect(durable).not.toContain('ephemeral-feature');
    expect(stored.metadata).toMatchObject({
      moderation_evidence: {
        recent_messages: [
          expect.objectContaining({ message_id: 'source-message', channel_id: 'source-channel' }),
        ],
      },
    });
  });
  it.each([
    'released',
    'restore-failure',
    'other-pending',
    'active-ban',
    'later-join',
    'new-owner-during-restore',
    'later-join-during-restore',
  ])(
    'compensates actual quarantine removal after verification already restored the snapshot: %s',
    async (state) => {
      const snapshots = new RoleQuarantineSnapshotRepository(getPrismaClient());
      const quarantine = new RoleQuarantineService(
        {
          getServerConfig: jest.fn().mockResolvedValue({
            guild_id: 'guild',
            case_role_id: 'case-role',
            settings: { role_quarantine_mode: 'on' },
          }),
        } as never,
        snapshots
      );
      const f = await fixture(true, quarantine);
      const role = {
        id: 'community-role',
        name: 'Community',
        managed: false,
        tags: {},
        permissions: { has: () => false },
      } as unknown as Role;
      const cache = new Map([[role.id, role]]);
      const caseRole = { id: 'case-role' } as Role;
      f.roles.assignCaseRole.mockImplementation(async () => {
        cache.set(caseRole.id, caseRole);
        return true;
      });
      f.roles.removeCaseRole.mockImplementation(async () => {
        cache.delete(caseRole.id);
        return true;
      });
      const bot = { roles: { highest: { comparePositionTo: () => 100 } } };
      Object.assign(f.guild, {
        roles: { cache, fetch: jest.fn(async (id) => (id === role.id ? role : null)) },
      });
      Object.assign(f.guild.members, { me: bot, fetchMe: jest.fn().mockResolvedValue(bot) });
      let reached!: () => void;
      let resume!: () => void;
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      Object.assign(f.member, {
        roles: {
          cache,
          remove: jest.fn(async (removed: Role) => {
            reached();
            await gate;
            cache.delete(removed.id);
          }),
          add: jest.fn(async (added: Role) => {
            if (state === 'restore-failure') throw new Error('role add denied');
            cache.set(added.id, added);
            if (state === 'new-owner-during-restore')
              await f.cases.createFromDetection(
                null,
                'guild',
                'target',
                VerificationStatus.PENDING
              );
            if (state === 'later-join-during-restore')
              (f.guild.members.fetch as jest.Mock).mockResolvedValue({
                ...f.member,
                joinedAt: new Date(),
              });
          }),
        },
      });
      await f.members.upsertMember('guild', 'target', {
        join_date: f.member.joinedAt!,
        verification_status: VerificationStatus.PENDING,
        case_role_active: false,
      });
      const event = await f.cases.createFromDetection(
        f.detection.id,
        'guild',
        'target',
        VerificationStatus.PENDING
      );
      const applying = f.moderation
        .applyCaseRole(f.member, f.moderator)
        .catch((error: unknown) => error);
      await paused;
      try {
        await f.moderation.verifyUser(f.member, f.moderator);
        expect(await snapshots.findActiveByServerAndUser('guild', 'target')).toBeNull();
        if (state === 'other-pending')
          await f.cases.createFromDetection(null, 'guild', 'target', VerificationStatus.PENDING);
        if (state === 'active-ban')
          await getPrismaClient().moderation_action_requests.update({
            where: { id: f.request.id },
            data: { metadata: { report_ban_phase: 'enforcement_started' } },
          });
        if (state === 'later-join')
          await f.members.upsertMember('guild', 'target', { join_date: new Date() });
      } finally {
        resume();
      }
      const result = await applying;
      if (state === 'restore-failure') expect(result).toBeInstanceOf(Error);
      else expect(result).toBe(true);
      expect(cache.has(role.id)).toBe(['released', 'later-join-during-restore'].includes(state));
      expect(cache.has(caseRole.id)).toBe(
        ['other-pending', 'active-ban', 'later-join', 'new-owner-during-restore'].includes(state)
      );
      const snapshotRows = await getPrismaClient().role_quarantine_snapshots.findMany({
        where: { verification_event_id: event.id },
      });
      expect(snapshotRows).toHaveLength(1);
      expect(snapshotRows[0].status).toBe('restored');
      expect((await f.cases.findById(event.id))?.status).toBe('verified');
      expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
        verification_status: 'verified',
        case_role_active: false,
      });
    }
  );
  it.each([
    'fetch-deleted',
    'edit-deleted',
    'button-deleted',
    'fetch-transient',
    'edit-transient',
    'button-transient',
    'fetch-ambiguous',
    'edit-ambiguous',
    'button-ambiguous',
  ])('closes a linked case through actual notification handling: %s', async (mode) => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    await f.cases.update(event.id, {
      notification_message_id: 'notice',
      notification_channel_id: 'admin',
    });
    const manager = new NotificationManager(
      f.client,
      { getServerConfig: jest.fn().mockResolvedValue({ settings: {} }) } as never,
      f.detections
    );
    const edit = jest.fn().mockResolvedValue(undefined);
    const message = { embeds: [new EmbedBuilder().setTitle('Case')], edit };
    const fetch = jest.fn().mockResolvedValue(message);
    const failure = mode.endsWith('deleted')
      ? { code: 10008 }
      : mode.endsWith('ambiguous')
        ? new Error('connection timed out')
        : { code: 50013 };
    if (mode.startsWith('fetch')) fetch.mockRejectedValue(failure);
    else if (mode.startsWith('button'))
      edit.mockResolvedValueOnce(undefined).mockRejectedValue(failure);
    else edit.mockRejectedValue(failure);
    const routed = manager as unknown as {
      getExistingNotificationChannel: () => Promise<unknown>;
    };
    jest.spyOn(routed, 'getExistingNotificationChannel').mockResolvedValue({ messages: { fetch } });
    f.notifications.logActionToMessage.mockImplementation(manager.logActionToMessage.bind(manager));
    f.notifications.updateNotificationButtons.mockImplementation(
      manager.updateNotificationButtons.bind(manager)
    );
    const result = await f.execute();
    if (!mode.endsWith('deleted')) {
      expect(result).toMatchObject({ status: 'banned_updates_pending' });
      expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(0);
      fetch.mockResolvedValue(message);
      edit.mockResolvedValue(undefined);
      const stored = (await f.requests.findById(f.request.id))!;
      expect(await f.security.reconcileReportBan(stored)).toEqual({ status: 'banned' });
    } else expect(result).toEqual({ status: 'banned' });
    expect((await f.cases.findById(event.id))?.status).toBe('banned');
    expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
    expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toHaveLength(1);
    expect((await f.reports.findById(f.report.id))?.status).toBe('actioned');
    expect(f.queue.deleteCaseMirror).toHaveBeenCalledWith(event.id);
    expect(f.ban).toHaveBeenCalledTimes(1);
  });
  it('removes obsolete successful role work after moderator verification wins', async () => {
    const f = await fixture();
    await f.members.upsertMember('guild', 'target', {
      join_date: f.member.joinedAt!,
      verification_status: VerificationStatus.PENDING,
      case_role_active: false,
    });
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    let reached!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let restricted = false;
    f.roles.assignCaseRole.mockImplementation(async () => {
      reached();
      await gate;
      restricted = true;
      return true;
    });
    f.roles.removeCaseRole.mockImplementation(async () => {
      restricted = false;
      return true;
    });
    const applying = f.moderation.applyCaseRole(f.member, f.moderator);
    await paused;
    try {
      expect(await f.moderation.verifyUser(f.member, f.moderator)).toBe(true);
    } finally {
      resume();
    }
    await applying;
    expect(restricted).toBe(false);
    expect((await f.cases.findById(event.id))?.status).toBe('verified');
    expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
      verification_status: 'verified',
      case_role_active: false,
    });
  });
  it.each([
    'configured-role-changed',
    'other-pending-case',
    'active-ban',
    'terminal-ban',
    'later-join',
    'discord-later-join',
    'newer-restriction',
    'remove-failure',
    'quarantine',
    'quarantine-failure',
    'restriction-during-removal',
    'restriction-during-restoration',
  ])('bounds superseded role compensation: %s', async (mode) => {
    const restore = jest.fn().mockResolvedValue({
      status: 'no_active_snapshot',
      snapshotId: null,
      attemptedRoleIds: [],
      restoredRoleIds: [],
      skippedRoles: [],
      failedRestores: [],
    });
    const quarantine = {
      quarantineMember: jest.fn().mockResolvedValue({
        status: 'quarantined',
        mode: 'enforce',
        snapshotId: 'snapshot',
        originalRoleIds: ['privilege'],
        plannedRoleIds: ['privilege'],
        removedRoleIds: ['privilege'],
        skippedRoles: [],
        failedRemovals: [],
      }),
      restoreMemberRoles: restore,
    };
    const useQuarantine = mode.includes('quarantine') || mode.includes('restoration');
    const f = await fixture(
      true,
      useQuarantine ? (quarantine as unknown as IRoleQuarantineService) : undefined
    );
    await f.members.upsertMember('guild', 'target', {
      join_date: f.member.joinedAt!,
      verification_status: VerificationStatus.PENDING,
      case_role_active: false,
    });
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    let reached!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let restricted = false;
    f.roles.assignCaseRole.mockImplementationOnce(async () => {
      reached();
      await gate;
      restricted = true;
      return true;
    });
    f.roles.assignCaseRole.mockImplementation(async () => {
      restricted = true;
      return true;
    });
    f.roles.removeCaseRole.mockImplementation(async () => {
      restricted = false;
      return true;
    });
    const applying = f.moderation
      .applyCaseRole(f.member, f.moderator)
      .catch((error: unknown) => error);
    await paused;
    try {
      await f.moderation.verifyUser(f.member, f.moderator);
      f.roles.removeCaseRole.mockClear();
      if (mode === 'configured-role-changed') f.roles.getCaseRoleId.mockResolvedValue('new-role');
      if (mode === 'other-pending-case')
        await f.cases.createFromDetection(null, 'guild', 'target', VerificationStatus.PENDING);
      if (mode === 'active-ban')
        await getPrismaClient().moderation_action_requests.update({
          where: { id: f.request.id },
          data: { metadata: { report_ban_phase: 'enforcement_started' } },
        });
      if (mode === 'terminal-ban') {
        await f.cases.update(event.id, { status: VerificationStatus.BANNED });
        await f.members.upsertMember('guild', 'target', {
          verification_status: VerificationStatus.BANNED,
        });
      }
      if (mode === 'later-join')
        await f.members.upsertMember('guild', 'target', { join_date: new Date() });
      if (mode === 'discord-later-join')
        (f.guild.members.fetch as jest.Mock).mockResolvedValue({
          ...f.member,
          joinedAt: new Date(),
        });
      if (mode === 'newer-restriction')
        await f.members.upsertMember('guild', 'target', {
          verification_status: VerificationStatus.PENDING,
          case_role_active: true,
          last_status_change: new Date(),
        });
      if (mode === 'remove-failure') f.roles.removeCaseRole.mockResolvedValue(false);
      if (mode === 'restriction-during-removal')
        f.roles.removeCaseRole.mockImplementation(async () => {
          restricted = false;
          await f.cases.createFromDetection(null, 'guild', 'target', VerificationStatus.PENDING);
          return true;
        });
      if (useQuarantine)
        restore.mockImplementation(async (_member, _moderator, fence) => {
          if (mode === 'quarantine-failure') throw new Error('restore denied');
          if (mode === 'restriction-during-restoration')
            await f.cases.createFromDetection(null, 'guild', 'target', VerificationStatus.PENDING);
          const allowed = await fence.canRestoreRole();
          expect(allowed).toBe(mode !== 'restriction-during-restoration');
          return {
            status: allowed ? 'restored' : 'held_pending_case',
            snapshotId: 'snapshot',
            attemptedRoleIds: ['privilege'],
            restoredRoleIds: allowed ? ['privilege'] : [],
            skippedRoles: [],
            failedRestores: [],
          };
        });
    } finally {
      resume();
    }
    const result = await applying;
    const fails = ['remove-failure', 'quarantine-failure'].includes(mode);
    if (fails) expect(result).toBeInstanceOf(Error);
    else expect(result).toBe(true);
    const releases = ['configured-role-changed', 'quarantine', 'quarantine-failure'].includes(mode);
    expect(restricted).toBe(!releases);
    if (releases || fails || mode.startsWith('restriction-during'))
      expect(f.roles.removeCaseRole).toHaveBeenCalledWith(f.member, 'case-role');
    else expect(f.roles.removeCaseRole).not.toHaveBeenCalled();
    expect(f.roles.assignCaseRole).toHaveBeenNthCalledWith(1, f.member, 'case-role');
    expect((await f.cases.findById(event.id))?.status).toBe(
      mode === 'terminal-ban' ? 'banned' : 'verified'
    );
    if (!['terminal-ban', 'newer-restriction'].includes(mode))
      expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
        verification_status: 'verified',
        case_role_active: false,
      });
  });
  it.each([true, false])(
    'serializes an uncommitted automatic case admission before confirmed cleanup (request exists=%s)',
    async (requestExists) => {
      const f = await fixture();
      if (!requestExists)
        await getPrismaClient().moderation_action_requests.delete({ where: { id: f.request.id } });
      let enterBan!: () => void,
        releaseBan!: () => void,
        inserted!: () => void,
        commit!: () => void;
      const banEntered = new Promise<void>((resolve) => {
        enterBan = resolve;
      });
      const banGate = new Promise<void>((resolve) => {
        releaseBan = resolve;
      });
      const insertEntered = new Promise<void>((resolve) => {
        inserted = resolve;
      });
      const commitGate = new Promise<void>((resolve) => {
        commit = resolve;
      });
      f.ban.mockImplementation(async () => {
        enterBan();
        await banGate;
      });
      jest.spyOn(f.cases, 'createFromDetection').mockImplementation(async (...args) =>
        getPrismaClient().$transaction(
          async (transaction) => {
            const client = new Proxy(transaction, {
              get(target, property) {
                return property === '$transaction'
                  ? // eslint-disable-next-line no-unused-vars -- Callback type only.
                    (callback: (_value: typeof transaction) => Promise<unknown>) =>
                      callback(transaction)
                  : Reflect.get(target, property);
              },
            }) as PrismaClient;
            const event = await new VerificationEventRepository(client).createFromDetection(
              ...args
            );
            inserted();
            await commitGate;
            return event;
          },
          { timeout: 15000 }
        )
      );
      const executionState = { finished: false };
      let execution: ReturnType<typeof f.execute> | undefined;
      const startExecution = () => {
        execution = f.execute().finally(() => {
          executionState.finished = true;
        });
      };
      if (requestExists) {
        startExecution();
        await banEntered;
      }
      const setup = f.security.handleSuspiciousMessage(f.member, {
        label: 'SUSPICIOUS',
        confidence: 0.9,
        reasons: ['Suspicious content'],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'Suspicious content',
      });
      try {
        await insertEntered;
        if (!requestExists) {
          Object.assign(
            f.request,
            await f.requests.enqueue({
              serverId: 'guild',
              actorId: 'moderator',
              actorSurface: 'web',
              targetUserId: 'target',
              reportIntakeId: f.report.id,
              detectionEventId: f.detection.id,
              actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
              idempotencyKey: 'ban:report',
              metadata: { reason: 'Confirmed spam' },
            })
          );
          startExecution();
          await banEntered;
        }
        releaseBan();
        // Wait for the real database lock, or the old implementation's incorrect completion.
        const deadline = Date.now() + 10000;
        while (!executionState.finished) {
          const waiting = await getPrismaClient().$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND (query LIKE '%moderation_action_requests%' OR query LIKE '%pg_advisory_xact_lock%')`;
          if (Number(waiting[0].count) > 0) break;
          if (Date.now() > deadline)
            throw new Error('Neither confirmation lock nor completion observed');
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        commit();
        expect(await setup).toBe(true);
        expect(await execution).toEqual({ status: 'banned' });
        const events = await f.cases.findByUserAndServer('target', 'guild');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          status: 'banned',
          metadata: { report_ban_operation_id: f.request.id },
        });
        expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
          report_ban_case_ids: [events[0].id],
        });
        expect(f.ban).toHaveBeenCalledTimes(1);
        expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
      } finally {
        commit();
        releaseBan();
        await Promise.all([setup, execution]);
      }
    }
  );

  it('rejects an admission that saw no request before confirmed cleanup wins the target fence', async () => {
    const f = await fixture();
    const prisma = getPrismaClient();
    await prisma.moderation_action_requests.delete({ where: { id: f.request.id } });
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = new Proxy(prisma, {
      get(target, property) {
        if (property === '$transaction')
          // eslint-disable-next-line no-unused-vars -- Callback type only.
          return (callback: (_transaction: Prisma.TransactionClient) => Promise<unknown>) =>
            prisma.$transaction(
              (transaction) =>
                callback(
                  new Proxy(transaction, {
                    get(inner, key) {
                      if (key === '$executeRaw')
                        return async (...args: Parameters<typeof transaction.$executeRaw>) => {
                          reached();
                          await gate;
                          return transaction.$executeRaw(...args);
                        };
                      return Reflect.get(inner, key);
                    },
                  })
                ),
              { timeout: 15000 }
            );
        return Reflect.get(target, property);
      },
    });
    jest
      .spyOn(f.cases, 'createFromDetection')
      .mockImplementation((...args) =>
        new VerificationEventRepository(client).createFromDetection(...args)
      );
    const setup = f.security.handleSuspiciousMessage(f.member, {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'Suspicious content',
    });
    try {
      await entered;
      Object.assign(
        f.request,
        await f.requests.enqueue({
          serverId: 'guild',
          actorId: 'moderator',
          actorSurface: 'web',
          targetUserId: 'target',
          reportIntakeId: f.report.id,
          detectionEventId: f.detection.id,
          actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
          idempotencyKey: 'ban:report',
          metadata: { reason: 'Confirmed spam' },
        })
      );
      expect(await f.execute()).toEqual({ status: 'banned' });
      release();
      expect(await setup).toBe(true);
      expect(await f.cases.findByUserAndServer('target', 'guild')).toHaveLength(0);
      expect(f.roles.assignCaseRole).not.toHaveBeenCalled();
      expect(f.threads.createVerificationThread).not.toHaveBeenCalled();
      expect(f.ban).toHaveBeenCalledTimes(1);
      expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
    } finally {
      release();
      await setup;
    }
  });

  it.each([false, true])(
    'bounds admission when confirmation wins the request lock (new membership=%s)',
    async (newerMembership) => {
      const f = await fixture();
      let enterBan!: () => void, releaseBan!: () => void;
      const banEntered = new Promise<void>((resolve) => {
        enterBan = resolve;
      });
      const banGate = new Promise<void>((resolve) => {
        releaseBan = resolve;
      });
      f.ban.mockImplementation(async () => {
        enterBan();
        await banGate;
      });
      let admissionStarted!: () => void, releaseAdmission!: () => void;
      const admissionEntered = new Promise<void>((resolve) => {
        admissionStarted = resolve;
      });
      const admissionGate = new Promise<void>((resolve) => {
        releaseAdmission = resolve;
      });
      const prisma = getPrismaClient();
      const admissionClient = new Proxy(prisma, {
        get(target, property) {
          if (property === '$transaction')
            return async (callback: Parameters<PrismaClient['$transaction']>[0]) => {
              admissionStarted();
              await admissionGate;
              return prisma.$transaction(callback as never);
            };
          return Reflect.get(target, property);
        },
      });
      jest
        .spyOn(f.cases, 'createFromDetection')
        .mockImplementation((...args) =>
          new VerificationEventRepository(admissionClient).createFromDetection(...args)
        );
      const execution = f.execute();
      await banEntered;
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const lock = await pool.connect();
      let setup: Promise<boolean> | undefined;
      const waitForLocks = async (minimum: number) => {
        const deadline = Date.now() + 10000;
        for (;;) {
          const result = await pool.query(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%moderation_action_requests%'"
          );
          if (Number(result.rows[0].count) >= minimum) return;
          if (Date.now() > deadline) throw new Error('Expected request lock wait did not occur');
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      };
      try {
        await lock.query('BEGIN');
        await lock.query('SELECT id FROM moderation_action_requests WHERE id = $1 FOR UPDATE', [
          f.request.id,
        ]);
        if (newerMembership)
          Object.assign(f.member, { joinedAt: new Date('2025-02-01T00:00:00Z') });
        setup = f.security.handleSuspiciousMessage(f.member, {
          label: 'SUSPICIOUS',
          confidence: 0.9,
          reasons: ['Suspicious content'],
          triggerSource: DetectionType.SUSPICIOUS_CONTENT,
          triggerContent: 'Suspicious content',
        });
        await admissionEntered;
        releaseBan();
        await waitForLocks(1);
        releaseAdmission();
        await waitForLocks(2);
        await lock.query('COMMIT');
        expect(await setup).toBe(true);
        expect(await execution).toEqual({ status: 'banned' });
        const events = await f.cases.findByUserAndServer('target', 'guild');
        expect(events).toHaveLength(newerMembership ? 1 : 0);
        if (newerMembership) expect(events[0].status).toBe('pending');
        else {
          expect(f.roles.assignCaseRole).not.toHaveBeenCalled();
          expect(f.threads.createVerificationThread).not.toHaveBeenCalled();
        }
        expect(f.ban).toHaveBeenCalledTimes(1);
        expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
        expect((await f.requests.findById(f.request.id))?.status).toBe('completed');
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        releaseBan();
        releaseAdmission();
        await Promise.all([setup, execution]);
        await pool.end();
      }
    }
  );
  it('preserves genuinely post-confirmation admissions and guards pending thread writes', async () => {
    const f = await fixture();
    expect(await f.execute()).toEqual({ status: 'banned' });
    const confirmedAt = String(
      ((await f.requests.findById(f.request.id))!.metadata as Record<string, unknown>)
        .report_ban_confirmed_at
    );
    while (Date.now() <= Date.parse(confirmedAt))
      await new Promise<void>((resolve) => setImmediate(resolve));
    const event = await f.cases.createFromDetection(
      null,
      'guild',
      'target',
      VerificationStatus.PENDING,
      { user_snapshot: { joined_at: f.member.joinedAt!.toISOString() } }
    );
    expect(event.status).toBe('pending');
    expect(event.created_at > new Date(confirmedAt)).toBe(true);
    expect(
      await f.cases.setThreadIdentity(event.id, 'original', 'verification', {}, null)
    ).not.toBeNull();
    expect(
      await f.cases.setThreadIdentity(event.id, 'replacement', 'verification', {}, null)
    ).toBeNull();
    await f.cases.update(event.id, {
      status: VerificationStatus.VERIFIED,
      metadata: { retained: true },
    });
    expect(
      await f.cases.setThreadIdentity(event.id, 'replacement', 'verification', {}, 'original')
    ).toBeNull();
    expect(
      await f.cases.patchMetadata(
        event.id,
        { initial_verification_prompt_message_id: 'late-prompt' },
        { expectedPendingThreadId: 'original' }
      )
    ).toBeNull();
    expect(await f.cases.findById(event.id)).toMatchObject({
      status: 'verified',
      thread_id: 'original',
      metadata: { retained: true },
    });
    expect(f.ban).toHaveBeenCalledTimes(1);
  });

  it.each(['http-first', 'observer-first'])(
    'adopts an independent automatic case during paused enforcement (%s)',
    async (ordering) => {
      const f = await fixture();
      let sending!: () => void;
      let confirm!: () => void;
      const reached = new Promise<void>((resolve) => {
        sending = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        confirm = resolve;
      });
      f.ban.mockImplementation(async () => {
        sending();
        await gate;
      });
      const execution = f.execute();
      try {
        await reached;
        expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
          report_ban_case_ids: [],
        });
        const create = f.cases.createFromDetection.bind(f.cases);
        jest.spyOn(f.cases, 'createFromDetection').mockImplementation(async (...args) => {
          const inserted = await create(...args);
          expect(inserted.metadata).toMatchObject({
            user_snapshot: { joined_at: f.member.joinedAt!.toISOString() },
          });
          return inserted;
        });
        await f.security.handleSuspiciousMessage(f.member, {
          label: 'SUSPICIOUS',
          confidence: 0.9,
          reasons: ['Suspicious content'],
          triggerSource: DetectionType.SUSPICIOUS_CONTENT,
          triggerContent: 'Suspicious content',
        });
        const lateCase = (await f.cases.findByUserAndServer('target', 'guild'))[0];
        expect(lateCase.status).toBe('pending');
        if (ordering === 'observer-first') {
          expect(
            await f.moderation.recordObservedDiscordBan(f.guild, f.user, {
              source: ModerationOutcomeSource.UNKNOWN_EXTERNAL,
            })
          ).toBe(0);
          expect((await f.cases.findById(lateCase.id))?.status).toBe('pending');
          expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toHaveLength(0);
        }
        confirm();
        expect(await execution).toEqual({ status: 'banned' });
        expect(await f.cases.findById(lateCase.id)).toMatchObject({
          status: 'banned',
          metadata: { report_ban_operation_id: f.request.id },
        });
        expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
          report_ban_case_ids: [lateCase.id],
        });
        expect(await f.actionRepo.getActionHistory('target', 'guild')).toEqual([
          expect.objectContaining({ verification_event_id: lateCase.id }),
        ]);
        expect(f.queue.deleteCaseMirror).toHaveBeenCalledWith(lateCase.id);
        expect(f.ban).toHaveBeenCalledTimes(1);
      } finally {
        confirm();
        await execution;
      }
    }
  );

  it('retains successful case role state when an in-flight ban is rejected', async () => {
    const f = await fixture();
    await f.members.upsertMember('guild', 'target', {
      verification_status: VerificationStatus.VERIFIED,
      case_role_active: false,
      join_date: f.member.joinedAt,
      last_status_change: new Date('2025-01-02T00:00:00Z'),
    });
    let sending!: () => void, rejectBan!: () => void;
    const sent = new Promise<void>((resolve) => {
      sending = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      rejectBan = resolve;
    });
    f.ban.mockImplementation(async () => {
      sending();
      await gate;
      throw Object.assign(new Error('Missing permissions'), { code: 50013 });
    });
    const execution = f.execute().catch((error: unknown) => error);
    try {
      await sent;
      await f.security.handleSuspiciousMessage(f.member, {
        label: 'SUSPICIOUS',
        confidence: 0.9,
        reasons: ['Suspicious content'],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'Suspicious content',
      });
      expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
        report_ban_phase: 'enforcement_started',
      });
      expect(f.roles.assignCaseRole).toHaveBeenCalledTimes(1);
      rejectBan();
      expect(await execution).toMatchObject({ code: 50013 });
      expect((await f.cases.findByUserAndServer('target', 'guild'))[0].status).toBe('pending');
      expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
        verification_status: 'pending',
        case_role_active: true,
      });
      expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
        report_ban_phase: null,
      });
      expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(0);
      expect(f.ban).toHaveBeenCalledTimes(1);
    } finally {
      rejectBan();
      await execution;
    }
  });

  it.each(['same-membership', 'newer-decision', 'later-join'])(
    'orders role setup started after confirmation against %s',
    async (state) => {
      const f = await fixture();
      await f.members.upsertMember('guild', 'target', {
        verification_status: VerificationStatus.VERIFIED,
        case_role_active: false,
        join_date: f.member.joinedAt,
        last_status_change: new Date('2025-01-02T00:00:00Z'),
      });
      f.ban.mockImplementation(async () => {
        await f.cases.createFromDetection(null, 'guild', 'target', VerificationStatus.PENDING, {
          user_snapshot: { joined_at: f.member.joinedAt!.toISOString() },
        });
      });
      const adopt = f.requests.adoptConfirmedReportBanCases.bind(f.requests);
      jest.spyOn(f.requests, 'adoptConfirmedReportBanCases').mockImplementation(async (...args) => {
        const request = (await f.requests.findById(f.request.id))!;
        const confirmedAt = new Date(
          String((request.metadata as Record<string, unknown>).report_ban_confirmed_at)
        );
        // Start role work strictly after the persisted confirmation boundary.
        while (Date.now() <= confirmedAt.getTime())
          await new Promise((resolve) => setTimeout(resolve, 1));
        if (state !== 'same-membership')
          await f.members.upsertMember('guild', 'target', {
            verification_status: VerificationStatus.VERIFIED,
            case_role_active: false,
            last_status_change: new Date(confirmedAt.getTime() + 1),
            ...(state === 'later-join' ? { join_date: new Date(confirmedAt.getTime() + 1) } : {}),
          });
        await f.moderation.applyCaseRole(f.member);
        const membership = (await f.members.findByServerAndUser('guild', 'target'))!;
        if (state === 'same-membership') {
          expect(membership).toMatchObject({
            verification_status: 'pending',
            case_role_active: true,
          });
          expect(membership.last_status_change).toEqual(confirmedAt);
        } else
          expect(membership).toMatchObject({
            verification_status: 'verified',
            case_role_active: false,
          });
        return adopt(...args);
      });
      expect(await f.execute()).toEqual({ status: 'banned' });
      expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
        verification_status: state === 'same-membership' ? 'banned' : 'verified',
        case_role_active: false,
      });
      expect(f.roles.assignCaseRole).toHaveBeenCalledTimes(1);
      expect(f.ban).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['after-cleanup', 'before-adoption'])(
    'preserves confirmed cleanup when late role assignment finishes %s',
    async (ordering) => {
      const f = await fixture();
      let sending!: () => void,
        confirm!: () => void,
        assigning!: () => void,
        finishRole!: () => void;
      const sent = new Promise<void>((resolve) => {
        sending = resolve;
      });
      const banGate = new Promise<void>((resolve) => {
        confirm = resolve;
      });
      const roleStarted = new Promise<void>((resolve) => {
        assigning = resolve;
      });
      const roleGate = new Promise<void>((resolve) => {
        finishRole = resolve;
      });
      f.ban.mockImplementation(async () => {
        sending();
        await banGate;
      });
      f.roles.assignCaseRole.mockImplementation(async () => {
        assigning();
        await roleGate;
        return true;
      });
      let reachedAdoption!: () => void, resumeAdoption!: () => void;
      const adoptionStarted = new Promise<void>((resolve) => {
        reachedAdoption = resolve;
      });
      const adoptionGate = new Promise<void>((resolve) => {
        resumeAdoption = resolve;
      });
      if (ordering === 'before-adoption') {
        const adopt = f.requests.adoptConfirmedReportBanCases.bind(f.requests);
        jest
          .spyOn(f.requests, 'adoptConfirmedReportBanCases')
          .mockImplementation(async (...args) => {
            reachedAdoption();
            await adoptionGate;
            return adopt(...args);
          });
      }
      const execution = f.execute();
      await sent;
      const setup = f.security.handleSuspiciousMessage(f.member, {
        label: 'SUSPICIOUS',
        confidence: 0.9,
        reasons: ['Suspicious content'],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'Suspicious content',
      });
      try {
        await roleStarted;
        const lateCase = (await f.cases.findByUserAndServer('target', 'guild'))[0];
        confirm();
        if (ordering === 'before-adoption') {
          await adoptionStarted;
          expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
            report_ban_phase: 'discord_confirmed',
            report_ban_case_ids: [],
          });
          finishRole();
          await setup;
          resumeAdoption();
        }
        expect(await execution).toEqual({ status: 'banned' });
        finishRole();
        await setup;
        expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
          verification_status: 'banned',
          case_role_active: false,
        });
        expect(await f.cases.findById(lateCase.id)).toMatchObject({
          status: 'banned',
          metadata: { report_ban_operation_id: f.request.id },
        });
        if (ordering === 'after-cleanup')
          expect(f.threads.createVerificationThread).not.toHaveBeenCalled();
        expect(f.queue.deleteCaseMirror).toHaveBeenCalledWith(lateCase.id);
        expect(f.ban).toHaveBeenCalledTimes(1);
      } finally {
        confirm();
        finishRole();
        resumeAdoption();
        await Promise.all([execution, setup]);
      }
    }
  );

  it.each([
    'restart',
    'competing',
    'unknown-case-epoch',
    'missing-ban-epoch',
    'later-join',
    'later-join-before-confirmation',
    'after-confirmation',
    'uncertain',
  ])('bounds late-case adoption for %s', async (scenario) => {
    const f = await fixture();
    let lateId = '';
    const newJoin = new Date(
      Date.now() + (scenario === 'later-join-before-confirmation' ? -1000 : 60000)
    );
    if (scenario === 'missing-ban-epoch') Object.assign(f.member, { joinedAt: null });
    f.ban.mockImplementation(async () => {
      const event = await f.cases.createFromDetection(
        null,
        'guild',
        'target',
        VerificationStatus.PENDING,
        scenario === 'unknown-case-epoch'
          ? {}
          : {
              user_snapshot: {
                joined_at: scenario.startsWith('later-join')
                  ? newJoin.toISOString()
                  : '2025-01-01T00:00:00.000Z',
              },
            }
      );
      lateId = event.id;
      if (scenario === 'competing')
        await f.cases.claimTerminalActions(
          [event.id],
          'guild',
          'target',
          'case-terminal-action:other'
        );
      if (scenario === 'after-confirmation')
        await getPrismaClient().verification_events.update({
          where: { id: event.id },
          data: { created_at: new Date(Date.now() + 60000) },
        });
      if (scenario.startsWith('later-join'))
        await f.members.upsertMember('guild', 'target', {
          join_date: newJoin,
          last_status_change: newJoin,
          verification_status: VerificationStatus.VERIFIED,
        });
      if (scenario === 'uncertain') throw new Error('socket closed');
    });
    const finalize = jest.spyOn(f.moderation, 'finalizeObservedBan');
    if (scenario === 'restart')
      finalize.mockRejectedValueOnce(new Error('interrupted after adoption'));
    const result = await f.execute();
    const expected =
      scenario === 'uncertain'
        ? 'ban_outcome_unknown'
        : ['restart', 'competing', 'unknown-case-epoch', 'missing-ban-epoch'].includes(scenario)
          ? 'banned_updates_pending'
          : 'banned';
    expect(result.status).toBe(expected);
    const stored = (await f.requests.findById(f.request.id))!;
    if (scenario === 'restart') {
      expect(stored.metadata).toMatchObject({ report_ban_case_ids: [lateId] });
      expect(await f.cases.findById(lateId)).toMatchObject({
        status: 'pending',
        metadata: { report_ban_enforcement_operation_id: f.request.id },
      });
      await f.cases.patchMetadata(lateId, { evidence_snapshot: { retained: true } });
      expect(await f.requests.adoptConfirmedReportBanCases(f.request.id, 'stale-token')).toBeNull();
      f.banFetch.mockRejectedValue({ code: 10026 });
      expect(await f.security.reconcileReportBan(stored)).toEqual({ status: 'banned' });
      expect(await f.cases.findById(lateId)).toMatchObject({
        status: 'banned',
        metadata: { evidence_snapshot: { retained: true }, report_ban_operation_id: f.request.id },
      });
      expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
    } else {
      expect(await f.cases.findById(lateId)).toMatchObject({
        status: 'pending',
        quarantine_attempt_id: scenario === 'competing' ? 'case-terminal-action:other' : null,
      });
      if (scenario.startsWith('later-join'))
        expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
          verification_status: 'verified',
          join_date: newJoin,
        });
      if (scenario === 'uncertain')
        expect(
          await f.requests.adoptConfirmedReportBanCases(
            f.request.id,
            getReportBanAttemptToken(stored)!
          )
        ).toBeNull();
      if (expected !== 'banned') expect(finalize).not.toHaveBeenCalled();
    }
    expect(f.ban).toHaveBeenCalledTimes(1);
  });

  async function uncertain(withReport = true) {
    const f = await fixture(withReport);
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    f.ban.mockRejectedValue(new Error('socket closed'));
    const result = await f.execute();
    expect(result.status).toBe('ban_outcome_unknown');
    await f.requests.complete(
      f.request.id,
      { observed_ban_result: result },
      getReportBanAttemptToken(f.request)
    );
    f.banFetch.mockRejectedValue({ code: 10026 });
    const reference = await f.security.prepareReportBanReview(f.guild, f.request.id, f.moderator);
    return { ...f, event, reference };
  }

  it.each(['observation-first', 'review-first'])(
    'retains delivered bans across uncertain review ownership handoff: %s',
    async (ordering) => {
      const f = await uncertain();
      const observedAt = new Date();
      let entered!: () => void, resume!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const review = f.requests.reviewUncertainReportBan.bind(f.requests);
      jest.spyOn(f.requests, 'reviewUncertainReportBan').mockImplementation(async (input) => {
        if (ordering === 'observation-first') {
          entered();
          await gate;
          return review(input);
        }
        return getPrismaClient().$transaction(
          async (transaction) => {
            const client = new Proxy(transaction, {
              get(target, property) {
                return property === '$transaction'
                  ? // eslint-disable-next-line no-unused-vars -- Callback type only.
                    (callback: (_value: typeof transaction) => Promise<unknown>) =>
                      callback(transaction)
                  : Reflect.get(target, property);
              },
            }) as PrismaClient;
            const result = await new ModerationActionRequestRepository(
              client
            ).reviewUncertainReportBan(input);
            entered();
            await gate;
            return result;
          },
          { timeout: 15000 }
        );
      });
      const reviewing = f.security
        .reviewUncertainReportBan(f.guild, f.reference, f.moderator, 'No ban at lookup')
        .then(
          () => null,
          (error: unknown) => error
        );
      await reached;
      f.banFetch.mockResolvedValue({ user: f.user });
      const observing = f.moderation.recordObservedDiscordBan(f.guild, f.user, {
        source: ModerationOutcomeSource.UNKNOWN_EXTERNAL,
        sourceDetail: 'guildBanAdd',
        occurredAt: observedAt,
      });
      try {
        if (ordering === 'observation-first') {
          expect(await observing).toBe(0);
          resume();
          expect(await reviewing).toBeInstanceOf(Error);
          const held = (await f.requests.findById(f.request.id))!;
          expect(held.metadata).toMatchObject({
            report_ban_phase: 'reconciliation_required',
            report_ban_observed_ban: {
              source: 'unknown_external',
              source_detail: 'guildBanAdd',
              occurred_at: observedAt.toISOString(),
              attempt_token: f.reference.attemptToken,
              membership_joined_at: f.member.joinedAt!.toISOString(),
              uncertain_result: { observed_ban_result: { status: 'ban_outcome_unknown' } },
            },
          });
          expect((held.metadata as Prisma.JsonObject).report_ban_confirmed_at).toBeUndefined();
          expect(await f.security.reconcileReportBan(held)).toEqual({ status: 'banned' });
        } else {
          // The actual observer has read the still-owned case before waiting on review's lock.
          const observationState = { finished: false };
          void observing.then(() => {
            observationState.finished = true;
          });
          const deadline = Date.now() + 10000;
          while (!observationState.finished) {
            const waiting = await getPrismaClient().$queryRaw<{ count: bigint }[]>`
              SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
                AND wait_event_type = 'Lock' AND query LIKE '%moderation_action_requests%'`;
            if (Number(waiting[0].count)) break;
            if (Date.now() > deadline) throw new Error('Observer did not reach request lock');
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          resume();
          expect(await reviewing).toBeNull();
          expect(await observing).toBe(1);
          expect((await f.requests.findById(f.request.id))?.metadata).not.toHaveProperty(
            'report_ban_observed_ban'
          );
          expect((await f.cases.findById(f.event.id))?.metadata).not.toHaveProperty(
            'report_ban_enforcement_operation_id'
          );
        }
        expect((await f.cases.findById(f.event.id))?.status).toBe('banned');
        expect(f.ban).toHaveBeenCalledTimes(1);
      } finally {
        resume();
        await Promise.all([reviewing, observing]);
      }
    }
  );

  it.each(['newer-attempt', 'newer-revision', 'newer-membership'])(
    'preserves newer state when a delivered ban waits on review: %s',
    async (change) => {
      const f = await uncertain();
      const observedAt = new Date();
      let entered!: () => void, resume!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const find = f.cases.findByUserAndServer.bind(f.cases);
      jest.spyOn(f.cases, 'findByUserAndServer').mockImplementationOnce(async (...args) => {
        const snapshot = await find(...args);
        entered();
        await gate;
        return snapshot;
      });
      const observing = f.moderation.recordObservedDiscordBan(f.guild, f.user, {
        source: ModerationOutcomeSource.UNKNOWN_EXTERNAL,
        occurredAt: observedAt,
      });
      await reached;
      const newJoin = new Date(observedAt.getTime() + 1000);
      try {
        if (change === 'newer-attempt') {
          await getPrismaClient().moderation_action_requests.update({
            where: { id: f.request.id },
            data: {
              metadata: {
                ...((await f.requests.findById(f.request.id))!.metadata as Prisma.JsonObject),
                report_ban_attempt_token: 'new-attempt',
                report_ban_attempt_id: 'report-ban:new-attempt',
              },
            },
          });
          await getPrismaClient().verification_events.update({
            where: { id: f.event.id },
            data: {
              quarantine_attempt_id: 'report-ban:new-attempt',
            },
          });
        } else if (change === 'newer-revision') {
          await getPrismaClient().verification_events.update({
            where: { id: f.event.id },
            data: {
              case_revision: { increment: 1 },
            },
          });
        } else {
          await f.security.reviewUncertainReportBan(
            f.guild,
            f.reference,
            f.moderator,
            'Absent before delivered event'
          );
          await f.members.upsertMember('guild', 'target', {
            join_date: newJoin,
            verification_status: VerificationStatus.VERIFIED,
            last_status_change: newJoin,
          });
        }
        resume();
        expect(await observing).toBe(change === 'newer-membership' ? 1 : 0);
        const request = (await f.requests.findById(f.request.id))!;
        expect(request.metadata).not.toHaveProperty('report_ban_observed_ban');
        if (change === 'newer-attempt')
          expect(getReportBanAttemptToken(request)).toBe('new-attempt');
        if (change === 'newer-revision')
          expect(await f.cases.findById(f.event.id)).toMatchObject({
            status: 'pending',
            case_revision: 1,
          });
        if (change === 'newer-membership')
          expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
            join_date: newJoin,
            verification_status: 'verified',
            last_status_change: newJoin,
          });
        expect(f.ban).toHaveBeenCalledTimes(1);
      } finally {
        resume();
        await observing;
      }
    }
  );

  it('retains delivered evidence when a fresh later review confirms absence', async () => {
    const f = await uncertain();
    await f.moderation.recordObservedDiscordBan(f.guild, f.user, {
      source: ModerationOutcomeSource.UNKNOWN_EXTERNAL,
      sourceDetail: 'guildBanAdd',
    });
    const reference = await f.security.prepareReportBanReview(f.guild, f.request.id, f.moderator);
    expect(reference.observedBanId).toBeDefined();
    await f.security.reviewUncertainReportBan(
      f.guild,
      reference,
      f.moderator,
      'Ban subsequently removed'
    );
    const stored = (await f.requests.findById(f.request.id))!;
    expect(stored.metadata).toMatchObject({
      observed_ban_reviews: [
        {
          operation_metadata: {
            report_ban_observed_ban: { id: reference.observedBanId, source: 'unknown_external' },
          },
          result: { observed_ban_result: { status: 'ban_outcome_unknown' } },
        },
      ],
    });
    expect(f.ban).toHaveBeenCalledTimes(1);
  });

  it('reviews a detection-only observed ban without requiring or changing a report', async () => {
    const f = await uncertain(false);
    expect(f.request.report_intake_id).toBeNull();
    const reportBefore = await f.reports.findById(f.report.id);
    await f.security.reviewUncertainReportBan(
      f.guild,
      f.reference,
      f.moderator,
      'Reviewed absence'
    );
    expect((await f.requests.findById(f.request.id))?.result).toMatchObject({
      observed_ban_result: { status: 'ban_reviewed_no_current_ban' },
    });
    expect((await f.detections.findById(f.detection.id))?.metadata).not.toHaveProperty(
      'observed_action'
    );
    expect((await f.cases.findById(f.event.id))?.quarantine_attempt_id).toBeNull();
    expect(await f.reports.findById(f.report.id)).toEqual(reportBefore);
    expect(f.ban).toHaveBeenCalledTimes(1);
    expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(0);
  });

  it('reviews absence without enforcement, retains history, and requires a new review for a fresh uncertain attempt', async () => {
    const f = await uncertain();
    const beforeMember = await f.members.findByServerAndUser('guild', 'target');
    await f.security.reviewUncertainReportBan(
      f.guild,
      f.reference,
      f.moderator,
      'Reviewed audit trail'
    );
    await f.security.reviewUncertainReportBan(f.guild, f.reference, f.moderator, 'Repeated review');
    const reviewed = (await f.requests.findById(f.request.id))!;
    expect(reviewed.result).toMatchObject({
      observed_ban_result: { status: 'ban_reviewed_no_current_ban' },
    });
    expect(reviewed.metadata).toMatchObject({
      report_ban_phase: null,
      observed_ban_reviews: [
        expect.objectContaining({
          attempt_token: f.reference.attemptToken,
          reviewed_by: 'moderator',
          reason: 'Reviewed audit trail',
          disposition: 'no_current_ban_historical_outcome_uncertain',
          result: {
            observed_ban_result: { status: 'ban_outcome_unknown', operationId: f.request.id },
          },
        }),
      ],
    });
    expect((reviewed.metadata as Record<string, unknown>).observed_ban_reviews).toHaveLength(1);
    expect((await f.reports.findById(f.report.id))?.metadata).not.toHaveProperty(
      'report_ban_operation_id'
    );
    expect((await f.detections.findById(f.detection.id))?.metadata).not.toHaveProperty(
      'observed_action'
    );
    expect(await f.cases.findById(f.event.id)).toMatchObject({
      status: 'pending',
      quarantine_attempt_id: null,
      containment_status: f.event.containment_status,
    });
    expect(await f.members.findByServerAndUser('guild', 'target')).toEqual(beforeMember);
    expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(0);
    expect(f.ban).toHaveBeenCalledTimes(1);
    const retry = await f.requests.enqueue({
      serverId: 'guild',
      actorId: 'moderator',
      actorSurface: 'discord',
      targetUserId: 'target',
      detectionEventId: f.detection.id,
      reportIntakeId: f.report.id,
      actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
      idempotencyKey: 'ban:report',
      metadata: { reason: 'New decision' },
    });
    expect(getReportBanAttemptToken(retry)).not.toBe(f.reference.attemptToken);
    const retryResult = await f.security.banObservedDetection(
      f.member,
      f.detection.id,
      f.moderator,
      'New decision',
      retry
    );
    expect(retryResult.status).toBe('ban_outcome_unknown');
    await f.requests.complete(
      retry.id,
      { observed_ban_result: retryResult },
      getReportBanAttemptToken(retry)
    );
    await expect(
      f.security.reviewUncertainReportBan(f.guild, f.reference, f.moderator, 'Old acknowledgment')
    ).rejects.toThrow('operation changed');
    expect((await f.requests.findById(retry.id))?.metadata).toMatchObject({
      report_ban_phase: 'reconciliation_required',
    });
    expect((await f.reports.findById(f.report.id))?.metadata).toHaveProperty(
      'report_ban_operation_id',
      retry.id
    );
    expect(f.ban).toHaveBeenCalledTimes(2);
  });

  it('retains a different reviewer audit separately from a later successful ban and analytics', async () => {
    const f = await uncertain();
    const reviewer = { id: 'reviewer', username: 'reviewer' } as User;
    (f.guild.members.fetch as jest.Mock).mockResolvedValue({ permissions: { has: () => true } });
    await f.security.reviewUncertainReportBan(f.guild, f.reference, reviewer, 'Reviewed absence');
    expect(
      await getPrismaClient().users.findUnique({ where: { discord_id: reviewer.id } })
    ).not.toBeNull();
    const retry = await f.requests.enqueue({
      serverId: 'guild',
      actorId: 'moderator',
      actorSurface: 'discord',
      targetUserId: 'target',
      detectionEventId: f.detection.id,
      reportIntakeId: f.report.id,
      actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
      idempotencyKey: 'ban:report',
      metadata: { reason: 'New confirmed decision' },
    });
    Object.assign(f.member, { joinedAt: null });
    f.ban.mockResolvedValue(undefined);
    expect(
      await f.security.banObservedDetection(
        f.member,
        f.detection.id,
        f.moderator,
        'New confirmed decision',
        retry
      )
    ).toEqual({ status: 'banned' });
    const completed = (await f.requests.findById(retry.id))!;
    expect(completed.metadata).toMatchObject({
      report_ban_membership_joined_at: null,
      observed_ban_reviews: [
        expect.objectContaining({
          reviewed_by: 'reviewer',
          attempt_token: f.reference.attemptToken,
        }),
      ],
    });
    expect(await f.actionRepo.getActionHistory('target', 'guild')).toEqual([
      expect.objectContaining({ action_type: 'ban', admin_id: 'moderator' }),
    ]);
    expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toHaveLength(1);
    expect(f.analytics.captureUserEvent).toHaveBeenCalledTimes(1);
    expect(f.ban).toHaveBeenCalledTimes(2);
  });

  it.each(['present', 'permission', 'operation', 'version', 'timeout', 'confirmed'])(
    'rejects no-current-ban review after %s changes',
    async (change) => {
      const f = await uncertain();
      if (change === 'present') f.banFetch.mockResolvedValue({ user: f.user });
      if (change === 'permission')
        (f.guild.members.fetch as jest.Mock).mockResolvedValue({
          permissions: { has: () => false },
        });
      if (change === 'operation') f.reference.targetUserId = 'other-user';
      if (change === 'version') await f.requests.heartbeat(f.request.id, f.reference.attemptToken);
      if (change === 'confirmed')
        await f.requests.mergeMetadata(
          f.request.id,
          {
            report_ban_phase: 'discord_confirmed',
            report_ban_confirmed_at: new Date().toISOString(),
          },
          f.reference.attemptToken
        );
      if (change === 'timeout') f.banFetch.mockRejectedValue(new Error('timeout'));
      await expect(
        f.security.reviewUncertainReportBan(f.guild, f.reference, f.moderator, 'Review')
      ).rejects.toThrow();
      expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
        report_ban_phase: change === 'confirmed' ? 'discord_confirmed' : 'reconciliation_required',
      });
      expect(f.ban).toHaveBeenCalledTimes(1);
    }
  );

  it('fences paused reconciliation and preserves newer case ownership and member state', async () => {
    const f = await uncertain();
    const stale = (await f.requests.findById(f.request.id))!;
    await getPrismaClient().verification_events.update({
      where: { id: f.event.id },
      data: { quarantine_attempt_id: 'new-owner' },
    });
    await f.members.upsertMember('guild', 'target', {
      verification_status: VerificationStatus.VERIFIED,
      last_status_change: new Date(Date.now() + 60000),
    });
    let reached!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    f.banFetch.mockImplementationOnce(async () => {
      reached();
      await paused;
      return { user: f.user };
    });
    const reconciling = f.security.reconcileReportBan(stale).catch((error: unknown) => error);
    await entered;
    await f.security.reviewUncertainReportBan(
      f.guild,
      f.reference,
      f.moderator,
      'No current ban at review'
    );
    resume();
    expect(await reconciling).toMatchObject({
      message: expect.stringContaining('ownership changed'),
    });
    await f.requests.complete(
      f.request.id,
      { observed_ban_result: { status: 'banned' } },
      f.reference.attemptToken
    );
    expect((await f.requests.findById(f.request.id))?.result).toMatchObject({
      observed_ban_result: { status: 'ban_reviewed_no_current_ban' },
    });
    expect(await f.cases.findById(f.event.id)).toMatchObject({
      quarantine_attempt_id: 'new-owner',
      status: 'pending',
    });
    expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
      verification_status: 'verified',
    });
    expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(0);
    expect(f.ban).toHaveBeenCalledTimes(1);
  });

  it('claims successful completion analytics only once across repository instances', async () => {
    const f = await fixture();
    await f.requests.complete(
      f.request.id,
      { observed_ban_result: { status: 'banned' } },
      getReportBanAttemptToken(f.request)
    );
    const second = new ModerationActionRequestRepository(getPrismaClient());
    const claims = await Promise.all(
      [f.requests, second].map((repo) =>
        repo.claimReportBanCompletionAnalytics(f.request.id, getReportBanAttemptToken(f.request)!)
      )
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('fails a stale phase-less owner and fences its late continuation before explicit retry', async () => {
    const f = await fixture();
    const claimed = (await f.requests.claimNext())!;
    expect(claimed.status).toBe('processing');
    await getPrismaClient().moderation_action_requests.update({
      where: { id: claimed.id },
      data: { updated_at: new Date(Date.now() - 16 * 60_000) },
    });
    // A fresh worker observes the crash boundary before any preparation was saved.
    await f.worker().processPendingRequests();
    expect((await f.requests.findById(claimed.id))?.status).toBe('failed');
    await expect(
      f.security.banObservedDetection(
        f.member,
        f.detection.id,
        f.moderator,
        'Confirmed spam',
        claimed
      )
    ).rejects.toThrow();
    expect(f.ban).not.toHaveBeenCalled();
    const retry = await f.requests.enqueue({
      serverId: 'guild',
      actorId: 'moderator',
      actorSurface: 'web',
      targetUserId: 'target',
      reportIntakeId: f.report.id,
      detectionEventId: f.detection.id,
      actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
      idempotencyKey: f.request.idempotency_key,
      metadata: { reason: 'Confirmed spam' },
    });
    expect(getReportBanAttemptToken(retry)).not.toBe(getReportBanAttemptToken(claimed));
    await expect(
      f.security.banObservedDetection(
        f.member,
        f.detection.id,
        f.moderator,
        'Confirmed spam',
        claimed
      )
    ).rejects.toThrow();
    await f.worker().processPendingRequests();
    expect(f.ban).toHaveBeenCalledTimes(1);
    expect((await f.requests.findById(claimed.id))?.status).toBe('completed');
  });
  it.each(['expiry', 'observer', 'preparing observer', 'unban'])(
    'preserves report-ban ownership and historical cleanup across %s',
    async (boundary) => {
      const f = await fixture();
      const event = await f.cases.createFromDetection(
        f.detection.id,
        'guild',
        'target',
        VerificationStatus.PENDING
      );
      await f.cases.update(event.id, { case_kind: CaseKind.COMPROMISED_ACCOUNT });
      let reached!: () => void;
      let resume!: () => void;
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      if (boundary === 'preparing observer') {
        const merge = f.requests.mergeMetadata.bind(f.requests);
        jest.spyOn(f.requests, 'mergeMetadata').mockImplementation(async (...args) => {
          if (args[1].report_ban_phase === 'enforcement_started') {
            reached();
            await gate;
          }
          return merge(...args);
        });
      } else {
        f.ban.mockImplementationOnce(async () => {
          reached();
          await gate;
        });
      }
      const executing = f.execute().catch((error: unknown) => error);
      await paused;
      const owned = (await f.cases.findById(event.id))!;
      if (boundary === 'expiry') {
        const expiry = new CaseRoleReleaseReconciliationService(
          f.client,
          f.cases,
          f.roles as never,
          new RoleQuarantineSnapshotRepository(getPrismaClient()),
          {} as never,
          {} as never,
          {} as never,
          f.notifications as never,
          f.queue as never
        );
        await expiry.runOnce(new Date(Date.now() + 6 * 60_000));
        expect((await f.cases.findById(event.id))?.quarantine_attempt_id).toBe(
          owned.quarantine_attempt_id
        );
        expect(
          await f.cases.recoverExpiredQuarantineAttempt(
            event.id,
            owned.quarantine_attempt_id!,
            new Date(Date.now() + 6 * 60_000),
            {}
          )
        ).toBeNull();
      }
      if (boundary.includes('observer')) {
        const observed = await f.moderation.recordObservedDiscordBan(f.guild, f.user, {
          source: ModerationOutcomeSource.UNKNOWN_EXTERNAL,
          sourceDetail: 'guildBanAdd',
        });
        expect(observed).toBe(boundary === 'preparing observer' ? 1 : 0);
        if (boundary === 'observer') {
          // Exercise the mutation fence even when the observer read a pre-enforcement snapshot.
          expect(
            await f.cases.update(
              event.id,
              { status: VerificationStatus.BANNED, metadata: {} },
              { allowQuarantineOverride: true, deferReportBanEnforcement: true }
            )
          ).toBeNull();
        }
      }
      if (boundary === 'unban') {
        jest
          .spyOn(f.moderation, 'finalizeObservedBan')
          .mockRejectedValueOnce(new Error('cleanup interrupted'));
      }
      resume();
      const result = await executing;
      if (boundary === 'preparing observer') {
        expect(result).toBeInstanceOf(Error);
        expect(f.ban).not.toHaveBeenCalled();
        expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toMatchObject([
          { source: 'unknown_external' },
        ]);
        return;
      }
      if (boundary === 'unban') {
        expect(result).toMatchObject({ status: 'banned_updates_pending' });
        f.banFetch.mockRejectedValue({ code: 10026, message: 'Unknown Ban' });
        const rejoinedAt = new Date(Date.now() + 1000);
        await f.members.upsertMember('guild', 'target', {
          verification_status: VerificationStatus.VERIFIED,
          case_role_active: false,
          last_status_change: rejoinedAt,
          join_date: rejoinedAt,
        });
        await f.requests.mergeMetadata(
          f.request.id,
          {
            report_ban_lease_until: new Date(0).toISOString(),
            report_ban_retry_at: new Date(0).toISOString(),
          },
          getReportBanAttemptToken(f.request)
        );
        await f.worker().processPendingRequests();
        expect(await f.members.findByServerAndUser('guild', 'target')).toMatchObject({
          verification_status: 'verified',
          last_status_change: rejoinedAt,
          join_date: rejoinedAt,
        });
      } else expect(result).toEqual({ status: 'banned' });
      expect(await f.requests.findById(f.request.id)).toMatchObject({
        status: 'completed',
        result: { observed_ban_result: { status: 'banned' } },
        metadata: { report_ban_phase: null },
      });
      expect((await f.cases.findById(event.id))?.status).toBe('banned');
      expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
      expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toMatchObject([
        { source: 'drasil' },
      ]);
      expect(f.ban).toHaveBeenCalledTimes(1);
      expect((await f.actionRepo.getActionHistory('target', 'guild'))[0].metadata).toMatchObject({
        user_snapshot: {
          id: 'target',
          username: 'target',
          avatar_url: 'https://example.test/avatar.png',
        },
      });
    }
  );
  it.each(['action', 'outcome'])(
    'does not duplicate %s or regress a successful takeover when the old worker resumes',
    async (boundary) => {
      const f = await fixture();
      let reached!: () => void;
      let resume!: () => void;
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const createAction = f.actionRepo.createAction.bind(f.actionRepo);
      const createOutcome = f.outcomeRepo.createOutcome.bind(f.outcomeRepo);
      if (boundary === 'action')
        jest.spyOn(f.actionRepo, 'createAction').mockImplementationOnce(async (data) => {
          reached();
          await gate;
          await createAction(data);
          throw new Error('old worker cleanup failed after takeover');
        });
      else
        jest.spyOn(f.outcomeRepo, 'createOutcome').mockImplementationOnce(async (data) => {
          reached();
          await gate;
          await createOutcome(data);
          throw new Error('old worker cleanup failed after takeover');
        });
      const old = f.execute();
      await paused;
      const due = new Date(Date.now() + 16 * 60_000);
      const takeover = await f.requests.claimReportBanReconciliation(due);
      expect(takeover).not.toBeNull();
      expect(await f.security.reconcileReportBan(takeover!)).toEqual({ status: 'banned' });
      const success = (await f.requests.findById(f.request.id))!;
      resume();
      const stale = await old;
      await f.requests.complete(
        f.request.id,
        { observed_ban_result: stale },
        getReportBanAttemptToken(f.request)
      );
      await f.requests.fail(f.request.id, 'stale failure', getReportBanAttemptToken(f.request));
      expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
      expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toHaveLength(1);
      expect(await f.requests.findById(f.request.id)).toMatchObject({
        status: 'completed',
        result: success.result,
        metadata: {
          report_ban_phase: null,
          report_ban_confirmed_at: (success.metadata as Record<string, unknown>)
            .report_ban_confirmed_at,
        },
      });
      expect((await f.reports.findById(f.report.id))?.status).toBe(ReportIntakeStatus.ACTIONED);
      expect(f.ban).toHaveBeenCalledTimes(1);
    }
  );
  it('releases stale preparation before old enforcement resumes without erasing newer departure evidence', async () => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    let reached!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const merge = f.requests.mergeMetadata.bind(f.requests);
    jest.spyOn(f.requests, 'mergeMetadata').mockImplementation(async (...args) => {
      const patch = args[1];
      if (patch.report_ban_phase === 'enforcement_started') {
        reached();
        await gate;
      }
      return merge(...args);
    });
    const old = f.execute();
    await paused;
    const departure = {
      member_left_at: '2026-10-15T12:00:00Z',
      evidence_updated: true,
      reminder_sent: true,
    };
    await f.cases.patchMetadata(event.id, departure);
    const takeover = await f.requests.claimReportBanReconciliation(
      new Date(Date.now() + 16 * 60_000)
    );
    expect(takeover?.metadata).toMatchObject({ report_ban_phase: 'preparing' });
    expect(await f.security.reconcileReportBan(takeover!)).toEqual({ status: 'already_handled' });
    resume();
    await expect(old).rejects.toThrow('Report ban preparation ownership changed');
    expect(f.ban).not.toHaveBeenCalled();
    expect(await f.cases.findById(event.id)).toMatchObject({
      status: 'pending',
      quarantine_attempt_id: null,
      metadata: departure,
    });
    expect((await f.reports.findById(f.report.id))?.metadata).not.toHaveProperty(
      'report_ban_operation_id'
    );
    expect((await f.detections.findById(f.detection.id))?.metadata).not.toHaveProperty(
      'observed_action'
    );
  });
  it('does not release guards when the old preparing snapshot reaches the lock after confirmed enforcement', async () => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    let reached!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let prepared!: () => void;
    let continueEnforcement!: () => void;
    const preparing = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    const enforcementGate = new Promise<void>((resolve) => {
      continueEnforcement = resolve;
    });
    const merge = f.requests.mergeMetadata.bind(f.requests);
    jest.spyOn(f.requests, 'mergeMetadata').mockImplementation(async (...args) => {
      const patch = args[1];
      if (patch.report_ban_phase === 'enforcement_started') {
        prepared();
        await enforcementGate;
      }
      return merge(...args);
    });
    const old = f.execute();
    await preparing;
    expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
      report_ban_phase: 'preparing',
    });
    const release = f.requests.releaseReportBanPreparation.bind(f.requests);
    jest
      .spyOn(f.requests, 'releaseReportBanPreparation')
      .mockImplementationOnce(async (...args) => {
        reached();
        await gate;
        return release(...args);
      });
    const staleRelease = f.requests.releaseReportBanPreparation(
      f.request.id,
      'preparing',
      getReportBanAttemptToken(f.request)
    );
    await paused;
    continueEnforcement();
    expect(await old).toEqual({ status: 'banned' });
    const success = (await f.requests.findById(f.request.id))!;
    resume();
    expect(await staleRelease).toMatchObject({ status: 'completed', result: success.result });
    expect(await f.cases.findById(event.id)).toMatchObject({
      status: 'banned',
      metadata: { report_ban_operation_id: f.request.id },
    });
    expect((await f.reports.findById(f.report.id))?.metadata).toHaveProperty(
      'report_ban_operation_id',
      f.request.id
    );
    expect((await f.detections.findById(f.detection.id))?.metadata).toHaveProperty(
      'observed_action',
      'ban'
    );
    expect(f.ban).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['bot', 'enforcement'],
    ['web', 'enforcement'],
    ['bot', 'terminal claim'],
    ['web', 'terminal claim'],
  ])('fences paused preparation from an ordinary %s retry at %s', async (surface, pausePoint) => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    let reached!: () => void;
    let resumeA!: () => void;
    let resumeB!: () => void;
    const pausedA = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gateA = new Promise<void>((resolve) => {
      resumeA = resolve;
    });
    let bReached!: () => void;
    const pausedB = new Promise<void>((resolve) => {
      bReached = resolve;
    });
    const gateB = new Promise<void>((resolve) => {
      resumeB = resolve;
    });
    const merge = f.requests.mergeMetadata.bind(f.requests);
    let transitions = 0;
    jest.spyOn(f.requests, 'mergeMetadata').mockImplementation(async (...args) => {
      if (pausePoint === 'enforcement' && args[1].report_ban_phase === 'enforcement_started') {
        transitions++;
        if (transitions === 1) {
          reached();
          await gateA;
        } else {
          bReached();
          await gateB;
        }
      }
      return merge(...args);
    });
    if (pausePoint === 'terminal claim') {
      const claim = f.cases.claimTerminalActions.bind(f.cases);
      let claims = 0;
      jest.spyOn(f.cases, 'claimTerminalActions').mockImplementation(async (...args) => {
        claims++;
        if (claims === 1) {
          reached();
          await gateA;
        } else {
          bReached();
          await gateB;
        }
        return claim(...args);
      });
    }
    try {
      const old = f.execute().then(
        (value) => value,
        (error) => error as Error
      );
      await Promise.race([
        pausedA,
        old.then((value) => {
          throw new Error(`A ended before pause: ${String(value)}`);
        }),
      ]);
      const oldSnapshot = (await f.requests.findById(f.request.id))!;
      await f.security.reconcileReportBan(oldSnapshot);
      const input = {
        serverId: 'guild',
        targetUserId: 'target',
        actorId: 'moderator',
        actorSurface: surface,
        actionType: 'ban_observed_detection' as const,
        reportIntakeId: f.report.id,
        detectionEventId: f.detection.id,
        idempotencyKey: f.request.idempotency_key,
        metadata: { reason: 'Confirmed spam' },
      };
      if (surface === 'web') {
        const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
        try {
          await insertModerationActionRequestWithReceipt(pool, input);
        } finally {
          await pool.end();
        }
      } else
        await f.requests.enqueue({
          ...input,
          actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
        });
      const retry = (await f.requests.claimNext())!;
      expect(retry.id).toBe(f.request.id);
      const newer = f.security.banObservedDetection(
        f.member,
        f.detection.id,
        f.moderator,
        'Confirmed spam',
        retry
      );
      await Promise.race([
        pausedB,
        newer.then((value) => {
          throw new Error(`B ended before pause: ${JSON.stringify(value)}`);
        }),
      ]);
      const token = (oldSnapshot.metadata as Record<string, unknown>)
        .report_ban_attempt_token as string;
      const activeBefore = (await f.requests.findById(retry.id))!;
      await f.requests.releaseReportBanPreparation(retry.id, 'preparing', token);
      await f.requests.complete(retry.id, { observed_ban_result: { status: 'banned' } }, token);
      await f.requests.fail(retry.id, 'stale failure', token);
      await f.requests.heartbeat(retry.id, token);
      expect(await f.requests.findById(retry.id)).toEqual(activeBefore);
      expect((await f.reports.findById(f.report.id))?.metadata).toHaveProperty(
        'report_ban_operation_id',
        retry.id
      );
      expect((await f.detections.findById(f.detection.id))?.metadata).toHaveProperty(
        'observed_action',
        'ban'
      );
      expect((await f.cases.findById(event.id))?.quarantine_attempt_id).toBe(
        pausePoint === 'terminal claim'
          ? null
          : (activeBefore.metadata as Record<string, unknown>).report_ban_attempt_id
      );
      resumeA();
      expect(await old).toBeInstanceOf(Error);
      const active = (await f.requests.findById(retry.id))!;
      expect(active.metadata).toMatchObject({ report_ban_phase: 'preparing' });
      expect(f.ban).not.toHaveBeenCalled();
      resumeB();
      expect(await newer).toEqual({ status: 'banned' });
      expect(f.ban).toHaveBeenCalledTimes(1);
      expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
      expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toHaveLength(1);
      expect((await f.cases.findById(event.id))?.status).toBe('banned');
      expect((await f.reports.findById(f.report.id))?.status).toBe('actioned');
      expect(await f.requests.findById(retry.id)).toMatchObject({
        status: 'completed',
        metadata: { report_ban_phase: null },
        result: { observed_ban_result: { status: 'banned' } },
      });
    } finally {
      resumeA();
      resumeB();
    }
  });

  it.each(['bot', 'web'])(
    'retains uncertain failed %s requests instead of rotating the attempt',
    async (surface) => {
      const f = await fixture();
      const input = {
        serverId: 'guild',
        targetUserId: 'target',
        actorId: 'moderator',
        actorSurface: surface,
        actionType: 'ban_observed_detection' as const,
        reportIntakeId: f.report.id,
        detectionEventId: f.detection.id,
        idempotencyKey: f.request.idempotency_key,
      };
      for (const [phase, status] of [
        ['enforcement_started', null],
        ['discord_confirmed', null],
        ['reconciliation_required', null],
        [null, 'ban_outcome_unknown'],
        [null, 'banned_updates_pending'],
      ]) {
        const seeded = await getPrismaClient().moderation_action_requests.update({
          where: { id: f.request.id },
          data: {
            status: 'failed',
            metadata: { ...(f.request.metadata as object), report_ban_phase: phase },
            result: status ? { observed_ban_result: { status, operationId: f.request.id } } : {},
          },
        });
        if (surface === 'web') {
          const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
          try {
            await insertModerationActionRequestWithReceipt(pool, input);
          } finally {
            await pool.end();
          }
        } else
          await f.requests.enqueue({
            ...input,
            actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
          });
        expect(await f.requests.findById(f.request.id)).toMatchObject({
          status: 'failed',
          metadata: seeded.metadata,
          result: seeded.result,
        });
        expect(await f.requests.claimNext()).toBeNull();
      }
      expect(f.ban).not.toHaveBeenCalled();
    }
  );
});

integration('shared detection action persistence boundary', () => {
  it('revoked_actor_cannot_start_report_ban', async () => {
    const f = await fixture();
    (f.guild.members.fetch as jest.Mock).mockImplementation(async (value) =>
      (typeof value === 'object' ? value.user : value) === 'moderator'
        ? {
            id: 'moderator',
            permissions: { bitfield: 0n, has: () => false },
            roles: { cache: new Map() },
          }
        : f.member
    );
    await f.worker().processPendingRequests();
    const banCallsAfterRevocation = f.ban.mock.calls.length;
    expect(banCallsAfterRevocation).toBe(0);
    expect(await f.requests.findById(f.request.id)).toMatchObject({
      status: 'failed',
      last_error: 'Detection action denied: permission_denied',
    });
  });
  it('confirmed_ban_recovery_finishes_after_policy_disable', async () => {
    const f = await fixture();
    jest
      .spyOn(f.moderation, 'finalizeObservedBan')
      .mockRejectedValueOnce(new Error('interrupted follow-up'));
    await f.worker().processPendingRequests();
    expect(f.ban).toHaveBeenCalledTimes(1);
    f.config.getServerConfig.mockResolvedValue({
      settings: { moderator_ban_action_enabled: false },
    });
    (f.guild.members.fetch as jest.Mock).mockImplementation(async () => {
      throw { code: 10007 };
    });
    await f.requests.mergeMetadata(
      f.request.id,
      {
        report_ban_lease_until: new Date(0).toISOString(),
        report_ban_retry_at: new Date(0).toISOString(),
      },
      getReportBanAttemptToken(f.request)
    );
    await f.worker().processPendingRequests();
    const recovered = await f.requests.findById(f.request.id);
    const recoveredReceipt = (recovered?.result as { observed_ban_result: { status: string } })
      .observed_ban_result;
    const banCallsAcrossRecovery = f.ban.mock.calls.length;
    expect(banCallsAcrossRecovery).toBe(1);
    expect(recoveredReceipt.status).toBe('banned');
    expect(recovered?.actor_id).toBe('moderator');
    expect((await f.actionRepo.getActionHistory('target', 'guild'))[0].admin_id).toBe('moderator');
  });
  it('uncertain_ban_never_reenforces', async () => {
    const f = await fixture();
    f.ban.mockRejectedValue(new Error('transport lost'));
    f.banFetch.mockRejectedValue({ code: 10026 });
    await f.worker().processPendingRequests();
    f.config.getServerConfig.mockResolvedValue({
      settings: { moderator_ban_action_enabled: false },
    });
    await f.requests.mergeMetadata(
      f.request.id,
      {
        report_ban_lease_until: new Date(0).toISOString(),
        report_ban_retry_at: new Date(0).toISOString(),
      },
      getReportBanAttemptToken(f.request)
    );
    await f.worker().processPendingRequests();
    const recovered = await f.requests.findById(f.request.id);
    const uncertainReceipt = (recovered?.result as { observed_ban_result: { status: string } })
      .observed_ban_result;
    expect(uncertainReceipt.status).toBe('ban_outcome_unknown');
    expect(f.ban).toHaveBeenCalledTimes(1);
  });
  it('accounting_change_is_guild_bound', async () => {
    const f = await fixture();
    const before = await f.detections.findById(f.detection.id);
    const context = {
      guildId: 'foreign',
      requestId: 'accounting',
      source: 'web',
      actor: { kind: 'user' as const, userId: 'moderator' },
    };
    const command = {
      kind: 'ignore_detection_accounting' as const,
      targetUserId: 'target',
      detectionEventId: f.detection.id,
      reason: null,
    };
    f.application.caseConfirmations.recordVerified(context, command);
    // Current actor is authorized in the requested guild, but the detection belongs elsewhere.
    (f.client.guilds.fetch as jest.Mock).mockResolvedValue({ ...f.guild, id: 'foreign' });
    expect(await f.application.detections.execute(context, command)).toEqual({
      kind: 'denied',
      code: 'binding_mismatch',
    });
    const foreignDetectionAccountingUnchanged =
      JSON.stringify(await f.detections.findById(f.detection.id)) === JSON.stringify(before);
    expect(foreignDetectionAccountingUnchanged).toBe(true);
  });
});

integration('shared uncertain-ban operator review', () => {
  it('keeps attempt fencing private and consumes a bound review without reenforcement', async () => {
    const f = await fixture();
    f.ban.mockRejectedValue(new Error('transport lost'));
    f.banFetch.mockRejectedValue({ code: 10026 });
    await f.worker().processPendingRequests();
    const context = {
      guildId: 'guild',
      requestId: 'review-prepare',
      source: 'discord_interaction',
      actor: { kind: 'user' as const, userId: 'moderator' },
    };
    const prepared = await f.application.detections.execute(context, {
      kind: 'prepare_report_ban_review',
      operationId: f.request.id,
    });
    if (prepared.kind !== 'outcome' || prepared.outcome.kind !== 'prepare_report_ban_review')
      throw new Error('Expected review preparation');
    expect(prepared.outcome.reference).not.toHaveProperty('attemptToken');
    const command = {
      kind: 'review_uncertain_report_ban' as const,
      ...prepared.outcome.reference,
      reason: 'Checked current ban and audit trail',
    };
    const reviewContext = { ...context, requestId: 'review-confirm' };
    f.application.caseConfirmations.recordVerified(reviewContext, command);
    expect(await f.application.detections.execute(reviewContext, command)).toEqual({
      kind: 'outcome',
      outcome: { kind: 'review_uncertain_report_ban', succeeded: true },
    });
    const persisted = await f.requests.findById(f.request.id);
    expect(persisted?.result).toMatchObject({
      observed_ban_result: { status: 'ban_reviewed_no_current_ban' },
    });
    expect((await f.reports.findById(f.report.id))?.metadata).not.toHaveProperty(
      'report_ban_operation_id'
    );
    f.application.caseConfirmations.recordVerified(reviewContext, command);
    await expect(f.application.detections.execute(reviewContext, command)).resolves.toEqual({
      kind: 'denied',
      code: 'stale_state',
    });
    expect(f.ban).toHaveBeenCalledTimes(1);
  });
});

integration('shared accounting execution scope', () => {
  const originalGlobalAdmins = process.env.DRASIL_GLOBAL_ADMIN_IDS;
  afterEach(() => {
    if (originalGlobalAdmins === undefined) delete process.env.DRASIL_GLOBAL_ADMIN_IDS;
    else process.env.DRASIL_GLOBAL_ADMIN_IDS = originalGlobalAdmins;
  });
  it.each([
    ModerationActionRequestType.IGNORE_DETECTION_ACCOUNTING,
    ModerationActionRequestType.RESTORE_DETECTION_ACCOUNTING,
  ])(
    'queued %s denies revoked Manage Server even with Moderate Members and writes no audit',
    async (actionType) => {
      const f = await fixture(false);
      await getPrismaClient().moderation_action_requests.delete({ where: { id: f.request.id } });
      if (actionType === ModerationActionRequestType.RESTORE_DETECTION_ACCOUNTING)
        await f.detections.markExcludedFromAccounting(f.detection.id, {
          excluded_from_accounting: true,
        });
      const before = await f.detections.findById(f.detection.id);
      const request = await f.requests.enqueue({
        serverId: 'guild',
        actorId: 'moderator',
        actorSurface: 'web',
        targetUserId: 'target',
        detectionEventId: f.detection.id,
        actionType,
        idempotencyKey: `accounting:${actionType}`,
        metadata: { reason: 'Reviewed' },
      });
      (f.guild.members.fetch as jest.Mock).mockImplementation(async (value) =>
        (typeof value === 'object' ? value.user : value) === 'moderator'
          ? {
              id: 'moderator',
              permissions: { bitfield: 1n << 40n, has: () => false },
              roles: { cache: new Map() },
            }
          : f.member
      );
      await f.worker().processPendingRequests();
      expect(await f.requests.findById(request.id)).toMatchObject({
        status: 'failed',
        last_error: 'Detection action denied: permission_denied',
      });
      expect(await f.detections.findById(f.detection.id)).toEqual(before);
      expect(await getPrismaClient().admin_actions.count()).toBe(0);
    }
  );
  it.each(
    ['ignore-detection', 'restore-detection'].flatMap((subcommand) =>
      ['global', 'not-global', 'foreign', 'global-revoked'].map((scope) => ({ subcommand, scope }))
    )
  )(
    'slash $subcommand preserves accounting scope $scope through real confirmation',
    async ({ subcommand, scope }) => {
      const f = await fixture(false);
      process.env.DRASIL_GLOBAL_ADMIN_IDS =
        scope === 'not-global' ? 'other-admin' : ' other-admin, moderator , ';
      if (scope === 'foreign')
        await getPrismaClient().servers.create({ data: { guild_id: 'foreign' } });
      await getPrismaClient().detection_events.update({
        where: { id: f.detection.id },
        data: { server_id: scope === 'foreign' ? 'foreign' : null },
      });
      if (subcommand === 'restore-detection')
        await f.detections.markExcludedFromAccounting(f.detection.id, {
          excluded_from_accounting: true,
        });
      const before = await f.detections.findById(f.detection.id);
      let permissions = 32n;
      (f.guild.members.fetch as jest.Mock).mockImplementation(async (value) =>
        (typeof value === 'object' ? value.user : value) === 'moderator'
          ? {
              id: 'moderator',
              permissions: { bitfield: permissions, has: () => true },
              roles: { cache: new Map() },
            }
          : f.member
      );
      const handler = new ModerationCommandHandler(
        f.config as never,
        f.security,
        async () => undefined,
        undefined,
        undefined,
        f.application
      );
      const interaction = {
        id: `audit-${scope}-${subcommand}`,
        guild: f.guild,
        guildId: 'guild',
        user: f.moderator,
        memberPermissions: { has: () => true },
        options: {
          getSubcommand: () => subcommand,
          getString: (name: string) => (name === 'detection-id' ? f.detection.id : 'Reviewed'),
        },
        reply: jest.fn(),
        editReply: jest.fn(),
      } as unknown as ChatInputCommandInteraction;
      await handler.handleAuditCommand(interaction);
      const reply = (interaction.reply as jest.Mock).mock.calls[0][0];
      expect(reply.components).toHaveLength(1);
      if (scope === 'global-revoked') permissions = 1n << 40n;
      await handleSlashCommandConfirmationButton({
        id: 'audit-confirm',
        customId: reply.components[0].components[0].toJSON().custom_id,
        guildId: 'guild',
        user: f.moderator,
        reply: jest.fn(),
        update: jest.fn(),
        editReply: interaction.editReply,
      } as unknown as ButtonInteraction);
      const after = await f.detections.findById(f.detection.id);
      if (scope === 'global') {
        expect(after?.metadata?.excluded_from_accounting === true).toBe(
          subcommand === 'ignore-detection'
        );
        expect(await getPrismaClient().admin_actions.findMany()).toMatchObject([
          { server_id: null, admin_id: 'moderator', user_id: 'target' },
        ]);
      } else {
        expect(after).toEqual(before);
        expect(await getPrismaClient().admin_actions.count()).toBe(0);
      }
    }
  );
});
