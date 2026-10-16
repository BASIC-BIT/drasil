import { CaseRoleReleaseReconciliationService } from '../../services/CaseRoleReleaseReconciliationService';
import { RoleQuarantineSnapshotRepository } from '../../repositories/RoleQuarantineSnapshotRepository';
import { Pool } from 'pg';
import { insertModerationActionRequestWithReceipt } from '../../../apps/web/lib/moderationActionRequestQueue';
jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
import { Client, Guild, GuildMember, User } from 'discord.js';
import { SecurityActionService } from '../../services/SecurityActionService';
import { UserModerationService } from '../../services/UserModerationService';
import { AdminActionService } from '../../services/AdminActionService';
import { ModerationOutcomeService } from '../../services/ModerationOutcomeService';
import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';
import { ModerationEvidenceService } from '../../services/ModerationEvidenceService';
import {
  CaseKind,
  ModerationOutcomeSource,
  DetectionType,
  ModerationActionRequestType,
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

async function fixture() {
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
    guild,
    user,
    client: { users: { fetch: jest.fn().mockResolvedValue(user) } },
    ban,
  } as unknown as GuildMember;
  (guild.members.fetch as jest.Mock).mockImplementation(async (id) =>
    id === moderator.id ? { permissions: { has: () => true } } : member
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
    queue as never
  );
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
    undefined,
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
  const worker = () =>
    new ModerationActionRequestService(
      requests,
      cases,
      client,
      threads as never,
      {} as never,
      {
        getServerConfig: jest
          .fn()
          .mockResolvedValue({ settings: { moderator_ban_action_enabled: true } }),
      } as never,
      security,
      moderation,
      queue as never,
      {} as never,
      {} as never,
      notifications as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
  return {
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

const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration('report-ban stale worker recovery with real services and Postgres', () => {
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
