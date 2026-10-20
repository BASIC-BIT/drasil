import { operationConfirmationCommand, type OperationCommand } from '@drasil/application';
import { createCaseConfirmationStore, createDiscordActionContext } from '../../application/context';
const context = createDiscordActionContext({
  guildId: 'guild',
  userId: 'staff',
  requestId: 'request',
});
test('confirmed intake binds the same selected options independently of property construction order', async () => {
  const store = createCaseConfirmationStore();
  const submitted = {
    kind: 'intake_role_members',
    roleId: 'role',
    execute: true,
    limit: 12,
    reason: 'reason',
  } as const;
  const execution = {
    kind: 'intake_role_members',
    roleId: 'role',
    reason: 'reason',
    execute: true,
    limit: 12,
  } as const;
  store.recordVerified(context, operationConfirmationCommand(context, submitted));
  expect(
    await store.confirmations.verify(context, operationConfirmationCommand(context, execution))
  ).toBe(true);
  expect(
    await store.confirmations.verify(context, operationConfirmationCommand(context, execution))
  ).toBe(false);
});
test.each<OperationCommand>([
  { kind: 'intake_role_members', roleId: 'other', execute: true, limit: 12, reason: 'reason' },
  { kind: 'intake_role_members', roleId: 'role', execute: true, limit: 13, reason: 'reason' },
  { kind: 'intake_role_members', roleId: 'role', execute: true, limit: 12, reason: 'changed' },
  { kind: 'apply_case_role_lockdown', unsyncAllowedChannels: true },
])('operation evidence cannot authorize changed options $kind', async (command) => {
  const store = createCaseConfirmationStore();
  store.recordVerified(
    context,
    operationConfirmationCommand(context, {
      kind: 'intake_role_members',
      roleId: 'role',
      execute: true,
      limit: 12,
      reason: 'reason',
    })
  );
  expect(
    await store.confirmations.verify(context, operationConfirmationCommand(context, command))
  ).toBe(false);
});

test('uses case identity by default and retains explicitly supplied evidence', async () => {
  const store = createCaseConfirmationStore();
  const command = { kind: 'ban_case_user', caseId: 'case', targetUserId: 'target' };
  store.recordVerified(context, command);
  expect(await store.confirmations.verify(context, { ...command, targetUserId: 'other' })).toBe(
    true
  );
  expect(await store.confirmations.verify(context, command)).toBe(false);
  store.recordVerified(context, command, {
    guildId: context.guildId,
    actorId: 'other-actor',
    action: command.kind,
    targetId: 'case',
  });
  expect(await store.confirmations.verify(context, command)).toBe(false);
});

test('rejects recording confirmation for system actors', () => {
  const store = createCaseConfirmationStore();
  expect(() =>
    store.recordVerified(
      { ...context, actor: { kind: 'system', purpose: 'captcha_pass' } },
      { kind: 'ban_case_user', caseId: 'case' }
    )
  ).toThrow('A case confirmation needs a user actor.');
});
