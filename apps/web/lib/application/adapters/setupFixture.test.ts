import { afterEach, expect, it, vi } from 'vitest';
import { FixtureSetupDataAdapter } from '../../../e2e/legacy/setupDataAdapter';
import {
  fixtureAdminSession,
  fixtureGuildId,
  fixtureServerRecord,
  resetFixtureServerRecord,
} from '../../e2eFixtures';
import { createWebSetupActions } from './setup';
vi.mock('./authority', () => ({
  createWebAuthority: () => ({
    loadFresh: async (guildId: string, userId: string) =>
      userId === 'fixture-admin'
        ? { guildId, userId, present: true, owner: true, permissions: '8', roleIds: [] }
        : null,
  }),
}));

afterEach(() => {
  resetFixtureServerRecord();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('saves setup through an explicit controlled authority and adapter without live Discord requests', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DRASIL_WEB_E2E_FIXTURE_MODE', 'true');
  const fetch = vi.fn(() => {
    throw new Error('Unexpected live request');
  });
  vi.stubGlobal('fetch', fetch);
  const context = {
    guildId: fixtureGuildId,
    requestId: 'fixture-save',
    source: 'web',
    actor: { kind: 'user' as const, userId: fixtureAdminSession().userId },
  };
  const actions = createWebSetupActions(new FixtureSetupDataAdapter());
  expect(
    (
      await actions.execute(context, {
        kind: 'update_setup',
        changes: { heuristicMessageThreshold: 17 },
      })
    ).kind
  ).toBe('outcome');
  expect(fixtureServerRecord().heuristic_message_threshold).toBe(17);
  expect(fixtureServerRecord().updated_by).toBe(context.actor.userId);
  expect(
    await actions.execute(
      { ...context, actor: { kind: 'user', userId: 'unknown' } },
      {
        kind: 'update_setup',
        changes: { heuristicMessageThreshold: 18 },
      }
    )
  ).toEqual({ kind: 'denied', code: 'actor_unavailable' });
  expect(fixtureServerRecord().heuristic_message_threshold).toBe(17);
  expect(fetch).not.toHaveBeenCalled();
});
