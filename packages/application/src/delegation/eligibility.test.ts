import {
  loadEligibleGuildFacts,
  createDelegatedAccess,
  type DelegatedAccessDependencies,
} from './access';
import {
  ADMINISTRATOR,
  BAN_MEMBERS,
  KICK_MEMBERS,
  MANAGE_GUILD,
  MODERATE_MEMBERS,
  type AuthorityFacts,
} from '../authorization';
const actor = '123456789012345678';
const guildId = '111111111111111111';
interface EligibilityFixture {
  authority: jest.Mocked<DelegatedAccessDependencies['authority']>;
  staffRoles: jest.Mocked<DelegatedAccessDependencies['staffRoles']>;
  guilds: jest.Mocked<DelegatedAccessDependencies['guilds']>;
}
function fixture(facts: Partial<AuthorityFacts> = {}): EligibilityFixture {
  const deps: EligibilityFixture = {
    authority: {
      loadFresh: jest.fn<
        ReturnType<DelegatedAccessDependencies['authority']['loadFresh']>,
        Parameters<DelegatedAccessDependencies['authority']['loadFresh']>
      >(async () => ({
        userId: actor,
        guildId,
        present: true,
        owner: false,
        permissions: '0',
        roleIds: [],
        ...facts,
      })),
    },
    staffRoles: {
      loadRoleIds: jest.fn<
        ReturnType<DelegatedAccessDependencies['staffRoles']['loadRoleIds']>,
        Parameters<DelegatedAccessDependencies['staffRoles']['loadRoleIds']>
      >(async () => ['staff']),
    },
    guilds: {
      isActive: jest.fn<
        ReturnType<DelegatedAccessDependencies['guilds']['isActive']>,
        Parameters<DelegatedAccessDependencies['guilds']['isActive']>
      >(async () => true),
      listActive: jest.fn<
        ReturnType<DelegatedAccessDependencies['guilds']['listActive']>,
        Parameters<DelegatedAccessDependencies['guilds']['listActive']>
      >(async () => ({ guildIds: [guildId], nextCursor: null })),
    },
  };
  return deps;
}
describe('pre-grant guild eligibility', () => {
  it.each([ADMINISTRATOR, MANAGE_GUILD, MODERATE_MEMBERS, BAN_MEMBERS, KICK_MEMBERS])(
    'uses the same permission eligibility before and after grants: %s',
    async (permission) => {
      const deps = fixture({ permissions: permission.toString() });
      expect(await loadEligibleGuildFacts(deps, actor, guildId)).not.toBeNull();
    }
  );
  it('refreshes roles and membership on every decision without creating or requiring a grant', async () => {
    const deps = fixture({ roleIds: ['staff'] });
    expect(await loadEligibleGuildFacts(deps, actor, guildId)).not.toBeNull();
    deps.staffRoles.loadRoleIds.mockResolvedValue([]);
    expect(await loadEligibleGuildFacts(deps, actor, guildId)).toBeNull();
    expect(deps.authority.loadFresh).toHaveBeenCalledTimes(2);
  });
  it.each([{ userId: 'other' }, { guildId: 'other' }, { present: false }])(
    'denies mismatched or departed actors: %j',
    async (facts) => {
      expect(
        await loadEligibleGuildFacts(fixture({ owner: true, ...facts }), actor, guildId)
      ).toBeNull();
    }
  );
  it('denies inactive installations before loading Discord facts', async () => {
    const deps = fixture({ owner: true });
    deps.guilds.isActive.mockResolvedValue(false);
    expect(await loadEligibleGuildFacts(deps, actor, guildId)).toBeNull();
    expect(deps.authority.loadFresh).not.toHaveBeenCalled();
  });
  it('does not weaken post-grant listing or invent a principal to discover servers', async () => {
    const deps = {
      ...fixture({ owner: true }),
      store: { findConnection: jest.fn(async () => null) },
    } satisfies DelegatedAccessDependencies;
    expect(
      await createDelegatedAccess(deps).listEligibleGuilds(
        {
          userId: actor,
          clientId: 'client',
          connectionId: 'missing',
          grantVersion: 1,
          scopes: ['drasil:read'],
        },
        {}
      )
    ).toEqual({ kind: 'denied', reason: 'invalid_grant' });
    expect(deps.guilds.listActive).not.toHaveBeenCalled();
  });
});
