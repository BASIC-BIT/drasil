import { expect, it } from 'vitest';
import {
  createWebActionContext,
  createWebConfirmationPort,
  createWebReportConfirmationPort,
} from './context';

it('keeps a supplied submission identity and provenance', () => {
  expect(
    createWebActionContext({
      guildId: 'guild',
      userId: 'user',
      requestId: 'attempt-2',
      source: 'web_report',
    })
  ).toEqual({
    guildId: 'guild',
    requestId: 'attempt-2',
    source: 'web_report',
    actor: { kind: 'user', userId: 'user' },
  });
});

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

it('requires a checked form and preserves case target precedence over user', async () => {
  const context = createWebActionContext({ guildId: 'guild', userId: 'actor' });
  const command = { kind: 'ban_case_user', caseId: 'case', targetUserId: 'target' };
  const form = new FormData();
  expect(await createWebConfirmationPort(context, command, form).verify(context, command)).toBe(
    false
  );
  form.set('confirmAction', 'on');
  const confirmations = createWebConfirmationPort(context, command, form);
  expect(await confirmations.verify(context, { ...command, targetUserId: 'other-target' })).toBe(
    true
  );
  expect(await confirmations.verify(context, { ...command, caseId: 'other-case' })).toBe(false);
  const systemContext = { ...context, actor: { kind: 'system', purpose: 'captcha_pass' } } as const;
  expect(
    await createWebConfirmationPort(systemContext, command, form).verify(systemContext, command)
  ).toBe(false);
});

it.each([
  ['close_report_intake', 'confirmCloseIntake', 'confirmReport'],
  ['ban_report_target', 'confirmReport', 'confirmCloseIntake'],
])('normalizes only the authenticated report checkbox for %s', async (kind, field, otherField) => {
  const context = createWebActionContext({ guildId: 'guild', userId: 'actor' });
  const command = { kind, intakeId: 'intake', targetUserId: 'target' };
  const form = new FormData();
  form.set(otherField, 'on');
  expect(
    await createWebReportConfirmationPort(context, command, form).verify(context, command)
  ).toBe(false);
  form.set(field, 'on');
  const confirmations = createWebReportConfirmationPort(context, command, form);
  expect(await confirmations.verify(context, command)).toBe(true);
  expect(await confirmations.verify(context, { ...command, intakeId: 'other-intake' })).toBe(false);
});
