import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  createCaptchaCompletionStore,
  persistSetupChange,
  type DelegationDatabase,
} from '../../../packages/application/src/postgres';
import type {
  ActionContext,
  CaptchaBoundAttemptInput,
  CaptchaCompletionInput,
} from '../../../packages/application/src';
import { CaptchaChallengeRepository } from '../../repositories/CaptchaChallengeRepository';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import {
  CaptchaProvider,
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
  DetectionType,
  VerificationStatus,
} from '../../repositories/types';
import { getPrismaClient } from '../testDb';
import { ownedTestDatabase } from '../../../scripts/owned-test-database.js';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
describeIntegration('CaptchaMethodConfiguration (integration)', () => {
  let pool: Pool;
  let database: DelegationDatabase;
  const statements: string[] = [];
  let observeQuery = (text: string): void => {
    statements.push(text);
  };
  let store: ReturnType<typeof createCaptchaCompletionStore>;
  beforeAll(() => {
    pool = new Pool({ connectionString: ownedTestDatabase() });
    database = {
      async query(text, values) {
        return pool.query(text, values ? [...values] : undefined);
      },
      async transaction(operation) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query("set local lock_timeout = '3s'");
          const result = await operation({
            async query(text, values) {
              observeQuery(text);
              return client.query(text, values ? [...values] : undefined);
            },
          });
          await client.query('commit');
          return result;
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
      },
    };
    store = createCaptchaCompletionStore(database);
  });
  afterAll(async () => {
    await pool.end();
  });
  async function fixture(provider: 'turnstile' | 'discord_image' = 'discord_image') {
    const prisma = getPrismaClient();
    const guildId = `guild-${randomUUID()}`;
    const userId = `user-${randomUUID()}`;
    const servers = new ServerRepository(prisma);
    await servers.getOrCreateServer(guildId);
    await prisma.servers.update({
      where: { guild_id: guildId },
      data: {
        settings: {
          captcha_mode: 'manual',
          captcha_method: provider,
          captcha_method_revision: 0,
          unrelated: 'kept',
        },
      },
    });
    await new UserRepository(prisma).getOrCreateUser(userId, 'captcha-target');
    const detection = await new DetectionEventsRepository(prisma).create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.NEW_ACCOUNT,
      confidence: 0.9,
      reasons: ['New account'],
      detected_at: new Date(),
    });
    const verification = await new VerificationEventRepository(prisma).createFromDetection(
      detection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const challenge = await new CaptchaChallengeRepository(prisma).create({
      verificationEventId: verification.id,
      serverId: guildId,
      userId,
      provider:
        provider === 'discord_image' ? CaptchaProvider.DISCORD_IMAGE : CaptchaProvider.TURNSTILE,
      methodRevision: 0,
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: verification.case_revision,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: 'moderator',
    });
    if (provider === 'discord_image') {
      await new CaptchaChallengeRepository(prisma).storeImageMaterial({
        challengeId: challenge.id,
        generation: 1,
        verificationEventId: challenge.verification_event_id,
        serverId: guildId,
        userId: userId,
        caseRevision: challenge.case_revision_at_issue,
        methodRevision: 0,
        png: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]),
        answerDigest: Buffer.alloc(32),
        keyVersion: 'v1',
      });
    }
    const context: ActionContext = {
      guildId,
      requestId: randomUUID(),
      source: 'captcha',
      actor: { kind: 'user', userId },
    };
    const input: CaptchaBoundAttemptInput = {
      challengeId: challenge.id,
      generation: 1,
      idempotencyKey: `discord-image:${randomUUID()}`,
      provider,
    };
    return { prisma, guildId, userId, challenge, context, input };
  }
  async function start(
    f: Awaited<ReturnType<typeof fixture>>,
    state: 'passed' | 'invalid' | 'provider_error' = 'passed'
  ): Promise<CaptchaCompletionInput> {
    const result = await store.beginAttempt(f.context, {
      ...f.input,
      idempotencyKey: `discord-image:${randomUUID()}`,
    });
    expect(result.state).toBe('ready');
    if (!result.attemptId) throw new Error('Attempt was not created');
    return {
      challengeId: f.challenge.id,
      generation: 1,
      provider: f.input.provider,
      attemptId: result.attemptId,
      validation: {
        state,
        success: state === 'provider_error' ? null : state === 'passed',
        action: null,
        hostname: null,
        errorCodes: [],
      },
    };
  }

  async function save(f: Awaited<ReturnType<typeof fixture>>, settings: Record<string, unknown>) {
    return database.transaction((client) => persistSetupChange(client, f.guildId, { settings }));
  }
  it('changes methods once, cancels pending checks and deletes material atomically without replacements', async () => {
    const f = await fixture();
    const saved = await save(f, { captcha_method: 'turnstile' });
    expect(saved?.settings).toMatchObject({
      captcha_method: 'turnstile',
      captcha_method_revision: 1,
      unrelated: 'kept',
    });
    expect(
      await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } })
    ).toMatchObject({ status: 'cancelled', generation: 1 });
    expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
    expect(await f.prisma.captcha_challenges.count({ where: { server_id: f.guildId } })).toBe(1);
    expect(await new CaptchaChallengeRepository(f.prisma).findById(f.challenge.id)).toMatchObject({
      history: [{ outcome: 'cancelled' }],
    });
  });
  it('resaving the same method preserves revision and pending checks', async () => {
    const f = await fixture();
    expect(
      (await save(f, { captcha_method: 'discord_image' }))?.settings.captcha_method_revision
    ).toBe(0);
    expect(
      (await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } }))
        .status
    ).toBe('pending');
  });
  it('reads stored revisions beyond one and cannot revive a revision-zero pass', async () => {
    const f = await fixture('turnstile');
    const attempt = await start(f);
    expect(
      (await save(f, { captcha_method: 'discord_image' }))?.settings.captcha_method_revision
    ).toBe(1);
    expect((await save(f, { captcha_method: 'turnstile' }))?.settings.captcha_method_revision).toBe(
      2
    );
    expect(await store.completeAttempt(f.context, attempt)).toBe('stale');
    expect(
      await f.prisma.moderation_action_requests.count({ where: { server_id: f.guildId } })
    ).toBe(0);
  });
  it('rolls cancellation and private material deletion back together', async () => {
    const f = await fixture();
    expect(await f.prisma.captcha_challenge_images.count()).toBe(1);
    await expect(
      database.transaction(async (client) => {
        await persistSetupChange(client, f.guildId, { settings: { captcha_method: 'none' } });
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(await f.prisma.captcha_challenge_images.count()).toBe(1);
    expect(
      (await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } }))
        .status
    ).toBe('pending');
    expect(
      (await f.prisma.servers.findUniqueOrThrow({ where: { guild_id: f.guildId } })).settings
    ).toMatchObject({ captcha_method_revision: 0 });
  });
  it('serializes a completion behind a method change and preserves parallel unrelated writes', async () => {
    const f = await fixture();
    const attempt = await start(f);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select guild_id from servers where guild_id=$1 for update', [f.guildId]);
      const completion = store.completeAttempt(f.context, attempt);
      await persistSetupChange(client, f.guildId, { settings: { captcha_method: 'turnstile' } });
      await client.query('commit');
      expect(await completion).toBe('stale');
    } finally {
      client.release();
    }
    await Promise.all([
      save(f, { captcha_method: 'discord_image' }),
      new ServerRepository(f.prisma).updateSettings(f.guildId, { min_confidence_threshold: 80 }),
    ]);
    expect(
      (await f.prisma.servers.findUniqueOrThrow({ where: { guild_id: f.guildId } })).settings
    ).toMatchObject({
      captcha_method_revision: 2,
      unrelated: 'kept',
      min_confidence_threshold: 80,
    });
  });
  it('materializes legacy mode edits from the locked merged row and preserves explicit choices', async () => {
    const f = await fixture();
    await f.prisma.servers.update({
      where: { guild_id: f.guildId },
      data: { settings: { captcha_mode: 'off' } },
    });
    expect((await save(f, { captcha_mode: 'manual' }))?.settings).toMatchObject({
      captcha_method: 'turnstile',
      captcha_method_revision: 1,
    });
    await save(f, { captcha_method: 'discord_image' });
    expect((await save(f, { captcha_mode: 'off' }))?.settings).toMatchObject({
      captcha_method: 'discord_image',
      captcha_method_revision: 2,
    });
  });
  it('rejects unavailable readiness against the locked merged method without cancelling', async () => {
    const f = await fixture();
    await expect(
      database.transaction((client) =>
        persistSetupChange(client, f.guildId, {
          settings: { captcha_mode: 'suspicious_join' },
          captchaReadiness: { discord_image: false, turnstile: true },
        })
      )
    ).rejects.toMatchObject({ code: 'policy_disabled' });
    expect(
      (await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } }))
        .status
    ).toBe('pending');
    expect(
      (await f.prisma.servers.findUniqueOrThrow({ where: { guild_id: f.guildId } })).settings
    ).toMatchObject({ captcha_mode: 'manual', captcha_method_revision: 0 });
  });
  it.each(['method', 'revision'] as const)(
    'sweep cleans pending material after an out-of-band %s mismatch',
    async (change) => {
      const f = await fixture();
      const settings =
        change === 'method' ? { captcha_method: 'turnstile' } : { captcha_method_revision: 1 };
      await pool.query('update servers set settings=settings||$2::jsonb where guild_id=$1', [
        f.guildId,
        JSON.stringify(settings),
      ]);
      const cancelled = await new CaptchaChallengeRepository(
        f.prisma
      ).cancelPendingForDisabledServers(10);
      expect(cancelled.map((row) => row.id)).toEqual([f.challenge.id]);
      expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
    }
  );

  it('resaving the same method with already-off issuance does not cancel pending rows', async () => {
    const f = await fixture();
    await pool.query(
      'update servers set settings=settings||\'{"captcha_mode":"off"}\'::jsonb where guild_id=$1',
      [f.guildId]
    );
    await save(f, { captcha_method: 'discord_image' });
    expect(
      (await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } }))
        .status
    ).toBe('pending');
  });
  it('a retry blocked behind a method change cannot create a replacement generation', async () => {
    const f = await fixture();
    const repository = new CaptchaChallengeRepository(f.prisma);
    await repository.recordDeliveryFailure(f.challenge.id, 1, 'delivery_failed');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select guild_id from servers where guild_id=$1 for update', [f.guildId]);
      const retry = repository.retry({
        expectedChallengeId: f.challenge.id,
        expectedGeneration: 1,
        verificationEventId: f.challenge.verification_event_id,
        serverId: f.guildId,
        userId: f.userId,
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
        passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
        provider: CaptchaProvider.DISCORD_IMAGE,
        methodRevision: 0,
        caseRevision: f.challenge.case_revision_at_issue,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
        requestedBy: 'moderator',
      });
      const rejected = retry.then(
        () => false,
        () => true
      );
      await persistSetupChange(client, f.guildId, { settings: { captcha_method: 'none' } });
      await client.query('commit');
      expect(await rejected).toBe(true);
      expect((await repository.findById(f.challenge.id))?.generation).toBe(1);
      expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('expiry and method changes converge on a terminal generation without replacements', async () => {
    const f = await fixture();
    await f.prisma.captcha_challenges.update({
      where: { id: f.challenge.id },
      data: { expires_at: new Date(0) },
    });
    await Promise.all([
      new CaptchaChallengeRepository(f.prisma).expirePending(new Date(), 10),
      save(f, { captcha_method: 'none' }),
    ]);
    expect(['cancelled', 'expired']).toContain(
      (await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } }))
        .status
    );
    expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
    expect(await f.prisma.captcha_challenges.count({ where: { server_id: f.guildId } })).toBe(1);
  });
  it('direct repository method writes require readiness before changing settings or pending material', async () => {
    const f = await fixture();
    const repository = new ServerRepository(f.prisma);
    const before = await f.prisma.servers.findUniqueOrThrow({ where: { guild_id: f.guildId } });
    const image = await f.prisma.captcha_challenge_images.findFirstOrThrow({
      where: { captcha_challenge_id: f.challenge.id },
    });
    await expect(
      repository.updateSettings(f.guildId, { captcha_method: 'turnstile' })
    ).rejects.toMatchObject({ code: 'policy_disabled' });
    expect(
      (await f.prisma.servers.findUniqueOrThrow({ where: { guild_id: f.guildId } })).settings
    ).toEqual(before.settings);
    expect(
      (await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } }))
        .status
    ).toBe('pending');
    expect(
      await f.prisma.captcha_challenge_images.findFirstOrThrow({
        where: { captcha_challenge_id: f.challenge.id },
      })
    ).toEqual(image);
  });

  it.each([
    { captcha_method: 'turnstile' as const },
    { captcha_method: 'discord_image' as const },
    { captcha_mode: 'suspicious_join' as const },
  ])(
    'direct repository rejects unavailable readiness for %j without modifying stored state',
    async (settings) => {
      const f = await fixture();
      const before = await f.prisma.servers.findUniqueOrThrow({ where: { guild_id: f.guildId } });
      const image = await f.prisma.captcha_challenge_images.findFirstOrThrow({
        where: { captcha_challenge_id: f.challenge.id },
      });
      await expect(
        new ServerRepository(f.prisma).updateSettings(f.guildId, settings, {
          turnstile: false,
          discord_image: false,
        })
      ).rejects.toMatchObject({ code: 'policy_disabled' });
      expect(await f.prisma.servers.findUniqueOrThrow({ where: { guild_id: f.guildId } })).toEqual(
        before
      );
      expect(
        (await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } }))
          .status
      ).toBe('pending');
      expect(
        await f.prisma.captcha_challenge_images.findFirstOrThrow({
          where: { captcha_challenge_id: f.challenge.id },
        })
      ).toEqual(image);
    }
  );
  it('direct repository saves a ready method and cancels material atomically', async () => {
    const f = await fixture();
    const saved = await new ServerRepository(f.prisma).updateSettings(
      f.guildId,
      { captcha_method: 'turnstile' },
      { turnstile: true, discord_image: false }
    );
    expect(saved?.settings).toMatchObject({
      captcha_method: 'turnstile',
      captcha_method_revision: 1,
      unrelated: 'kept',
    });
    expect(
      (await f.prisma.captcha_challenges.findUniqueOrThrow({ where: { id: f.challenge.id } }))
        .status
    ).toBe('cancelled');
    expect(await f.prisma.captcha_challenge_images.count()).toBe(0);
  });
  it('direct repository saves None with an explicit unavailable readiness snapshot and no secrets', async () => {
    const f = await fixture();
    const saved = await new ServerRepository(f.prisma).updateSettings(
      f.guildId,
      { captcha_method: 'none' },
      { turnstile: false, discord_image: false }
    );
    expect(saved?.settings).toMatchObject({ captcha_method: 'none', captcha_method_revision: 1 });
  });
});
