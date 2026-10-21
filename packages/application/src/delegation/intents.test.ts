import { ActionDeniedError } from '../results';
import {
  canonicalDigest,
  IntentError,
  createIntentService,
  setupFingerprintState,
  type IntentService,
} from './intents';
import type {
  IntentRecord,
  IntentStore,
  IntentResolution,
  DelegatedPrincipal,
  IntentResolver,
} from './types';
import { setupServerRecordSchema, type SetupServerRecord } from '../setup/settings';

const principal: DelegatedPrincipal = {
  userId: 'actor',
  clientId: 'client',
  connectionId: 'connection',
  grantVersion: 1,
  scopes: ['drasil:configure'],
};
const invocation = {
  workflowId: 'update_setup' as const,
  guildId: 'guild',
  idempotencyKey: 'key',
  input: { changes: { adminChannelId: '123' } },
};
interface Fixture {
  service: IntentService;
  store: IntentStore;
  resolver: IntentResolver;
  state: SetupServerRecord;
  setResolution(value: Partial<IntentResolution>): void;
  setNow(value: number): void;
  denyAccess(): void;
}
function fixture(): Fixture {
  let saved: IntentRecord | null = null;
  let now = 1000;
  const state = setupServerRecordSchema.parse({
    guild_id: 'guild',
    settings: {},
    case_role_id: null,
    admin_channel_id: null,
    verification_channel_id: null,
    admin_notification_role_id: null,
    heuristic_message_threshold: 5,
    heuristic_message_timeframe_seconds: 60,
    heuristic_suspicious_keywords: [],
    created_at: null,
    updated_at: null,
    updated_by: null,
    is_active: true,
  });
  let resolution: IntentResolution = {
    delivery: { kind: 'direct' },
    preconditions: { kind: 'setup', approvedState: state },
    relevantState: { enabled: true },
    summary: 'Admin channel: none → 123',
    previewExpiresAt: null,
  };
  const store = {
    findIntentByKey: async () => saved,
    saveIntent: async (_principal: DelegatedPrincipal, intent: IntentRecord) => (saved = intent),
    loadIntent: async () => saved,
    denyIntent: async () => {
      if (saved) saved = { ...saved, state: 'denied' };
      return saved;
    },
    cancelIntent: async () => {
      if (saved) saved = { ...saved, state: 'cancelled' };
      return saved;
    },
    acceptIntent: jest.fn(async () => ({ executionId: 'execution' })),
  } as unknown as IntentStore;
  let authorized = true;
  const access = {
    authorizeWorkflowId: async (): Promise<{ kind: 'allowed' }> => ({ kind: 'allowed' as const }),
    authorizeWorkflow: jest.fn(async () =>
      authorized
        ? { kind: 'allowed' as const }
        : { kind: 'denied' as const, reason: 'permission_denied' as const }
    ),
  };
  const resolver = { resolve: jest.fn(async () => resolution) };
  const service = createIntentService({ store, access: access as never, resolver, now: () => now });
  return {
    service,
    store,
    resolver,
    state,
    setResolution: (value: Partial<IntentResolution>): void => {
      resolution = { ...resolution, ...value };
    },
    setNow: (value: number): void => {
      now = value;
    },
    denyAccess: (): void => {
      authorized = false;
    },
  };
}
it('uses versioned canonical JSON without losing omitted/null/array or large ID semantics', () => {
  expect(canonicalDigest({ b: 2, a: '9999999999999999999' })).toBe(
    canonicalDigest({ a: '9999999999999999999', b: 2 })
  );
  expect(canonicalDigest({ a: null })).not.toBe(canonicalDigest({}));
  expect(canonicalDigest([1, 2])).not.toBe(canonicalDigest([2, 1]));
  expect(canonicalDigest({})).toMatch(/^v1:sha256:[a-f0-9]{64}$/);
  expect(() => canonicalDigest({ bad: Infinity })).toThrow();
});
it('caps expiry at ten minutes or the underlying preview and performs no enforcement during prepare', async () => {
  const f = fixture();
  f.setResolution({ previewExpiresAt: new Date(1000 + 20 * 60_000) });
  const intent = await f.service.prepareIntent(principal, invocation);
  const createdAt = intent.createdAt.getTime();
  const expiryWithLongPreview = intent.expiresAt.getTime();
  expect(expiryWithLongPreview - createdAt).toBe(10 * 60_000);
  expect(intent.confirmationId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(intent.command).toEqual({ kind: 'update_setup', changes: { adminChannelId: '123' } });
  expect(intent.summary).toBe('Admin channel: none → 123');
  const enforcementCallsAfterPrepare = (f.store.acceptIntent as jest.Mock).mock.calls.length;
  expect(enforcementCallsAfterPrepare).toBe(0);
  const other = fixture();
  const previewExpiresAt = 1000 + 60_000;
  other.setResolution({ previewExpiresAt: new Date(previewExpiresAt) });
  const expiryWithShortPreview = (
    await other.service.prepareIntent(principal, invocation)
  ).expiresAt.getTime();
  expect(expiryWithShortPreview).toBe(previewExpiresAt);
});
it('returns exact retries and rejects changed arguments and grant binding', async () => {
  const f = fixture();
  const first = await f.service.prepareIntent(principal, invocation);
  expect(await f.service.prepareIntent(principal, invocation)).toEqual(first);
  expect(f.resolver.resolve).toHaveBeenCalledTimes(1);
  await expect(
    f.service.prepareIntent(principal, {
      ...invocation,
      input: { changes: { adminChannelId: '456' } },
    })
  ).rejects.toThrow('idempotency_conflict');
  await expect(
    f.service.prepareIntent({ ...principal, grantVersion: 2 }, invocation)
  ).rejects.toThrow('binding_mismatch');
});
it('rejects changed relevant policy and terminally denies the old approval', async () => {
  const f = fixture();
  const intent = await f.service.prepareIntent(principal, invocation);
  f.setResolution({ relevantState: { enabled: false } });
  await expect(
    f.service.acceptIntent(principal, intent.confirmationId, 'client_confirmation')
  ).rejects.toThrow('stale_state');
  expect((await f.store.loadIntent(principal, intent.confirmationId))?.state).toBe('denied');
  expect(f.store.acceptIntent).not.toHaveBeenCalled();
});
it('denies expired preview and fresh authority loss without accepting', async () => {
  const f = fixture();
  f.setResolution({ previewExpiresAt: new Date(2000) });
  const intent = await f.service.prepareIntent(principal, invocation);
  f.setNow(2000);
  await expect(
    f.service.acceptIntent(principal, intent.confirmationId, 'client_confirmation')
  ).rejects.toThrow('expired');
  const g = fixture();
  const other = await g.service.prepareIntent(principal, invocation);
  g.denyAccess();
  await expect(g.service.acceptIntent(principal, other.confirmationId, 'website')).rejects.toThrow(
    'permission_denied'
  );
  expect((await g.store.loadIntent(principal, other.confirmationId))?.state).toBe('denied');
});
it('rejects client-selected not_required and cancelled approvals', async () => {
  const f = fixture();
  const intent = await f.service.prepareIntent(principal, invocation);
  await expect(
    f.service.acceptIntent(principal, intent.confirmationId, 'not_required' as never)
  ).rejects.toThrow('confirmation_required');
  await f.service.cancelIntent(principal, intent.confirmationId);
  await expect(f.service.acceptIntent(principal, intent.confirmationId, 'discord')).rejects.toThrow(
    'cancelled'
  );
});
it('fingerprints every editable settings location but ignores timestamps and unrelated publication bookkeeping', () => {
  const f = fixture();
  const fingerprint = canonicalDigest(setupFingerprintState(f.state));
  expect(
    canonicalDigest(
      setupFingerprintState({
        ...f.state,
        updated_at: '2030-01-01',
        settings: { ...f.state.settings, report_instructions_message_id: 'noise' },
      })
    )
  ).toBe(fingerprint);
  for (const change of [
    { admin_channel_id: '123' },
    { heuristic_message_threshold: 123 },
    { settings: { report_ai_restrict_threshold: 0.4 } },
    { settings: { case_role_lockdown_enabled: true } },
  ]) {
    expect(canonicalDigest(setupFingerprintState({ ...f.state, ...change }))).not.toBe(fingerprint);
  }
});
it('caps quarantine lifetime by the bound preview even when the resolver omits the duplicate expiry', async () => {
  const f = fixture();
  const previewExpiresAt = 30_000;
  f.setResolution({
    delivery: {
      kind: 'queued',
      command: {
        kind: 'quarantine_compromised_account',
        caseId: 'case',
        targetUserId: 'target',
        reason: 'reason',
        previewReference: { kind: 'persisted_preview', requestId: 'preview' },
      },
    },
    preconditions: {
      kind: 'quarantine_preview',
      requestId: 'preview',
      fingerprint: 'fingerprint',
      expiresAt: new Date(previewExpiresAt),
    },
  });
  const intent = await f.service.prepareIntent(principal, {
    workflowId: 'quarantine_compromised_account',
    guildId: 'guild',
    idempotencyKey: 'quarantine',
    input: {
      caseId: 'case',
      targetUserId: 'target',
      reason: 'reason',
      previewReference: 'preview',
    },
  });
  expect(intent.expiresAt.getTime()).toBe(previewExpiresAt);
});
it('requires the matching trusted preview protocol for preview-confirm actions', async () => {
  const f = fixture();
  f.setResolution({
    delivery: {
      kind: 'queued',
      command: {
        kind: 'quarantine_compromised_account',
        caseId: 'case',
        targetUserId: 'target',
        reason: 'reason',
        previewReference: { kind: 'persisted_preview', requestId: 'preview' },
      },
    },
    preconditions: {
      kind: 'resource_revision',
      resource: { kind: 'case', id: 'case' },
      revision: 1,
    },
  });
  await expect(
    f.service.prepareIntent(principal, {
      workflowId: 'quarantine_compromised_account',
      guildId: 'guild',
      idempotencyKey: 'quarantine',
      input: {
        caseId: 'case',
        targetUserId: 'target',
        reason: 'reason',
        previewReference: 'preview',
      },
    })
  ).rejects.toThrow('preview_required');
});
it('freezes a report wrapper and its different canonical queued child with separate digests', async () => {
  const f = fixture();
  f.setResolution({
    delivery: {
      kind: 'queued',
      command: {
        kind: 'open_case_from_observed_detection',
        targetUserId: 'target',
        detectionEventId: 'detection',
        reportId: 'report',
      },
    },
    preconditions: {
      kind: 'resource_revision',
      resource: { kind: 'report', id: 'report' },
      revision: 1,
    },
  });
  const intent = await f.service.prepareIntent(principal, {
    workflowId: 'open_submitted_report_case',
    guildId: 'guild',
    idempotencyKey: 'open-report',
    input: { reportId: 'report' },
  });
  expect(intent.command).toEqual({ kind: 'open_submitted_report_case', reportId: 'report' });
  expect(intent.authorizedDelivery.kind).toBe('queued');
  if (intent.authorizedDelivery.kind !== 'queued') throw new Error('Expected queue');
  expect(intent.commandDigest).not.toBe(intent.authorizedDelivery.commandDigest);
  expect(intent.authorizedDelivery.commandDigest).toBe(
    canonicalDigest(intent.authorizedDelivery.command)
  );
});
it('rejects a resolver delivery that changes the approved target or reason', async () => {
  const f = fixture();
  f.setResolution({
    delivery: {
      kind: 'queued',
      command: {
        kind: 'kick_observed_detection',
        targetUserId: 'other',
        detectionEventId: 'detection',
        reason: 'different',
      },
    },
    preconditions: {
      kind: 'resource_revision',
      resource: { kind: 'detection', id: 'detection' },
      revision: 1,
    },
  });
  await expect(
    f.service.prepareIntent(principal, {
      workflowId: 'kick_observed_detection',
      guildId: 'guild',
      idempotencyKey: 'kick',
      input: { targetUserId: 'target', detectionEventId: 'detection', reason: 'approved' },
    })
  ).rejects.toThrow('delivery_mismatch');
});
it('requires fresh authority before returning an existing pending summary', async () => {
  const f = fixture();
  await f.service.prepareIntent(principal, invocation);
  f.denyAccess();
  await expect(f.service.prepareIntent(principal, invocation)).rejects.toThrow('permission_denied');
});
it('preserves cleanup generations without inventing a native preview TTL', async () => {
  const f = fixture();
  const command = {
    kind: 'execute_case_message_deletion' as const,
    jobId: 'job',
    caseId: 'case',
    targetUserId: 'target',
    mode: 'delete_only' as const,
    scope: 'last_day' as const,
    reason: 'approved',
    detectionEventId: null,
    previewReference: { jobId: 'job', generation: 'generation' },
  };
  f.setResolution({
    bindings: { cleanup: { jobId: 'job', generation: 'generation' } },
    delivery: { kind: 'queued', command },
    preconditions: {
      kind: 'cleanup_preview',
      jobId: 'job',
      generation: 'generation',
      expiresAt: null,
    },
  });
  const intent = await f.service.prepareIntent(principal, {
    workflowId: 'execute_case_message_deletion',
    guildId: 'guild',
    idempotencyKey: 'cleanup',
    input: {
      caseId: 'case',
      targetUserId: 'target',
      mode: 'delete_only',
      scope: 'last_day',
      reason: 'approved',
      detectionEventId: null,
      cleanupReference: 'reference',
    },
  });
  expect(intent.expiresAt.getTime() - intent.createdAt.getTime()).toBe(10 * 60_000);
  expect(intent.previewExpiresAt).toBeNull();
  f.setResolution({
    bindings: { cleanup: { jobId: 'job', generation: 'changed' } },
    delivery: {
      kind: 'queued',
      command: { ...command, previewReference: { jobId: 'job', generation: 'changed' } },
    },
    preconditions: {
      kind: 'cleanup_preview',
      jobId: 'job',
      generation: 'changed',
      expiresAt: null,
    },
  });
  await expect(
    f.service.acceptIntent(principal, intent.confirmationId, 'client_confirmation')
  ).rejects.toThrow('stale_state');
});
it('checks exact workflow authority before a resolver can inspect private resource state', async () => {
  const f = fixture();
  const resolver = {
    resolve: jest.fn(async (): Promise<IntentResolution> => {
      throw new Error('private resource detail');
    }),
  };
  const access = {
    authorizeGuild: async (): Promise<{ kind: 'allowed' }> => ({ kind: 'allowed' }),
    authorizeWorkflowId: async (): Promise<{ kind: 'denied'; reason: 'permission_denied' }> => ({
      kind: 'denied',
      reason: 'permission_denied',
    }),
    authorizeWorkflow: async (): Promise<{ kind: 'denied'; reason: 'permission_denied' }> => ({
      kind: 'denied',
      reason: 'permission_denied',
    }),
  };
  const service = createIntentService({ store: f.store, resolver, access: access as never });
  await expect(service.prepareIntent(principal, invocation)).rejects.toThrow('permission_denied');
  expect(resolver.resolve).not.toHaveBeenCalled();
});

it.each([new IntentError('policy_disabled'), new ActionDeniedError('policy_disabled')])(
  'terminally denies revalidation rejection %p even after the resolver recovers',
  async (error) => {
    const f = fixture();
    const intent = await f.service.prepareIntent(principal, invocation);
    jest.spyOn(f.resolver, 'resolve').mockRejectedValueOnce(error);
    await expect(
      f.service.acceptIntent(principal, intent.confirmationId, 'client_confirmation')
    ).rejects.toBe(error);
    expect((await f.store.loadIntent(principal, intent.confirmationId))?.state).toBe('denied');
    await expect(
      f.service.acceptIntent(principal, intent.confirmationId, 'client_confirmation')
    ).rejects.toThrow('denied');
    expect(f.store.acceptIntent).not.toHaveBeenCalled();
  }
);
it.each([
  new IntentError('unavailable'),
  new ActionDeniedError('unavailable'),
  new Error('transport interrupted'),
])(
  'keeps temporary revalidation failure %p pending for successful same-ID retry',
  async (error) => {
    const f = fixture();
    const intent = await f.service.prepareIntent(principal, invocation);
    jest.spyOn(f.resolver, 'resolve').mockRejectedValueOnce(error);
    await expect(
      f.service.acceptIntent(principal, intent.confirmationId, 'client_confirmation')
    ).rejects.toBe(error);
    expect((await f.store.loadIntent(principal, intent.confirmationId))?.state).toBe('pending');
    expect(f.store.acceptIntent).not.toHaveBeenCalled();
    await expect(
      f.service.acceptIntent(principal, intent.confirmationId, 'client_confirmation')
    ).resolves.toMatchObject({ executionId: 'execution' });
    expect(f.store.acceptIntent).toHaveBeenCalledTimes(1);
  }
);
