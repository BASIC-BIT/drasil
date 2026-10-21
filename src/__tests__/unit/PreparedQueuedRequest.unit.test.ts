import { mock, mockDeep } from 'jest-mock-extended';
import type { Guild } from 'discord.js';
import type { AuthorityPort } from '@drasil/application';
import {
  createBotCaptchaRuntime,
  type BotCaptchaDependencies,
} from '../../application/adapters/captcha';
import { createCaseConfirmationStore } from '../../application/context';
import { prepareQueuedRequest } from '../../application/requestRuntime';
import type { QueuedRequestRuntime } from '../../application/requestDispatch';
import type { IProductAnalyticsService } from '../../services/ProductAnalyticsService';
import type { ICaptchaChallengeService } from '../../services/CaptchaChallengeService';
import {
  ModerationActionRequestType,
  VerificationStatus,
  CaseKind,
  type Server,
  type ModerationActionRequest,
  type VerificationEvent,
  type CaptchaChallenge,
} from '../../repositories/types';

function request(id = 'request-1', actor = 'moderator-1'): ModerationActionRequest {
  return mock<ModerationActionRequest>({
    id,
    server_id: 'guild',
    actor_id: actor,
    actor_surface: 'web',
    action_type: ModerationActionRequestType.REQUEST_CAPTCHA_CHALLENGE,
    target_user_id: 'target',
    verification_event_id: 'case',
    detection_event_id: null,
    report_intake_id: null,
    message_deletion_job_id: null,
    metadata: {},
  });
}

function arrange() {
  let permissions = '8';
  const authority = mock<AuthorityPort>();
  authority.loadFresh.mockImplementation(async (guildId, userId) => ({
    guildId,
    userId,
    present: true,
    owner: false,
    roleIds: [],
    permissions,
  }));
  const deps = mockDeep<BotCaptchaDependencies>();
  const captcha = mock<ICaptchaChallengeService>();
  const guild = mockDeep<Guild>();
  const fetchGuild = deps.client.guilds.fetch as unknown as jest.Mock<Promise<Guild>, [string]>;
  fetchGuild.mockResolvedValue(guild);
  deps.verificationEventRepository.findById.mockResolvedValue(
    mock<VerificationEvent>({
      id: 'case',
      server_id: 'guild',
      user_id: 'target',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.STANDARD,
    })
  );
  deps.configService.getServerConfig.mockResolvedValue(
    mock<Server>({ settings: { captcha_mode: 'manual' } })
  );
  captcha.findByCaseId.mockResolvedValue(null);
  captcha.requestChallenge.mockResolvedValue({
    challenge: mock<CaptchaChallenge>({ id: 'challenge', generation: 1 }),
    delivered: true,
  });
  const caseConfirmations = createCaseConfirmationStore();
  const recordVerified = jest.spyOn(caseConfirmations, 'recordVerified');
  const captchaRuntime = createBotCaptchaRuntime(
    {
      ...deps,
      captchaChallengeService: captcha,
      confirmations: caseConfirmations.confirmations,
    },
    authority
  );
  const bind = jest.spyOn(captchaRuntime, 'forRequest');
  const runtime = mock<QueuedRequestRuntime>({
    delegation: undefined,
    captchaRuntime,
    caseConfirmations,
  });
  const analytics = mock<IProductAnalyticsService>();
  return {
    runtime,
    analytics,
    bind,
    captcha,
    authority,
    recordVerified,
    revoke: () => {
      permissions = '0';
    },
  };
}

it('prepares without executing effects or replacing application methods', async () => {
  const f = arrange();
  const envelope = request();
  const originalRuntime = f.runtime.captchaRuntime;
  const originalActions = originalRuntime.actions;
  const originalFactory = originalRuntime.forRequest;
  const execution = await prepareQueuedRequest({
    runtime: f.runtime,
    request: envelope,
    analytics: f.analytics,
  });
  expect(f.bind).toHaveBeenCalledTimes(1);
  expect(f.bind).toHaveBeenCalledWith(envelope);
  expect(f.recordVerified).toHaveBeenCalledTimes(1);
  expect(f.authority.loadFresh).not.toHaveBeenCalled();
  expect(f.captcha.requestChallenge).not.toHaveBeenCalled();
  expect(execution.execute).toEqual(expect.any(Function));
  expect(execution).not.toHaveProperty('application');
  expect(execution).not.toHaveProperty('action');
  expect(f.runtime.captchaRuntime).toBe(originalRuntime);
  expect(originalRuntime.actions).toBe(originalActions);
  expect(originalRuntime.forRequest).toBe(originalFactory);
  await execution.execute();
  expect(f.bind).toHaveBeenCalledTimes(1);
  expect(f.captcha.requestChallenge).toHaveBeenCalledWith(
    expect.objectContaining({
      actionRequestId: envelope.id,
      requestedBy: envelope.actor_id,
      verificationEventId: 'case',
    })
  );
});

it('keeps two prepared request envelopes independently bound', async () => {
  const f = arrange();
  const first = request();
  const second = request('request-2', 'moderator-2');
  const one = await prepareQueuedRequest({
    runtime: f.runtime,
    request: first,
    analytics: f.analytics,
  });
  const two = await prepareQueuedRequest({
    runtime: f.runtime,
    request: second,
    analytics: f.analytics,
  });
  await two.execute();
  await one.execute();
  expect(f.bind.mock.calls).toEqual([[first], [second]]);
  expect(f.captcha.requestChallenge).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      actionRequestId: second.id,
      requestedBy: second.actor_id,
    })
  );
  expect(f.captcha.requestChallenge).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      actionRequestId: first.id,
      requestedBy: first.actor_id,
    })
  );
});

it('rejects revoked authority at execution', async () => {
  const f = arrange();
  const execution = await prepareQueuedRequest({
    runtime: f.runtime,
    request: request(),
    analytics: f.analytics,
  });
  f.revoke();
  await expect(execution.execute()).rejects.toThrow('current moderation permission');
  expect(f.authority.loadFresh).toHaveBeenCalledWith('guild', 'moderator-1');
  expect(f.captcha.requestChallenge).not.toHaveBeenCalled();
});
