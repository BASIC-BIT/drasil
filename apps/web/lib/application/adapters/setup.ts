import {
  createSetupUpdateActions,
  type AuthorityPort,
  type SetupUpdateActions,
} from '@drasil/application';
import { createWebAuthority } from './authority';
import { createSetupDataAdapter, type SetupDataAdapter } from '../../setupDataAdapter';
import { captchaProviderConfigurationIssues } from '../../turnstile';
import { fixtureAdminSession, fixtureGuilds, isWebE2eFixtureMode } from '../../e2eFixtures';

function createSetupAuthority(): AuthorityPort {
  if (!isWebE2eFixtureMode()) return createWebAuthority();
  return {
    async loadFresh(guildId, userId) {
      const guild = fixtureGuilds().find((entry) => entry.id === guildId);
      if (!guild || userId !== fixtureAdminSession().userId) return null;
      return {
        guildId,
        userId,
        present: true,
        owner: guild.owner,
        permissions: guild.permissions,
        roleIds: [],
      };
    },
  };
}

export function createWebSetupActions(
  adapter: SetupDataAdapter = createSetupDataAdapter()
): SetupUpdateActions {
  return createSetupUpdateActions({
    authority: createSetupAuthority(),
    provider: { isConfigured: () => captchaProviderConfigurationIssues().length === 0 },
    configuration: {
      loadFresh: (guildId) => adapter.getServer(guildId),
      save(context, change) {
        if (context.actor.kind !== 'user')
          throw new Error('Setup requires an authenticated administrator.');
        return adapter.updateGuildSetup({
          ...change.columns,
          guildId: context.guildId,
          updatedBy: context.actor.userId,
        });
      },
    },
  });
}
