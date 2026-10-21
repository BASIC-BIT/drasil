import {
  createDelegatedAccess,
  type DelegatedPrincipal,
  type ConnectionGrant,
} from '@drasil/application';
export const guildId = '100000000000000001';
export const principal: DelegatedPrincipal = {
  userId: '100000000000000002',
  clientId: 'client',
  connectionId: 'connection',
  grantVersion: 1,
  scopes: ['drasil:read'],
};
export function accessFixture(guildIds: readonly string[] = [guildId]) {
  const state = { owner: true, permissions: '0', present: true };
  const excludedGuilds = new Set<string>();
  const grant: { -readonly [K in keyof ConnectionGrant]: ConnectionGrant[K] } = {
    ...principal,
    version: 1,
    selection: { mode: 'all_eligible' },
    createdAt: new Date(),
    revokedAt: null,
  };
  const access = createDelegatedAccess({
    store: { findConnection: async () => grant },
    authority: {
      loadFresh: async (guildId, userId) => ({
        guildId,
        userId,
        ...state,
        present: state.present && !excludedGuilds.has(guildId),
        roleIds: [],
      }),
    },
    staffRoles: { loadRoleIds: async () => [] },
    guilds: {
      isActive: async () => true,
      listActive: async ({ limit, cursor }) => {
        const remaining = guildIds.filter((id) => cursor === null || id > cursor);
        const page = remaining.slice(0, limit);
        return {
          guildIds: page,
          nextCursor: remaining.length > limit ? page[page.length - 1] : null,
        };
      },
    },
  });
  return { access, state, grant, excludedGuilds };
}
