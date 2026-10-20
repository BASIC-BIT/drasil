import { mock } from 'jest-mock-extended';
import type { IProductAnalyticsService } from '../../services/ProductAnalyticsService';
import type { ISetupDiagnosticsService } from '../../services/SetupDiagnosticsService';
import type { IIntegrityAuditService } from '../../services/IntegrityAuditService';
import type { ICaseRoleLockdownService } from '../../services/CaseRoleLockdownService';
import type { ICaseThreadClosureSweepService } from '../../services/CaseThreadClosureSweepService';
import { createBotApplication } from '../../application/createBotApplication';
import { getReportBanAttemptToken } from '../../repositories/ModerationActionRequestRepository';
import { NotificationManager } from '../../services/NotificationManager';
import { EmbedBuilder, Client, Guild, GuildMember, User } from 'discord.js';
import { SecurityActionService } from '../../services/SecurityActionService';
import { UserModerationService } from '../../services/UserModerationService';
import { AdminActionService } from '../../services/AdminActionService';
import { ModerationOutcomeService } from '../../services/ModerationOutcomeService';
import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';
import { ModerationEvidenceService } from '../../services/ModerationEvidenceService';
import {
  DetectionType,
  ModerationActionRequestType,
  ReportIntakeStatus,
  VerificationStatus,
  CaseContainmentStatus,
} from '../../repositories/types';
import { InMemoryModerationActionRequestRepository } from '../fakes/moderationActionRequests';
import {
  InMemoryAdminActionRepository,
  InMemoryDetectionEventsRepository,
  InMemoryModerationOutcomeRepository,
  InMemoryReportIntakeRepository,
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
  InMemoryVerificationEventRepository,
} from '../fakes/inMemoryRepositories';

async function fixture() {
  const detections = new InMemoryDetectionEventsRepository();
  const reports = new InMemoryReportIntakeRepository();
  const cases = new InMemoryVerificationEventRepository();
  const requests = new InMemoryModerationActionRequestRepository({ cases, reports, detections });
  const members = new InMemoryServerMemberRepository();
  const servers = new InMemoryServerRepository();
  const users = new InMemoryUserRepository();
  const actionRepo = new InMemoryAdminActionRepository();
  const outcomeRepo = new InMemoryModerationOutcomeRepository();
  const actions = new AdminActionService(actionRepo, users, servers);
  const outcomes = new ModerationOutcomeService(outcomeRepo, servers, users);
  const user = {
    id: 'target',
    username: 'target',
    tag: 'target#0001',
    createdTimestamp: 1,
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
    guilds: { fetch: jest.fn().mockResolvedValue(guild) },
    users: { fetch: jest.fn().mockResolvedValue(moderator) },
    channels: { fetch: jest.fn() },
  } as unknown as Client;
  const member = {
    id: user.id,
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
    updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
    logActionToMessage: jest.fn().mockResolvedValue(true),
  };
  const threads = {
    resolveVerificationThread: jest.fn().mockResolvedValue(true),
    closeResolvedVerificationThreads: jest.fn().mockResolvedValue({ results: [] }),
    createVerificationThread: jest.fn(),
    createReportReviewThread: jest.fn(),
    retireReportConfirmationPrompts: jest.fn().mockResolvedValue(undefined),
  };
  const roles = { assignCaseRole: jest.fn() };
  const queue = {
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
    queue as never
  );
  const analytics = { captureUserEvent: jest.fn().mockResolvedValue(undefined) };
  const evidence = new ModerationEvidenceService(detections);
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
    metadata: { reportIntakeId: report.id },
  });
  const request = await requests.enqueue({
    serverId: guild.id,
    actorId: moderator.id,
    actorSurface: 'web',
    targetUserId: user.id,
    reportIntakeId: report.id,
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
    productAnalyticsService: mock<IProductAnalyticsService>(),
    setupDiagnosticsService: mock<ISetupDiagnosticsService>(),
    reportIntakeService: {} as any,
    integrityAuditService: mock<IIntegrityAuditService>(),
    caseRoleLockdownService: mock<ICaseRoleLockdownService>(),
    caseThreadClosureSweepService: mock<ICaseThreadClosureSweepService>(),
    messageDeletionJobs: {} as never,
    messageCleanupService: {} as never,
    captchaChallengeService: null,
    threadManager: {} as any,
    notificationManager: {} as any,
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
    security,
    report,
    detection,
    request,
    execute,
    worker,
  };
}

describe('report-bound observed bans with real services', () => {
  it.each([false, true])(
    'tracks durable observed ban completion once (by ID: %s)',
    async (byId) => {
      const f = await fixture();
      expect(await f.execute(byId)).toEqual({ status: 'banned' });
      await f.security.reconcileReportBan((await f.requests.findById(f.request.id))!);
      expect(f.analytics.captureUserEvent).toHaveBeenCalledTimes(1);
      expect(f.analytics.captureUserEvent).toHaveBeenCalledWith(
        'guild',
        'target',
        'observed detection action completed',
        expect.objectContaining({
          action_type: 'ban',
          ...(byId ? { source_detail: 'ban_by_id' } : {}),
        }),
        { moderatorId: 'moderator', detectionEventId: f.detection.id }
      );
    }
  );

  it('waits for completed cleanup before best-effort analytics', async () => {
    const f = await fixture();
    const finalize = f.moderation.finalizeObservedBan.bind(f.moderation);
    jest
      .spyOn(f.moderation, 'finalizeObservedBan')
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockImplementation(finalize);
    expect(await f.execute()).toMatchObject({ status: 'banned_updates_pending' });
    expect(f.analytics.captureUserEvent).not.toHaveBeenCalled();
    f.analytics.captureUserEvent.mockRejectedValueOnce(new Error('analytics offline'));
    expect(await f.security.reconcileReportBan((await f.requests.findById(f.request.id))!)).toEqual(
      { status: 'banned' }
    );
    expect((await f.requests.findById(f.request.id))?.result).toMatchObject({
      observed_ban_result: { status: 'banned' },
    });
    await f.security.reconcileReportBan((await f.requests.findById(f.request.id))!);
    expect(f.analytics.captureUserEvent).toHaveBeenCalledTimes(1);
    expect(f.ban).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'persists evidence before enforcement, retains audit links, and creates no case (by ID: %s)',
    async (byId) => {
      const f = await fixture();
      f.ban.mockImplementation(async () => {
        expect((await f.detections.findById(f.detection.id))?.metadata).toMatchObject({
          observed_action: 'ban',
          report_ban_operation_id: f.request.id,
          moderation_evidence: {
            unavailable_sources: expect.arrayContaining([
              'profile_image_description',
              'recent_messages',
            ]),
          },
        });
        expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
          report_ban_phase: 'enforcement_started',
        });
      });
      expect(await f.execute(byId)).toEqual({ status: 'banned' });
      expect((await f.reports.findById(f.report.id))?.status).toBe(ReportIntakeStatus.ACTIONED);
      expect(await f.actions.getActionsForUser('guild', 'target')).toEqual([
        expect.objectContaining({
          detection_event_id: f.detection.id,
          verification_event_id: null,
          admin_id: 'moderator',
          metadata: expect.objectContaining({ report_ban_operation_id: f.request.id }),
        }),
      ]);
      expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toEqual([
        expect.objectContaining({
          detection_event_id: f.detection.id,
          actor_id: 'moderator',
          reason: 'Confirmed spam',
        }),
      ]);
      expect(f.threads.createVerificationThread).not.toHaveBeenCalled();
      expect(f.roles.assignCaseRole).not.toHaveBeenCalled();
      expect(await f.execute(byId)).toEqual({ status: 'already_handled' });
      expect(f.ban).toHaveBeenCalledTimes(1);
    }
  );

  it('does not enforce when required evidence persistence fails and releases preparation', async () => {
    const f = await fixture();
    jest
      .spyOn(f.detections, 'patchMetadata')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(f.execute()).rejects.toThrow('storage unavailable');
    expect(f.ban).not.toHaveBeenCalled();
    expect((await f.reports.findById(f.report.id))?.metadata).not.toHaveProperty(
      'report_ban_operation_id'
    );
    expect((await f.detections.findById(f.detection.id))?.metadata).not.toHaveProperty(
      'observed_action'
    );
  });

  it.each(['closed', 'target', 'guild'])(
    'rejects a stale report before evidence or enforcement: %s',
    async (kind) => {
      const f = await fixture();
      if (kind === 'closed')
        await f.reports.update(f.report.id, { status: ReportIntakeStatus.DISMISSED });
      if (kind === 'target')
        await f.reports.update(f.report.id, { confirmedTargetUserId: 'someone-else' });
      if (kind === 'guild') f.request.server_id = 'foreign';
      const capture = jest.spyOn(f.evidence, 'capture');
      await expect(f.execute()).rejects.toThrow();
      expect(capture).not.toHaveBeenCalled();
      expect(f.ban).not.toHaveBeenCalled();
    }
  );

  it('rejects close, target changes, and case opening while evidence capture is paused', async () => {
    const f = await fixture();
    const capture = f.evidence.capture.bind(f.evidence);
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest.spyOn(f.evidence, 'capture').mockImplementation(async (input) => {
      entered();
      await paused;
      return capture(input);
    });
    const execution = f.execute();
    await ready;
    const current = (await f.reports.findById(f.report.id))!;
    expect(
      await f.reports.updateIfCurrent(current, { status: ReportIntakeStatus.DISMISSED })
    ).toBeNull();
    expect(
      await f.reports.update(f.report.id, { confirmedTargetUserId: 'someone-else' })
    ).toBeNull();
    await expect(
      f.security.openObservedDetectionCase(f.member, f.detection.id, f.moderator)
    ).rejects.toThrow('busy');
    resume();
    expect(await execution).toEqual({ status: 'banned' });
  });

  it('recovers a completed pending-update receipt on startup without repeating enforcement or audit', async () => {
    const f = await fixture();
    f.queue.deleteReportThreadAttention.mockRejectedValueOnce(new Error('queue unavailable'));
    expect(await f.execute()).toEqual({
      status: 'banned_updates_pending',
      operationId: f.request.id,
    });
    await f.requests.complete(
      f.request.id,
      {
        observed_ban_result: { status: 'banned_updates_pending', operationId: f.request.id },
      },
      getReportBanAttemptToken(f.request)
    );
    await f.requests.mergeMetadata(
      f.request.id,
      {
        report_ban_retry_at: new Date(0).toISOString(),
        report_ban_lease_until: new Date(0).toISOString(),
      },
      getReportBanAttemptToken(f.request)
    );
    expect(await f.worker().processPendingRequests()).toBe(0);
    expect((await f.requests.findById(f.request.id))?.result).toMatchObject({
      observed_ban_result: { status: 'banned' },
    });
    expect(await f.actions.getActionsForUser('guild', 'target')).toHaveLength(1);
    expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toHaveLength(1);
    expect(f.ban).toHaveBeenCalledTimes(1);
  });

  it('preserves linked-case ownership through a finalization failure and resolves it on restart', async () => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    const original = f.cases.completeTerminalActions.bind(f.cases);
    jest
      .spyOn(f.cases, 'completeTerminalActions')
      .mockRejectedValueOnce(new Error('case write unavailable'))
      .mockImplementation(original);
    f.ban.mockImplementation(async () => {
      const current = await f.cases.findById(event.id);
      expect(current?.containment_status).toBe(CaseContainmentStatus.IN_PROGRESS);
      expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
        report_ban_case_ids: [event.id],
        report_ban_attempt_id: current?.quarantine_attempt_id,
      });
    });
    expect(await f.execute()).toEqual({
      status: 'banned_updates_pending',
      operationId: f.request.id,
    });
    const current = (await f.requests.findById(f.request.id))!;
    f.banFetch.mockRejectedValue({ code: 10026 });
    expect(await f.security.reconcileReportBan(current)).toEqual({ status: 'banned' });
    expect(f.banFetch).not.toHaveBeenCalled();
    expect((await f.cases.findById(event.id))?.status).toBe(VerificationStatus.BANNED);
    expect(f.ban).toHaveBeenCalledTimes(1);
    expect(f.threads.resolveVerificationThread).toHaveBeenCalled();
    expect(f.threads.createVerificationThread).not.toHaveBeenCalled();
  });

  it('keeps an uncertain send unknown when a cached prior ban is absent from Discord', async () => {
    const f = await fixture();
    f.ban.mockRejectedValueOnce(new Error('socket closed'));
    expect(await f.execute()).toMatchObject({ status: 'ban_outcome_unknown' });
    const cachedPriorBan = { user: f.user };
    f.banFetch.mockImplementation(async (options) => {
      if (typeof options === 'object' && options.force) throw { code: 10026 };
      return cachedPriorBan;
    });
    expect(await f.security.reconcileReportBan((await f.requests.findById(f.request.id))!)).toEqual(
      {
        status: 'ban_outcome_unknown',
        operationId: f.request.id,
      }
    );
    expect(f.banFetch).toHaveBeenCalledWith({ user: 'target', force: true });
    const current = (await f.requests.findById(f.request.id))!;
    expect(current.metadata).toMatchObject({ report_ban_phase: 'reconciliation_required' });
    expect(current.metadata).not.toHaveProperty('report_ban_confirmed_at');
    expect((await f.reports.findById(f.report.id))?.status).toBe('submitted');
    expect(await f.actions.getActionsForUser('guild', 'target')).toHaveLength(0);
    expect(f.analytics.captureUserEvent).not.toHaveBeenCalled();
    expect(f.ban).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'reconciles an interrupted send without resending (Discord ban present: %s)',
    async (present) => {
      const f = await fixture();
      f.ban.mockRejectedValueOnce(new Error('socket closed'));
      expect(await f.execute()).toEqual({
        status: 'ban_outcome_unknown',
        operationId: f.request.id,
      });
      if (!present) f.banFetch.mockRejectedValue({ code: 10026 });
      const current = (await f.requests.findById(f.request.id))!;
      expect(await f.security.reconcileReportBan(current)).toMatchObject({
        status: present ? 'banned' : 'ban_outcome_unknown',
      });
      expect(f.ban).toHaveBeenCalledTimes(1);
      if (!present) expect(f.analytics.captureUserEvent).not.toHaveBeenCalled();
      if (!present)
        expect((await f.reports.findById(f.report.id))?.metadata).toHaveProperty(
          'report_ban_operation_id',
          f.request.id
        );
    }
  );

  it('blocks a ban when linked-case quarantine ownership cannot be acquired', async () => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    await f.cases.update(event.id, {
      containment_status: CaseContainmentStatus.IN_PROGRESS,
      quarantine_attempt_id: 'other-operation',
    });
    await expect(f.execute()).rejects.toThrow();
    expect(f.ban).not.toHaveBeenCalled();
  });
  it('releases an interrupted preparing operation and its already-acquired terminal guard', async () => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    const write = f.requests.mergeMetadata.bind(f.requests);
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    jest.spyOn(f.requests, 'mergeMetadata').mockImplementation(async (...args) => {
      const patch = args[1];
      if (patch.report_ban_phase === 'enforcement_started') {
        reached();
        return new Promise(() => {});
      }
      return write(...args);
    });
    void f.execute();
    await ready;
    const interrupted = (await f.requests.findById(f.request.id))!;
    expect((await f.cases.findById(event.id))?.containment_status).toBe(
      CaseContainmentStatus.IN_PROGRESS
    );
    expect(await f.security.reconcileReportBan(interrupted)).toEqual({ status: 'already_handled' });
    expect((await f.cases.findById(event.id))?.containment_status).toBe(event.containment_status);
    expect((await f.reports.findById(f.report.id))?.metadata).not.toHaveProperty(
      'report_ban_operation_id'
    );
    expect((await f.requests.findById(f.request.id))?.status).toBe('failed');
    expect(f.ban).not.toHaveBeenCalled();
  });

  it('retries cleanup after one, five, fifteen, then sixty minutes with a renewable lease', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-15T12:00:00Z') });
    try {
      const f = await fixture();
      f.queue.deleteReportThreadAttention.mockRejectedValue(new Error('queue unavailable'));
      await f.execute();
      for (const minutes of [1, 5, 15, 60]) {
        const row = (await f.requests.findById(f.request.id))!;
        expect(row.metadata).toMatchObject({
          report_ban_retry_at: new Date(Date.now() + minutes * 60_000).toISOString(),
          report_ban_last_error: 'queue unavailable',
        });
        expect(await f.requests.claimReportBanReconciliation(new Date())).toBeNull();
        jest.setSystemTime(Date.now() + minutes * 60_000);
        const claimed = await f.requests.claimReportBanReconciliation(new Date());
        expect(claimed).not.toBeNull();
        expect(await f.requests.claimReportBanReconciliation(new Date())).toBeNull();
        await f.security.reconcileReportBan(claimed!);
      }
      expect(f.ban).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rechecks actor permission at worker execution', async () => {
    const f = await fixture();
    (f.guild.members.fetch as jest.Mock).mockResolvedValueOnce({
      id: 'moderator',
      permissions: { has: () => false, bitfield: 0n },
      roles: { cache: new Map() },
    });
    await f.worker().processPendingRequests();
    expect((await f.requests.findById(f.request.id))?.last_error).toContain('permission_denied');
    expect(f.ban).not.toHaveBeenCalled();
  });
  it('releases ownership after Discord definitively rejects enforcement', async () => {
    const f = await fixture();
    f.ban.mockRejectedValueOnce({ code: 50013, status: 403 });
    await expect(f.execute()).rejects.toMatchObject({ code: 50013 });
    expect((await f.reports.findById(f.report.id))?.metadata).not.toHaveProperty(
      'report_ban_operation_id'
    );
    expect((await f.detections.findById(f.detection.id))?.metadata).not.toHaveProperty(
      'observed_action'
    );
  });

  it('retries thread archival without sending its saved closeout notice again', async () => {
    const f = await fixture();
    await f.reports.update(f.report.id, { metadata: {} });
    const stored = (await f.reports.findById(f.report.id))!;
    // The report was created before a thread identity was available in this fixture.
    const threadReport = { ...stored, thread_id: 'source-thread' };
    const read = f.reports.findById.bind(f.reports);
    jest.spyOn(f.reports, 'findById').mockImplementation(async (id) => {
      const row = await read(id);
      return row ? { ...row, thread_id: threadReport.thread_id } : null;
    });
    const update = f.reports.updateBan.bind(f.reports);
    jest.spyOn(f.reports, 'updateBan').mockImplementation(async (...args) => {
      const row = await update(...args);
      return row ? { ...row, thread_id: threadReport.thread_id } : null;
    });
    const thread = {
      isThread: () => true,
      archived: false,
      send: jest.fn().mockResolvedValue({ id: 'notice-1' }),
      setArchived: jest
        .fn()
        .mockRejectedValueOnce(new Error('archive unavailable'))
        .mockResolvedValue(undefined),
    };
    (f.client.channels.fetch as jest.Mock).mockResolvedValue(thread);
    expect(await f.execute()).toMatchObject({ status: 'banned_updates_pending' });
    expect(await f.security.reconcileReportBan((await f.requests.findById(f.request.id))!)).toEqual(
      { status: 'banned' }
    );
    expect(thread.send).toHaveBeenCalledTimes(1);
    expect(thread.setArchived).toHaveBeenCalledTimes(2);
    expect(f.ban).toHaveBeenCalledTimes(1);
  });
  it('does not enforce when saving the exact acquired case context fails', async () => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    const save = f.requests.mergeMetadata.bind(f.requests);
    jest.spyOn(f.requests, 'mergeMetadata').mockImplementation(async (...args) => {
      const patch = args[1];
      if (patch.report_ban_phase === 'enforcement_started')
        throw new Error('owned context unavailable');
      return save(...args);
    });
    await expect(f.execute()).rejects.toThrow('owned context unavailable');
    expect(f.ban).not.toHaveBeenCalled();
    expect((await f.cases.findById(event.id))?.quarantine_attempt_id).toBeNull();
    expect((await f.reports.findById(f.report.id))?.metadata).not.toHaveProperty(
      'report_ban_operation_id'
    );
  });
  it('retains a partial receipt when linked-case thread closure reports failure', async () => {
    const f = await fixture();
    await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    f.threads.closeResolvedVerificationThreads.mockResolvedValueOnce({
      results: [{ error: 'archive unavailable' }],
    } as never);
    expect(await f.execute()).toEqual({
      status: 'banned_updates_pending',
      operationId: f.request.id,
    });
    expect(f.ban).toHaveBeenCalledTimes(1);
  });
  it('retains a partial receipt when the existing case notification cannot be updated', async () => {
    const f = await fixture();
    const event = await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    await f.cases.update(event.id, { notification_message_id: 'notification' });
    f.notifications.logActionToMessage.mockResolvedValueOnce(false);
    expect(await f.execute()).toEqual({
      status: 'banned_updates_pending',
      operationId: f.request.id,
    });
    expect(f.ban).toHaveBeenCalledTimes(1);
  });
  it.each(['fetch_failure', 'edit_failure', 'deleted', 'deleted_during_edit', 'absent'])(
    'uses the actual observed notification contract: %s',
    async (mode) => {
      const f = await fixture();
      if (mode !== 'absent')
        await f.detections.patchMetadata(f.detection.id, {
          observed_notification_message_id: 'message',
          observed_notification_channel_id: 'channel',
        });
      const manager = new NotificationManager(
        f.client,
        { getServerConfig: jest.fn().mockResolvedValue({ settings: {} }) } as never,
        f.detections
      );
      const channel = {
        messages: {
          fetch: jest.fn().mockResolvedValue({
            embeds: [new EmbedBuilder().setTitle('Observed')],
            edit: jest.fn().mockRejectedValue(new Error('edit denied')),
          }),
        },
      };
      if (mode === 'fetch_failure')
        channel.messages.fetch.mockRejectedValue(new Error('fetch denied'));
      if (mode === 'deleted') channel.messages.fetch.mockRejectedValue({ code: 10008 });
      if (mode === 'deleted_during_edit')
        channel.messages.fetch.mockResolvedValue({
          embeds: [new EmbedBuilder().setTitle('Observed')],
          edit: jest.fn().mockRejectedValue({ code: 10008 }),
        });
      const routed = manager as unknown as {
        getExistingNotificationChannel: () => Promise<unknown>;
      };
      jest.spyOn(routed, 'getExistingNotificationChannel').mockResolvedValue(channel);
      f.notifications.markObservedDetectionActionTaken.mockImplementation(
        manager.markObservedDetectionActionTaken.bind(manager)
      );
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(await f.execute()).toMatchObject({
          status: ['absent', 'deleted', 'deleted_during_edit'].includes(mode)
            ? 'banned'
            : 'banned_updates_pending',
        });
        expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
          report_ban_phase: ['absent', 'deleted', 'deleted_during_edit'].includes(mode)
            ? null
            : 'discord_confirmed',
        });
        expect(f.ban).toHaveBeenCalledTimes(1);
        if (mode === 'edit_failure') expect(error).toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
    }
  );
  it('completes a linked case with no optional notification using the actual notification contract', async () => {
    const f = await fixture();
    await f.cases.createFromDetection(
      f.detection.id,
      'guild',
      'target',
      VerificationStatus.PENDING
    );
    const manager = new NotificationManager(f.client, {} as never, f.detections);
    f.notifications.updateNotificationButtons.mockImplementation(
      manager.updateNotificationButtons.bind(manager)
    );
    expect(await f.execute()).toEqual({ status: 'banned' });
    expect(await f.actionRepo.getActionHistory('target', 'guild')).toHaveLength(1);
    expect(await f.outcomeRepo.findByUserAndServer('target', 'guild')).toHaveLength(1);
    expect((await f.reports.findById(f.report.id))?.status).toBe('actioned');
    expect((await f.requests.findById(f.request.id))?.result).toMatchObject({
      observed_ban_result: { status: 'banned' },
    });
  });
});
