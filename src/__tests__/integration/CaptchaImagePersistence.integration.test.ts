import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import {
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
} from '../../repositories/types';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { CaptchaChallengeRepository } from '../../repositories/CaptchaChallengeRepository';
import { getPrismaClient } from '../testDb';

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('CAPTCHA image persistence', () => {
  it('migrates a legacy Turnstile challenge and history without changing their state', async () => {
    // Rehearse the exact migration in an isolated schema inside the same owned DB.
    // Transaction rollback removes every fixture object and enum change afterward.
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE SCHEMA captcha_migration_fixture;
        SET LOCAL search_path TO captcha_migration_fixture, public;
        CREATE TYPE captcha_migration_fixture.captcha_provider AS ENUM ('turnstile');
        CREATE TABLE captcha_migration_fixture.captcha_challenges (
          id uuid PRIMARY KEY, provider captcha_migration_fixture.captcha_provider NOT NULL DEFAULT 'turnstile',
          generation integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'pending', submission_count integer NOT NULL DEFAULT 0
        );
        CREATE TABLE captcha_migration_fixture.captcha_challenge_requests (
          captcha_challenge_id uuid NOT NULL, generation integer NOT NULL, outcome text, requested_at timestamptz NOT NULL
        );
        INSERT INTO captcha_challenges (id, status, submission_count)
          VALUES ('00000000-0000-4000-8000-000000000001', 'failed', 5);
        INSERT INTO captcha_challenge_requests VALUES ('00000000-0000-4000-8000-000000000001', 1, 'failed', '2026-10-22T12:00:00Z');
      `);
      const beforeChallenge = (
        await client.query(
          'select id, provider, generation, status, submission_count from captcha_challenges'
        )
      ).rows;
      const beforeHistory = (
        await client.query(
          'select captcha_challenge_id, generation, outcome, requested_at from captcha_challenge_requests'
        )
      ).rows;
      const migration = readFileSync(
        resolve(
          process.cwd(),
          'prisma/migrations/20261023090000_captcha_image_method/migration.sql'
        ),
        'utf8'
      );
      await client.query(migration.split('"public".').join('"captcha_migration_fixture".'));
      expect(
        (
          await client.query(
            'select id, provider, generation, status, submission_count from captcha_challenges'
          )
        ).rows
      ).toEqual(beforeChallenge);
      expect(
        (
          await client.query(
            'select captcha_challenge_id, generation, outcome, requested_at from captcha_challenge_requests'
          )
        ).rows
      ).toEqual(beforeHistory);
      expect(
        (await client.query('select provider, method_revision from captcha_challenges')).rows
      ).toEqual([{ provider: 'turnstile', method_revision: 0 }]);
      expect(
        (await client.query('select provider, method_revision from captcha_challenge_requests'))
          .rows
      ).toEqual([{ provider: 'turnstile', method_revision: 0 }]);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('adds private image storage with RLS and legacy provider/revision defaults', async () => {
    const prisma = getPrismaClient();
    const columns = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; column_default: string }>
    >`
      select table_name, column_name, column_default from information_schema.columns
      where table_name in ('captcha_challenges', 'captcha_challenge_requests')
        and column_name in ('provider', 'method_revision')
      order by table_name, column_name
    `;
    expect(columns).toEqual([
      expect.objectContaining({
        table_name: 'captcha_challenge_requests',
        column_name: 'method_revision',
        column_default: '0',
      }),
      expect.objectContaining({
        table_name: 'captcha_challenge_requests',
        column_name: 'provider',
        column_default: "'turnstile'::captcha_provider",
      }),
      expect.objectContaining({
        table_name: 'captcha_challenges',
        column_name: 'method_revision',
        column_default: '0',
      }),
      expect.objectContaining({
        table_name: 'captcha_challenges',
        column_name: 'provider',
        column_default: "'turnstile'::captcha_provider",
      }),
    ]);
    expect(
      await prisma.$queryRaw`select relrowsecurity from pg_class where oid = 'captcha_challenge_images'::regclass`
    ).toEqual([{ relrowsecurity: true }]);
  });
});

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]);
const digest = Buffer.alloc(32, 7);

describeIntegration('private image generation lifecycle', () => {
  async function fixture() {
    const prisma = getPrismaClient();
    await prisma.servers.create({
      data: {
        guild_id: 'image-guild',
        settings: {
          captcha_mode: 'manual',
          captcha_method: 'discord_image',
          captcha_method_revision: 3,
        },
      },
    });
    await prisma.users.create({ data: { discord_id: 'image-user' } });
    const verification = await prisma.verification_events.create({
      data: { server_id: 'image-guild', user_id: 'image-user' },
    });
    const repository = new CaptchaChallengeRepository(prisma);
    const challenge = await repository.create({
      verificationEventId: verification.id,
      serverId: 'image-guild',
      userId: 'image-user',
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: 0,
      provider: 'discord_image',
      methodRevision: 3,
      tokenHash: 'unused-random-fixture-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const binding = {
      challengeId: challenge.id,
      generation: 1,
      verificationEventId: verification.id,
      serverId: 'image-guild',
      userId: 'image-user',
      caseRevision: 0,
      methodRevision: 3,
    };
    return { prisma, repository, challenge, binding };
  }

  it('round trips a generation and revision while keeping private material out of history', async () => {
    const { repository, challenge, binding } = await fixture();
    await expect(
      repository.storeImageMaterial({ ...binding, png, answerDigest: digest, keyVersion: 'v1' })
    ).resolves.toBe(true);
    expect(await repository.findImageMaterial(binding)).toMatchObject({
      png: new Uint8Array(png),
      answer_digest: new Uint8Array(digest),
      key_version: 'v1',
    });
    const read = await repository.findById(challenge.id);
    expect(read).toMatchObject({
      provider: 'discord_image',
      method_revision: 3,
      history: [{ provider: 'discord_image', method_revision: 3 }],
    });
    expect(JSON.stringify(read)).not.toMatch(/answer_digest|key_version|"png"/);
    await repository.deleteImageMaterial(challenge.id, 2);
    expect(await repository.findImageMaterial(binding)).not.toBeNull();
    await repository.deleteImageMaterial(challenge.id, 1);
    await repository.deleteImageMaterial(challenge.id, 1);
    expect(await repository.findImageMaterial(binding)).toBeNull();
  });

  it.each(['passed', 'failed', 'cancelled', 'bypassed', 'expired'] as const)(
    'atomically erases material on %s',
    async (status) => {
      const { prisma, repository, challenge, binding } = await fixture();
      await repository.storeImageMaterial({
        ...binding,
        png,
        answerDigest: digest,
        keyVersion: 'v1',
      });
      await prisma.captcha_challenges.update({ where: { id: challenge.id }, data: { status } });
      expect(await prisma.captcha_challenge_images.count()).toBe(0);
      await expect(
        repository.storeImageMaterial({ ...binding, png, answerDigest: digest, keyVersion: 'v2' })
      ).resolves.toBe(false);
    }
  );

  it('rolls cleanup back with the lifecycle transaction and deletes on generation replacement', async () => {
    const { prisma, repository, challenge, binding } = await fixture();
    await repository.storeImageMaterial({
      ...binding,
      png,
      answerDigest: digest,
      keyVersion: 'v1',
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.captcha_challenges.update({
          where: { id: challenge.id },
          data: { status: 'passed' },
        });
        expect(await tx.captcha_challenge_images.count()).toBe(0);
        throw new Error('synthetic rollback');
      })
    ).rejects.toThrow('synthetic rollback');
    expect(await repository.findImageMaterial(binding)).not.toBeNull();
    await prisma.captcha_challenges.update({
      where: { id: challenge.id },
      data: { generation: 2 },
    });
    expect(await prisma.captcha_challenge_images.count()).toBe(0);
    expect(
      await repository.storeImageMaterial({
        ...binding,
        png,
        answerDigest: digest,
        keyVersion: 'v1',
      })
    ).toBe(false);
  });

  it('cannot overwrite a concurrently stored answer or reinsert after cancellation', async () => {
    const { prisma, repository, challenge, binding } = await fixture();
    const stores = await Promise.all(
      [1, 2].map((value) =>
        repository.storeImageMaterial({
          ...binding,
          png,
          answerDigest: Buffer.alloc(32, value),
          keyVersion: 'v1',
        })
      )
    );
    expect(stores.sort()).toEqual([false, true]);
    expect(await prisma.captcha_challenge_images.count()).toBe(1);
    await Promise.all([
      repository.storeImageMaterial({ ...binding, png, answerDigest: digest, keyVersion: 'v2' }),
      repository.cancelPendingForCase(challenge.verification_event_id),
    ]);
    expect(await prisma.captcha_challenge_images.count()).toBe(0);
    expect(await repository.findImageMaterial(binding)).toBeNull();
  });

  it('rejects mismatched bindings, current settings, provider, and expiry without creating material', async () => {
    const { prisma, repository, challenge, binding } = await fixture();
    for (const change of [
      { userId: 'other' },
      { serverId: 'other' },
      { verificationEventId: '00000000-0000-4000-8000-000000000099' },
      { generation: 2 },
      { caseRevision: 1 },
      { methodRevision: 2 },
    ]) {
      expect(
        await repository.storeImageMaterial({
          ...binding,
          ...change,
          png,
          answerDigest: digest,
          keyVersion: 'v1',
        })
      ).toBe(false);
    }
    await prisma.servers.update({
      where: { guild_id: 'image-guild' },
      data: {
        settings: { captcha_method: 'none', captcha_mode: 'manual', captcha_method_revision: 3 },
      },
    });
    expect(
      await repository.storeImageMaterial({
        ...binding,
        png,
        answerDigest: digest,
        keyVersion: 'v1',
      })
    ).toBe(false);
    await prisma.servers.update({
      where: { guild_id: 'image-guild' },
      data: {
        settings: {
          captcha_method: 'discord_image',
          captcha_mode: 'manual',
          captcha_method_revision: 4,
        },
      },
    });
    expect(
      await repository.storeImageMaterial({
        ...binding,
        png,
        answerDigest: digest,
        keyVersion: 'v1',
      })
    ).toBe(false);
    await prisma.servers.update({
      where: { guild_id: 'image-guild' },
      data: {
        settings: {
          captcha_method: 'discord_image',
          captcha_mode: 'manual',
          captcha_method_revision: 3,
        },
      },
    });
    await prisma.captcha_challenges.update({
      where: { id: challenge.id },
      data: { provider: 'turnstile' },
    });
    expect(
      await repository.storeImageMaterial({
        ...binding,
        png,
        answerDigest: digest,
        keyVersion: 'v1',
      })
    ).toBe(false);
    await prisma.captcha_challenges.update({
      where: { id: challenge.id },
      data: { provider: 'discord_image', expires_at: new Date(0) },
    });
    expect(
      await repository.storeImageMaterial({
        ...binding,
        png,
        answerDigest: digest,
        keyVersion: 'v1',
      })
    ).toBe(false);
    expect(await prisma.captcha_challenge_images.count()).toBe(0);
  });

  it('rechecks expiry after waiting for a lifecycle lock', async () => {
    const { prisma, repository, challenge, binding } = await fixture();
    const expiresAt = new Date(Date.now() + 1000);
    await prisma.captcha_challenges.update({
      where: { id: challenge.id },
      data: { expires_at: expiresAt },
    });
    let releaseLock = () => {};
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let markLocked = () => {};
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select id from captcha_challenges where id = ${challenge.id}::uuid for update`;
      markLocked();
      await release;
    });
    await locked;
    const store = repository.storeImageMaterial({
      ...binding,
      png,
      answerDigest: digest,
      keyVersion: 'v1',
    });
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now()) + 30)
    );
    releaseLock();
    await holder;
    expect(await store).toBe(false);
    expect(await prisma.captcha_challenge_images.count()).toBe(0);
  });

  it('retains the issuance binding when later case evidence advances the current revision', async () => {
    const { prisma, repository, binding } = await fixture();
    await prisma.verification_events.update({
      where: { id: binding.verificationEventId },
      data: { case_revision: { increment: 1 } },
    });
    expect(
      await repository.storeImageMaterial({
        ...binding,
        png,
        answerDigest: digest,
        keyVersion: 'v1',
      })
    ).toBe(true);
    expect(await repository.findImageMaterial(binding)).not.toBeNull();
  });

  it('erases pending material through the existing case-reopen cancellation path', async () => {
    const { prisma, repository, challenge, binding } = await fixture();
    await repository.storeImageMaterial({
      ...binding,
      png,
      answerDigest: digest,
      keyVersion: 'v1',
    });
    await prisma.verification_events.update({
      where: { id: binding.verificationEventId },
      data: { status: 'verified' },
    });
    await new VerificationEventRepository(prisma).reopen(binding.verificationEventId);
    expect(
      await prisma.captcha_challenges.findUnique({ where: { id: challenge.id } })
    ).toMatchObject({ status: 'cancelled' });
    expect(await prisma.captcha_challenge_images.count()).toBe(0);
  });

  it('cleans expired material with a bounded sweep and preserves pending unexpired material', async () => {
    const { prisma, repository, challenge, binding } = await fixture();
    await repository.storeImageMaterial({
      ...binding,
      png,
      answerDigest: digest,
      keyVersion: 'v1',
    });
    expect(await repository.cleanupImageMaterial(new Date(), 1)).toBe(0);
    await prisma.captcha_challenge_images.createMany({
      data: [2, 3].map((generation) => ({
        captcha_challenge_id: challenge.id,
        generation,
        png,
        answer_digest: digest,
        key_version: 'v1',
      })),
    });
    expect(await repository.cleanupImageMaterial(new Date(), 1)).toBe(1);
    expect(await prisma.captcha_challenge_images.count()).toBe(2);
    expect(await repository.findImageMaterial(binding)).not.toBeNull();
    expect(await repository.cleanupImageMaterial(new Date(), 1)).toBe(1);
    expect(await prisma.captcha_challenge_images.count()).toBe(1);
    await prisma.captcha_challenges.update({
      where: { id: challenge.id },
      data: { expires_at: new Date(0) },
    });
    expect(await repository.findImageMaterial(binding)).toBeNull();
    expect(await repository.cleanupImageMaterial(new Date(), 1)).toBe(1);
    expect(await repository.cleanupImageMaterial(new Date(), 1)).toBe(0);
  });

  it('enforces digest, PNG, key, generation and unique-generation constraints', async () => {
    const { prisma, challenge } = await fixture();
    const data = {
      captcha_challenge_id: challenge.id,
      generation: 1,
      png,
      answer_digest: digest,
      key_version: 'v1',
    };
    for (const invalid of [
      { answer_digest: Buffer.alloc(31) },
      { png: Buffer.alloc(40) },
      { png: Buffer.concat([png, Buffer.alloc(262144)]) },
      { key_version: '' },
      { generation: 0 },
    ]) {
      await expect(
        prisma.captcha_challenge_images.create({ data: { ...data, ...invalid } })
      ).rejects.toThrow();
    }
    await prisma.captcha_challenge_images.create({ data });
    await expect(prisma.captcha_challenge_images.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
    await prisma.captcha_challenges.delete({ where: { id: challenge.id } });
    expect(await prisma.captcha_challenge_images.count()).toBe(0);
  });
});
