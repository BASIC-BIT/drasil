import { matchesConfirmation } from '../confirmation';
import { createCaseActions } from './actions';
import { caseCommandSchema, type CaseCommand } from './commands';
import type { CaseDependencies, CasePolicy } from './ports';
import type { ActionContext } from '../context';

const context: ActionContext = {
  guildId: 'guild-1',
  requestId: 'request-1',
  source: 'discord_interaction',
  actor: { kind: 'user', userId: 'moderator-1' },
};
interface Fixture {
  readonly deps: CaseDependencies;
  readonly ban: jest.Mock<Promise<boolean>, []>;
  readonly kick: jest.Mock<Promise<boolean>, []>;
  readonly actions: ReturnType<typeof createCaseActions>;
  readonly policy: CasePolicy;
}
function arrange(): Fixture {
  const policy: CasePolicy = {
    adminCaseOpenRequiresReason: false,
    moderatorBanActionEnabled: true,
    moderatorBanActionRequiresReason: false,
    moderatorKickActionEnabled: true,
    moderatorKickActionRequiresReason: false,
  };
  const ban = jest.fn(async () => true);
  const kick = jest.fn(async () => true);
  const deps: CaseDependencies = {
    roleGate: null,
    authority: {
      loadFresh: async () => ({
        guildId: 'guild-1',
        userId: 'moderator-1',
        present: true,
        owner: false,
        permissions: '6',
        roleIds: [],
      }),
    },
    repository: {
      findSourceMessage: async () => null,
      findById: async () => null,
      findActive: async () => null,
      findDetection: async () => null,
    },
    settings: { loadFresh: async () => policy },
    confirmations: {
      verify: async (ctx, cmd) =>
        matchesConfirmation(ctx, cmd, {
          guildId: 'guild-1',
          actorId: 'moderator-1',
          action: 'ban_user',
          targetId: 'user-1',
        }),
    },
    workflows: {
      ban,
      kick,
      banById: ban,
      verify: async () => true,
      openAdmin: async () => ({ opened: true, caseRoleActive: true, caseRoleAttempted: true }),
      openObserved: async () => true,
      manualFlag: async () => true,
      closeNoAction: async () => 0,
      repair: async () => ({
        repaired: true,
        message: '',
        threadCreated: false,
        userAdded: false,
        promptSent: false,
        promptAlreadyPresent: false,
      }),
      reopen: async () => true,
      refresh: async () => ({ refreshed: true, message: '' }),
      syncExistingBan: async () => 0,
    },
  };
  return { deps, ban, kick, actions: createCaseActions(deps), policy };
}
function command(
  kind = 'ban_user',
  targetUserId = 'user-1',
  reason: string | null = 'review'
): CaseCommand {
  const parsed = caseCommandSchema.safeParse({ kind, targetUserId, reason, selectedMessage: null });
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('Ordinary staff command unavailable');
  return parsed.data;
}
test('confirmation_cannot_move_to_another_target', async () => {
  const fixture = arrange();
  const wrongTarget = await fixture.actions.execute(context, command('ban_user', 'other-user'));
  if (wrongTarget.kind !== 'denied') throw new Error('Expected confirmation denial');
  expect(wrongTarget.code).toBe('confirmation_required');
  expect(fixture.ban).not.toHaveBeenCalled();
});
test('ban_by_id_preserves_departed_subject', async () => {
  const fixture = arrange();
  expect((await fixture.actions.execute(context, command())).kind).toBe('outcome');
  expect(fixture.ban).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: 'user-1' }));
});
test.each(['ban_user', 'kick_user'])(
  'disabled_action_and_missing_reason_block_all_callers (%s)',
  async (kind) => {
    const fixture = arrange();
    fixture.deps.settings.loadFresh = async (): Promise<CasePolicy> => ({
      ...fixture.policy,
      moderatorBanActionEnabled: false,
      moderatorKickActionEnabled: false,
    });
    expect(await fixture.actions.execute(context, command(kind))).toEqual({
      kind: 'denied',
      code: 'policy_disabled',
    });
    fixture.deps.settings.loadFresh = async (): Promise<CasePolicy> => ({
      ...fixture.policy,
      moderatorBanActionRequiresReason: true,
      moderatorKickActionRequiresReason: true,
    });
    const requiredReason = await fixture.actions.execute(context, command(kind, 'user-1', null));
    if (requiredReason.kind !== 'denied') throw new Error('Expected reason denial');
    expect(requiredReason.code).toBe('reason_required');
    expect(fixture.ban).not.toHaveBeenCalled();
    expect(fixture.kick).not.toHaveBeenCalled();
  }
);

test.each(['action', 'actor', 'guild'] as const)(
  'confirmation cannot transfer %s',
  async (changed) => {
    const fixture = arrange();
    const candidate = changed === 'action' ? command('kick_user') : command();
    const candidateContext: ActionContext =
      changed === 'actor'
        ? { ...context, actor: { kind: 'user', userId: 'another-actor' } }
        : changed === 'guild'
          ? { ...context, guildId: 'another-guild' }
          : context;
    fixture.deps.authority.loadFresh = async (): ReturnType<
      CaseDependencies['authority']['loadFresh']
    > => ({
      guildId: candidateContext.guildId,
      userId: candidateContext.actor.kind === 'user' ? candidateContext.actor.userId : '',
      owner: false,
      present: true,
      permissions: '6',
      roleIds: [],
    });
    expect(await fixture.actions.execute(candidateContext, candidate)).toEqual({
      kind: 'denied',
      code: 'confirmation_required',
    });
    expect(fixture.ban).not.toHaveBeenCalled();
    expect(fixture.kick).not.toHaveBeenCalled();
  }
);
test.each(['ban_user', 'kick_user'])('ordinary %s prohibits self targeting', async (kind) => {
  const fixture = arrange();
  expect(await fixture.actions.execute(context, command(kind, 'moderator-1'))).toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(fixture.ban).not.toHaveBeenCalled();
  expect(fixture.kick).not.toHaveBeenCalled();
});

test('denied execution consumes its confirmation before a later retry', async () => {
  const fixture = arrange();
  let pending = true;
  fixture.deps.confirmations.verify = async (): Promise<boolean> => {
    const verified = pending;
    pending = false;
    return verified;
  };
  fixture.deps.settings.loadFresh = async (): Promise<CasePolicy> => ({
    ...fixture.policy,
    moderatorBanActionEnabled: false,
  });
  expect(await fixture.actions.execute(context, command())).toEqual({
    kind: 'denied',
    code: 'policy_disabled',
  });
  fixture.deps.settings.loadFresh = async (): Promise<CasePolicy> => fixture.policy;
  expect(await fixture.actions.execute(context, command())).toEqual({
    kind: 'denied',
    code: 'confirmation_required',
  });
  expect(fixture.ban).not.toHaveBeenCalled();
});
