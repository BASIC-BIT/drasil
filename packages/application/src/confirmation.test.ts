import { confirmationBindingFor, matchesConfirmation, type ConfirmationCommand } from './index';
import type { ActionContext } from './context';

const context: ActionContext = {
  guildId: 'guild',
  requestId: 'submission',
  source: 'web',
  actor: { kind: 'user', userId: 'actor' },
};

it('projects each confirmation target category', () => {
  const commands: ConfirmationCommand[] = [
    { kind: 'close_report_intake', intakeId: 'intake' },
    { kind: 'ban_case_user', caseId: 'case' },
    { kind: 'clear_moderation_queue', operationId: 'operation' },
    { kind: 'ban_user', targetUserId: 'target' },
  ];
  expect(commands.map((command) => confirmationBindingFor(context, command))).toEqual([
    { guildId: 'guild', actorId: 'actor', action: 'close_report_intake', targetId: 'intake' },
    { guildId: 'guild', actorId: 'actor', action: 'ban_case_user', targetId: 'case' },
    { guildId: 'guild', actorId: 'actor', action: 'clear_moderation_queue', targetId: 'operation' },
    { guildId: 'guild', actorId: 'actor', action: 'ban_user', targetId: 'target' },
  ]);
});

it('preserves intake-case-operation-user precedence', () => {
  expect(
    confirmationBindingFor(context, {
      kind: 'ban_case_user',
      caseId: 'case',
      targetUserId: 'target',
    })
  ).toEqual({ guildId: 'guild', actorId: 'actor', action: 'ban_case_user', targetId: 'case' });
  const commands = [
    {
      kind: 'close_report_intake',
      intakeId: 'intake',
      caseId: 'case',
      operationId: 'operation',
      targetUserId: 'target',
    },
    { kind: 'ban_case_user', caseId: 'case', operationId: 'operation', targetUserId: 'target' },
    { kind: 'clear_moderation_queue', operationId: 'operation', targetUserId: 'target' },
  ];
  expect(commands.map((command) => confirmationBindingFor(context, command)?.targetId)).toEqual([
    'intake',
    'case',
    'operation',
  ]);
});

it('does not project system approval', () => {
  const command = { kind: 'ban_case_user', caseId: 'case', targetUserId: 'target' };
  const systemContext: ActionContext = {
    ...context,
    actor: { kind: 'system', purpose: 'captcha_pass' },
  };
  expect(confirmationBindingFor(systemContext, command)).toBeNull();
  expect(matchesConfirmation(context, command, null)).toBe(false);
  expect(
    matchesConfirmation(systemContext, command, {
      guildId: 'guild',
      actorId: 'actor',
      action: 'ban_case_user',
      targetId: 'case',
    })
  ).toBe(false);
});
