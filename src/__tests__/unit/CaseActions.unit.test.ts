import {
  decodeQueuedAction,
  queuedCommandSchema,
  encodeQueuedAction,
  type CaseCommand,
} from '@drasil/application';
import type { Client, GuildMember, User } from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import { createBotApplication } from '../../application/createBotApplication';
import { createDiscordActionContext } from '../../application/context';
import { dispatchQueuedAction } from '../../application/requestDispatch';
import { UserModerationService } from '../../services/UserModerationService';
import { AdminActionService } from '../../services/AdminActionService';
import { ModerationOutcomeService } from '../../services/ModerationOutcomeService';
import type { ISecurityActionService } from '../../services/SecurityActionService';
import type { IRoleManager } from '../../services/RoleManager';
import type { INotificationManager } from '../../services/NotificationManager';
import type { IThreadManager } from '../../services/ThreadManager';
import { DetectionType, VerificationStatus } from '../../repositories/types';
import {
  InMemoryAdminActionRepository,
  InMemoryDetectionEventsRepository,
  InMemoryModerationOutcomeRepository,
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
  InMemoryVerificationEventRepository,
} from '../fakes/inMemoryRepositories';

async function arrange() {
  const cases = new InMemoryVerificationEventRepository();
  const detections = new InMemoryDetectionEventsRepository();
  const users = new InMemoryUserRepository();
  const servers = new InMemoryServerRepository();
  await servers.getOrCreateServer('guild-1');
  await users.getOrCreateUser('target-1', 'target');
  const detection = await detections.create({
    server_id: 'guild-1',
    user_id: 'target-1',
    detection_type: DetectionType.SUSPICIOUS_CONTENT,
    confidence: 0.8,
    reasons: ['Test detection'],
    detected_at: new Date(),
  });
  const state = await cases.createFromDetection(
    detection.id,
    'guild-1',
    'target-1',
    VerificationStatus.PENDING
  );
  const roleManager = {
    getCaseRoleId: jest.fn(async () => 'case-role'),
    assignCaseRole: jest.fn(async () => true),
    removeCaseRole: jest.fn(async () => true),
  } satisfies IRoleManager;
  const notifications = {
    updateNotificationButtons: jest.fn(async () => undefined),
    logActionToMessage: jest.fn(async () => true),
  } as unknown as INotificationManager;
  const threads = {
    closeResolvedVerificationThreads: jest.fn(async () => ({ closedAny: false, results: [] })),
    resolveVerificationThread: jest.fn(async () => true),
  } as unknown as IThreadManager;
  const moderation = new UserModerationService(
    new InMemoryServerMemberRepository(),
    notifications,
    roleManager,
    cases,
    new AdminActionService(new InMemoryAdminActionRepository(), users, servers),
    threads,
    undefined,
    new ModerationOutcomeService(new InMemoryModerationOutcomeRepository(), servers, users)
  );
  let permissions = 8n;
  const actor = {
    id: 'actor-1',
    roles: { cache: new Map() },
    permissions: {
      get bitfield() {
        return permissions;
      },
    },
  };
  const target = {
    id: 'target-1',
    guild: { id: 'guild-1' },
    user: { id: 'target-1', tag: 'target#0001', username: 'target' },
    roles: { cache: new Map(), remove: jest.fn() },
  } as unknown as GuildMember;
  const guild = {
    id: 'guild-1',
    ownerId: 'owner-1',
    roles: { fetch: jest.fn() },
    members: {
      fetch: jest.fn(async (input: string | { user: string }) =>
        (typeof input === 'string' ? input : input.user) === actor.id ? actor : target
      ),
      me: { permissions: { has: () => true } },
      fetchMe: jest.fn().mockResolvedValue({ permissions: { has: () => true } }),
    },
  };
  const sourceMessage = {
    guildId: 'guild-1',
    id: 'message-1',
    channelId: 'channel-1',
    author: target.user,
  };
  const client = {
    guilds: { fetch: jest.fn(async () => guild) },
    users: { fetch: jest.fn(async (id: string) => ({ id }) as User) },
    channels: {
      fetch: jest.fn(async () => ({ messages: { fetch: jest.fn(async () => sourceMessage) } })),
    },
  } as unknown as Client;
  const configService = {
    getServerConfig: jest.fn(async () => ({ settings: {} })),
  } as unknown as IConfigService;
  const security = {
    openAdminCase: jest.fn(async (_member, _actor, options) => {
      await cases.patchMetadata(state.id, options.metadata);
      return { opened: true, caseRoleActive: true, caseRoleAttempted: true };
    }),
  } as unknown as ISecurityActionService;
  const application = createBotApplication({
    captchaChallengeService: null,
    threadManager: {} as any,
    notificationManager: {} as any,
    accountQuarantineService: null,
    actionRequests: {} as never,
    client,
    configService,
    verificationEventRepository: cases,
    detectionEventsRepository: detections,
    securityActionService: security,
    userModerationService: moderation,
    roleGateService: null,
    queueRepository: {} as any,
    queueService: {} as any,
  });
  const actions = application.cases;
  const proof = application.caseConfirmations;
  const context = createDiscordActionContext({
    guildId: 'guild-1',
    userId: actor.id,
    requestId: 'request-1',
  });
  const command: CaseCommand = {
    kind: 'verify_case_user',
    caseId: state.id,
    targetUserId: target.id,
  };
  const prepareQueued = (input: CaseCommand) => {
    const encoded = encodeQueuedAction(
      { ...context, source: 'web' },
      queuedCommandSchema.parse(input)
    );
    const decoded = decodeQueuedAction({
      id: context.requestId,
      server_id: encoded.serverId,
      actor_id: encoded.actorId,
      actor_surface: encoded.actorSurface,
      target_user_id: encoded.targetUserId,
      action_type: encoded.actionType,
      verification_event_id: encoded.verificationEventId,
      detection_event_id: encoded.detectionEventId,
      report_intake_id: encoded.reportIntakeId,
      metadata: encoded.metadata,
    });
    proof.recordVerified(decoded.context, decoded.command);
    return decoded;
  };
  const execute = async (delivery: 'direct' | 'worker', input: CaseCommand = command) => {
    if (delivery === 'direct') {
      proof.recordVerified(context, input);
      return actions.execute(context, input);
    }
    return dispatchQueuedAction(application, prepareQueued(input));
  };
  return {
    application,
    prepareQueued,
    cases,
    state,
    actions,
    context,
    command,
    execute,
    configService,
    roleManager,
    setPermissions: (value: bigint) => {
      permissions = value;
    },
    revoke: () => {
      permissions = 0n;
    },
  };
}

test('queued_dashboard_open_rechecks_Manage_Guild_instead_of_accepting_Moderate_Members', async () => {
  const fixture = await arrange();
  fixture.setPermissions(1n << 5n);
  const queued = fixture.prepareQueued({
    kind: 'open_admin_case',
    intent: 'dashboard_case_open',
    targetUserId: 'target-1',
    detectionEventId: null,
    reason: 'review',
    selectedMessage: null,
  });
  fixture.setPermissions(1n << 40n);
  await expect(dispatchQueuedAction(fixture.application, queued)).rejects.toThrow(
    'permission_denied'
  );
});

describe.each(['direct', 'worker'] as const)(
  '%s case execution with real verification workflow',
  (delivery) => {
    test('verify_rechecks_actor_at_execution', async () => {
      const fixture = await arrange();
      fixture.revoke();
      if (delivery === 'direct')
        expect(await fixture.execute(delivery)).toEqual({
          kind: 'denied',
          code: 'permission_denied',
        });
      else await expect(fixture.execute(delivery)).rejects.toThrow('permission_denied');
      const verificationCountAfterRevocation = fixture.roleManager.removeCaseRole.mock.calls.length;
      expect(verificationCountAfterRevocation).toBe(0);
      expect((await fixture.cases.findById(fixture.state.id))?.status).toBe('pending');
    });
    test('resolved_case_is_not_reopened_by_stale_verify', async () => {
      const fixture = await arrange();
      await fixture.execute(delivery);
      expect(fixture.roleManager.removeCaseRole).toHaveBeenCalledTimes(1);
      if (delivery === 'direct')
        expect(await fixture.execute(delivery)).toEqual({ kind: 'denied', code: 'stale_state' });
      else await expect(fixture.execute(delivery)).rejects.toThrow('stale_state');
      const resolvedCaseStatus = (await fixture.cases.findById(fixture.state.id))?.status;
      expect(resolvedCaseStatus).toBe('verified');
      expect(fixture.roleManager.removeCaseRole).toHaveBeenCalledTimes(1);
      expect(fixture.configService.getServerConfig).toHaveBeenCalledWith('guild-1', {
        forceRefresh: true,
        failOnReadError: true,
      });
    });
    test('rejects_case_from_another_guild_or_subject', async () => {
      const fixture = await arrange();
      const otherSubject: CaseCommand = { ...fixture.command, targetUserId: 'other-subject' };
      if (delivery === 'direct') {
        const mismatch = await fixture.execute(delivery, otherSubject);
        expect(mismatch).toEqual({ kind: 'denied', code: 'binding_mismatch' });
      } else
        await expect(fixture.execute(delivery, otherSubject)).rejects.toThrow('binding_mismatch');
      expect(fixture.roleManager.removeCaseRole).not.toHaveBeenCalled();
    });
    test('selected_message_survives_case_open', async () => {
      const fixture = await arrange();
      await fixture.execute(delivery, {
        kind: 'open_admin_case',
        intent: 'dashboard_case_open',
        targetUserId: 'target-1',
        detectionEventId: null,
        reason: 'Review selected message',
        selectedMessage: { channelId: 'channel-1', messageId: 'message-1' },
      });
      const storedSource = (await fixture.cases.findById(fixture.state.id))?.metadata;
      expect(storedSource).toMatchObject({
        source_channel_id: 'channel-1',
        source_message_id: 'message-1',
      });
    });
  }
);
