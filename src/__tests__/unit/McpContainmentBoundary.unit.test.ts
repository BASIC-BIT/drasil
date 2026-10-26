import { mockDeep } from 'jest-mock-extended';
import { encodeQueuedAction, type ExecutionRecord, type HumanCommand } from '@drasil/application';
import {
  createBotCaptchaRuntime,
  type BotCaptchaDependencies,
} from '../../application/adapters/captcha';
import { prepareQueuedRequest } from '../../application/requestRuntime';
import type { QueuedRequestRuntime } from '../../application/requestDispatch';
import type { ModerationActionRequest } from '../../repositories/types';
const context = {
  guildId: 'guild',
  requestId: 'request',
  source: 'mcp',
  actor: { kind: 'user' as const, userId: 'actor' },
};
const authority = {
  loadFresh: async () => ({
    guildId: 'guild',
    userId: 'actor',
    owner: true,
    present: true,
    permissions: '8',
    roleIds: [],
  }),
};
function fixture(kind: 'new_execution' | 'committed_containment', receipt?: unknown) {
  const command: HumanCommand = {
    kind: 'request_captcha_challenge',
    caseId: 'case',
    targetUserId: 'target',
  };
  const encoded = encodeQueuedAction(context, command);
  const request = {
    id: 'request',
    server_id: 'guild',
    actor_id: 'actor',
    actor_surface: 'mcp',
    target_user_id: 'target',
    verification_event_id: 'case',
    action_type: command.kind,
    metadata: { ...encoded.metadata, ...(receipt ? { captcha_mutation_receipt: receipt } : {}) },
  } as ModerationActionRequest;
  const deps = mockDeep<BotCaptchaDependencies>();
  deps.verificationEventRepository.findById.mockResolvedValue({
    id: 'case',
    server_id: 'guild',
    user_id: 'target',
    status: 'pending',
    case_kind: 'standard',
    case_revision: 3,
  } as never);
  deps.configService.getServerConfig.mockResolvedValue({
    settings: { captcha_mode: 'manual' },
  } as never);
  deps.confirmations.verify.mockResolvedValue(true);
  deps.client.guilds.fetch.mockResolvedValue({ members: { fetch: async () => ({}) } } as never);
  deps.captchaChallengeService!.findByCaseId.mockResolvedValue({
    id: 'challenge',
    server_id: 'guild',
    user_id: 'target',
    verification_event_id: 'case',
    generation: 1,
    request_source: 'moderator',
    requested_by: 'actor',
    delivered_at: new Date(),
  } as never);
  deps.captchaChallengeService!.requestChallenge.mockResolvedValue({
    challenge: { id: 'challenge', generation: 1 },
    delivered: true,
  } as never);
  const execution = {
    executionId: 'execution',
    queueRequestId: 'request',
    workflowId: command.kind,
    command,
    preconditions: {
      kind: 'resource_revision',
      resource: { kind: 'case', id: 'case' },
      revision: 3,
    },
  } as ExecutionRecord;
  const runtime = {
    captchaRuntime: createBotCaptchaRuntime(deps, authority),
    caseConfirmations: { recordVerified: jest.fn() },
    delegation: {
      authorizeDelegatedRequest: async () => ({ kind, execution }),
      complete: jest.fn(),
    },
  } as unknown as QueuedRequestRuntime;
  return { deps, request, runtime };
}
it('carries saved CAPTCHA revision through the actual scoped queue runtime to service', async () => {
  const { deps, request, runtime } = fixture('new_execution');
  const prepared = await prepareQueuedRequest({ runtime, request, analytics: {} as never });
  expect(await prepared.execute()).toMatchObject({ action_type: 'request_captcha_challenge' });
  expect(deps.captchaChallengeService!.requestChallenge).toHaveBeenCalledWith(
    expect.objectContaining({ expectedCaseRevision: 3 })
  );
});
it('finishes recorded CAPTCHA mutation after admission without issuing or delivering again', async () => {
  const { deps, request, runtime } = fixture('committed_containment', {
    operation: 'request',
    challenge_id: 'challenge',
    generation: 1,
  });
  const prepared = await prepareQueuedRequest({ runtime, request, analytics: {} as never });
  expect(await prepared.execute()).toMatchObject({ resumed: true, delivered: true });
  expect(deps.captchaChallengeService!.requestChallenge).not.toHaveBeenCalled();
  expect(deps.client.guilds.fetch).not.toHaveBeenCalled();
});
it('never falls through to new CAPTCHA effects when the committed receipt fails validation', async () => {
  const { deps, request, runtime } = fixture('committed_containment');
  const prepared = await prepareQueuedRequest({ runtime, request, analytics: {} as never });
  expect(await prepared.execute()).toMatchObject({ state: 'denied' });
  expect(deps.captchaChallengeService!.requestChallenge).not.toHaveBeenCalled();
});
