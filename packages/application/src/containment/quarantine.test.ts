import { buildAccountQuarantinePreviewFingerprint } from './fingerprint';
import { queuedQuarantineCommandSchema } from './commands';
import { decodeQueuedAction, encodeQueuedAction } from '../index';
import { createQuarantineActions, type QuarantineExecuteInput } from './quarantine';
import type { ActionContext } from '../context';
import type {
  QuarantineDependencies,
  QuarantinePreviewBinding,
  QuarantinePreviewData,
  QuarantinePreview,
} from './ports';

const context: ActionContext = {
  guildId: 'guild',
  requestId: 'execute',
  source: 'web',
  actor: { kind: 'user', userId: 'staff' },
};
const input: QuarantineExecuteInput = {
  caseId: 'case',
  targetUserId: 'target',
  reason: 'Compromise reported',
  previewReference: { kind: 'persisted_preview', requestId: 'preview' },
};
interface Harness {
  readonly deps: QuarantineDependencies;
  readonly actions: ReturnType<typeof createQuarantineActions>;
  removed(): number;
  caseStatus(): string;
  verify(): void;
  changeState(kind: string): void;
  setBinding(value: QuarantinePreviewBinding | null): void;
  revoke(): void;
  disable(): void;
}
function harness(): Harness {
  let caseStatus = 'pending';
  let removed = 0;
  const roles: string[] = [];
  const readiness = {
    adminNotificationReady: true,
    recoveryThreadReady: true,
    recoveryThreadId: 'thread',
  };
  const preview: QuarantinePreview = {
    enabled: true,
    canContain: true,
    caseRoleId: 'role',
    rolePreview: { plannedRoleIds: roles, privilegedRoleIds: [], skippedRoles: [] },
    lockdown: { enabled: true, errorCount: 0, issues: [], plannedActions: [] },
    memberAudit: { bypasses: [], unremovablePrivilegeReasons: [] },
  };
  const snapshot = (): QuarantinePreviewData => ({
    preview,
    readiness,
    roleNames: {},
    fingerprint: buildAccountQuarantinePreviewFingerprint(preview, readiness),
  });
  let permission = '32';
  let enabled = true;
  let binding: QuarantinePreviewBinding | null = {
    guildId: 'guild',
    actorId: 'staff',
    caseId: 'case',
    targetUserId: 'target',
    fingerprint: snapshot().fingerprint,
    expiresAt: 100,
  };
  const deps: QuarantineDependencies = {
    authority: {
      async loadFresh(guildId, userId) {
        return {
          guildId,
          userId,
          present: true,
          owner: false,
          permissions: permission,
          roleIds: [],
        };
      },
    },
    settings: {
      async loadFresh() {
        return { enabled };
      },
    },
    repository: {
      async findActive() {
        return caseStatus === 'pending'
          ? { id: 'case', server_id: 'guild', user_id: 'target', status: caseStatus }
          : null;
      },
    },
    previews: {
      async resolve() {
        return binding;
      },
    },
    now: () => 10,
    workflows: {
      async recoverCommitted() {
        return null;
      },
      async preview() {
        return snapshot();
      },
      async repair() {
        return {
          repaired: true,
          threadCreated: false,
          userAdded: true,
          promptSent: false,
          promptAlreadyPresent: true,
          message: 'Ready',
          verificationEventId: 'case',
          threadId: 'thread',
          notificationReady: true,
        };
      },
      async quarantine() {
        removed++;
        return {
          status: 'parked',
          containmentStatus: 'contained',
          failedRoleRemovals: 0,
          memberBypasses: 0,
          retainedRoles: 0,
          lockdownChangesRequired: 0,
          recovered: false,
        };
      },
    },
  };
  return {
    deps,
    actions: createQuarantineActions(deps),
    removed: () => removed,
    caseStatus: () => caseStatus,
    verify: (): void => {
      caseStatus = 'verified';
    },
    changeState: (kind): void => {
      if (kind === 'role') roles.push('new-role');
      else readiness.adminNotificationReady = false;
    },
    setBinding: (value: QuarantinePreviewBinding | null): void => {
      binding = value;
    },
    revoke: (): void => {
      permission = '0';
    },
    disable: (): void => {
      enabled = false;
    },
  };
}
it.each(['role', 'readiness'])(
  'changed_role_or_readiness_invalidates_preview (%s)',
  async (kind) => {
    const h = harness();
    h.changeState(kind);
    await expect(h.actions.execute(context, input)).resolves.toEqual({
      kind: 'denied',
      code: 'stale_state',
    });
    expect(h.removed()).toBe(0);
  }
);
it('quarantine_does_not_overwrite_newer_verification', async () => {
  const h = harness();
  const repair = h.deps.workflows.repair;
  h.deps.workflows.repair = async (
    ...args
  ): ReturnType<QuarantineDependencies['workflows']['repair']> => {
    h.verify();
    return repair(...args);
  };
  await expect(h.actions.execute(context, input)).resolves.toEqual({
    kind: 'denied',
    code: 'stale_state',
  });
  expect(h.caseStatus()).toBe('verified');
  expect(h.removed()).toBe(0);
});
it('preview_from_another_case_is_rejected', async () => {
  const h = harness();
  h.setBinding({
    guildId: 'guild',
    actorId: 'staff',
    caseId: 'another',
    targetUserId: 'target',
    fingerprint: 'original',
    expiresAt: 100,
  });
  await expect(h.actions.execute(context, input)).resolves.toEqual({
    kind: 'denied',
    code: 'binding_mismatch',
  });
  expect(h.removed()).toBe(0);
});
it('executes only after current permission, policy and preview checks', async () => {
  const h = harness();
  await expect(h.actions.execute(context, input)).resolves.toMatchObject({
    kind: 'outcome',
    outcome: { status: 'parked' },
  });
  expect(h.removed()).toBe(1);
});
it('checks revoked authority and disabled policy at execution', async () => {
  const revoked = harness();
  revoked.revoke();
  await expect(revoked.actions.execute(context, input)).resolves.toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  const disabled = harness();
  disabled.disable();
  await expect(disabled.actions.execute(context, input)).resolves.toEqual({
    kind: 'denied',
    code: 'policy_disabled',
  });
  expect(revoked.removed() + disabled.removed()).toBe(0);
});

it.each(['actorId', 'guildId', 'targetUserId'] as const)(
  'rejects a preview bound to a different %s',
  async (field) => {
    const h = harness();
    const binding = await h.deps.previews.resolve(context, input);
    if (!binding) throw new Error('Missing fixture binding');
    h.setBinding({ ...binding, [field]: 'someone-else' });
    await expect(h.actions.execute(context, input)).resolves.toEqual({
      kind: 'denied',
      code: 'binding_mismatch',
    });
    expect(h.removed()).toBe(0);
  }
);
it('rejects expired or missing preview references before role changes', async () => {
  const h = harness();
  const binding = await h.deps.previews.resolve(context, input);
  if (!binding) throw new Error('Missing fixture binding');
  h.setBinding({ ...binding, expiresAt: 0 });
  await expect(h.actions.execute(context, input)).resolves.toEqual({
    kind: 'denied',
    code: 'stale_state',
  });
  h.setBinding(null);
  await expect(h.actions.execute(context, input)).resolves.toEqual({
    kind: 'denied',
    code: 'confirmation_required',
  });
  expect(h.removed()).toBe(0);
});
it.each(['role', 'readiness'])('rejects %s drift during repair', async (kind) => {
  const h = harness();
  const repair = h.deps.workflows.repair;
  h.deps.workflows.repair = async (
    ...args
  ): ReturnType<QuarantineDependencies['workflows']['repair']> => {
    h.changeState(kind);
    return repair(...args);
  };
  await expect(h.actions.execute(context, input)).resolves.toEqual({
    kind: 'denied',
    code: 'stale_state',
  });
  expect(h.removed()).toBe(0);
});
it('rechecks authority after repair and fails closed on policy read errors', async () => {
  const h = harness();
  const repair = h.deps.workflows.repair;
  h.deps.workflows.repair = async (
    ...args
  ): ReturnType<QuarantineDependencies['workflows']['repair']> => {
    h.revoke();
    return repair(...args);
  };
  await expect(h.actions.execute(context, input)).resolves.toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  const unavailable = harness();
  unavailable.deps.settings.loadFresh = async (): Promise<never> => {
    throw new Error('Policy unavailable');
  };
  await expect(unavailable.actions.execute(context, input)).rejects.toThrow('Policy unavailable');
  expect(h.removed() + unavailable.removed()).toBe(0);
});
it('source never grants authority and system actors cannot start quarantine', async () => {
  const h = harness();
  h.revoke();
  await expect(h.actions.execute({ ...context, source: 'trusted_system' }, input)).resolves.toEqual(
    { kind: 'denied', code: 'permission_denied' }
  );
  await expect(
    h.actions.execute(
      { ...context, actor: { kind: 'system', purpose: 'report_ban_recovery' } },
      input
    )
  ).resolves.toEqual({ kind: 'denied', code: 'permission_denied' });
  expect(h.removed()).toBe(0);
});
it('keeps incomplete containment distinct from infrastructure failure', async () => {
  const h = harness();
  const result = await h.deps.workflows.quarantine(context, input);
  h.deps.workflows.quarantine = async (): ReturnType<
    QuarantineDependencies['workflows']['quarantine']
  > => ({
    ...result,
    status: 'incomplete',
    containmentStatus: 'incomplete',
    failedRoleRemovals: 1,
  });
  await expect(h.actions.execute(context, input)).resolves.toMatchObject({
    kind: 'outcome',
    outcome: { status: 'incomplete', failedRoleRemovals: 1 },
  });
  h.deps.workflows.quarantine = async (): Promise<never> => {
    throw new Error('Persistence unavailable');
  };
  await expect(h.actions.execute(context, input)).rejects.toThrow('Persistence unavailable');
});
it('returns committed runtime recovery without enforcing again after policy revocation', async () => {
  const h = harness();
  h.revoke();
  h.disable();
  h.deps.workflows.recoverCommitted = async (): ReturnType<
    QuarantineDependencies['workflows']['recoverCommitted']
  > => ({
    status: 'parked',
    containmentStatus: 'contained',
    failedRoleRemovals: 0,
    memberBypasses: 0,
    retainedRoles: 0,
    lockdownChangesRequired: 0,
    recovered: true,
  });
  await expect(h.actions.execute(context, input)).resolves.toMatchObject({
    kind: 'outcome',
    outcome: { recovered: true },
  });
  expect(h.removed()).toBe(0);
});
it.each([
  { kind: 'preview_account_quarantine', caseId: input.caseId, targetUserId: input.targetUserId },
  { kind: 'quarantine_compromised_account', ...input },
])('preserves shipped $kind queue metadata and bindings', (commandInput) => {
  const command = queuedQuarantineCommandSchema.parse(commandInput);
  const encoded = encodeQueuedAction(context, command);
  expect(encoded.idempotencyKey).toBe(
    `web:case-action:quarantine_compromised_account:guild:case:${command.kind === 'preview_account_quarantine' ? 'preview:execute' : 'execute:preview'}`
  );
  expect(
    decodeQueuedAction({
      id: context.requestId,
      server_id: encoded.serverId,
      actor_id: encoded.actorId,
      actor_surface: encoded.actorSurface,
      action_type: encoded.actionType,
      target_user_id: encoded.targetUserId,
      verification_event_id: encoded.verificationEventId,
      metadata: encoded.metadata,
    })
  ).toEqual({ context, command });
  expect(() =>
    queuedQuarantineCommandSchema.parse({ ...command, attemptToken: 'forged' })
  ).toThrow();
  expect(() => queuedQuarantineCommandSchema.parse({ ...command, actor: context.actor })).toThrow();
});
it('does not accept Discord or trusted-preview objects in queued commands', () => {
  expect(() =>
    queuedQuarantineCommandSchema.parse({
      kind: 'quarantine_compromised_account',
      ...input,
      previewReference: { kind: 'discord_confirmation', fingerprint: 'forged' },
    })
  ).toThrow();
  expect(() =>
    queuedQuarantineCommandSchema.parse({
      kind: 'quarantine_compromised_account',
      ...input,
      preview: { canContain: true },
    })
  ).toThrow();
});
