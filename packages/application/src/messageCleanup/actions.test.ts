import type { AuthorityFacts } from '../authorization';
import type { MessageCleanupCounts } from './ports';
import { createMessageCleanupActions } from './actions';
import type { MessageCleanupCommand } from './commands';
import type { MessageCleanupDependencies, MessageCleanupJob } from './ports';

const context = {
  guildId: 'guild',
  requestId: 'request',
  source: 'web_case',
  actor: { kind: 'user', userId: 'admin' },
} as const;
const command: MessageCleanupCommand = {
  kind: 'ban_case_user_with_message_cleanup',
  caseId: 'case',
  targetUserId: 'user',
  jobId: 'job',
  mode: 'ban_with_cleanup',
  scope: 'last_day',
  reason: 'reviewed',
  detectionEventId: null,
  previewReference: { jobId: 'job', generation: 'generation-1' },
};
interface Harness {
  actions: ReturnType<typeof createMessageCleanupActions>;
  deps: MessageCleanupDependencies;
  job: MessageCleanupJob;
  loadFresh: jest.Mock<Promise<AuthorityFacts>, []>;
  settings: jest.Mock<Promise<{ moderatorBanActionEnabled: boolean }>, []>;
  ban: jest.Mock<Promise<void>, []>;
  cleanup: jest.Mock<Promise<MessageCleanupCounts>, []>;
}
function setup(): Harness {
  const job: MessageCleanupJob = {
    id: 'job',
    guildId: 'guild',
    caseId: 'case',
    targetUserId: 'user',
    requestedBy: 'admin',
    source: 'web_case',
    mode: 'ban_with_cleanup',
    scope: 'last_day',
    reason: 'reviewed',
    evidenceThreadId: 'evidence',
    generation: 'generation-1',
    status: 'ready',
    coverage: 'ready',
    candidateCount: 2,
    banStatus: 'not_requested',
    caseFinalizationStatus: 'pending',
  };
  const loadFresh = jest.fn(async () => ({
    guildId: 'guild',
    userId: 'admin',
    present: true,
    owner: false,
    permissions: '8',
    roleIds: [],
  }));
  const ban = jest.fn(async () => undefined);
  const cleanup = jest.fn(async () => ({
    alreadyCompleted: false,
    preservedCount: 2,
    deletedCount: 1,
    alreadyMissingCount: 0,
    changedCount: 0,
    evidenceFailedCount: 0,
    deleteFailedCount: 1,
    permissionDeniedCount: 0,
  }));
  const settings = jest.fn(async () => ({ moderatorBanActionEnabled: true }));
  const deps: MessageCleanupDependencies = {
    authority: { loadFresh },
    settings: { loadFresh: settings },
    confirmations: { verify: async () => true },
    jobs: {
      find: async () => job,
      fail: async () => undefined,
      setBanStatus: async (_id, status) => {
        job.banStatus = status;
      },
      setFinalizationStatus: async (_id, status) => {
        job.caseFinalizationStatus = status;
      },
    },
    cases: {
      find: async () => ({
        id: 'case',
        guildId: 'guild',
        targetUserId: 'user',
        status: 'pending',
        evidenceThreadId: 'evidence',
      }),
    },
    recovery: { resolveCommitted: async () => ({ kind: 'recorded_operation', context }) },
    workflows: {
      preview: async () => job,
      cleanup,
      ban,
      assertBotPermissions: async () => undefined,
      markPending: async () => undefined,
      clearMarker: async () => undefined,
      finalize: async () => undefined,
    },
  };
  return {
    actions: createMessageCleanupActions(deps),
    deps,
    job,
    loadFresh,
    settings,
    ban,
    cleanup,
  };
}
it('cleanup_requires_current_administrator', async () => {
  const f = setup();
  f.loadFresh.mockResolvedValue({
    guildId: 'guild',
    userId: 'admin',
    present: true,
    owner: false,
    permissions: '32',
    roleIds: [],
  });
  const nonAdministrator = await f.actions.execute(context, command);
  expect(nonAdministrator).toEqual({ kind: 'denied', code: 'permission_denied' });
  expect(f.cleanup).not.toHaveBeenCalled();
  expect(f.ban).not.toHaveBeenCalled();
});
it('changed_frozen_job_cannot_execute', async () => {
  const f = setup();
  f.job.generation = 'generation-2';
  expect(await f.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'stale_state',
  });
  expect(f.cleanup).not.toHaveBeenCalled();
});
it('combined_retry_resumes_after_ban_without_reenforcement', async () => {
  const f = setup();
  f.cleanup.mockRejectedValueOnce(new Error('interrupted'));
  await expect(f.actions.execute(context, command)).rejects.toThrow('interrupted');
  f.loadFresh.mockResolvedValue({
    guildId: 'guild',
    userId: 'admin',
    present: false,
    owner: false,
    permissions: '0',
    roleIds: [],
  });
  f.settings.mockResolvedValue({ moderatorBanActionEnabled: false });
  const result = await f.actions.execute(context, command);
  expect(f.ban).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    kind: 'outcome',
    outcome: { deletedCount: 1, deleteFailedCount: 1, banned: true, caseFinalized: true },
  });
});
it('does not permit committed recovery outside its owned runtime operation', async () => {
  const f = setup();
  f.job.banStatus = 'succeeded';
  f.deps.recovery.resolveCommitted = async (): Promise<null> => null;
  expect(await f.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'binding_mismatch',
  });
  expect(f.cleanup).not.toHaveBeenCalled();
});
it('requires action-bound confirmation before enforcing', async () => {
  const f = setup();
  f.deps.confirmations.verify = async (): Promise<boolean> => false;
  expect(await f.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'confirmation_required',
  });
  expect(f.ban).not.toHaveBeenCalled();
});
it('never supplies a default for an empty raw cleanup reason', async () => {
  const f = setup();
  expect(await f.actions.execute(context, { ...command, reason: ' ' })).toEqual({
    kind: 'denied',
    code: 'reason_required',
  });
  expect(f.ban).not.toHaveBeenCalled();
});

it('a new request cannot adopt a committed job as owned recovery', async () => {
  const f = setup();
  f.job.banStatus = 'succeeded';
  f.loadFresh.mockResolvedValue({
    guildId: 'guild',
    userId: 'admin',
    present: true,
    owner: false,
    permissions: '0',
    roleIds: [],
  });
  expect(await f.actions.execute({ ...context, requestId: 'foreign-request' }, command)).toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(f.cleanup).not.toHaveBeenCalled();
});
it('an authorized new request continues with the recorded initiating actor', async () => {
  const f = setup();
  f.job.banStatus = 'succeeded';
  const finalize = jest.fn(async () => undefined);
  f.deps.workflows.finalize = finalize;
  const result = await f.actions.execute({ ...context, requestId: 'new-request' }, command);
  expect(result.kind).toBe('outcome');
  expect(finalize).toHaveBeenCalledWith(context, command);
  expect(f.ban).not.toHaveBeenCalled();
});

it('ambiguous legacy committed jobs require fresh authority even on the same request', async () => {
  const f = setup();
  f.job.banStatus = 'succeeded';
  f.deps.recovery.resolveCommitted = async (): ReturnType<
    MessageCleanupDependencies['recovery']['resolveCommitted']
  > => ({ kind: 'legacy_unowned', context });
  f.loadFresh.mockResolvedValue({
    guildId: 'guild',
    userId: 'admin',
    present: true,
    owner: false,
    permissions: '0',
    roleIds: [],
  });
  expect(await f.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(f.cleanup).not.toHaveBeenCalled();
  expect(f.ban).not.toHaveBeenCalled();
});
it('authorized legacy continuation never repeats its committed ban', async () => {
  const f = setup();
  f.job.banStatus = 'succeeded';
  f.deps.recovery.resolveCommitted = async (): ReturnType<
    MessageCleanupDependencies['recovery']['resolveCommitted']
  > => ({ kind: 'legacy_unowned', context });
  expect((await f.actions.execute(context, command)).kind).toBe('outcome');
  expect(f.ban).not.toHaveBeenCalled();
});
