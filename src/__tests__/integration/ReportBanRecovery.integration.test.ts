import { Client, Guild, GuildMember, User } from 'discord.js';
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
} from '../../repositories/types';
import { getPrismaClient } from '../testDb';
import { ModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
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
      await f.requests.complete(f.request.id, { observed_ban_result: stale });
      await f.requests.fail(f.request.id, 'stale failure');
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
    jest.spyOn(f.requests, 'mergeMetadata').mockImplementation(async (id, patch) => {
      if (patch.report_ban_phase === 'enforcement_started') {
        reached();
        await gate;
      }
      return merge(id, patch);
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
    jest.spyOn(f.requests, 'mergeMetadata').mockImplementation(async (id, patch) => {
      if (patch.report_ban_phase === 'enforcement_started') {
        prepared();
        await enforcementGate;
      }
      return merge(id, patch);
    });
    const old = f.execute();
    await preparing;
    expect((await f.requests.findById(f.request.id))?.metadata).toMatchObject({
      report_ban_phase: 'preparing',
    });
    const release = f.requests.releaseReportBanPreparation.bind(f.requests);
    jest
      .spyOn(f.requests, 'releaseReportBanPreparation')
      .mockImplementationOnce(async (id, phase) => {
        reached();
        await gate;
        return release(id, phase);
      });
    const staleRelease = f.requests.releaseReportBanPreparation(f.request.id, 'preparing');
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
});
