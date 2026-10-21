import { createContainmentIntentResolver, type ContainmentResolutionResources } from './resolution';
import type { DelegatedPrincipal, IntentInvocation } from '../delegation/types';
const principal: DelegatedPrincipal = {
  userId: 'actor',
  clientId: 'client',
  connectionId: 'connection',
  grantVersion: 1,
  scopes: ['drasil:moderate'],
};
const state = {
  id: 'case',
  guildId: 'guild',
  targetUserId: 'target',
  status: 'pending',
  caseKind: 'standard',
  revision: 3,
  evidenceThreadId: 'evidence',
  detectionEventId: null,
  challenge: { id: 'challenge', generation: 2 },
};
const input = {
  caseId: 'case',
  targetUserId: 'target',
  mode: 'delete_only',
  scope: 'last_hour',
  reason: 'Remove spam',
  detectionEventId: null,
};
function fixture(): {
  resources: ContainmentResolutionResources;
  resolver: ReturnType<typeof createContainmentIntentResolver>;
} {
  const resources: ContainmentResolutionResources = {
    loadCase: jest.fn(async () => state),
    loadPolicy: jest.fn(async () => ({
      captchaEnabled: true,
      quarantineEnabled: true,
      banEnabled: true,
    })),
    resolvePreviewReference: jest.fn(async () => {
      throw new Error('unexpected preview');
    }),
  };
  return { resources, resolver: createContainmentIntentResolver(resources) };
}
function invocation(
  workflowId: IntentInvocation['workflowId'],
  options: unknown
): IntentInvocation {
  return { workflowId, guildId: 'guild', idempotencyKey: 'key', input: options };
}
describe('containment intent resolution', () => {
  it.each(['source_message', 'last_hour', 'last_day', 'last_7_days'])(
    'reserves readonly immutable cleanup %s provision in both modes',
    async (scope) => {
      for (const mode of ['delete_only', 'ban_with_cleanup']) {
        const { resolver } = fixture();
        const value = await resolver.resolve(
          principal,
          invocation('preview_case_message_deletion', { ...input, scope, mode })
        );
        expect(value.preconditions).toMatchObject({
          kind: 'cleanup_job_provision',
          caseId: 'case',
          revision: 3,
          evidenceThreadId: 'evidence',
        });
        expect(value.bindings?.cleanup?.jobId).toMatch(/^[a-f0-9-]{36}$/);
        expect(value.summary).toContain(scope);
        expect(value.summary).toContain(mode);
        expect(value.summary).toContain('Remove spam');
      }
    }
  );
  it('rejects reuse of another connections cleanup preview', async () => {
    const { resolver, resources } = fixture();
    const cleanupEffects = jest.fn();
    jest
      .mocked(resources.resolvePreviewReference)
      .mockRejectedValue(new Error('preview_not_found'));
    const result = await resolver
      .resolve(
        principal,
        invocation('execute_case_message_deletion', { ...input, cleanupReference: 'foreign' })
      )
      .then(
        async () => {
          await cleanupEffects();
          return { state: 'completed' };
        },
        () => ({ state: 'denied' })
      );
    expect(result.state).toBe('denied');
    expect(cleanupEffects).not.toHaveBeenCalled();
  });
  it.each([
    'request_captcha_challenge',
    'retry_captcha_challenge',
    'bypass_captcha_challenge',
  ] as const)('binds saved revision and expected generation for %s', async (kind) => {
    const { resolver } = fixture();
    const value = await resolver.resolve(
      principal,
      invocation(kind, {
        caseId: 'case',
        targetUserId: 'target',
        ...(kind === 'request_captcha_challenge'
          ? {}
          : { expectedChallengeId: 'challenge', expectedGeneration: 2 }),
        ...(kind === 'bypass_captcha_challenge' ? { reason: 'Verified moderator review' } : {}),
      })
    );
    expect(value.preconditions).toMatchObject({
      kind: 'resource_revision',
      revision: 3,
      resource: { kind: 'case', id: 'case' },
    });
    expect(value.summary).toContain('target');
    if (kind !== 'request_captcha_challenge') expect(value.summary).toContain('generation 2');
    if (kind === 'bypass_captcha_challenge')
      expect(value.summary).toContain('Verified moderator review');
  });
  it('denies stale CAPTCHA generation', async () => {
    const { resolver } = fixture();
    await expect(
      resolver.resolve(
        principal,
        invocation('retry_captcha_challenge', {
          caseId: 'case',
          targetUserId: 'target',
          expectedChallengeId: 'challenge',
          expectedGeneration: 1,
        })
      )
    ).rejects.toThrow('stale_state');
  });
  it('acknowledgement keeps the direct batch command and per-item execution', async () => {
    const { resolver, resources } = fixture();
    const value = await resolver.resolve(
      principal,
      invocation('acknowledge_attention', { itemIds: ['one', 'two'] })
    );
    expect(value.delivery).toEqual({ kind: 'direct' });
    expect(resources.loadCase).not.toHaveBeenCalled();
  });
});
it('ignores unrelated quarantine policy changes in CAPTCHA approval state', async () => {
  const { resources, resolver } = fixture();
  const request = invocation('request_captcha_challenge', {
    caseId: 'case',
    targetUserId: 'target',
  });
  const original = await resolver.resolve(principal, request);
  jest
    .mocked(resources.loadPolicy)
    .mockResolvedValue({ captchaEnabled: true, quarantineEnabled: false, banEnabled: false });
  expect((await resolver.resolve(principal, request)).relevantState).toEqual(
    original.relevantState
  );
});
