import { ownedTestDatabase } from '../../../scripts/owned-test-database.js';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAttentionActions } from '@drasil/application';
import { PostgresQueueAttentionRepository } from './application/adapters/attention';
import { createModerationWorkspaceDataAdapter } from './moderationWorkspaceDataAdapter';
import { getPostgresPool } from './setupDataAdapter';

vi.stubEnv('DRASIL_WEB_DATABASE_URL', ownedTestDatabase());
const pool = getPostgresPool();
const repository = new PostgresQueueAttentionRepository();
let guildId: string, userId: string, intakeId: string, itemId: string;
const authority = {
  loadFresh: async (guildId: string, userId: string) => ({
    guildId,
    userId,
    present: true,
    owner: true,
    permissions: '8',
    roleIds: [],
  }),
};
const context = () => ({
  guildId,
  requestId: 'cleanup',
  source: 'web',
  actor: { kind: 'user' as const, userId: 'staff' },
});
beforeEach(async () => {
  guildId = `cleanup-${randomUUID()}`;
  userId = `reporter-${randomUUID()}`;
  intakeId = randomUUID();
  itemId = randomUUID();
  await pool.query('insert into servers(guild_id) values($1)', [guildId]);
  await pool.query("insert into users(discord_id,username) values($1,'Synthetic')", [userId]);
  await pool.query(
    "insert into report_intakes(id,server_id,reporter_id,thread_id,status,metadata) values($1,$2,$3,'thread','needs_admin_confirmation',$4)",
    [
      intakeId,
      guildId,
      userId,
      {
        analysis: {
          handoff: {
            state: 'delivered',
            reason: 'no_match',
            attempts: 1,
            nextDueAt: null,
            receipt: 'sent',
            channelId: 'old-channel',
            messageId: 'old-message',
          },
        },
      },
    ]
  );
  await pool.query(
    "insert into moderation_queue_items(id,server_id,user_id,item_type,report_intake_id,source_thread_id,queue_channel_id,queue_message_id) values($1,$2,$3,'report_thread_attention',$4,'thread','old-channel','old-message')",
    [itemId, guildId, userId, intakeId]
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await pool.query('delete from servers where guild_id=$1', [guildId]);
  await pool.query('delete from users where discord_id=$1', [userId]);
});
afterAll(async () => {
  await pool.end();
  vi.unstubAllEnvs();
});

it('reclassifies a promotion after the first web read and keeps the identity review open', async () => {
  const read = repository.findById.bind(repository);
  vi.spyOn(repository, 'findById').mockImplementationOnce(async (id) => {
    const snapshot = await read(id);
    await pool.query('update moderation_queue_items set metadata=$2 where id=$1', [
      id,
      { identity_review: { revision: 1 } },
    ]);
    return snapshot;
  });
  const deleteQueueMessage = vi.fn();
  const actions = createAttentionActions({
    repository,
    authority,
    messageDeleter: { deleteQueueMessage },
  });
  expect(await actions.acknowledge(context(), { itemId })).toMatchObject({
    outcome: { status: 'acknowledged' },
  });
  expect(await repository.findById(itemId)).toMatchObject({ attention_cleanup_pending: false });
  expect(
    (
      await pool.query('select status,closed_at,metadata from report_intakes where id=$1', [
        intakeId,
      ])
    ).rows[0]
  ).toMatchObject({
    status: 'needs_admin_confirmation',
    closed_at: null,
    metadata: { analysis: { handoff: { state: 'acknowledged', acknowledgedBy: 'staff' } } },
  });
  expect(deleteQueueMessage).not.toHaveBeenCalled();
});

it.each(['discord failure', 'database completion failure'])(
  'retains retriable web cleanup after %s without blocking a new live generation',
  async (failure) => {
    const deleteQueueMessage = vi.fn().mockResolvedValue(undefined);
    if (failure === 'discord failure')
      deleteQueueMessage.mockRejectedValueOnce(new Error('cleanup unavailable'));
    else
      vi.spyOn(repository, 'completeOrdinaryAcknowledgement').mockRejectedValueOnce(
        new Error('cleanup unavailable')
      );
    const actions = createAttentionActions({
      repository,
      authority,
      messageDeleter: { deleteQueueMessage },
    });
    await expect(actions.acknowledge(context(), { itemId })).rejects.toThrow('cleanup unavailable');
    expect(await repository.findById(itemId)).toMatchObject({
      attention_cleanup_pending: true,
      queue_channel_id: 'old-channel',
      queue_message_id: 'old-message',
    });
    const liveId = randomUUID();
    await pool.query(
      "insert into moderation_queue_items(id,server_id,user_id,item_type,report_intake_id,source_thread_id,queue_channel_id,queue_message_id,metadata) values($1,$2,$3,'report_thread_attention',$4,'thread','fallback','live-message',$5)",
      [liveId, guildId, userId, intakeId, { identity_review: { revision: 1 } }]
    );
    // The report shortcut must choose live identity review even if cleanup was updated last.
    await pool.query(
      "update moderation_queue_items set updated_at=now()+interval '1 minute' where id=$1",
      [itemId]
    );
    const workspace = createModerationWorkspaceDataAdapter({
      guildId,
      userId,
      present: true,
      owner: true,
      permissions: '8',
      roleIds: [],
    });
    expect(
      await workspace.getInboxItemDetail({ guildId, itemId: `report:${intakeId}` })
    ).toMatchObject({ item: { queueItemId: liveId } });
    expect(
      await workspace.getInboxItemDetail({ guildId, itemId: `queue:${itemId}` })
    ).toMatchObject({
      item: { queueItemId: itemId, sourceMetadata: { sourceThreadId: 'thread' } },
    });
    expect(await actions.acknowledge(context(), { itemId })).toMatchObject({
      outcome: { status: 'acknowledged' },
    });
    expect(await repository.findById(itemId)).toBeNull();
    expect(await repository.findById(liveId)).toMatchObject({
      attention_cleanup_pending: false,
      queue_message_id: 'live-message',
    });
    expect(deleteQueueMessage.mock.calls.map(([item]) => item.queue_message_id)).toEqual([
      'old-message',
      'old-message',
    ]);
  }
);
