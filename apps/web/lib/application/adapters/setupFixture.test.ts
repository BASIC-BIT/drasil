import { afterEach, expect, it, vi } from 'vitest';
import { createWebSetupActions } from './setup';
import {
  fixtureAdminSession,
  fixtureGuildId,
  fixtureServerRecord,
  resetFixtureServerRecord,
} from '../../e2eFixtures';

afterEach(() => {
  resetFixtureServerRecord();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('saves setup to the actual fixture store without live Discord requests', async () => {
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
  const actions = createWebSetupActions();
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

it('does not enable fixture authority in production', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DRASIL_WEB_E2E_FIXTURE_MODE', 'true');
  expect(() => createWebSetupActions()).toThrow('must not be enabled in production');
});
