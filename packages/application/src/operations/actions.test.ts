import type { CaseRoleLockdownReport } from './reports';
import { createOperationsActions, type OperationsActions } from './actions';
import type { OperationsDependencies } from './ports';
import type { ActionContext } from '../context';

const context: ActionContext = {
  guildId: 'guild',
  requestId: 'request',
  source: 'discord_interaction',
  actor: { kind: 'user', userId: 'staff' },
};
function arrange(): {
  actions: OperationsActions;
  queue: string[];
  calls: unknown[];
  setPermissions(value: bigint): void;
  setConfirmed(value: boolean): void;
  setReasonRequired(value: boolean): void;
  readonly repairCallsDuringPreview: number;
  readonly lockdownUnsyncIntent: boolean;
} {
  let permissions = String(1n << 3n);
  let confirmed = true;
  let reasonRequired = true;
  let repairCallsDuringPreview = 0;
  let lockdownUnsyncIntent = true;
  const queue = ['guild', 'other'];
  const calls: unknown[] = [];
  const deps: OperationsDependencies = {
    authority: {
      async loadFresh(guildId, userId) {
        return { guildId, userId, present: true, owner: false, permissions, roleIds: [] };
      },
    },
    confirmations: {
      async verify() {
        return confirmed;
      },
    },
    policy: {
      async loadFresh() {
        return { intakeReasonRequired: reasonRequired };
      },
    },
    queue: {
      async sync(guildId) {
        calls.push(guildId);
      },
      async clear(guildId) {
        const index = queue.indexOf(guildId);
        if (index < 0) return 0;
        queue.splice(index, 1);
        return 1;
      },
    },
    closure: {
      async sweep(input) {
        calls.push(input);
        return {
          execute: input.execute,
          days: input.days,
          limit: input.limit,
          checkedCases: 0,
          checkedThreads: 0,
          wouldCloseThreads: 0,
          closedThreads: 0,
          alreadyClosedThreads: 0,
          missingThreads: 0,
          failedThreads: 0,
          cases: [],
        };
      },
    },
    lockdown: {
      async audit() {
        return lockdownReport();
      },
      async apply(input) {
        repairCallsDuringPreview++;
        lockdownUnsyncIntent = input.unsyncAllowedChannels;
        return lockdownReport();
      },
    },
    integrity: {
      async audit(input) {
        calls.push(input);
        return {
          guildId: input.guildId,
          checkedAt: new Date(),
          scope: 'all',
          days: 30,
          limit: 50,
          candidateCounts: {
            pendingCases: 0,
            recentResolvedCases: 0,
            caseRoleMembers: 0,
            activeRoleQuarantines: 0,
            queueItems: 0,
          },
          findings: [],
        };
      },
    },
    intake: {
      async run(input) {
        calls.push(input);
        return {
          batchId: 'batch',
          roleId: input.roleId,
          roleName: 'role',
          action: 'open_case',
          execute: input.execute,
          totalMembers: 0,
          eligibleMembers: 0,
          processed: 0,
          opened: 0,
          skippedBots: 0,
          skippedActiveCases: 0,
          skippedOverLimit: 0,
          failed: 0,
          failures: [],
        };
      },
    },
  };
  return {
    actions: createOperationsActions(deps),
    queue,
    calls,
    setPermissions(value: bigint): void {
      permissions = String(value);
    },
    setConfirmed(value: boolean): void {
      confirmed = value;
    },
    setReasonRequired(value: boolean): void {
      reasonRequired = value;
    },
    get repairCallsDuringPreview(): number {
      return repairCallsDuringPreview;
    },
    get lockdownUnsyncIntent(): boolean {
      return lockdownUnsyncIntent;
    },
  };
}
function lockdownReport(): CaseRoleLockdownReport {
  return {
    guildId: 'guild',
    checkedAt: new Date(),
    enabled: false,
    allowedChannelIds: [],
    allowedCategoryIds: [],
    autoAllowedChannelIds: [],
    issues: [],
    plannedActions: [],
    appliedActions: [],
    failedActions: [],
    syncedAllowedChannels: [],
    unsyncedAllowedChannels: [],
    errorCount: 0,
    warningCount: 0,
  };
}

test('bulk_intake_requires_admin_and_existing_reason_policy', async () => {
  const h = arrange();
  const command = {
    kind: 'intake_role_members',
    roleId: 'role',
    execute: true,
    limit: 250,
    reason: null,
  } as const;
  const bulkWithoutReason = await h.actions.execute(context, command);
  expect(bulkWithoutReason).toEqual({ kind: 'denied', code: 'reason_required' });
  h.setPermissions(1n << 5n);
  expect(await h.actions.execute(context, { ...command, reason: 'reason' })).toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(h.calls).toHaveLength(0);
});
test('queue_clear_is_guild_scoped', async () => {
  const h = arrange();
  const originalOtherGuildQueueCount = h.queue.filter((g) => g === 'other').length;
  expect(await h.actions.execute(context, { kind: 'clear_moderation_queue' })).toEqual({
    kind: 'outcome',
    outcome: { kind: 'clear_moderation_queue', removedCount: 1 },
  });
  const otherGuildQueueCount = h.queue.filter((g) => g === 'other').length;
  expect(otherGuildQueueCount).toBe(originalOtherGuildQueueCount);
});
test('audit_preview_has_no_repair_effects', async () => {
  const h = arrange();
  await h.actions.execute(context, { kind: 'audit_case_role_lockdown' });
  await h.actions.execute(context, {
    kind: 'audit_integrity',
    scope: 'all',
    days: 30,
    limit: 50,
    userId: null,
  });
  expect(h.repairCallsDuringPreview).toBe(0);
  await h.actions.execute(context, {
    kind: 'apply_case_role_lockdown',
    unsyncAllowedChannels: false,
  });
  expect(h.lockdownUnsyncIntent).toBe(false);
});
test('execution intent alone never proves confirmation and fresh authority stays operation specific', async () => {
  const h = arrange();
  h.setConfirmed(false);
  expect(
    await h.actions.execute(context, {
      kind: 'apply_case_role_lockdown',
      unsyncAllowedChannels: false,
    })
  ).toEqual({ kind: 'denied', code: 'confirmation_required' });
  expect(
    await h.actions.execute(context, {
      kind: 'intake_role_members',
      roleId: 'role',
      reason: 'reason',
      execute: true,
      limit: 250,
    })
  ).toEqual({ kind: 'denied', code: 'confirmation_required' });
  h.setPermissions(1n << 40n);
  expect(
    await h.actions.execute(context, {
      kind: 'audit_integrity',
      scope: 'all',
      days: 30,
      limit: 50,
      userId: null,
    })
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
  h.setPermissions(1n << 5n);
  expect(
    (
      await h.actions.execute(context, {
        kind: 'audit_integrity',
        scope: 'all',
        days: 30,
        limit: 50,
        userId: null,
      })
    ).kind
  ).toBe('outcome');
  expect(
    (
      await h.actions.execute(
        { ...context, source: 'web' },
        { kind: 'audit_integrity', scope: 'all', days: 30, limit: 50, userId: null }
      )
    ).kind
  ).toBe('outcome');
});
test('preview intake preserves bounded selection and skips execution reason and confirmation', async () => {
  const h = arrange();
  h.setConfirmed(false);
  expect(
    (
      await h.actions.execute(context, {
        kind: 'intake_role_members',
        roleId: 'role',
        reason: null,
        execute: false,
        limit: 12,
      })
    ).kind
  ).toBe('outcome');
  expect(h.calls).toEqual([
    expect.objectContaining({ guildId: 'guild', roleId: 'role', execute: false, limit: 12 }),
  ]);
});
test('thread sweep authority follows admitted intent and never source provenance', async () => {
  const h = arrange();
  h.setPermissions(1n << 5n);
  const sweep = {
    kind: 'close_resolved_case_threads',
    execute: false,
    days: 30,
    limit: 100,
    userId: null,
  } as const;
  expect(
    (await h.actions.execute({ ...context, source: 'web' }, { ...sweep, intent: 'guild_audit' }))
      .kind
  ).toBe('outcome');
  expect(await h.actions.execute(context, { ...sweep, intent: 'administrator_operation' })).toEqual(
    { kind: 'denied', code: 'permission_denied' }
  );
  h.setPermissions(0n);
  expect(
    await h.actions.execute(
      { ...context, source: 'discord_interaction' },
      { ...sweep, intent: 'guild_audit' }
    )
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
});
