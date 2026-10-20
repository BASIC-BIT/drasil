import { createDetectionActions } from './actions';
import type { DetectionDependencies } from './ports';
import type { ActionContext } from '../context';
const context: ActionContext = {
  guildId: 'guild',
  requestId: 'operation',
  source: 'web_report',
  actor: { kind: 'user', userId: 'actor' },
};
const command = {
  kind: 'ban_observed_detection',
  targetUserId: 'target',
  detectionEventId: 'detection',
  reason: null,
  subject: { kind: 'report', reportId: 'report' },
} as const;
function fixture(): {
  deps: DetectionDependencies;
  actions: ReturnType<typeof createDetectionActions>;
  banCalls: () => number;
} {
  let banCalls = 0;
  const deps: DetectionDependencies = {
    globalAccountingAdmins: { containsFresh: async () => false },
    authority: {
      loadFresh: async () => ({
        guildId: 'guild',
        userId: 'actor',
        present: true,
        owner: false,
        permissions: '4',
        roleIds: [],
      }),
    },
    confirmations: { verify: async () => true },
    settings: {
      loadFresh: async () => ({
        banEnabled: true,
        kickEnabled: true,
        banRequiresReason: false,
        kickRequiresReason: false,
      }),
    },
    repository: {
      findDetection: async () => ({ guildId: 'guild', targetUserId: 'target', reportId: 'report' }),
      findOperation: async () => ({
        id: 'operation',
        guildId: 'guild',
        targetUserId: 'target',
        detectionEventId: 'detection',
        reportId: 'report',
        actorId: 'actor',
        source: 'web_report',
        continuation: 'fresh',
        owned: true,
      }),
    },
    workflows: {
      dismiss: async () => true,
      undo: async () => 'dismiss',
      changeAccounting: async () => true,
      kick: async () => true,
      ban: async () => {
        banCalls++;
        return { result: { status: 'banned' }, banById: false };
      },
      reconcile: async () => ({ status: 'banned' }),
      prepareReview: async () => ({
        targetUserId: 'target',
        operationId: 'operation',
        reviewReference: 'preview',
      }),
      review: async () => undefined,
    },
  };
  return { deps, actions: createDetectionActions(deps), banCalls: (): number => banCalls };
}
test('revoked_actor_cannot_start_report_ban', async () => {
  const f = fixture();
  f.deps.authority.loadFresh = async (): ReturnType<
    DetectionDependencies['authority']['loadFresh']
  > => ({
    guildId: 'guild',
    userId: 'actor',
    present: true,
    owner: false,
    permissions: '0',
    roleIds: [],
  });
  expect(await f.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(f.banCalls()).toBe(0);
});
test('confirmed_ban_recovery_finishes_after_policy_disable', async () => {
  const f = fixture();
  await f.actions.execute(context, command);
  const operation = await f.deps.repository.findOperation('operation');
  f.deps.repository.findOperation = async (): ReturnType<
    DetectionDependencies['repository']['findOperation']
  > => operation && { ...operation, continuation: 'confirmed' };
  f.deps.authority.loadFresh = async (): ReturnType<
    DetectionDependencies['authority']['loadFresh']
  > => null;
  f.deps.settings.loadFresh = async (): ReturnType<
    DetectionDependencies['settings']['loadFresh']
  > => ({
    banEnabled: false,
    kickEnabled: false,
    banRequiresReason: true,
    kickRequiresReason: true,
  });
  const result = await f.actions.execute(
    { ...context, actor: { kind: 'system', purpose: 'report_ban_recovery' } },
    command
  );
  expect(result).toMatchObject({ kind: 'outcome', outcome: { result: { status: 'banned' } } });
  expect(f.banCalls()).toBe(1);
});
test('uncertain_ban_never_reenforces', async () => {
  const f = fixture();
  const operation = await f.deps.repository.findOperation('operation');
  f.deps.repository.findOperation = async (): ReturnType<
    DetectionDependencies['repository']['findOperation']
  > => operation && { ...operation, continuation: 'uncertain' };
  f.deps.workflows.reconcile = async (): ReturnType<
    DetectionDependencies['workflows']['reconcile']
  > => ({
    status: 'ban_outcome_unknown',
    operationId: 'operation',
  });
  expect(await f.actions.execute(context, command)).toMatchObject({
    kind: 'outcome',
    outcome: { result: { status: 'ban_outcome_unknown' } },
  });
  expect(f.banCalls()).toBe(0);
});
test('accounting_change_is_guild_bound', async () => {
  const f = fixture();
  let unchanged = true;
  f.deps.authority.loadFresh = async (): ReturnType<
    DetectionDependencies['authority']['loadFresh']
  > => ({
    guildId: 'guild',
    userId: 'actor',
    present: true,
    owner: true,
    permissions: '0',
    roleIds: [],
  });
  f.deps.repository.findDetection = async (): ReturnType<
    DetectionDependencies['repository']['findDetection']
  > => ({
    guildId: 'foreign',
    targetUserId: 'target',
    reportId: null,
  });
  f.deps.workflows.changeAccounting = async (): ReturnType<
    DetectionDependencies['workflows']['changeAccounting']
  > => {
    unchanged = false;
    return true;
  };
  expect(
    await f.actions.execute(context, {
      kind: 'ignore_detection_accounting',
      targetUserId: 'target',
      detectionEventId: 'detection',
      reason: null,
    })
  ).toEqual({ kind: 'denied', code: 'binding_mismatch' });
  expect(unchanged).toBe(true);
});
test('a system context cannot begin fresh enforcement', async () => {
  const f = fixture();
  expect(
    await f.actions.execute(
      { ...context, actor: { kind: 'system', purpose: 'report_ban_recovery' } },
      command
    )
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
  expect(f.banCalls()).toBe(0);
});
test('recovery rejects a foreign or unowned persisted operation', async () => {
  const f = fixture();
  const operation = await f.deps.repository.findOperation('operation');
  f.deps.repository.findOperation = async (): ReturnType<
    DetectionDependencies['repository']['findOperation']
  > => operation && { ...operation, continuation: 'confirmed', owned: false };
  expect(
    await f.actions.execute(
      { ...context, actor: { kind: 'system', purpose: 'report_ban_recovery' } },
      command
    )
  ).toEqual({ kind: 'denied', code: 'binding_mismatch' });
});
test('fresh required reasons are checked before defaults', async () => {
  const f = fixture();
  f.deps.settings.loadFresh = async (): ReturnType<
    DetectionDependencies['settings']['loadFresh']
  > => ({
    banEnabled: true,
    kickEnabled: true,
    banRequiresReason: true,
    kickRequiresReason: false,
  });
  expect(await f.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'reason_required',
  });
  expect(f.banCalls()).toBe(0);
});
test.each([
  'dismiss_observed_detection',
  'mark_observed_detection_false_positive',
  'undo_observed_detection_action',
  'ignore_detection_accounting',
  'restore_detection_accounting',
  'kick_observed_detection',
] as const)('executes bound %s through its named workflow', async (kind) => {
  const f = fixture();
  f.deps.authority.loadFresh = async (): ReturnType<
    DetectionDependencies['authority']['loadFresh']
  > => ({
    guildId: 'guild',
    userId: 'actor',
    present: true,
    owner: true,
    permissions: '0',
    roleIds: [],
  });
  expect(
    await f.actions.execute(context, {
      kind,
      targetUserId: 'target',
      detectionEventId: 'detection',
      reason: null,
    })
  ).toMatchObject({ kind: 'outcome', outcome: { kind } });
});
test('report preparation exposes only an opaque review reference and review requires confirmation', async () => {
  const f = fixture();
  const operation = await f.deps.repository.findOperation('operation');
  f.deps.repository.findOperation = async (): ReturnType<
    DetectionDependencies['repository']['findOperation']
  > => operation && { ...operation, continuation: 'uncertain' };
  const result = await f.actions.execute(context, {
    kind: 'prepare_report_ban_review',
    operationId: 'operation',
  });
  expect(result).toEqual({
    kind: 'outcome',
    outcome: {
      kind: 'prepare_report_ban_review',
      reference: { operationId: 'operation', targetUserId: 'target', reviewReference: 'preview' },
    },
  });
  f.deps.confirmations.verify = async (): ReturnType<
    DetectionDependencies['confirmations']['verify']
  > => false;
  expect(
    await f.actions.execute(context, {
      kind: 'review_uncertain_report_ban',
      operationId: 'operation',
      targetUserId: 'target',
      reviewReference: 'preview',
      reason: 'Reviewed',
    })
  ).toEqual({ kind: 'denied', code: 'confirmation_required' });
});
test('report review remains possible after policy disable but requires current ban authority', async () => {
  const f = fixture();
  const operation = await f.deps.repository.findOperation('operation');
  f.deps.repository.findOperation = async (): ReturnType<
    DetectionDependencies['repository']['findOperation']
  > => operation && { ...operation, continuation: 'uncertain' };
  f.deps.settings.loadFresh = async (): ReturnType<
    DetectionDependencies['settings']['loadFresh']
  > => {
    throw new Error('Review must not consult enforcement policy');
  };
  const review = {
    kind: 'review_uncertain_report_ban',
    operationId: 'operation',
    targetUserId: 'target',
    reviewReference: 'preview',
    reason: 'Reviewed',
  } as const;
  expect(await f.actions.execute(context, review)).toEqual({
    kind: 'outcome',
    outcome: { kind: 'review_uncertain_report_ban', succeeded: true },
  });
  f.deps.authority.loadFresh = async (): ReturnType<
    DetectionDependencies['authority']['loadFresh']
  > => null;
  expect(await f.actions.execute(context, review)).toEqual({
    kind: 'denied',
    code: 'actor_unavailable',
  });
});
test('report-bound operation rejects changed report detection binding', async () => {
  const f = fixture();
  f.deps.repository.findDetection = async (): ReturnType<
    DetectionDependencies['repository']['findDetection']
  > => ({
    guildId: 'guild',
    targetUserId: 'target',
    reportId: 'replacement-report',
  });
  expect(await f.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'binding_mismatch',
  });
  expect(f.banCalls()).toBe(0);
});
test.each([
  { guildId: 'foreign' },
  { actorId: 'different-actor' },
  { source: 'discord_interaction' },
  { detectionEventId: 'replacement' },
  { targetUserId: 'other' },
  { reportId: 'other-report' },
])('continuation cannot cross persisted binding %j', async (patch) => {
  const f = fixture();
  const operation = await f.deps.repository.findOperation('operation');
  f.deps.repository.findOperation = async (): ReturnType<
    DetectionDependencies['repository']['findOperation']
  > => operation && { ...operation, ...patch, continuation: 'confirmed' };
  expect(await f.actions.execute(context, command)).toEqual({
    kind: 'denied',
    code: 'binding_mismatch',
  });
  expect(f.banCalls()).toBe(0);
});
test('operator review is bound to the persisted guild and target before invoking review', async () => {
  const f = fixture();
  const operation = await f.deps.repository.findOperation('operation');
  f.deps.repository.findOperation = async (): ReturnType<
    DetectionDependencies['repository']['findOperation']
  > => operation && { ...operation, guildId: 'foreign', continuation: 'uncertain' };
  expect(
    await f.actions.execute(context, {
      kind: 'review_uncertain_report_ban',
      operationId: 'operation',
      targetUserId: 'target',
      reviewReference: 'preview',
      reason: 'Reviewed',
    })
  ).toEqual({ kind: 'denied', code: 'binding_mismatch' });
});
test('safe undo does not depend on unrelated enforcement policy availability', async () => {
  const f = fixture();
  f.deps.authority.loadFresh = async (): ReturnType<
    DetectionDependencies['authority']['loadFresh']
  > => ({
    guildId: 'guild',
    userId: 'actor',
    present: true,
    owner: true,
    permissions: '0',
    roleIds: [],
  });
  f.deps.settings.loadFresh = async (): ReturnType<
    DetectionDependencies['settings']['loadFresh']
  > => {
    throw new Error('enforcement policy unavailable');
  };
  expect(
    await f.actions.execute(context, {
      kind: 'undo_observed_detection_action',
      targetUserId: 'target',
      detectionEventId: 'detection',
    })
  ).toEqual({
    kind: 'outcome',
    outcome: { kind: 'undo_observed_detection_action', undoneAction: 'dismiss' },
  });
});

test.each(['ignore_detection_accounting', 'restore_detection_accounting'] as const)(
  'accounting %s requires Manage Server even when Moderate Members remains',
  async (kind) => {
    const f = fixture();
    f.deps.authority.loadFresh = async (): ReturnType<
      DetectionDependencies['authority']['loadFresh']
    > => ({
      guildId: 'guild',
      userId: 'actor',
      present: true,
      owner: false,
      permissions: (1n << 40n).toString(),
      roleIds: [],
    });
    expect(
      await f.actions.execute(context, {
        kind,
        targetUserId: 'target',
        detectionEventId: 'detection',
        reason: null,
      })
    ).toEqual({ kind: 'denied', code: 'permission_denied' });
  }
);

test.each(['ignore_detection_accounting', 'restore_detection_accounting'] as const)(
  'accounting %s limits the global-admin exception to null-guild detections',
  async (kind) => {
    const f = fixture();
    f.deps.authority.loadFresh = async (): ReturnType<
      DetectionDependencies['authority']['loadFresh']
    > => ({
      guildId: 'guild',
      userId: 'actor',
      present: true,
      owner: false,
      permissions: '32',
      roleIds: [],
    });
    f.deps.repository.findDetection = async (): ReturnType<
      DetectionDependencies['repository']['findDetection']
    > => ({ guildId: null, targetUserId: 'target', reportId: null });
    const command = { kind, targetUserId: 'target', detectionEventId: 'detection', reason: null };
    expect(await f.actions.execute(context, command)).toEqual({
      kind: 'denied',
      code: 'binding_mismatch',
    });
    f.deps.globalAccountingAdmins.containsFresh = async (): Promise<boolean> => true;
    expect(await f.actions.execute(context, command)).toEqual({
      kind: 'outcome',
      outcome: { kind, succeeded: true },
    });
    f.deps.repository.findDetection = async (): ReturnType<
      DetectionDependencies['repository']['findDetection']
    > => ({ guildId: 'foreign', targetUserId: 'target', reportId: null });
    expect(await f.actions.execute(context, command)).toEqual({
      kind: 'denied',
      code: 'binding_mismatch',
    });
  }
);
