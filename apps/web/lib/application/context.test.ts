import { expect, it } from 'vitest';
import { createWebActionContext, createWebConfirmationPort } from './context';

it('binds an authenticated form confirmation to its actor, guild, case, and operation', async () => {
  const context = createWebActionContext({ guildId: 'guild-1', userId: 'actor-1' });
  const command = { kind: 'ban_case_user', caseId: 'case-1' };
  const form = new FormData();
  form.set('confirmAction', 'on');
  const confirmations = createWebConfirmationPort(context, command, form);
  expect(await confirmations.verify(context, command)).toBe(true);
  expect(await confirmations.verify(context, { ...command, caseId: 'other-case' })).toBe(false);
  expect(await confirmations.verify(context, { ...command, kind: 'kick_case_user' })).toBe(false);
  expect(await confirmations.verify({ ...context, guildId: 'other-guild' }, command)).toBe(false);
  expect(
    await confirmations.verify(
      { ...context, actor: { kind: 'user', userId: 'other-actor' } },
      command
    )
  ).toBe(false);
  expect(
    await createWebConfirmationPort(context, command, undefined).verify(context, command)
  ).toBe(false);
});
