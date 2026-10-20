import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupDataAdapter } from '../../setupDataAdapter';
import type { SetupServerRecord } from '@drasil/contracts';
const state = vi.hoisted(() => ({ permissions: '8', owner: false, provider: true, present: true }));
vi.mock('./attention', () => ({
  createWebAuthority: () => ({
    loadFresh: async (guildId: string, userId: string) =>
      state.present
        ? {
            guildId,
            userId,
            permissions: state.permissions,
            owner: state.owner,
            present: true,
            roleIds: [],
          }
        : null,
  }),
}));
vi.mock('../../turnstile', () => ({
  captchaProviderConfigurationIssues: () => (state.provider ? [] : ['TURNSTILE_SECRET_KEY']),
}));
import { createWebSetupActions } from './setup';
const context = {
  guildId: 'guild',
  requestId: 'submission',
  source: 'web',
  actor: { kind: 'user' as const, userId: 'admin' },
};
function fixture() {
  let server: SetupServerRecord = {
    guild_id: 'guild',
    case_role_id: null,
    admin_channel_id: null,
    verification_channel_id: null,
    admin_notification_role_id: null,
    heuristic_message_threshold: 5,
    heuristic_message_timeframe_seconds: 10,
    heuristic_suspicious_keywords: [],
    created_at: null,
    updated_at: null,
    updated_by: null,
    settings: { analytics_consent_level: 'anonymous', unrelated: 'kept' },
    is_active: true,
  };
  const saved: unknown[] = [];
  const adapter: SetupDataAdapter = {
    provider: 'postgres',
    async listConfiguredGuildIds() {
      return new Set();
    },
    async listCoreConfiguredGuildIds() {
      return new Set();
    },
    async getServer() {
      return server;
    },
    async updateGuildSetup(update) {
      saved.push(update);
      server = { ...server, updated_by: update.updatedBy ?? null };
      return server;
    },
  };
  return {
    actions: createWebSetupActions(adapter),
    saved,
    setLevel(level: 'full' | 'anonymous') {
      server.settings.analytics_consent_level = level;
    },
  };
}
describe('web setup execution', () => {
  beforeEach(() => {
    state.permissions = '8';
    state.owner = false;
    state.provider = true;
    state.present = true;
  });
  it('requires Administrator after the Manage Server web-entry gate', async () => {
    const runtime = fixture();
    state.permissions = '32';
    expect(
      await runtime.actions.execute(context, {
        kind: 'update_setup',
        changes: { adminChannelId: 'channel' },
      })
    ).toEqual({ kind: 'denied', code: 'permission_denied' });
    expect(runtime.saved).toEqual([]);
  });
  it('rechecks consent when a stale full-mode form is submitted', async () => {
    const runtime = fixture();
    runtime.setLevel('full');
    expect(
      (
        await runtime.actions.execute(context, {
          kind: 'update_setup',
          changes: { analyticsConsentLevel: 'full' },
        })
      ).kind
    ).toBe('outcome');
    runtime.setLevel('anonymous');
    expect(
      await runtime.actions.execute(context, {
        kind: 'update_setup',
        changes: { analyticsConsentLevel: 'full' },
      })
    ).toEqual({ kind: 'denied', code: 'permission_denied' });
    expect(runtime.saved).toHaveLength(1);
  });
  it('attributes saves to authenticated context and checks configured CAPTCHA provider', async () => {
    const runtime = fixture();
    state.provider = false;
    expect(
      await runtime.actions.execute(context, {
        kind: 'update_setup',
        changes: { captchaMode: 'manual' },
      })
    ).toEqual({ kind: 'denied', code: 'policy_disabled' });
    state.provider = true;
    await runtime.actions.execute(context, {
      kind: 'update_setup',
      changes: { captchaMode: 'manual', adminChannelId: 'channel' },
    });
    expect(runtime.saved).toEqual([
      { guildId: 'guild', updatedBy: 'admin', captchaMode: 'manual', adminChannelId: 'channel' },
    ]);
  });
});
