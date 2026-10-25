import { describe, expect, it, vi } from 'vitest';
import { createApprovedSetupExecutor } from './setup';
import { setupServerRecordSchema } from '@drasil/application';
const state = setupServerRecordSchema.parse({
  guild_id: 'guild',
  case_role_id: null,
  admin_channel_id: 'admin',
  verification_channel_id: null,
  admin_notification_role_id: null,
  heuristic_message_threshold: 5,
  heuristic_message_timeframe_seconds: 10,
  heuristic_suspicious_keywords: [],
  created_at: null,
  updated_at: null,
  updated_by: null,
  settings: {},
  is_active: true,
});
const context = {
  guildId: 'guild',
  requestId: 'execution',
  source: 'mcp',
  actor: { kind: 'user' as const, userId: 'actor' },
};
describe('approved setup executor', () => {
  it('passes the exact full approved state to the narrow atomic web write', async () => {
    const updateGuildSetup = vi.fn(async () => state);
    const executor = createApprovedSetupExecutor({
      adapter: {
        provider: 'postgres',
        getServer: async () => state,
        listConfiguredGuildIds: async () => new Set(),
        listCoreConfiguredGuildIds: async () => new Set(),
        updateGuildSetup,
      },
      authority: {
        loadFresh: async () => ({
          guildId: 'guild',
          userId: 'actor',
          present: true,
          owner: true,
          permissions: '8',
          roleIds: [],
        }),
      },
      provider: { isConfigured: () => true },
    });
    const result = await executor.execute(
      context,
      { kind: 'update_setup', changes: { userReportReasonRequired: false } },
      { kind: 'setup', approvedState: state }
    );
    expect(result).toMatchObject({ kind: 'update_setup' });
    expect(updateGuildSetup).toHaveBeenCalledWith(
      { guildId: 'guild', updatedBy: 'actor', userReportReasonRequired: false },
      { approvedState: state }
    );
    await expect(
      executor.execute(
        context,
        { kind: 'disable_lockdown' },
        { kind: 'setup', approvedState: state }
      )
    ).rejects.toMatchObject({ code: 'unsupported_direct_workflow' });
    expect(updateGuildSetup).toHaveBeenCalledTimes(1);
  });
});

it('rechecks supplied channel IDs at execution even when equal to the approved value, and allows clearing', async () => {
  const updateGuildSetup = vi.fn(async () => state);
  const loadGuildResources = vi.fn(async () => ({ roles: [], channels: [] }));
  const executor = createApprovedSetupExecutor({
    adapter: {
      provider: 'postgres',
      getServer: async () => state,
      listConfiguredGuildIds: async () => new Set(),
      listCoreConfiguredGuildIds: async () => new Set(),
      updateGuildSetup,
    },
    authority: {
      loadFresh: async () => ({
        guildId: 'guild',
        userId: 'actor',
        present: true,
        owner: true,
        permissions: '8',
        roleIds: [],
      }),
    },
    provider: { isConfigured: () => true },
    loadGuildResources,
  });
  await expect(
    executor.execute(
      context,
      { kind: 'update_setup', changes: { adminChannelId: 'admin' } },
      { kind: 'setup', approvedState: state }
    )
  ).rejects.toMatchObject({ code: 'binding_mismatch' });
  expect(updateGuildSetup).not.toHaveBeenCalled();
  await expect(
    executor.execute(
      context,
      { kind: 'update_setup', changes: { adminChannelId: null } },
      { kind: 'setup', approvedState: state }
    )
  ).resolves.toMatchObject({ kind: 'update_setup' });
  expect(loadGuildResources).toHaveBeenCalledTimes(1);
  expect(updateGuildSetup).toHaveBeenCalledTimes(1);
});
