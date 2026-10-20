import { createSetupUpdateActions, type SetupUpdateActions } from '@drasil/application';
import { createWebAuthority } from './attention';
import { createSetupDataAdapter, type SetupDataAdapter } from '../../setupDataAdapter';
import { captchaProviderConfigurationIssues } from '../../turnstile';

export function createWebSetupActions(
  adapter: SetupDataAdapter = createSetupDataAdapter()
): SetupUpdateActions {
  return createSetupUpdateActions({
    authority: createWebAuthority(),
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
