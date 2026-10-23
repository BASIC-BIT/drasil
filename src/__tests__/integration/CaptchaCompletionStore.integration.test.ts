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
describeIntegration('CaptchaCompletionStore (integration)', () => {
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
        settings: { captcha_mode: 'manual', captcha_method: provider, captcha_method_revision: 0 },
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
    const imageIssuance = {
      keyVersion: 'a'.repeat(64),
      answerDigest: Buffer.alloc(32, 7).toString('hex'),
    };
    if (provider === 'discord_image')
      await prisma.captcha_challenge_images.create({
        data: {
          captcha_challenge_id: challenge.id,
          generation: 1,
          png: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]),
          answer_digest: Buffer.alloc(32, 7),
          key_version: imageIssuance.keyVersion,
        },
      });
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
    return { prisma, guildId, userId, challenge, context, input, imageIssuance };
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
      ...(f.input.provider === 'discord_image'
        ? { provider: 'discord_image', imageIssuance: f.imageIssuance }
        : { provider: 'turnstile' }),
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
  it.each(['turnstile', 'discord_image'] as const)(
    'queues one existing pass receipt for simultaneous %s passes and duplicate deliveries',
    async (provider) => {
      const f = await fixture(provider);
      const first = await start(f);
      const second = await start(f);
      const outcomes = await Promise.all([
        store.completeAttempt(f.context, first),
        store.completeAttempt(f.context, second),
      ]);
      expect([...outcomes].sort()).toEqual(['passed', 'stale']);
      const winner = outcomes[0] === 'passed' ? first : second;
      expect(await store.completeAttempt(f.context, winner)).toBe('passed');
      const receipts = await f.prisma.moderation_action_requests.findMany({
        where: { server_id: f.guildId, action_type: 'apply_captcha_pass' },
      });
      expect(receipts).toHaveLength(1);
      expect(receipts[0].idempotency_key).toBe(`captcha:apply:${f.challenge.id}:1`);
      expect(
        await f.prisma.verification_events.findUnique({
          where: { id: f.challenge.verification_event_id },
        })
      ).toMatchObject({ status: 'pending' });
    }
  );
  it('serializes duplicate starts and returns only the exactly bound attempt', async () => {
    const f = await fixture();
    const results = await Promise.all([
      store.beginAttempt(f.context, f.input),
      store.beginAttempt(f.context, f.input),
    ]);
    expect(results.map((result) => result.state).sort()).toEqual(['duplicate', 'ready']);
    expect(results[0].attemptId).toBe(results[1].attemptId);
    expect(
      await f.prisma.captcha_challenge_attempts.count({
        where: { captcha_challenge_id: f.challenge.id },
      })
    ).toBe(1);
  });
  it.each(['user', 'service', 'generation', 'abandoned'] as const)(
    'enforces persisted %s attempt accounting across challenge rows',
    async (budget) => {
      const f = await fixture();
      const other = await fixture();
      const challengeId =
        budget === 'generation' || budget === 'abandoned' ? f.challenge.id : other.challenge.id;
      const count = budget === 'user' ? 10 : 100;
      await f.prisma.captcha_challenge_attempts.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          captcha_challenge_id: challengeId,
          generation: 1,
          submission_number: index + 1,
          consumes_submission: false,
          idempotency_key: randomUUID(),
          validation_state: budget === 'user' ? 'provider_error' : 'started',
          discord_user_id: budget === 'user' ? f.userId : other.userId,
          created_at: new Date(Date.now() - (budget === 'abandoned' ? 61_000 : 0)),
        })),
      });
      expect((await store.beginAttempt(f.context, f.input)).state).toBe(
        budget === 'abandoned' ? 'ready' : budget === 'generation' ? 'stale' : 'rate_limited'
      );
      expect(
        await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
      ).toMatchObject({
        submission_count: 0,
        status: budget === 'generation' ? 'failed' : 'pending',
      });
      if (budget === 'abandoned')
        expect(
          await f.prisma.captcha_challenge_attempts.count({
            where: {
              captcha_challenge_id: f.challenge.id,
              validation_state: 'provider_error',
              consumes_submission: false,
            },
          })
        ).toBe(100);
    }
  );
  it('fails on the fifth invalid answer and leaves provider errors uncounted', async () => {
    const f = await fixture();
    expect(await store.completeAttempt(f.context, await start(f, 'provider_error'))).toBe(
      'provider_error'
    );
    for (let index = 0; index < 5; index++)
      expect(await store.completeAttempt(f.context, await start(f, 'invalid'))).toBe(
        index === 4 ? 'failed' : 'invalid'
      );
    expect(
      await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
    ).toMatchObject({ status: 'failed', submission_count: 5 });
    expect(
      await f.prisma.captcha_challenge_attempts.count({
        where: { captcha_challenge_id: f.challenge.id, consumes_submission: true },
      })
    ).toBe(5);
  });
  it('rejects wrong actor, server, provider and generation without exposing another result', async () => {
    const f = await fixture();
    const completion = await start(f);
    for (const context of [
      { ...f.context, guildId: 'wrong-server' },
      { ...f.context, actor: { kind: 'user' as const, userId: 'wrong-user' } },
    ]) {
      expect(await store.completeAttempt(context, completion)).toBe('stale');
      expect((await store.beginAttempt(context, f.input)).state).toBe('identity_mismatch');
    }
    expect(await store.completeAttempt(f.context, { ...completion, provider: 'turnstile' })).toBe(
      'stale'
    );
    expect(await store.completeAttempt(f.context, { ...completion, generation: 2 })).toBe('stale');
    expect(
      await f.prisma.captcha_challenge_attempts.findUnique({ where: { id: completion.attemptId } })
    ).toMatchObject({ validation_state: 'started', consumes_submission: false });
    expect(await store.completeAttempt(f.context, completion)).toBe('passed');
    expect(await store.completeAttempt({ ...f.context, guildId: 'wrong-server' }, completion)).toBe(
      'stale'
    );
  });
  it('rejects cross-case idempotency reuse without disclosing the first attempt', async () => {
    const first = await fixture();
    const second = await fixture();
    const accepted = await store.beginAttempt(first.context, first.input);
    expect(accepted.state).toBe('ready');
    const result = await store.beginAttempt(second.context, {
      ...second.input,
      idempotencyKey: first.input.idempotencyKey,
    });
    expect(result).toEqual({ state: 'unavailable' });
    expect(
      await second.prisma.captcha_challenge_attempts.count({
        where: { captcha_challenge_id: second.challenge.id },
      })
    ).toBe(0);
  });
  it.each(['expiry', 'generation', 'method', 'revision', 'case-kind', 'case-binding'] as const)(
    'rereads %s after provider work and consumes no submission for stale input',
    async (change) => {
      const f = await fixture();
      const completion = await start(f, 'invalid');
      if (change === 'expiry')
        await f.prisma.captcha_challenges.update({
          where: { id: f.challenge.id },
          data: { expires_at: new Date(Date.now() - 1) },
        });
      if (change === 'generation')
        await f.prisma.captcha_challenges.update({
          where: { id: f.challenge.id },
          data: { generation: 2 },
        });
      if (change === 'method' || change === 'revision')
        await f.prisma.servers.update({
          where: { guild_id: f.guildId },
          data: {
            settings: {
              captcha_mode: 'manual',
              captcha_method: change === 'method' ? 'turnstile' : 'discord_image',
              captcha_method_revision: change === 'revision' ? 1 : 0,
            },
          },
        });
      if (change === 'case-kind')
        await f.prisma.verification_events.update({
          where: { id: f.challenge.verification_event_id },
          data: { case_kind: 'compromised_account' },
        });
      if (change === 'case-binding')
        await new ServerRepository(f.prisma).getOrCreateServer('wrong-server');
      if (change === 'case-binding')
        await f.prisma.verification_events.update({
          where: { id: f.challenge.verification_event_id },
          data: { server_id: 'wrong-server' },
        });
      expect(await store.completeAttempt(f.context, completion)).toBe('stale');
      expect(
        await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
      ).toMatchObject({ submission_count: 0 });
      expect(
        await f.prisma.moderation_action_requests.count({ where: { server_id: f.guildId } })
      ).toBe(0);
    }
  );
  it('records a pass against issued evidence while leaving changed case resolution to the queue fence', async () => {
    const f = await fixture();
    const completion = await start(f);
    await f.prisma.verification_events.update({
      where: { id: f.challenge.verification_event_id },
      data: { case_revision: { increment: 1 } },
    });
    expect(await store.completeAttempt(f.context, completion)).toBe('passed');
    const receipt = await f.prisma.moderation_action_requests.findFirstOrThrow({
      where: { server_id: f.guildId },
    });
    expect(receipt.metadata).toMatchObject({
      expected_case_revision: f.challenge.case_revision_at_issue,
    });
  });
  it('does not disclose an earlier completed generation after replacement', async () => {
    const f = await fixture();
    const completion = await start(f);
    expect(await store.completeAttempt(f.context, completion)).toBe('passed');
    await f.prisma.captcha_challenges.update({
      where: { id: f.challenge.id },
      data: { generation: 2, status: 'pending' },
    });
    expect(await store.completeAttempt(f.context, completion)).toBe('stale');
  });
  async function lowerSubmissionCap(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
    await database.transaction((client) =>
      persistSetupChange(client, f.guildId, { settings: { captcha_max_submissions: 2 } })
    );
  }
  async function useTwoSubmissions(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
    for (let index = 0; index < 2; index++)
      expect(await store.completeAttempt(f.context, await start(f, 'invalid'))).toBe('invalid');
  }
  async function expectOneLimitReceipt(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
    const receipts = await f.prisma.moderation_action_requests.findMany({
      where: { server_id: f.guildId },
    });
    expect(receipts).toEqual([
      expect.objectContaining({
        action_type: 'notify_captcha_attention',
        idempotency_key: `captcha:attention:${f.challenge.id}:1:submission-limit`,
      }),
    ]);
  }
  it.each(['turnstile', 'discord_image'] as const)(
    'fails lowered %s submission caps before accepting new starts exactly once',
    async (provider) => {
      const f = await fixture(provider);
      await useTwoSubmissions(f);
      await lowerSubmissionCap(f);
      const results = await Promise.all([
        store.beginAttempt(f.context, f.input),
        store.beginAttempt(f.context, { ...f.input, idempotencyKey: randomUUID() }),
      ]);
      for (const result of results)
        expect(result).toMatchObject({ state: 'stale', challenge: { status: 'failed' } });
      expect(await store.beginAttempt(f.context, f.input)).toMatchObject({
        state: 'stale',
        challenge: { status: 'failed' },
      });
      expect(
        await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
      ).toMatchObject({ status: 'failed', submission_count: 2 });
      expect(
        await f.prisma.captcha_challenge_attempts.count({
          where: { captcha_challenge_id: f.challenge.id },
        })
      ).toBe(2);
      await expectOneLimitReceipt(f);
    }
  );
  it.each(['turnstile', 'discord_image'] as const)(
    'fails lowered %s submission caps after provider work without accepting or charging competing completions',
    async (provider) => {
      const f = await fixture(provider);
      await useTwoSubmissions(f);
      const first = await start(f);
      const second = await start(f, 'invalid');
      await lowerSubmissionCap(f);
      const outcomes = await Promise.all([
        store.completeAttempt(f.context, first),
        store.completeAttempt(f.context, second),
      ]);
      expect([...outcomes].sort()).toEqual(['failed', 'stale']);
      expect(await store.completeAttempt(f.context, first)).toBe('stale');
      expect(await store.completeAttempt(f.context, second)).toBe('stale');
      expect(
        await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
      ).toMatchObject({ status: 'failed', submission_count: 2, passed_at: null });
      expect(
        await f.prisma.captcha_challenge_attempts.findMany({
          where: { id: { in: [first.attemptId, second.attemptId] } },
        })
      ).toEqual([
        expect.objectContaining({
          validation_state: 'stale',
          consumes_submission: false,
          provider_success: null,
        }),
        expect.objectContaining({
          validation_state: 'stale',
          consumes_submission: false,
          provider_success: null,
        }),
      ]);
      await expectOneLimitReceipt(f);
    }
  );
  it.each(['begin', 'complete'] as const)(
    'rolls back lowered-cap failure and image cleanup when the %s attention receipt fails',
    async (operation) => {
      const f = await fixture();
      await useTwoSubmissions(f);
      const completion = await start(f);
      await lowerSubmissionCap(f);
      const failing = createCaptchaCompletionStore({
        ...database,
        transaction(operation) {
          return database.transaction((client) =>
            operation({
              async query(text, values) {
                if (text.includes('insert into moderation_action_requests'))
                  throw new Error('queue unavailable');
                return client.query(text, values);
              },
            })
          );
        },
      });
      await expect(
        operation === 'begin'
          ? failing.beginAttempt(f.context, f.input)
          : failing.completeAttempt(f.context, completion)
      ).rejects.toThrow('queue unavailable');
      expect(
        await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
      ).toMatchObject({ status: 'pending', submission_count: 2, passed_at: null });
      expect(
        await f.prisma.captcha_challenge_attempts.findUnique({
          where: { id: completion.attemptId },
        })
      ).toMatchObject({
        validation_state: 'started',
        consumes_submission: false,
        provider_success: null,
      });
      expect(
        await f.prisma.captcha_challenge_attempts.count({
          where: { captcha_challenge_id: f.challenge.id },
        })
      ).toBe(3);
      expect(
        await f.prisma.captcha_challenge_images.count({
          where: { captcha_challenge_id: f.challenge.id },
        })
      ).toBe(1);
      expect(
        await f.prisma.moderation_action_requests.count({ where: { server_id: f.guildId } })
      ).toBe(0);
    }
  );
  it.each(['proof', 'expiry', 'revision', 'actor', 'generation'] as const)(
    'keeps exhausted challenges without effects when the %s completion fence fails',
    async (fence) => {
      const f = await fixture();
      await useTwoSubmissions(f);
      const completion = await start(f);
      await lowerSubmissionCap(f);
      if (fence === 'expiry')
        await f.prisma.captcha_challenges.update({
          where: { id: f.challenge.id },
          data: { expires_at: new Date(0) },
        });
      if (fence === 'revision')
        await database.transaction((client) =>
          persistSetupChange(client, f.guildId, { settings: { captcha_method: 'turnstile' } })
        );
      const boundContext: ActionContext =
        fence === 'actor'
          ? { ...f.context, actor: { kind: 'user', userId: 'wrong-user' } }
          : f.context;
      const boundCompletion: CaptchaCompletionInput =
        fence === 'proof'
          ? {
              ...completion,
              provider: 'discord_image',
              imageIssuance: { ...f.imageIssuance, answerDigest: '0'.repeat(64) },
            }
          : { ...completion, generation: fence === 'generation' ? 2 : 1 };
      expect(await store.completeAttempt(boundContext, boundCompletion)).toBe('stale');
      if (fence !== 'proof')
        expect(
          (
            await store.beginAttempt(boundContext, {
              ...f.input,
              generation: boundCompletion.generation,
            })
          ).state
        ).not.toBe('ready');
      expect(
        await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
      ).toMatchObject({
        status: fence === 'revision' ? 'cancelled' : 'pending',
        submission_count: 2,
        passed_at: null,
      });
      expect(
        await f.prisma.moderation_action_requests.count({ where: { server_id: f.guildId } })
      ).toBe(0);
    }
  );
  it('rereads a lowered cap committed while completion waits on the server lock', async () => {
    const f = await fixture();
    await useTwoSubmissions(f);
    const completion = await start(f);
    const blocker = await pool.connect();
    try {
      await blocker.query('begin');
      await blocker.query('select guild_id from servers where guild_id=$1 for update', [f.guildId]);
      let reached: () => void = () => undefined;
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      observeQuery = (sql) => {
        if (sql.includes('from servers') && sql.includes('for update')) reached();
      };
      const pending = store.completeAttempt(f.context, completion);
      await waiting;
      await persistSetupChange(
        { query: (text, values) => blocker.query(text, values ? [...values] : undefined) },
        f.guildId,
        { settings: { captcha_max_submissions: 2 } }
      );
      await blocker.query('commit');
      expect(await pending).toBe('failed');
      expect(
        await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
      ).toMatchObject({ status: 'failed', submission_count: 2 });
      await expectOneLimitReceipt(f);
    } finally {
      observeQuery = (text) => {
        statements.push(text);
      };
      await blocker.query('rollback');
      blocker.release();
    }
  });
  it('rolls back pass acceptance and private material cleanup if queue insertion fails', async () => {
    const f = await fixture();
    const completion = await start(f);
    const failing = createCaptchaCompletionStore({
      ...database,
      transaction(operation) {
        return database.transaction((client) =>
          operation({
            async query(text, values) {
              if (text.includes('insert into moderation_action_requests'))
                throw new Error('queue unavailable');
              return client.query(text, values);
            },
          })
        );
      },
    });
    await expect(failing.completeAttempt(f.context, completion)).rejects.toThrow(
      'queue unavailable'
    );
    expect(
      await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
    ).toMatchObject({ status: 'pending', passed_at: null });
    expect(
      await f.prisma.captcha_challenge_attempts.findUnique({ where: { id: completion.attemptId } })
    ).toMatchObject({ validation_state: 'started', consumes_submission: false });
    expect(
      await f.prisma.captcha_challenge_images.count({
        where: { captcha_challenge_id: f.challenge.id },
      })
    ).toBe(1);
  });
  it('keeps OAuth identity mismatches distinct and uncharged, including duplicate delivery', async () => {
    const f = await fixture();
    const context = { ...f.context, actor: { kind: 'user' as const, userId: 'another-user' } };
    await store.recordIdentityMismatch(context, f.input);
    await store.recordIdentityMismatch(context, f.input);
    expect(
      await f.prisma.captcha_challenge_attempts.findMany({
        where: { captcha_challenge_id: f.challenge.id },
      })
    ).toEqual([
      expect.objectContaining({
        validation_state: 'identity_mismatch',
        consumes_submission: false,
        discord_user_id: 'another-user',
      }),
    ]);
    expect(
      await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
    ).toMatchObject({ submission_count: 0, status: 'pending' });
  });
  it('requeues only a bound passed generation using the original durable receipt', async () => {
    const f = await fixture();
    await store.completeAttempt(f.context, await start(f));
    const context: ActionContext = {
      ...f.context,
      actor: { kind: 'system', purpose: 'captcha_pass' },
    };
    const ref = {
      challengeId: f.challenge.id,
      generation: 1,
      caseId: f.challenge.verification_event_id,
      targetUserId: f.userId,
      expectedCaseRevision: f.challenge.case_revision_at_issue,
    };
    await store.requeuePassEffect(context, ref);
    expect(
      await f.prisma.moderation_action_requests.count({ where: { server_id: f.guildId } })
    ).toBe(1);
    await f.prisma.moderation_action_requests.deleteMany({ where: { server_id: f.guildId } });
    await store.requeuePassEffect(context, { ...ref, generation: 2 });
    await store.requeuePassEffect(f.context, ref);
    expect(
      await f.prisma.moderation_action_requests.count({ where: { server_id: f.guildId } })
    ).toBe(0);
  });
  it.each(['begin', 'identity_mismatch'] as const)(
    'checks wall-clock expiry after the %s user-budget lock wait',
    async (operation) => {
      const f = await fixture();
      const context =
        operation === 'begin'
          ? f.context
          : { ...f.context, actor: { kind: 'user' as const, userId: 'wrong-user' } };
      const actorId = context.actor.kind === 'user' ? context.actor.userId : '';
      const blocker = await pool.connect();
      try {
        await blocker.query('begin');
        await blocker.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [actorId]);
        const expiresAt = new Date(Date.now() + 1_000);
        await f.prisma.captcha_challenges.update({
          where: { id: f.challenge.id },
          data: { expires_at: expiresAt },
        });
        let reached: () => void = () => undefined;
        const waiting = new Promise<void>((resolve) => {
          reached = resolve;
        });
        observeQuery = (sql) => {
          if (sql.includes('pg_advisory_xact_lock')) reached();
        };
        const pending =
          operation === 'begin'
            ? store.beginAttempt(context, f.input)
            : store.recordIdentityMismatch(context, f.input);
        await waiting;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 20))
        );
        await blocker.query('commit');
        const result = await pending;
        if (operation === 'begin')
          expect(result).toMatchObject({ state: 'stale', challenge: { status: 'expired' } });
        expect(
          await f.prisma.captcha_challenge_attempts.count({
            where: { captcha_challenge_id: f.challenge.id },
          })
        ).toBe(0);
      } finally {
        observeQuery = (text) => {
          statements.push(text);
        };
        await blocker.query('rollback');
        blocker.release();
      }
    }
  );
  it('locks cases before setup cancellation mutates their challenges', async () => {
    const f = await fixture();
    statements.length = 0;
    await database.transaction((client) =>
      persistSetupChange(client, f.guildId, { settings: { captcha_mode: 'off' } })
    );
    const caseLock = statements.findIndex(
      (sql) => sql.includes('verification_events') && sql.includes('for update')
    );
    const cancellation = statements.findIndex((sql) => sql.includes('update captcha_challenges'));
    expect(caseLock).toBeGreaterThan(-1);
    expect(caseLock).toBeLessThan(cancellation);
    expect(
      await f.prisma.captcha_challenges.findUnique({ where: { id: f.challenge.id } })
    ).toMatchObject({ status: 'cancelled' });
  });
  it('waits behind a method update and rereads policy without deadlocking', async () => {
    const f = await fixture();
    const completion = await start(f);
    const blocker = await pool.connect();
    try {
      await blocker.query('begin');
      await blocker.query('select guild_id from servers where guild_id=$1 for update', [f.guildId]);
      let reached: () => void = () => undefined;
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      observeQuery = (sql) => {
        if (sql.includes('from servers') && sql.includes('for update')) reached();
      };
      const pending = store.completeAttempt(f.context, completion);
      await waiting;
      await blocker.query(
        'update servers set settings=settings||\'{"captcha_method":"turnstile","captcha_method_revision":1}\'::jsonb where guild_id=$1',
        [f.guildId]
      );
      await blocker.query('select id from verification_events where id=$1::uuid for update', [
        f.challenge.verification_event_id,
      ]);
      await blocker.query('select id from captcha_challenges where id=$1::uuid for update', [
        f.challenge.id,
      ]);
      await blocker.query('commit');
      expect(await pending).toBe('stale');
    } finally {
      observeQuery = (text) => {
        statements.push(text);
      };
      await blocker.query('rollback');
      blocker.release();
    }
  });
});
