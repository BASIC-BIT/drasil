import { ownedTestDatabase } from '../../../scripts/owned-test-database.js';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PostgresSetupDataAdapter, getPostgresPool } from './setupDataAdapter';

vi.stubEnv('DRASIL_WEB_DATABASE_URL', ownedTestDatabase());
const pool = getPostgresPool();
const adapter = new PostgresSetupDataAdapter();
let guildId: string;
let userId: string;
let challengeId: string;
beforeEach(async () => {
  guildId = `setup-test-${randomUUID()}`;
  userId = `setup-user-${randomUUID()}`;
  challengeId = randomUUID();
  const caseId = randomUUID();
  await pool.query('insert into servers(guild_id,settings) values($1,$2)', [
    guildId,
    {
      captcha_method: 'discord_image',
      captcha_mode: 'manual',
      captcha_method_revision: 0,
      unrelated: 'kept',
    },
  ]);
  await pool.query("insert into users(discord_id,username) values($1,'Synthetic')", [userId]);
  await pool.query('insert into verification_events(id,server_id,user_id) values($1,$2,$3)', [
    caseId,
    guildId,
    userId,
  ]);
  await pool.query(
    "insert into captcha_challenges(id,verification_event_id,server_id,user_id,provider,request_source,pass_effect,case_revision_at_issue,link_token_hash,expires_at) values($1,$2,$3,$4,'discord_image','moderator','evidence_only',0,$5,now()+interval '1 hour')",
    [challengeId, caseId, guildId, userId, randomUUID()]
  );
  await pool.query(
    "insert into captcha_challenge_requests(captcha_challenge_id,generation,provider,request_source,pass_effect,case_revision_at_issue) values($1,1,'discord_image','moderator','evidence_only',0)",
    [challengeId]
  );
  await pool.query(
    'insert into captcha_challenge_images(captcha_challenge_id,generation,png,answer_digest,key_version) values($1,1,$2,$3,$4)',
    [
      challengeId,
      Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]),
      Buffer.alloc(32),
      'v1',
    ]
  );
});
afterEach(async () => {
  await pool.query('delete from servers where guild_id=$1', [guildId]);
  await pool.query('delete from users where discord_id=$1', [userId]);
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await pool.end();
});
it('persists method choices and monotonic revisions with atomic cancellation and material removal', async () => {
  expect(
    (await adapter.updateGuildSetup({ guildId, captchaMethod: 'none' })).settings
  ).toMatchObject({ captcha_method: 'none', captcha_method_revision: 1, unrelated: 'kept' });
  expect(
    (await pool.query('select status from captcha_challenges where id=$1', [challengeId])).rows[0]
  ).toEqual({ status: 'cancelled' });
  expect(
    (
      await pool.query('select * from captcha_challenge_images where captcha_challenge_id=$1', [
        challengeId,
      ])
    ).rowCount
  ).toBe(0);
  expect(
    (
      await pool.query(
        'select outcome from captcha_challenge_requests where captcha_challenge_id=$1',
        [challengeId]
      )
    ).rows[0]
  ).toEqual({ outcome: 'cancelled' });
  vi.stubEnv('DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET', Buffer.alloc(32, 7).toString('base64'));
  expect(
    (await adapter.updateGuildSetup({ guildId, captchaMethod: 'discord_image' })).settings
      .captcha_method_revision
  ).toBe(2);
  expect(
    (await adapter.updateGuildSetup({ guildId, captchaMethod: 'discord_image' })).settings
      .captcha_method_revision
  ).toBe(2);
  expect(
    (
      await pool.query('select count(*)::int as count from captcha_challenges where server_id=$1', [
        guildId,
      ])
    ).rows[0]
  ).toEqual({ count: 1 });
});
it('rejects invalid readiness before saving or cancelling', async () => {
  vi.stubEnv('DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET', 'invalid');
  await expect(
    adapter.updateGuildSetup({ guildId, captchaMethod: 'discord_image' })
  ).rejects.toMatchObject({ code: 'policy_disabled' });
  expect((await adapter.getServer(guildId))?.settings).toMatchObject({
    captcha_method_revision: 0,
  });
  expect(
    (await pool.query('select status from captcha_challenges where id=$1', [challengeId])).rows[0]
  ).toEqual({ status: 'pending' });
  expect(
    (
      await pool.query('select * from captcha_challenge_images where captcha_challenge_id=$1', [
        challengeId,
      ])
    ).rowCount
  ).toBe(1);
});
