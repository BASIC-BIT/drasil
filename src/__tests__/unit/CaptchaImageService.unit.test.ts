import type { ActionContext } from '@drasil/application';
import {
  CaptchaImageService,
  type CaptchaImageDependencies,
} from '../../services/CaptchaImageService';
import { createBotCaptchaImageActions } from '../../application/adapters/captchaImage';
import { digestImageAnswer, imageAnswerKeyVersion } from '../../services/captcha/imageAnswer';
import {
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaptchaProvider,
  type CaptchaChallenge,
} from '../../repositories/types';

const context: ActionContext = {
  guildId: 'guild',
  requestId: 'interaction',
  source: 'discord_interaction',
  actor: { kind: 'user', userId: 'member' },
};
const reference = { challengeId: 'challenge', generation: 1 };
function harness(secret: string | undefined) {
  const now = new Date();
  const challenge: CaptchaChallenge = {
    id: 'challenge',
    verification_event_id: 'case',
    server_id: 'guild',
    user_id: 'member',
    provider: CaptchaProvider.DISCORD_IMAGE,
    method_revision: 0,
    status: CaptchaChallengeStatus.PENDING,
    request_source: CaptchaChallengeRequestSource.MODERATOR,
    pass_effect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
    generation: 1,
    case_revision_at_issue: 0,
    link_token_hash: 'hash',
    expires_at: new Date(Date.now() + 60_000),
    submission_count: 0,
    requested_by: null,
    requested_at: now,
    delivered_at: null,
    delivery_error_code: null,
    passed_at: null,
    bypassed_by: null,
    bypassed_at: null,
    bypass_reason: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
  };
  const dependencies: CaptchaImageDependencies = {
    challenges: {
      requestImageAssistance: jest.fn(async () => true),
      findById: jest.fn(async () => challenge),
      isImageBindingEligible: jest.fn(async () => true),
      findImageMaterial: jest.fn(async () => null),
      storeImageMaterial: jest.fn(async () => false),
      invalidateImageMaterial: jest.fn(async () => false),
    },
    completion: {
      beginAttempt: jest.fn(async () => ({ state: 'unavailable' as const })),
      completeAttempt: jest.fn(async () => 'stale' as const),
    },
    renderer: {
      render: jest.fn(async () => {
        throw new Error('renderer failed');
      }),
    },
    secret: () => secret,
    maxSubmissions: async () => 5,
  };
  return { dependencies, service: new CaptchaImageService(dependencies), challenge };
}

function submissionHarness() {
  const key = Buffer.alloc(32, 7);
  const fixture = harness(key.toString('base64'));
  fixture.dependencies.challenges.findImageMaterial = jest.fn(async () => ({
    captcha_challenge_id: reference.challengeId,
    generation: reference.generation,
    png: Buffer.from('image'),
    answer_digest: Uint8Array.from(
      digestImageAnswer(
        {
          serverId: 'guild',
          userId: 'member',
          caseId: 'case',
          ...reference,
        },
        'AB2CDE',
        key
      )
    ),
    key_version: imageAnswerKeyVersion(key),
    created_at: fixture.challenge.created_at,
  }));
  fixture.dependencies.completion.beginAttempt = jest.fn(async () => ({
    state: 'ready' as const,
    attemptId: 'attempt',
  }));
  return {
    ...fixture,
    submit: () =>
      fixture.service.submit(context, {
        ...reference,
        interactionId: context.requestId,
        answer: 'WR2NG3',
      }),
  };
}

describe('image CAPTCHA submission feedback', () => {
  it.each([
    { before: 10, after: 5, remaining: 2 },
    { before: 5, after: 10, remaining: 7 },
  ])('uses the limit changed from $before to $after during completion', async (limits) => {
    const { dependencies, challenge, submit } = submissionHarness();
    let maxSubmissions = limits.before;
    dependencies.maxSubmissions = async () => maxSubmissions;
    dependencies.completion.completeAttempt = jest.fn(async () => {
      maxSubmissions = limits.after;
      challenge.submission_count = 3;
      return 'invalid';
    });

    expect(await submit()).toEqual({ kind: 'invalid', remainingAttempts: limits.remaining });
  });

  it.each([
    CaptchaChallengeStatus.PASSED,
    CaptchaChallengeStatus.FAILED,
    CaptchaChallengeStatus.EXPIRED,
    CaptchaChallengeStatus.BYPASSED,
    CaptchaChallengeStatus.CANCELLED,
  ])('does not report retryable feedback after the challenge becomes %s', async (status) => {
    const { dependencies, challenge, submit } = submissionHarness();
    dependencies.completion.completeAttempt = jest.fn(async () => {
      challenge.status = status;
      challenge.submission_count = 3;
      return 'invalid';
    });

    expect(await submit()).toEqual({ kind: 'stale' });
  });

  it.each(['missing', 'new_generation'] as const)(
    'returns stale when the completed generation is %s',
    async (change) => {
      const { dependencies, challenge, submit } = submissionHarness();
      dependencies.completion.completeAttempt = jest.fn(async () => {
        if (change === 'missing') dependencies.challenges.findById = jest.fn(async () => null);
        else challenge.generation += 1;
        return 'invalid';
      });

      expect(await submit()).toEqual({ kind: 'stale' });
    }
  );

  it.each(['passed', 'failed', 'stale'] as const)(
    'returns %s without loading remaining-attempt settings',
    async (completed) => {
      const { dependencies, submit } = submissionHarness();
      dependencies.maxSubmissions = async () => {
        throw new Error('settings unavailable');
      };
      dependencies.completion.completeAttempt = jest.fn(async () => completed);

      expect(await submit()).toEqual({ kind: completed });
    }
  );
});

describe('native image application boundary', () => {
  it.each([undefined, Buffer.alloc(31, 3).toString('base64'), 'private-invalid-key'])(
    'rejects unavailable secret without logging it',
    async (secret) => {
      const logs = [
        jest.spyOn(console, 'log'),
        jest.spyOn(console, 'warn'),
        jest.spyOn(console, 'error'),
      ];
      const { service } = harness(secret);
      expect(await service.open(context, reference)).toEqual({ kind: 'unavailable' });
      expect(
        await service.submit(context, {
          ...reference,
          interactionId: context.requestId,
          answer: 'AB2CDE',
        })
      ).toEqual({ kind: 'unavailable' });
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    }
  );
  it('returns unavailable on renderer failure without accepting an answer', async () => {
    const { service } = harness(Buffer.alloc(32, 7).toString('base64'));
    expect(await service.open(context, reference)).toEqual({ kind: 'unavailable' });
  });
  it('uses ActionResult wrappers for authenticated members without moderator authority', async () => {
    const { service } = harness(undefined);
    const actions = createBotCaptchaImageActions(service);
    expect(await actions.open(context, reference)).toEqual({
      kind: 'outcome',
      outcome: { kind: 'unavailable' },
    });
    expect(
      await actions.submit(context, {
        ...reference,
        interactionId: context.requestId,
        answer: 'AB2CDE',
      })
    ).toEqual({ kind: 'outcome', outcome: { kind: 'unavailable' } });
    const system: ActionContext = {
      ...context,
      actor: { kind: 'system', purpose: 'captcha_pass' },
    };
    expect(await actions.open(system, reference)).toEqual({
      kind: 'denied',
      code: 'permission_denied',
    });
    expect(
      await actions.submit(system, {
        ...reference,
        interactionId: context.requestId,
        answer: 'AB2CDE',
      })
    ).toEqual({ kind: 'denied', code: 'permission_denied' });
  });
  it('queues assistance without requiring rendering or an answer secret', async () => {
    const { service, dependencies } = harness(undefined);
    Object.assign(dependencies.challenges, { requestImageAssistance: jest.fn(async () => true) });
    const actions = createBotCaptchaImageActions(service);
    expect(await actions.requestAssistance(context, reference)).toEqual({
      kind: 'outcome',
      outcome: { kind: 'queued' },
    });
    expect(dependencies.renderer.render).not.toHaveBeenCalled();
    expect(dependencies.completion.beginAttempt).not.toHaveBeenCalled();
  });
  it('denies assistance from other actors or guilds without queuing it', async () => {
    const { service, dependencies } = harness(undefined);
    const enqueue = jest.fn(async () => true);
    Object.assign(dependencies.challenges, { requestImageAssistance: enqueue });
    for (const ctx of [
      { ...context, guildId: 'other' },
      { ...context, actor: { kind: 'user' as const, userId: 'other' } },
    ]) {
      expect(await service.requestAssistance(ctx, reference)).toEqual({ kind: 'denied' });
    }
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('keeps an uncomposed service unavailable', async () => {
    const actions = createBotCaptchaImageActions(null);
    expect(await actions.open(context, reference)).toEqual({
      kind: 'outcome',
      outcome: { kind: 'unavailable' },
    });
    expect(
      await actions.submit(context, {
        ...reference,
        interactionId: context.requestId,
        answer: 'AB2CDE',
      })
    ).toEqual({ kind: 'outcome', outcome: { kind: 'unavailable' } });
  });
});
