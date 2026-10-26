import {
  captchaImageSecretConfigured,
  createSetupUpdateActions,
  type SetupUpdateActions,
} from '@drasil/application';
import { createSetupDataAdapter, type SetupDataAdapter } from '../../setupDataAdapter';
import { captchaProviderConfigurationIssues } from '../../turnstile';
import { createWebAuthority } from './authority';

export function createWebSetupActions(
  adapter: SetupDataAdapter = createSetupDataAdapter()
): SetupUpdateActions {
  return createSetupUpdateActions({
    authority: createWebAuthority(),
    provider: {
      isConfigured: (method) =>
        method === 'discord_image'
          ? captchaImageSecretConfigured(process.env.DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET)
          : captchaProviderConfigurationIssues().length === 0,
    },
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
