import { createCaseActions } from './actions';
import type { CaseDependencies } from './ports';
import type { ActionContext } from '../context';

const context: ActionContext = {
  guildId: 'guild-1',
  requestId: 'request-1',
  source: 'web',
  actor: { kind: 'user', userId: 'actor-1' },
};
interface Fixture {
  readonly deps: CaseDependencies;
  readonly state: {
    id: string;
    server_id: string;
    user_id: string;
    status: string;
    case_kind: string;
    attention_state: string;
  };
  readonly actions: ReturnType<typeof createCaseActions>;
  revoke(): void;
  count(): number;
  source(): unknown;
}
function arrange(): Fixture {
  const state = {
    id: 'case-1',
    server_id: 'guild-1',
    user_id: 'target-1',
    status: 'pending',
    case_kind: 'standard',
    attention_state: 'review_required',
  };
  let permissions = (1n << 40n).toString();
  let verificationCount = 0;
  let storedSource: unknown;
  const deps: CaseDependencies = {
    roleGate: null,
    authority: {
      loadFresh: async () => ({
        guildId: context.guildId,
        userId: 'actor-1',
        present: true,
        owner: false,
        permissions,
        roleIds: [],
      }),
    },
    repository: {
      findSourceMessage: async () => null,
      findById: async () => state,
      findActive: async () => state,
      findDetection: async () => ({ server_id: 'guild-1', user_id: 'target-1', reportId: null }),
    },
    settings: {
      loadFresh: async () => ({
        adminCaseOpenRequiresReason: false,
        moderatorBanActionEnabled: true,
        moderatorBanActionRequiresReason: false,
        moderatorKickActionEnabled: true,
        moderatorKickActionRequiresReason: false,
      }),
    },
    confirmations: {
      verify: async () => true,
    },
    workflows: {
      verify: async () => {
        verificationCount++;
        state.status = 'verified';
        return true;
      },
      openAdmin: async (input) => {
        storedSource = input.source;
        return { opened: true, caseRoleActive: true, caseRoleAttempted: true };
      },
      openObserved: async () => true,
      manualFlag: async () => true,
      closeNoAction: async () => 1,
      kick: async () => true,
      ban: async () => true,
      banById: async () => true,
      repair: async () => ({
        repaired: true,
        message: 'Repaired',
        threadCreated: false,
        userAdded: false,
        promptSent: false,
        promptAlreadyPresent: true,
      }),
      reopen: async () => true,
      refresh: async () => ({ refreshed: true, message: 'Refreshed' }),
      syncExistingBan: async () => 1,
    },
  };
  return {
    deps,
    state,
    actions: createCaseActions(deps),
    revoke: (): void => {
      permissions = '0';
    },
    count: (): number => verificationCount,
    source: (): unknown => storedSource,
  };
}
const verify = { kind: 'verify_case_user', caseId: 'case-1', targetUserId: 'target-1' } as const;
test('rejects_case_from_another_guild_or_subject', async () => {
  const { state, actions } = arrange();
  state.server_id = 'another-guild';
  const mismatch = await actions.execute(context, verify);
  expect(mismatch).toEqual({ kind: 'denied', code: 'binding_mismatch' });
  state.server_id = 'guild-1';
  state.user_id = 'another-user';
  expect(await actions.execute(context, verify)).toEqual(mismatch);
});
test('verify_rechecks_actor_at_execution', async () => {
  const fixture = arrange();
  expect((await fixture.actions.execute(context, verify)).kind).toBe('outcome');
  fixture.state.status = 'pending';
  fixture.revoke();
  expect(await fixture.actions.execute(context, verify)).toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  const verificationCountAfterRevocation = fixture.count() - 1;
  expect(verificationCountAfterRevocation).toBe(0);
});
test('resolved_case_is_not_reopened_by_stale_verify', async () => {
  const { state, actions } = arrange();
  state.status = 'verified';
  expect(await actions.execute(context, verify)).toEqual({ kind: 'denied', code: 'stale_state' });
  const resolvedCaseStatus = state.status;
  expect(resolvedCaseStatus).toBe('verified');
});
test('selected_message_survives_case_open', async () => {
  const fixture = arrange();
  await fixture.actions.execute(context, {
    kind: 'open_admin_case',
    intent: 'native_case_open',
    targetUserId: 'target-1',
    reason: null,
    detectionEventId: null,
    selectedMessage: { channelId: 'channel-1', messageId: 'message-1' },
  });
  const storedSource = fixture.source();
  expect(storedSource).toMatchObject({
    source_channel_id: 'channel-1',
    source_message_id: 'message-1',
  });
});

test('stale_reopen_does_not_replace_a_new_active_case', async () => {
  const fixture = arrange();
  fixture.state.status = 'verified';
  fixture.deps.repository.findActive = async (): ReturnType<
    CaseDependencies['repository']['findActive']
  > => ({ ...fixture.state, id: 'new-case', status: 'pending' });
  const result = await fixture.actions.execute(context, {
    kind: 'reopen_case',
    caseId: 'case-1',
    targetUserId: 'target-1',
  });
  expect(result).toEqual({ kind: 'denied', code: 'stale_state' });
});
test('confirmation_is_bound_to_the_case_and_operation', async () => {
  const fixture = arrange();
  fixture.deps.confirmations.verify = async (): Promise<boolean> => false;
  expect(await fixture.actions.execute(context, verify)).toEqual({
    kind: 'denied',
    code: 'confirmation_required',
  });
  expect(fixture.count()).toBe(0);
});
test('queued_source_and_responder_roles_do_not_grant_case_authority', async () => {
  const fixture = arrange();
  fixture.deps.authority.loadFresh = async (): ReturnType<
    CaseDependencies['authority']['loadFresh']
  > => ({
    guildId: 'guild-1',
    userId: 'actor-1',
    owner: false,
    present: true,
    permissions: '0',
    roleIds: ['responder-role'],
  });
  expect(await fixture.actions.execute({ ...context, source: 'administrator' }, verify)).toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
});
test('mutable_policy_denial_precedes_new_moderation_effects', async () => {
  const fixture = arrange();
  fixture.deps.authority.loadFresh = async (): ReturnType<
    CaseDependencies['authority']['loadFresh']
  > => ({
    guildId: 'guild-1',
    userId: 'actor-1',
    owner: false,
    present: true,
    permissions: '4',
    roleIds: [],
  });
  fixture.deps.settings.loadFresh = async (): ReturnType<
    CaseDependencies['settings']['loadFresh']
  > => ({
    adminCaseOpenRequiresReason: false,
    moderatorBanActionEnabled: false,
    moderatorBanActionRequiresReason: false,
    moderatorKickActionEnabled: true,
    moderatorKickActionRequiresReason: false,
  });
  expect(
    await fixture.actions.execute(context, {
      kind: 'ban_case_user',
      caseId: 'case-1',
      targetUserId: 'target-1',
      reason: 'review',
      detectionEventId: null,
    })
  ).toEqual({ kind: 'denied', code: 'policy_disabled' });
});
test('observed_case_checks_the_persisted_report_binding', async () => {
  const fixture = arrange();
  fixture.deps.repository.findDetection = async (): ReturnType<
    CaseDependencies['repository']['findDetection']
  > => ({ server_id: 'guild-1', user_id: 'target-1', reportId: 'another-report' });
  expect(
    await fixture.actions.execute(context, {
      kind: 'open_case_from_observed_detection',
      targetUserId: 'target-1',
      detectionEventId: 'detection-1',
      reportId: 'report-1',
    })
  ).toEqual({ kind: 'denied', code: 'binding_mismatch' });
});
test('preserves_moderator_repair_and_stricter_administrator_repair', async () => {
  const fixture = arrange();
  const binding = {
    kind: 'repair_active_case',
    mode: 'repair_thread',
    caseId: 'case-1',
    targetUserId: 'target-1',
  } as const;
  expect(
    (await fixture.actions.execute(context, { ...binding, intent: 'moderator_repair' })).kind
  ).toBe('outcome');
  expect(
    await fixture.actions.execute(context, { ...binding, intent: 'administrator_repair' })
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
});
test('selected_message_binding_is_checked_by_the_shared_operation', async () => {
  const fixture = arrange();
  fixture.deps.repository.findSourceMessage = async (): Promise<{
    guildId: string;
    userId: string;
  }> => ({ guildId: 'other-guild', userId: 'target-1' });
  expect(
    await fixture.actions.execute(context, {
      kind: 'open_admin_case',
      intent: 'native_case_open',
      targetUserId: 'target-1',
      reason: null,
      detectionEventId: null,
      selectedMessage: { channelId: 'channel-1', messageId: 'message-1' },
    })
  ).toEqual({ kind: 'denied', code: 'binding_mismatch' });
});
test.each(['administrator_repair', 'refresh'] as const)(
  'rechecks %s administrator authority after revocation',
  async (intent) => {
    const fixture = arrange();
    let permissions = '8';
    fixture.deps.authority.loadFresh = async (): ReturnType<
      CaseDependencies['authority']['loadFresh']
    > => ({
      guildId: 'guild-1',
      userId: 'actor-1',
      owner: false,
      present: true,
      permissions,
      roleIds: [],
    });
    const command =
      intent === 'refresh'
        ? ({
            kind: 'refresh_case_notification',
            caseId: 'case-1',
            targetUserId: 'target-1',
          } as const)
        : ({
            kind: 'repair_active_case',
            caseId: 'case-1',
            targetUserId: 'target-1',
            mode: 'repair_thread',
            intent,
          } as const);
    expect((await fixture.actions.execute(context, command)).kind).toBe('outcome');
    permissions = (1n << 40n).toString();
    expect(await fixture.actions.execute(context, command)).toEqual({
      kind: 'denied',
      code: 'permission_denied',
    });
  }
);

test.each([
  ['native_case_open', 1n << 40n, 'web', true],
  ['native_case_open', 1n << 5n, 'discord_interaction', false],
  ['dashboard_case_open', 1n << 5n, 'discord_interaction', true],
  ['dashboard_case_open', 1n << 40n, 'web', false],
] as const)(
  'opening intent %s uses permissions %s independently of source %s',
  async (intent, bits, source, allowed) => {
    const fixture = arrange();
    fixture.deps.authority.loadFresh = async (): ReturnType<
      CaseDependencies['authority']['loadFresh']
    > => ({
      guildId: 'guild-1',
      userId: 'actor-1',
      owner: false,
      present: true,
      permissions: bits.toString(),
      roleIds: [],
    });
    const result = await fixture.actions.execute(
      { ...context, source },
      {
        kind: 'open_admin_case',
        intent,
        targetUserId: 'target-1',
        reason: null,
        detectionEventId: null,
        selectedMessage: null,
      }
    );
    if (allowed) expect(result.kind).toBe('outcome');
    else expect(result).toEqual({ kind: 'denied', code: 'permission_denied' });
  }
);
