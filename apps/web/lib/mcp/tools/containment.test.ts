import { describe, expect, it, vi } from 'vitest';
import { createContainmentTools } from './containment';
import { mcpWorkflowManifest } from '../manifest';

describe('containment tools', () => {
  it('registers human containment and attention workflows only', () => {
    const tools = createContainmentTools({ service: { submit: vi.fn() } });
    expect(tools.map((t) => t.toolName)).toEqual(
      mcpWorkflowManifest
        .filter((e) => ['cleanup', 'captcha', 'quarantine', 'attention'].includes(e.family))
        .map((e) => e.toolName)
    );
    expect(tools.some((t) => /apply_captcha_pass|notify_captcha_attention/.test(t.toolName))).toBe(
      false
    );
  });
});

import {
  createContainmentIntentResolver,
  createDelegatedActionService,
  ActionDeniedError,
  type DelegationStore,
} from '@drasil/application';
import { createMcpDirectExecutor } from '../delivery';
import { accessFixture, principal, guildId } from '../queryTestFixtures';
it('rejects reuse of another connections cleanup preview', async () => {
  const h = accessFixture();
  h.grant.scopes = ['drasil:read', 'drasil:moderate'];
  const actor = { ...principal, scopes: h.grant.scopes };
  const cleanupEffects = vi.fn();
  const store = { findIntentByKey: async () => null } as unknown as DelegationStore;
  const service = createDelegatedActionService({
    store,
    access: h.access,
    direct: { execute: cleanupEffects },
    resolver: createContainmentIntentResolver({
      loadCase: async () => ({
        id: 'case',
        guildId,
        targetUserId: 'target',
        status: 'pending',
        caseKind: 'standard',
        revision: 0,
        evidenceThreadId: 'evidence',
        detectionEventId: null,
        challenge: null,
      }),
      loadPolicy: async () => ({ captchaEnabled: true, quarantineEnabled: true, banEnabled: true }),
      resolvePreviewReference: async () => {
        throw new ActionDeniedError('preview_not_found');
      },
    }),
  });
  const tool = createContainmentTools({ service }).find(
    (t) => t.id === 'execute_case_message_deletion'
  )!;
  const result = await tool.handler(actor, {
    guildId,
    idempotencyKey: 'key',
    caseId: 'case',
    targetUserId: 'target',
    mode: 'delete_only',
    scope: 'last_hour',
    reason: 'Remove spam',
    detectionEventId: null,
    cleanupReference: 'other-connection',
  });
  expect(result.state).toBe('denied');
  expect(cleanupEffects).not.toHaveBeenCalled();
});
it('acknowledgement batches retain denials, no-ops and uncertain items independently', async () => {
  const acknowledge = vi.fn(async (_context, { itemId }) => {
    if (itemId === 'denied') return { kind: 'denied', code: 'permission_denied' };
    if (itemId === 'uncertain') throw new Error('Discord unavailable');
    return {
      kind: 'outcome',
      outcome: { itemId, status: itemId === 'gone' ? 'already_handled' : 'acknowledged' },
    };
  });
  const executor = createMcpDirectExecutor({ attention: { acknowledge } } as never);
  expect(
    await executor.execute(
      {
        guildId,
        requestId: 'request',
        source: 'mcp',
        actor: { kind: 'user', userId: principal.userId },
      },
      { kind: 'acknowledge_attention', itemIds: ['ok', 'denied', 'gone', 'uncertain'] },
      { kind: 'none' }
    )
  ).toEqual({
    kind: 'attention_batch',
    items: [
      { itemId: 'ok', state: 'completed', status: 'acknowledged' },
      { itemId: 'denied', state: 'denied' },
      { itemId: 'gone', state: 'completed', status: 'already_handled' },
      { itemId: 'uncertain', state: 'uncertain' },
    ],
  });
});
