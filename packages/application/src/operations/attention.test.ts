import {
  createAttentionActions,
  isIdentityReviewItem,
  getAttentionCleanupSource,
  type AttentionActions,
  type QueueAttentionItemRecord,
} from './attention';
import type { ActionContext } from '../context';
import type { AuthorityFacts } from '../authorization';

const context: ActionContext = {
  guildId: 'guild-1',
  requestId: 'direct-1',
  source: 'discord_interaction',
  actor: { kind: 'user', userId: 'moderator-1' },
};
function arrange(): {
  actions: AttentionActions;
  items: Map<string, QueueAttentionItemRecord>;
  deletedItemIds: string[];
  messageIds: string[];
  setFacts(value: AuthorityFacts | null): void;
} {
  const items = new Map<string, QueueAttentionItemRecord>([
    [
      'queue-1',
      {
        id: 'queue-1',
        server_id: 'guild-1',
        item_type: 'support_thread_attention',
        queue_channel_id: 'channel-1',
        queue_message_id: 'message-1',
      },
    ],
    [
      'foreign',
      {
        id: 'foreign',
        server_id: 'other-guild',
        item_type: 'report_thread_attention',
        queue_channel_id: 'channel-2',
        queue_message_id: 'message-2',
      },
    ],
    [
      'mirror',
      {
        id: 'mirror',
        server_id: 'guild-1',
        item_type: 'case_mirror',
        queue_channel_id: null,
        queue_message_id: null,
      },
    ],
  ]);
  let facts: AuthorityFacts | null = {
    userId: 'moderator-1',
    guildId: 'guild-1',
    present: true,
    owner: false,
    permissions: String(1n << 40n),
    roleIds: [],
  };
  const deletedItemIds: string[] = [];
  const messageIds: string[] = [];
  const actions = createAttentionActions({
    authority: { loadFresh: async () => facts },
    repository: {
      acknowledgeIdentityReview: async () => 'acknowledged',
      findById: async (id) => items.get(id) ?? null,
      reserveOrdinaryAcknowledgement: async (id) => {
        const current = items.get(id);
        if (!current || isIdentityReviewItem(current)) return current ?? null;
        const reserved = { ...current, attention_cleanup_pending: true };
        items.set(id, reserved);
        return reserved;
      },
      completeOrdinaryAcknowledgement: async ({ id }) => {
        const item = items.get(id);
        deletedItemIds.push(id);
        items.delete(id);
        return Boolean(item);
      },
    },
    messageDeleter: {
      deleteQueueMessage: async (item) => {
        messageIds.push(item.id);
      },
    },
  });
  return {
    actions,
    items,
    deletedItemIds,
    messageIds,
    setFacts: (value: AuthorityFacts | null): void => {
      facts = value;
    },
  };
}
it('allows_discord_moderator_but_keeps_web_entry_gate', async () => {
  const { actions, items } = arrange();
  const discordResult = await actions.acknowledge(context, { itemId: 'queue-1' });
  expect(discordResult.kind).toBe('outcome');
  expect(discordResult).toEqual({
    kind: 'outcome',
    outcome: {
      actor: { id: 'moderator-1', surface: 'discord_interaction' },
      itemId: 'queue-1',
      status: 'acknowledged',
    },
  });
  expect(items.has('queue-1')).toBe(false);
});
it('denies_revoked_actor_before_deleting_attention', async () => {
  const { actions, setFacts, deletedItemIds, messageIds } = arrange();
  setFacts({
    userId: 'moderator-1',
    guildId: 'guild-1',
    present: true,
    owner: false,
    permissions: '0',
    roleIds: [],
  });
  const revokedResult = await actions.acknowledge(context, { itemId: 'queue-1' });
  const deletedItemIdsAfterDeniedCall = deletedItemIds;
  expect(revokedResult).toEqual({ kind: 'denied', code: 'permission_denied' });
  expect(deletedItemIdsAfterDeniedCall).toEqual([]);
  expect(messageIds).toEqual([]);
});
it('batch_preserves_each_items_binding_and_result', async () => {
  const { actions, items, deletedItemIds } = arrange();
  const result = await actions.acknowledgeBatch(context, {
    itemIds: ['queue-1', 'foreign', 'missing', 'mirror', 'queue-1'],
  });
  expect(result).toEqual(
    [
      'acknowledged',
      'already_handled',
      'already_handled',
      'already_handled',
      'already_handled',
    ].map((status, i) => ({
      kind: 'outcome',
      outcome: {
        actor: { id: 'moderator-1', surface: 'discord_interaction' },
        itemId: ['queue-1', 'foreign', 'missing', 'mirror', 'queue-1'][i],
        status,
      },
    }))
  );
  const foreignGuildItemStillExists = items.has('foreign');
  expect(foreignGuildItemStillExists).toBe(true);
  expect(deletedItemIds).toEqual(['queue-1']);
});
it.each([
  null,
  {
    userId: 'moderator-1',
    guildId: 'guild-1',
    present: false,
    owner: true,
    permissions: '8',
    roleIds: [],
  },
])('denies an unavailable or departed actor', async (facts) => {
  const { actions, setFacts, items } = arrange();
  setFacts(facts);
  expect(await actions.acknowledge(context, { itemId: 'queue-1' })).toEqual({
    kind: 'denied',
    code: 'actor_unavailable',
  });
  expect(items.has('queue-1')).toBe(true);
});
it('rejects system actors and mismatched authority bindings', async () => {
  const { actions, setFacts, deletedItemIds } = arrange();
  expect(
    await actions.acknowledge(
      { ...context, actor: { kind: 'system', purpose: 'captcha_attention' } },
      { itemId: 'queue-1' }
    )
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
  setFacts({
    userId: 'other-user',
    guildId: 'guild-1',
    present: true,
    owner: true,
    permissions: '8',
    roleIds: [],
  });
  expect(await actions.acknowledge(context, { itemId: 'queue-1' })).toEqual({
    kind: 'denied',
    code: 'binding_mismatch',
  });
  expect(deletedItemIds).toEqual([]);
});

it.each(['support_thread_attention', 'report_thread_attention', 'quarantine_breach_attention'])(
  'retains acknowledgement for %s',
  async (itemType) => {
    const { actions, items, messageIds } = arrange();
    const item = items.get('queue-1');
    if (!item) throw new Error('missing fixture');
    items.set(item.id, { ...item, item_type: itemType });
    expect(
      await actions.acknowledge({ ...context, source: 'web' }, { itemId: item.id })
    ).toMatchObject({
      kind: 'outcome',
      outcome: { actor: { id: 'moderator-1', surface: 'web' }, status: 'acknowledged' },
    });
    expect(messageIds).toEqual(['queue-1']);
    expect(items.has(item.id)).toBe(false);
  }
);

it('acknowledges identity review without deleting the unresolved item or its message', async () => {
  const f = arrange();
  const item = f.items.get('queue-1')!;
  f.items.set(
    item.id,
    Object.assign({}, item, {
      item_type: 'report_thread_attention',
      report_intake_id: 'intake',
      metadata: { identity_review: { revision: 2 } },
    })
  );
  expect(await f.actions.acknowledge(context, { itemId: item.id })).toMatchObject({
    outcome: { status: 'acknowledged' },
  });
  expect(f.items.has(item.id)).toBe(true);
  expect(f.deletedItemIds).toEqual([]);
  expect(f.messageIds).toEqual([]);
});

it('acknowledges a review promoted after the initial read without deleting its row or message', async () => {
  const original: QueueAttentionItemRecord = {
    id: 'queue-1',
    server_id: 'guild-1',
    item_type: 'report_thread_attention',
    report_intake_id: 'intake',
    queue_channel_id: 'channel',
    queue_message_id: 'message',
    metadata: {},
  };
  let current: QueueAttentionItemRecord | null = original;
  const acknowledgeIdentityReview = jest.fn(async () => 'acknowledged' as const);
  const deleteQueueMessage = jest.fn();
  const actions = createAttentionActions({
    authority: {
      loadFresh: async () => ({
        guildId: 'guild-1',
        userId: 'moderator-1',
        present: true,
        owner: true,
        permissions: '8',
        roleIds: [],
      }),
    },
    repository: {
      findById: async () => {
        const snapshot = current;
        current = { ...original, metadata: { identity_review: { revision: 1 } } };
        return snapshot;
      },
      acknowledgeIdentityReview,
      reserveOrdinaryAcknowledgement: async () => current,
      completeOrdinaryAcknowledgement: async () => {
        current = null;
        return true;
      },
    },
    messageDeleter: { deleteQueueMessage },
  });
  expect(await actions.acknowledge(context, { itemId: original.id })).toMatchObject({
    outcome: { status: 'acknowledged' },
  });
  expect(current).not.toBeNull();
  expect(acknowledgeIdentityReview).toHaveBeenCalled();
  expect(deleteQueueMessage).not.toHaveBeenCalled();
});

it('restores only validated source metadata for a reserved cleanup row', () => {
  const attention_cleanup = {
    source_thread_id: 'thread',
    verification_event_id: null,
    detection_event_id: null,
  };
  expect(
    getAttentionCleanupSource({ attention_cleanup_pending: true, metadata: { attention_cleanup } })
  ).toEqual(attention_cleanup);
  expect(
    getAttentionCleanupSource({ attention_cleanup_pending: false, metadata: { attention_cleanup } })
  ).toBeNull();
  expect(
    getAttentionCleanupSource({
      attention_cleanup_pending: true,
      metadata: {
        attention_cleanup: { ...attention_cleanup, verification_event_id: 'not-a-uuid' },
      },
    })
  ).toBeNull();
});
