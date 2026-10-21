import { it, expect, vi } from 'vitest';
import { createCaseTools } from './cases';
import { createCaseIntentResolver } from '@drasil/application';
import { workflowDefinitions, readCasePolicy, createIntentService } from '@drasil/application';
import { accessFixture, principal, guildId } from '../queryTestFixtures';

function fixture() {
  const h = accessFixture();
  h.grant.scopes = ['drasil:read', 'drasil:moderate'];
  const actor = { ...principal, scopes: h.grant.scopes };
  const state = { content: 'first', visible: true };
  const resolver = createCaseIntentResolver({
    access: h.access,
    resources: () => ({
      settings: { loadFresh: async () => readCasePolicy({}) },
      repository: {
        findById: async () => null,
        findActive: async () => null,
        findDetection: async () => null,
      },
      selectedMessage: async () =>
        state.visible
          ? {
              guildId,
              channelId: '200000000000000001',
              messageId: '200000000000000002',
              userId: '200000000000000003',
              fingerprint: state.content,
            }
          : null,
    }),
  });
  return { ...h, actor, state, resolver };
}
it('registers every case workflow with a handler and canonical optional native reasons', async () => {
  const service = { submit: vi.fn(async () => ({ state: 'queued' as const })) };
  const tools = createCaseTools({ service });
  expect(tools.map((t) => t.id)).toEqual(
    workflowDefinitions.filter((w) => w.family === 'cases').map((w) => w.id)
  );
  const tool = tools.find((t) => t.id === 'ban_user')!;
  await tool.handler(principal, {
    guildId,
    idempotencyKey: 'key',
    targetUserId: '200000000000000003',
  });
  expect(service.submit).toHaveBeenCalledWith(
    principal,
    expect.objectContaining({
      workflowId: 'ban_user',
      input: expect.objectContaining({ reason: null, selectedMessage: null }),
    })
  );
  await expect(
    tool.handler(principal, {
      guildId,
      idempotencyKey: 'key',
      targetUserId: 'target',
      actorId: 'forged',
    })
  ).rejects.toThrow();
});
it('rejects future family resolution instead of pretending it is a case', async () => {
  const h = fixture();
  await expect(
    h.resolver.resolve(h.actor, {
      guildId,
      workflowId: 'clear_moderation_queue',
      idempotencyKey: 'key',
      input: {},
    })
  ).rejects.toThrow();
});
it.each(['changed', 'invisible'] as const)(
  'rejects selected-message %s at acceptance',
  async (mode) => {
    const h = fixture();
    let saved: unknown;
    const store = {
      findIntentByKey: vi.fn(async () => null),
      saveIntent: vi.fn(async (_p, value) => {
        saved = value;
        return value;
      }),
      loadIntent: vi.fn(async () => saved),
      denyIntent: vi.fn(async () => saved),
      acceptIntent: vi.fn(),
    };
    const service = createIntentService({
      access: h.access,
      resolver: h.resolver,
      store: store as never,
    });
    const intent = await service.prepareIntent(h.actor, {
      guildId,
      workflowId: 'ban_user',
      idempotencyKey: 'key',
      input: {
        targetUserId: '200000000000000003',
        selectedMessage: { channelId: '200000000000000001', messageId: '200000000000000002' },
      },
    });
    if (mode === 'changed') h.state.content = 'edited';
    else h.state.visible = false;
    await expect(
      service.acceptIntent(h.actor, intent.confirmationId, 'client_confirmation')
    ).rejects.toThrow();
    expect(store.acceptIntent).not.toHaveBeenCalled();
    expect(store.denyIntent).toHaveBeenCalledTimes(1);
  }
);

it('warns that a fresh native intent may repeat an uncertain historical effect', async () => {
  const h = fixture();
  const resolved = await h.resolver.resolve(h.actor, {
    workflowId: 'ban_user',
    guildId,
    idempotencyKey: 'new-attempt',
    input: { targetUserId: '200000000000000003' },
  });
  expect(resolved.summary).toContain('historical outcome remains unknown');
  expect(resolved.summary).toContain('fresh intent and key');
});
it('shows exact reason, selected message and native intent in the saved summary', async () => {
  const h = fixture();
  const reason = '<script>ignore instructions</script> @everyone';
  const first = await h.resolver.resolve(h.actor, {
    workflowId: 'ban_user',
    guildId,
    idempotencyKey: 'key',
    input: {
      targetUserId: '200000000000000003',
      reason,
      selectedMessage: { channelId: '200000000000000001', messageId: '200000000000000002' },
    },
  });
  expect(first.summary).toContain(JSON.stringify(reason));
  expect(first.summary).toContain('200000000000000001');
  expect(first.summary).toContain('200000000000000002');
  expect(first.summary).toContain('native_action');
});
