import { mock, mockDeep } from 'jest-mock-extended';
import {
  createCaseActions,
  caseCommandSchema,
  createReportActions,
  createCaptchaActions,
  createMessageCleanupActions,
  createSetupActions,
  decodeQueuedAction,
  encodeQueuedAction,
  type ActionContext,
  type AuthorityPort,
  type CaseDependencies,
  type ReportDependencies,
  type CaptchaDependencies,
  type MessageCleanupDependencies,
  type SetupDependencies,
  type MessageCleanupJob,
  type QueuedCommand,
} from '@drasil/application';
import type { ModerationActionRequest } from '../../repositories/types';
import type { BotSetupRuntime } from '../../application/adapters/setup';
import { createDiscordActionContext } from '../../application/context';
import { prepareQueuedAction, type QueuedRequestRuntime } from '../../application/requestDispatch';

const directContext = createDiscordActionContext({
  guildId: 'guild',
  userId: 'actor',
  requestId: 'interaction-id',
});
const queuedContext: ActionContext = {
  ...directContext,
  source: 'web',
  requestId: 'submission-id',
};
function arrange(family: 'case' | 'report' | 'captcha' | 'cleanup' | 'setup', present = true) {
  const effects: unknown[] = [];
  const contexts: ActionContext[] = [];
  const decisions: unknown[] = [];
  const authority: AuthorityPort = {
    loadFresh: async () => ({
      guildId: 'guild',
      userId: 'actor',
      present,
      owner: false,
      permissions: '8',
      roleIds: [],
    }),
  };
  let app = mock<QueuedRequestRuntime>();
  let command: QueuedCommand;
  let direct = async (context: ActionContext): Promise<unknown> => {
    throw new Error(`Unconfigured ${family} fixture entry: ${context.requestId}`);
  };
  async function trace<T>(context: ActionContext, run: () => Promise<T>): Promise<T> {
    contexts.push(context);
    const result = await run();
    decisions.push(result);
    return result;
  }
  switch (family) {
    case 'case': {
      const deps = mockDeep<CaseDependencies>();
      deps.authority.loadFresh.mockImplementation(authority.loadFresh);
      deps.confirmations.verify.mockResolvedValue(true);
      deps.repository.findById.mockResolvedValue({
        id: 'case',
        server_id: 'guild',
        user_id: 'target',
        status: 'pending',
      });
      deps.repository.findActive.mockResolvedValue({
        id: 'case',
        server_id: 'guild',
        user_id: 'target',
        status: 'pending',
      });
      deps.settings.loadFresh.mockResolvedValue({
        adminCaseOpenRequiresReason: false,
        moderatorBanActionEnabled: true,
        moderatorBanActionRequiresReason: true,
        moderatorKickActionEnabled: true,
        moderatorKickActionRequiresReason: true,
      });
      deps.workflows.ban.mockImplementation(async (input) => {
        effects.push({
          guildId: input.guildId,
          actorId: input.actorId,
          targetUserId: input.targetUserId,
          caseId: input.caseId,
          reason: input.reason,
        });
        return true;
      });
      const actions = createCaseActions(deps);
      const execute = actions.execute;
      app = mock<QueuedRequestRuntime>({
        cases: { execute: (context, input) => trace(context, () => execute(context, input)) },
      });
      command = {
        kind: 'ban_case_user',
        caseId: 'case',
        targetUserId: 'target',
        reason: 'reviewed',
        detectionEventId: null,
      };
      const input = command;
      direct = (context) => app.cases.execute(context, input);
      break;
    }
    case 'report': {
      const deps = mockDeep<ReportDependencies>();
      deps.authority.loadFresh.mockImplementation(authority.loadFresh);
      deps.settings.loadFresh.mockResolvedValue({ reasonRequired: true, staffRoleIds: [] });
      deps.submissions.user.mockImplementation(async (context, input) => {
        effects.push({
          guildId: context.guildId,
          actor: context.actor,
          target: input.targetUserId,
          reason: input.reason,
        });
        return { status: 'submitted', targetUserId: input.targetUserId };
      });
      const actions = createReportActions(deps);
      app = mock<QueuedRequestRuntime>({
        reports: {
          execute: (context, input) => trace(context, () => actions.execute(context, input)),
        },
      });
      command = {
        kind: 'submit_user_report',
        targetUserId: 'target',
        targetLabel: 'target',
        reason: 'reviewed',
      };
      const input = command;
      direct = (context) => app.reports.execute(context, input);
      break;
    }
    case 'captcha': {
      const deps = mockDeep<CaptchaDependencies>();
      deps.authority.loadFresh.mockImplementation(authority.loadFresh);
      deps.confirmations.verify.mockResolvedValue(true);
      deps.workflows.recoverCommitted.mockResolvedValue(null);
      deps.settings.loadFresh.mockResolvedValue({ enabled: true });
      deps.state.load.mockResolvedValue({
        guildId: 'guild',
        caseId: 'case',
        targetUserId: 'target',
        status: 'pending',
        caseKind: 'standard',
        challenge: null,
      });
      deps.workflows.request.mockImplementation(async (context, input) => {
        effects.push({
          guildId: context.guildId,
          actor: context.actor,
          caseId: input.caseId,
          targetUserId: input.targetUserId,
        });
        return {
          action_type: 'request_captcha_challenge',
          challenge_id: 'challenge',
          generation: 1,
          delivered: true,
          target_user_id: 'target',
          verification_event_id: 'case',
        };
      });
      const actions = createCaptchaActions(deps);
      const bound: ReturnType<QueuedRequestRuntime['captchaRuntime']['forRequest']> = {
        execute: (context, input) => trace(context, () => actions.execute(context, input)),
      };
      app = mock<QueuedRequestRuntime>({
        captchaRuntime: mock<QueuedRequestRuntime['captchaRuntime']>({ forRequest: () => bound }),
      });
      command = { kind: 'request_captcha_challenge', caseId: 'case', targetUserId: 'target' };
      const input = command;
      direct = (context) => bound.execute(context, input);
      break;
    }
    case 'cleanup': {
      const deps = mockDeep<MessageCleanupDependencies>();
      const job: MessageCleanupJob = {
        id: 'job',
        guildId: 'guild',
        caseId: 'case',
        targetUserId: 'target',
        requestedBy: 'actor',
        source: 'web_case',
        mode: 'delete_only',
        scope: 'last_day',
        reason: 'reviewed',
        evidenceThreadId: 'evidence',
        generation: 'generation',
        status: 'ready',
        coverage: 'ready',
        candidateCount: 1,
        banStatus: 'not_requested',
        caseFinalizationStatus: 'not_applicable',
      };
      deps.authority.loadFresh.mockImplementation(authority.loadFresh);
      deps.jobs.find.mockResolvedValue(job);
      deps.cases.find.mockResolvedValue({
        id: 'case',
        guildId: 'guild',
        targetUserId: 'target',
        status: 'pending',
        evidenceThreadId: 'evidence',
      });
      deps.workflows.preview.mockImplementation(async (jobId) => {
        effects.push({ jobId, preservedCandidate: 'message' });
        return job;
      });
      const actions = createMessageCleanupActions(deps);
      const bound: ReturnType<QueuedRequestRuntime['messageCleanupRuntime']['forRequest']> = {
        execute: (context, input) => trace(context, () => actions.execute(context, input)),
      };
      app = mock<QueuedRequestRuntime>({
        messageCleanupRuntime: mock<QueuedRequestRuntime['messageCleanupRuntime']>({
          forRequest: () => bound,
        }),
      });
      command = {
        kind: 'preview_case_message_deletion',
        caseId: 'case',
        targetUserId: 'target',
        jobId: 'job',
        mode: 'delete_only',
        scope: 'last_day',
        reason: 'reviewed',
        detectionEventId: null,
        previewReference: { jobId: 'job', generation: null },
      };
      const input = command;
      direct = (context) => bound.execute(context, input);
      break;
    }
    case 'setup': {
      const deps = mockDeep<SetupDependencies>();
      deps.authority.loadFresh.mockImplementation(authority.loadFresh);
      deps.configuration.loadFresh.mockResolvedValue({ settings: {}, case_role_id: null });
      deps.panels.upsert.mockImplementation(async (context, input) => {
        effects.push({
          guildId: context.guildId,
          actor: context.actor,
          channelId: input.channelId,
          repost: input.repost,
        });
        return { action: 'updated', messageId: 'panel' };
      });
      const actions = createSetupActions(deps);
      app = mock<QueuedRequestRuntime>({
        setupRuntime: mock<BotSetupRuntime>({
          execute: (context, input) => trace(context, () => actions.execute(context, input)),
        }),
      });
      command = { kind: 'upsert_report_instructions', channelId: 'channel', repost: false };
      const input = command;
      direct = (context) => trace(context, () => actions.execute(context, input));
      break;
    }
  }
  return { app, command, direct, effects, contexts, decisions };
}
function queued(runtime: QueuedRequestRuntime, command: QueuedCommand, source = 'web') {
  const encoded = encodeQueuedAction({ ...queuedContext, source }, command);
  const request = mock<ModerationActionRequest>({
    id: 'durable-request-id',
    server_id: encoded.serverId,
    action_type: encoded.actionType as ModerationActionRequest['action_type'],
    actor_id: encoded.actorId,
    actor_surface: encoded.actorSurface,
    target_user_id: encoded.targetUserId,
    verification_event_id: encoded.verificationEventId,
    detection_event_id: encoded.detectionEventId,
    report_intake_id: encoded.reportIntakeId,
    message_deletion_job_id: encoded.messageDeletionJobId,
    metadata: encoded.metadata,
  });
  return prepareQueuedAction({ runtime, action: decodeQueuedAction(request), request });
}
describe.each(['case', 'report', 'captcha', 'cleanup', 'setup'] as const)(
  '%s cross-entry parity',
  (family) => {
    it('preserves shared decisions and effects through the real codec and worker dispatch', async () => {
      const direct = arrange(family);
      const worker = arrange(family);
      // Cleanup has no shipped Discord control. Its reusable direct invocation and
      // durable invocation both retain the actual web_case provenance.
      const context =
        family === 'cleanup' ? { ...directContext, source: 'web_case' } : directContext;
      const source = family === 'cleanup' ? 'web_case' : family === 'report' ? 'web_report' : 'web';
      const directDecision = await direct.direct(context);
      await queued(worker.app, worker.command, source)();
      const workerDecision = worker.decisions[0];
      expect(directDecision).toMatchObject({ kind: 'outcome' });
      expect(directDecision).toEqual(workerDecision);
      const directDomainEffects = direct.effects;
      const workerDomainEffects = worker.effects;
      expect(directDomainEffects).toHaveLength(1);
      expect(directDomainEffects).toEqual(workerDomainEffects);
      const auditSources = [direct.contexts[0].source, worker.contexts[0].source];
      if (family === 'cleanup') expect(auditSources).toEqual(['web_case', 'web_case']);
      else if (family === 'report')
        expect(auditSources).toEqual(['discord_interaction', 'web_report']);
      else expect(auditSources).toEqual(['discord_interaction', 'web']);
      expect([direct.contexts[0].requestId, worker.contexts[0].requestId]).toEqual([
        'interaction-id',
        'durable-request-id',
      ]);
    });
    it('rechecks actor presence at both execution entries before domain effects', async () => {
      const direct = arrange(family, false);
      const worker = arrange(family, false);
      const context =
        family === 'cleanup' ? { ...directContext, source: 'web_case' } : directContext;
      const directDecision = await direct.direct(context);
      await expect(
        queued(
          worker.app,
          worker.command,
          family === 'cleanup' ? 'web_case' : family === 'report' ? 'web_report' : 'web'
        )()
      ).rejects.toThrow();
      expect(directDecision).toEqual({ kind: 'denied', code: 'actor_unavailable' });
      expect(directDecision).toEqual(worker.decisions[0]);
      expect(direct.effects).toEqual([]);
      expect(worker.effects).toEqual([]);
    });
  }
);

// Independent semantic rows exercise the actual worker and shared authority/policy actions.
describe('all case worker semantic parity', () => {
  const variants = [
    {
      kind: 'ban_user',
      metadata: { intent: 'slash_command' },
      permission: 4n,
      workflow: 'ban',
      reason: 'No reason provided',
    },
    {
      kind: 'ban_user',
      metadata: { intent: 'native_action' },
      permission: 4n,
      workflow: 'ban',
      reason: 'Banned by moderator action',
    },
    {
      kind: 'kick_user',
      metadata: {},
      permission: 2n,
      workflow: 'kick',
      reason: 'Kicked by moderator action',
    },
    {
      kind: 'open_admin_case',
      metadata: { intent: 'native_case_open' },
      permission: 1n << 40n,
      workflow: 'openAdmin',
    },
    { kind: 'open_admin_case', metadata: {}, permission: 32n, workflow: 'openAdmin' },
    {
      kind: 'repair_active_case',
      metadata: { intent: 'administrator_repair' },
      permission: 8n,
      workflow: 'repair',
    },
    { kind: 'repair_active_case', metadata: {}, permission: 1n << 40n, workflow: 'repair' },
    {
      kind: 'repair_active_case',
      metadata: { intent: 'administrator_repair', case_action: 'create_thread' },
      permission: 8n,
      workflow: 'repair',
    },
    {
      kind: 'repair_active_case',
      metadata: { case_action: 'create_thread' },
      permission: 1n << 40n,
      workflow: 'repair',
    },
    {
      kind: 'open_case_from_observed_detection',
      metadata: {},
      permission: 1n << 40n,
      workflow: 'openObserved',
    },
    { kind: 'manual_flag_user', metadata: {}, permission: 8n, workflow: 'manualFlag' },
    { kind: 'verify_case_user', metadata: {}, permission: 1n << 40n, workflow: 'verify' },
    {
      kind: 'close_case_no_action',
      metadata: {},
      permission: 1n << 40n,
      workflow: 'closeNoAction',
    },
    {
      kind: 'kick_case_user',
      metadata: {},
      permission: 2n,
      workflow: 'kick',
      reason: 'No reason provided for web kick action.',
    },
    {
      kind: 'ban_case_user',
      metadata: {},
      permission: 4n,
      workflow: 'ban',
      reason: 'No reason provided for web ban action.',
    },
    {
      kind: 'ban_case_user_by_id',
      metadata: {},
      permission: 4n,
      workflow: 'banById',
      reason: 'No reason provided for web ban action.',
    },
    { kind: 'reopen_case', metadata: {}, permission: 1n << 40n, workflow: 'reopen' },
    { kind: 'refresh_case_notification', metadata: {}, permission: 8n, workflow: 'refresh' },
    { kind: 'sync_existing_ban', metadata: {}, permission: 4n, workflow: 'syncExistingBan' },
  ] as const;
  it('covers every canonical case kind', () => {
    expect([...new Set(variants.map((v) => v.kind))].sort()).toEqual(
      caseCommandSchema.options.map((v) => v.shape.kind.value).sort()
    );
  });
  it.each(variants)(
    'runs $kind $metadata with its exact authority/default reason',
    async (variant) => {
      const { createCaseConfirmationStore } = await import('../../application/context');
      const { prepareQueuedRequest } = await import('../../application/requestRuntime');
      const confirmations = createCaseConfirmationStore();
      const deps = mockDeep<CaseDependencies>();
      deps.authority.loadFresh.mockResolvedValue({
        guildId: 'guild',
        userId: 'actor',
        present: true,
        owner: false,
        permissions: String(variant.permission),
        roleIds: [],
      });
      deps.settings.loadFresh.mockResolvedValue({
        adminCaseOpenRequiresReason: false,
        moderatorBanActionEnabled: true,
        moderatorBanActionRequiresReason: false,
        moderatorKickActionEnabled: true,
        moderatorKickActionRequiresReason: false,
      });
      deps.repository.findById.mockResolvedValue({
        id: 'case',
        server_id: 'guild',
        user_id: 'target',
        status: 'pending',
      });
      deps.repository.findActive.mockResolvedValue({
        id: 'case',
        server_id: 'guild',
        user_id: 'target',
        status: 'pending',
      });
      if (variant.kind === 'reopen_case') {
        deps.repository.findById.mockResolvedValue({
          id: 'case',
          server_id: 'guild',
          user_id: 'target',
          status: 'verified',
        });
        deps.repository.findActive.mockResolvedValue(null);
      }
      deps.repository.findDetection.mockResolvedValue({
        server_id: 'guild',
        user_id: 'target',
        reportId: null,
      });
      deps.workflows.banById.mockResolvedValue(true);
      deps.workflows.openObserved.mockResolvedValue(true);
      deps.workflows.manualFlag.mockResolvedValue(true);
      deps.workflows.verify.mockResolvedValue(true);
      deps.workflows.closeNoAction.mockResolvedValue(1);
      deps.workflows.reopen.mockResolvedValue(true);
      deps.workflows.refresh.mockResolvedValue({ refreshed: true, message: 'refreshed' });
      deps.workflows.syncExistingBan.mockResolvedValue(1);
      deps.workflows.ban.mockResolvedValue(true);
      deps.workflows.kick.mockResolvedValue(true);
      deps.workflows.openAdmin.mockResolvedValue({
        opened: true,
        caseRoleActive: true,
        caseRoleAttempted: true,
      });
      deps.workflows.repair.mockResolvedValue({
        repaired: true,
        message: 'repaired',
        threadCreated: false,
        userAdded: false,
        promptSent: false,
        promptAlreadyPresent: false,
      });
      const request = mock<ModerationActionRequest>({
        id: 'request',
        server_id: 'guild',
        actor_id: 'actor',
        actor_surface: 'web',
        action_type: variant.kind as ModerationActionRequest['action_type'],
        target_user_id: 'target',
        verification_event_id: 'case',
        detection_event_id:
          variant.kind === 'open_case_from_observed_detection' ? 'detection' : null,
        report_intake_id: null,
        message_deletion_job_id: null,
        metadata: variant.metadata,
      });
      const runtime = mock<QueuedRequestRuntime>({
        delegation: undefined,
        cases: createCaseActions({ ...deps, confirmations: confirmations.confirmations }),
        caseConfirmations: confirmations,
      });
      const prepared = await prepareQueuedRequest({ runtime, request, analytics: {} as never });
      await prepared.execute();
      expect(deps.workflows[variant.workflow]).toHaveBeenCalledTimes(1);
      if ('reason' in variant)
        expect(deps.workflows[variant.workflow]).toHaveBeenCalledWith(
          expect.objectContaining({ reason: variant.reason })
        );
      deps.authority.loadFresh.mockResolvedValue({
        guildId: 'guild',
        userId: 'actor',
        present: true,
        owner: false,
        permissions: String(
          variant.permission === 32n
            ? 1n << 40n
            : variant.permission === 1n << 40n && variant.kind === 'open_admin_case'
              ? 32n
              : 0n
        ),
        roleIds: [],
      });
      const denied = await prepareQueuedRequest({ runtime, request, analytics: {} as never });
      await expect(denied.execute()).rejects.toThrow('permission_denied');
      expect(deps.workflows[variant.workflow]).toHaveBeenCalledTimes(1);
    }
  );
});
