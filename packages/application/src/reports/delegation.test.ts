import { createIntakeChoiceReferences } from './delegation';
import type { ReportIntakeState } from './ports';
const principal = {
  userId: 'owner',
  clientId: 'client',
  connectionId: 'connection',
  grantVersion: 1,
  scopes: ['drasil:read', 'drasil:moderate'] as const,
};
it('binds choices to owner, connection and current prompt without disclosing tokens', async () => {
  const intake: ReportIntakeState = {
    id: 'intake',
    guildId: 'guild',
    reporterId: 'owner',
    threadId: 'thread',
    status: 'needs_reporter_confirmation',
    confirmedTargetUserId: null,
    promptMessageId: 'prompt',
    promptToken: 'PRIVATE-TOKEN',
    candidateIds: ['target'],
    claimed: false,
  };
  const refs = createIntakeChoiceReferences({
    secret: 'test-only-secret'.repeat(3),
    intakes: { load: async () => intake },
    authority: { loadFresh: async () => null },
    staffRoles: { loadRoleIds: async () => [] },
  });
  const choice = await refs.issue(principal, 'guild', 'intake');
  expect(choice.candidateIds).toEqual(['target']);
  expect(Buffer.from(choice.reference.split('.')[0], 'base64url').toString()).not.toContain(
    'PRIVATE-TOKEN'
  );
  expect(await refs.resolveIntakeChoice(principal, choice.reference)).toMatchObject({
    intakeId: 'intake',
    promptToken: 'PRIVATE-TOKEN',
  });
  await expect(
    refs.resolveIntakeChoice({ ...principal, connectionId: 'other' }, choice.reference)
  ).rejects.toThrow();
  intake.promptMessageId = 'rotated';
  await expect(refs.resolveIntakeChoice(principal, choice.reference)).rejects.toThrow();
  intake.promptMessageId = 'prompt';
  intake.claimed = true;
  await expect(refs.resolveIntakeChoice(principal, choice.reference)).rejects.toThrow();
});
it('denies nonowners before exposing candidate choices', async () => {
  const refs = createIntakeChoiceReferences({
    secret: 'secret',
    intakes: {
      load: async () => ({
        id: 'intake',
        guildId: 'guild',
        reporterId: 'other',
        threadId: 'thread',
        status: 'needs_reporter_confirmation',
        confirmedTargetUserId: null,
        promptMessageId: 'prompt',
        promptToken: 'token',
        candidateIds: ['target'],
        claimed: false,
      }),
    },
    authority: { loadFresh: async () => null },
    staffRoles: { loadRoleIds: async () => [] },
  });
  await expect(refs.issue(principal, 'guild', 'intake')).rejects.toThrow('permission_denied');
});
it('refreshes configured staff authority on every reference resolution', async () => {
  let staff = true;
  const refs = createIntakeChoiceReferences({
    secret: 'staff-test'.repeat(4),
    intakes: {
      load: async () => ({
        id: 'intake',
        guildId: 'guild',
        reporterId: 'reporter',
        threadId: 'thread',
        status: 'needs_reporter_confirmation',
        confirmedTargetUserId: null,
        promptMessageId: 'prompt',
        promptToken: 'token',
        candidateIds: ['target'],
        claimed: false,
      }),
    },
    authority: {
      loadFresh: async () => ({
        guildId: 'guild',
        userId: principal.userId,
        present: true,
        owner: false,
        permissions: '0',
        roleIds: staff ? ['staff'] : [],
      }),
    },
    staffRoles: { loadRoleIds: async () => ['staff'] },
  });
  const choice = await refs.issue(principal, 'guild', 'intake');
  expect((await refs.resolveIntakeChoice(principal, choice.reference)).candidateIds).toEqual([
    'target',
  ]);
  staff = false;
  await expect(refs.resolveIntakeChoice(principal, choice.reference)).rejects.toThrow(
    'permission_denied'
  );
});
