import { CaseRoleReleaseReconciliationService } from '../../services/CaseRoleReleaseReconciliationService';
import { RoleQuarantineSnapshotRepository } from '../../repositories/RoleQuarantineSnapshotRepository';
import { Pool } from 'pg';
import { insertModerationActionRequestWithReceipt } from '../../../apps/web/lib/moderationActionRequestQueue';
jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
import { IRoleQuarantineService } from '../../services/RoleQuarantineService';
import { NotificationManager } from '../../services/NotificationManager';
import { Client, EmbedBuilder, Guild, GuildMember, User } from 'discord.js';
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
      ? { permissions: { has: () => true } }
      : member
  );
  const notifications = {
    markObservedDetectionActionTaken: jest.fn().mockResolvedValue(true),
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

const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration('report-ban stale worker recovery with real services and Postgres', () => {
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
      getModerationNotificationChannel: () => Promise<unknown>;
      getStoredNotificationChannel: () => Promise<unknown>;
    };
    jest
      .spyOn(routed, 'getModerationNotificationChannel')
      .mockResolvedValue({ messages: { fetch } });
    jest.spyOn(routed, 'getStoredNotificationChannel').mockResolvedValue({ messages: { fetch } });
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
