import { describe, expect, it, vi } from 'vitest';
import { createWebDelegatedAccess, withAuthorizedRead } from './access';
import type { ConnectionGrant, DelegatedPrincipal } from '@drasil/application';
const principal: DelegatedPrincipal = {
  userId: 'user',
  clientId: 'client',
  connectionId: 'connection',
  grantVersion: 1,
  scopes: ['drasil:read'],
};
const grant: ConnectionGrant = {
  ...principal,
  version: 1,
  selection: { mode: 'all_eligible' },
  createdAt: new Date(),
  revokedAt: null,
};
it('never queries resources after a Discord refresh failure or role removal', async () => {
  const loadFresh = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({
    userId: 'user',
    guildId: 'guild',
    present: true,
    owner: false,
    permissions: '0',
    roleIds: [],
  });
  const access = createWebDelegatedAccess({
    store: { findConnection: async () => grant },
    authority: { loadFresh },
    staffRoles: { loadRoleIds: async () => ['staff'] },
    guilds: {
      isActive: async () => true,
      listActive: async () => ({ guildIds: ['guild'], nextCursor: null }),
    },
  });
  const query = vi.fn();
  for (let i = 0; i < 2; i++)
    expect(
      await withAuthorizedRead(access, principal, { kind: 'cases', guildId: 'guild' }, query)
    ).toMatchObject({ kind: 'denied' });
  expect(query).not.toHaveBeenCalled();
});
describe('discovery hints', () => {
  it('bounds page sizes and concurrent member requests while refreshing cached candidates', async () => {
    let active = 0;
    let maximum = 0;
    let owner = true;
    const loadFresh = vi.fn(async (guildId: string) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { userId: 'user', guildId, present: true, owner, permissions: '0', roleIds: [] };
    });
    const listActive = vi.fn(async () => ({
      guildIds: Array.from({ length: 25 }, (_, i) => String(i)),
      nextCursor: '25',
    }));
    const access = createWebDelegatedAccess({
      store: { findConnection: async () => grant },
      authority: { loadFresh },
      staffRoles: { loadRoleIds: async () => [] },
      guilds: { isActive: async () => true, listActive },
    });
    expect(await access.listEligibleGuilds(principal, {})).toMatchObject({
      kind: 'allowed',
      nextCursor: '25',
    });
    expect(maximum).toBeLessThanOrEqual(4);
    expect(listActive).toHaveBeenCalledWith({ limit: 25, cursor: null });
    owner = false;
    expect(await access.listEligibleGuilds(principal, {})).toMatchObject({
      kind: 'allowed',
      guilds: [],
    });
    expect(listActive).toHaveBeenCalledTimes(1);
    expect(loadFresh).toHaveBeenCalledTimes(50);
    expect(await access.listEligibleGuilds(principal, { limit: 101 })).toMatchObject({
      kind: 'denied',
    });
  });
});

it('expires discovery hints after 60 seconds and always refreshes the persisted grant', async () => {
  let now = 0;
  let revoked = false;
  const listActive = vi.fn(async () => ({ guildIds: ['guild'], nextCursor: null }));
  const access = createWebDelegatedAccess({
    now: () => now,
    store: { findConnection: async () => ({ ...grant, revokedAt: revoked ? new Date() : null }) },
    authority: {
      loadFresh: async (guildId) => ({
        userId: principal.userId,
        guildId,
        present: true,
        owner: true,
        permissions: '0',
        roleIds: [],
      }),
    },
    staffRoles: { loadRoleIds: async () => [] },
    guilds: { isActive: async () => true, listActive },
  });
  expect(await access.listEligibleGuilds(principal, {})).toMatchObject({ kind: 'allowed' });
  now = 59_999;
  expect(await access.listEligibleGuilds(principal, {})).toMatchObject({ kind: 'allowed' });
  expect(listActive).toHaveBeenCalledTimes(1);
  now = 60_000;
  expect(await access.listEligibleGuilds(principal, {})).toMatchObject({ kind: 'allowed' });
  expect(listActive).toHaveBeenCalledTimes(2);
  revoked = true;
  expect(await access.listEligibleGuilds(principal, {})).toMatchObject({
    kind: 'denied',
    reason: 'invalid_grant',
  });
});

it('passes the authorized guild and reporter binding to a resource query', async () => {
  const access = createWebDelegatedAccess({
    store: { findConnection: async () => grant },
    authority: {
      loadFresh: async (guildId) => ({
        userId: principal.userId,
        guildId,
        present: true,
        owner: false,
        permissions: '4',
        roleIds: [],
      }),
    },
    staffRoles: { loadRoleIds: async () => [] },
    guilds: {
      isActive: async () => true,
      listActive: async () => ({ guildIds: [], nextCursor: null }),
    },
  });
  const result = await withAuthorizedRead(
    access,
    principal,
    { kind: 'intakes', guildId: 'guild', audience: 'reporter' },
    async (binding) => ({ guildId: binding.guildId, reporterId: binding.reporterId })
  );
  expect(result).toEqual({ kind: 'allowed', value: { guildId: 'guild', reporterId: 'user' } });
});

it('binds member projections to an authorized workflow and prevents unauthorized variants reaching queries', async () => {
  const access = createWebDelegatedAccess({
    store: { findConnection: async () => grant },
    authority: {
      loadFresh: async (guildId) => ({
        userId: principal.userId,
        guildId,
        present: true,
        owner: false,
        permissions: '32',
        roleIds: [],
      }),
    },
    staffRoles: { loadRoleIds: async () => [] },
    guilds: {
      isActive: async () => true,
      listActive: async () => ({ guildIds: [], nextCursor: null }),
    },
  });
  const read = vi.fn(async (binding) => binding);
  const denied = {
    kind: 'member_context' as const,
    guildId: 'guild',
    purpose: 'case' as const,
    workflowId: 'open_admin_case_moderator' as const,
  };
  expect(await withAuthorizedRead(access, principal, denied, read)).toMatchObject({
    kind: 'denied',
  });
  expect(read).not.toHaveBeenCalled();
  const allowed = { ...denied, workflowId: 'open_admin_case_administrator' as const };
  expect(await withAuthorizedRead(access, principal, allowed, read)).toMatchObject({
    kind: 'allowed',
    value: {
      guildId: 'guild',
      scope: 'drasil:read',
      memberContext: { purpose: 'case', workflowId: allowed.workflowId },
    },
  });
  expect(read).toHaveBeenCalledTimes(1);
});
