import { randomUUID } from 'node:crypto';
import { createCaptchaCompletionStore } from '@drasil/application/postgres';
import type { ActionContext } from '@drasil/application';
import { CaptchaImageService } from '../../services/CaptchaImageService';
import { createBotCaptchaImageActions } from '../../application/adapters/captchaImage';
import { createBotDelegationDatabase } from '../../application/adapters/delegationDatabase';
import { CaptchaChallengeRepository } from '../../repositories/CaptchaChallengeRepository';
import {
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
} from '../../repositories/types';
import { getPrismaClient } from '../testDb';
import { imageAnswerKeyVersion } from '../../services/captcha/imageAnswer';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
const secret = Buffer.alloc(32, 7).toString('base64');
const png = (n: number) =>
  Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40, n)]);

describeIntegration('native CAPTCHA image service', () => {
  async function fixture(provider: 'discord_image' | 'turnstile' = 'discord_image') {
    const prisma = getPrismaClient();
    const serverId = `guild-${randomUUID()}`;
    const userId = `user-${randomUUID()}`;
    await prisma.servers.create({
      data: { guild_id: serverId, settings: { captcha_mode: 'manual', captcha_method: provider } },
    });
    await prisma.users.create({ data: { discord_id: userId } });
    const event = await prisma.verification_events.create({
      data: { server_id: serverId, user_id: userId },
    });
    const repository = new CaptchaChallengeRepository(prisma);
    const challenge = await repository.create({
      serverId,
      userId,
      verificationEventId: event.id,
      provider,
      methodRevision: 0,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: 0,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const completion = createCaptchaCompletionStore(createBotDelegationDatabase(prisma));
    const answers: string[] = [];
    let activeSecret: string | undefined = secret;
    const render = jest.fn(async (answer: string) => {
      answers.push(answer);
      return png(answers.length);
    });
    const dependencies = {
      challenges: repository,
      completion,
      renderer: { render },
      secret: () => activeSecret,
      maxSubmissions: async () => 5,
    };
    const service = new CaptchaImageService(dependencies);
    const reference = { challengeId: challenge.id, generation: 1 };
    const context: ActionContext = {
      guildId: serverId,
      actor: { kind: 'user', userId },
      source: 'discord_interaction',
      requestId: randomUUID(),
    };
    const submit = (answer: string, interactionId = randomUUID()) =>
      service.submit(
        { ...context, requestId: interactionId },
        { ...reference, interactionId, answer }
      );
    return {
      prisma,
      repository,
      challenge,
      completion,
      dependencies,
      service,
      reference,
      context,
      submit,
      answers,
      render,
      rotate: () => {
        activeSecret = Buffer.alloc(32, 8).toString('base64');
      },
      loseKey: () => {
        activeSecret = undefined;
      },
    };
  }
  it('starts a native attempt through the bot database adapter', async () => {
    const f = await fixture();
    await expect(
      f.completion.beginAttempt(f.context, {
        ...f.reference,
        provider: 'discord_image',
        idempotencyKey: 'discord-image:database-check',
      })
    ).resolves.toMatchObject({ state: 'ready' });
  });
  it('selects one persisted issuance across concurrent opens, discards the loser, and survives restart', async () => {
    const f = await fixture();
    const opened = await Promise.all([
      f.service.open(f.context, f.reference),
      f.service.open(f.context, f.reference),
    ]);
    expect(opened[0]).toEqual(opened[1]);
    expect(f.answers).toHaveLength(2);
    const material = await f.prisma.captcha_challenge_images.findFirstOrThrow();
    expect(material.key_version).toBe(imageAnswerKeyVersion(Buffer.from(secret, 'base64')));
    const winnerIndex = Buffer.from(material.png).equals(png(1)) ? 0 : 1;
    const loserIndex = 1 - winnerIndex;
    expect(await f.submit(f.answers[loserIndex])).toEqual({
      kind: 'invalid',
      remainingAttempts: 4,
    });
    const restarted = new CaptchaImageService(f.dependencies);
    expect(await restarted.open(f.context, f.reference)).toEqual(opened[0]);
    expect(f.answers).toHaveLength(2);
    const finalId = randomUUID();
    expect(
      await createBotCaptchaImageActions(restarted).submit(
        { ...f.context, requestId: finalId },
        { ...f.reference, interactionId: finalId, answer: f.answers[winnerIndex].toLowerCase() }
      )
    ).toEqual({ kind: 'outcome', outcome: { kind: 'passed' } });
    expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
    expect(
      await f.prisma.moderation_action_requests.count({
        where: { action_type: 'apply_captcha_pass' },
      })
    ).toBe(1);
    const persisted = JSON.stringify({
      challenges: await f.prisma.captcha_challenges.findMany(),
      attempts: await f.prisma.captcha_challenge_attempts.findMany(),
      receipts: await f.prisma.moderation_action_requests.findMany(),
    });
    for (const answer of f.answers) expect(persisted).not.toContain(answer);
  });
  it('authorizes actor, guild, method and generation before rendering or charging attempts', async () => {
    const f = await fixture();
    for (const context of [
      { ...f.context, guildId: 'other' },
      { ...f.context, actor: { kind: 'user' as const, userId: 'other' } },
    ]) {
      expect(await f.service.open(context, f.reference)).toEqual({ kind: 'denied' });
      expect(
        await f.service.submit(context, {
          ...f.reference,
          interactionId: randomUUID(),
          answer: 'AB2CDE',
        })
      ).toEqual({ kind: 'denied' });
    }
    expect(await f.service.open(f.context, { ...f.reference, generation: 2 })).toEqual({
      kind: 'stale',
    });
    expect(
      await f.service.submit(f.context, {
        ...f.reference,
        generation: 2,
        interactionId: randomUUID(),
        answer: 'AB2CDE',
      })
    ).toEqual({ kind: 'stale' });
    await f.prisma.captcha_challenges.update({
      where: { id: f.challenge.id },
      data: { provider: 'turnstile' },
    });
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'stale' });
    expect(await f.submit('AB2CDE')).toEqual({ kind: 'stale' });
    expect(f.render).not.toHaveBeenCalled();
    expect(await f.prisma.captcha_challenge_attempts.count()).toBe(0);
  });
  it('counts duplicate interaction once and fails at five wrong answers with cleanup', async () => {
    const f = await fixture();
    await f.service.open(f.context, f.reference);
    const interaction = randomUUID();
    expect(await f.submit('!!!!!!', interaction)).toEqual({
      kind: 'invalid',
      remainingAttempts: 4,
    });
    expect(await f.submit('!!!!!!', interaction)).toEqual({
      kind: 'invalid',
      remainingAttempts: 4,
    });
    for (const remaining of [3, 2, 1])
      expect(await f.submit('!!!!!!')).toEqual({ kind: 'invalid', remainingAttempts: remaining });
    expect(await f.submit('!!!!!!')).toEqual({ kind: 'failed' });
    expect(await f.prisma.captcha_challenge_attempts.count()).toBe(5);
    expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
    expect(
      await f.prisma.moderation_action_requests.count({
        where: { action_type: 'notify_captcha_attention' },
      })
    ).toBe(1);
  });
  it('does not charge render, missing secret or persistence failures', async () => {
    const f = await fixture();
    f.loseKey();
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'unavailable' });
    expect(await f.submit('AB2CDE')).toEqual({ kind: 'unavailable' });
    f.rotate();
    f.render.mockRejectedValueOnce(new Error('renderer unavailable'));
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'unavailable' });
    jest
      .spyOn(f.repository, 'storeImageMaterial')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'unavailable' });
    expect(await f.prisma.captcha_challenge_attempts.count()).toBe(0);
  });
  it('invalidates rotated material and blocks generation reuse until moderator reissue', async () => {
    const f = await fixture();
    expect(await f.repository.recordDelivery(f.challenge.id, 1)).toBe(true);
    await f.service.open(f.context, f.reference);
    f.rotate();
    expect(await f.submit(f.answers[0])).toEqual({ kind: 'stale' });
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'stale' });
    expect(
      await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
    ).toMatchObject({
      status: 'pending',
      submission_count: 0,
      delivery_error_code: 'image_key_rotated',
      delivered_at: null,
    });
    expect(await f.repository.findDeliveryFailuresNeedingAttention(10)).toEqual([
      expect.objectContaining({ id: f.challenge.id }),
    ]);
    expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
    expect(await f.prisma.captcha_challenge_attempts.count()).toBe(0);
    expect(f.answers).toHaveLength(1);
    const retried = await f.repository.retry({
      expectedChallengeId: f.challenge.id,
      expectedGeneration: 1,
      verificationEventId: f.challenge.verification_event_id,
      serverId: f.challenge.server_id,
      userId: f.challenge.user_id,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: 0,
      provider: 'discord_image',
      methodRevision: 0,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(retried.generation).toBe(2);
    expect((await f.service.open(f.context, { ...f.reference, generation: 2 })).kind).toBe('ready');
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'stale' });
    expect(f.answers).toHaveLength(2);
  });
  it('preserves key rotation invalidation against late delivery success or failure callbacks', async () => {
    const f = await fixture();
    await f.service.open(f.context, f.reference);
    f.rotate();
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'stale' });
    expect(await f.repository.recordDelivery(f.challenge.id, 1)).toBe(false);
    expect(
      await f.repository.recordDeliveryFailure(f.challenge.id, 1, 'discord_delivery_failed')
    ).toBe(false);
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'stale' });
    expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
  });
  it('keeps the rotation marker under lock while an old render is still in flight', async () => {
    const f = await fixture();
    let releaseRender = () => {};
    let markRendering = () => {};
    const rendering = new Promise<void>((resolve) => {
      markRendering = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    f.render.mockImplementationOnce(async (answer) => {
      f.answers.push(answer);
      markRendering();
      await release;
      return png(8);
    });
    const oldOpen = f.service.open(f.context, f.reference);
    await rendering;
    expect((await f.service.open(f.context, f.reference)).kind).toBe('ready');
    f.rotate();
    expect(await f.service.open(f.context, f.reference)).toEqual({ kind: 'stale' });
    releaseRender();
    expect(await oldOpen).toEqual({ kind: 'stale' });
    expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
    expect(
      await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
    ).toMatchObject({
      status: 'pending',
      submission_count: 0,
      delivery_error_code: 'image_key_rotated',
    });
  });
  it('keeps shared authenticated rate limits distinct from answer exhaustion', async () => {
    const f = await fixture();
    await f.prisma.servers.update({
      where: { guild_id: f.context.guildId },
      data: {
        settings: {
          captcha_method: 'discord_image',
          captcha_mode: 'manual',
          captcha_max_submissions: 20,
        },
      },
    });
    f.dependencies.maxSubmissions = async () => 20;
    await f.service.open(f.context, f.reference);
    for (let i = 0; i < 10; i++)
      expect(await f.submit('!!!!!!')).toEqual({ kind: 'invalid', remainingAttempts: 19 - i });
    expect(await f.submit('!!!!!!')).toEqual({ kind: 'rate_limited' });
    expect(
      await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
    ).toMatchObject({ status: 'pending', submission_count: 10 });
    expect(
      await f.service.submit(f.context, {
        ...f.reference,
        interactionId: 'different',
        answer: 'AB2CDE',
      })
    ).toEqual({ kind: 'denied' });
  });
  it.each([
    ['passed', 'removed'],
    ['invalid', 'removed'],
    ['passed', 'digest'],
    ['invalid', 'digest'],
    ['passed', 'key'],
    ['invalid', 'key'],
  ] as const)(
    'rejects %s validation after %s mutation before final acceptance without charging it',
    async (outcome, mutation) => {
      const f = await fixture();
      await f.service.open(f.context, f.reference);
      const realComplete = f.completion.completeAttempt;
      jest.spyOn(f.completion, 'completeAttempt').mockImplementationOnce(async (context, input) => {
        expect(input.validation.state).toBe(outcome);
        await f.repository.deleteImageMaterial(f.challenge.id, 1);
        if (mutation !== 'removed')
          await f.prisma.captcha_challenge_images.create({
            data: {
              captcha_challenge_id: f.challenge.id,
              generation: 1,
              png: png(9),
              answer_digest:
                mutation === 'digest'
                  ? Buffer.alloc(32, 9)
                  : Buffer.from(
                      input.provider === 'discord_image' ? input.imageIssuance.answerDigest : '',
                      'hex'
                    ),
              key_version: imageAnswerKeyVersion(Buffer.alloc(32, mutation === 'key' ? 8 : 7)),
            },
          });
        return realComplete(context, input);
      });
      expect(await f.submit(outcome === 'passed' ? f.answers[0] : '!!!!!!')).toEqual({
        kind: 'stale',
      });
      expect(
        await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
      ).toMatchObject({ status: 'pending', submission_count: 0 });
      expect(await f.prisma.moderation_action_requests.count()).toBe(0);
      expect(await f.prisma.captcha_challenge_attempts.findFirst()).toMatchObject({
        validation_state: 'stale',
        consumes_submission: false,
      });
    }
  );
  it('accepts exactly one concurrent correct submission and one durable pass receipt', async () => {
    const f = await fixture();
    await f.service.open(f.context, f.reference);
    const outcomes = await Promise.all([f.submit(f.answers[0]), f.submit(f.answers[0])]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(['passed', 'stale']);
    expect(
      await f.prisma.moderation_action_requests.count({
        where: { action_type: 'apply_captcha_pass' },
      })
    ).toBe(1);
  });
});
