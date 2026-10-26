import { fetchDiscordGuildRoles, fetchDiscordGuildChannels } from '../../discordApi';
import {
  ActionDeniedError,
  setupResourceReferences,
  validateSetupResourceReferences,
  type SetupSelectionResources,
  createSetupUpdateActions,
  type AuthorityPort,
  type SetupWritePrecondition,
  createSetupIntentResolver,
  captchaImageSecretConfigured,
  parseSetupStoredRecord,
  shippedResetChanges,
} from '@drasil/application';
import type { ApprovedSetupExecutor } from '../delivery';
import { createWebAuthority } from '../../application/adapters/authority';
import {
  PostgresSetupDataAdapter,
  getPostgresPool,
  type SetupDataAdapter,
} from '../../setupDataAdapter';
import { captchaProviderConfigurationIssues } from '../../turnstile';

export function createApprovedSetupExecutor(
  deps: {
    adapter?: SetupDataAdapter;
    authority?: AuthorityPort;
    provider?: { isConfigured(): boolean };
    loadGuildResources?: (guildId: string) => Promise<SetupSelectionResources>;
  } = {}
): ApprovedSetupExecutor {
  const adapter = deps.adapter ?? new PostgresSetupDataAdapter();
  return {
    async execute(context, command, preconditions) {
      if (command.kind !== 'update_setup')
        throw new ActionDeniedError('unsupported_direct_workflow');
      const references = setupResourceReferences(command);
      if (references.length)
        validateSetupResourceReferences(
          references,
          await (deps.loadGuildResources ?? loadWebSetupGuildResources)(context.guildId)
        );
      const expected: SetupWritePrecondition = { approvedState: preconditions.approvedState };
      const result = await createSetupUpdateActions({
        authority: deps.authority ?? createWebAuthority(),
        provider: deps.provider ?? {
          isConfigured: (method) =>
            method === 'discord_image'
              ? captchaImageSecretConfigured(process.env.DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET)
              : captchaProviderConfigurationIssues().length === 0,
        },
        configuration: {
          loadFresh: (guildId) => adapter.getServer(guildId),
          save: (ctx, change) =>
            adapter.updateGuildSetup(
              {
                ...change.columns,
                guildId: ctx.guildId,
                updatedBy: ctx.actor.kind === 'user' ? ctx.actor.userId : undefined,
              },
              expected
            ),
        },
      }).execute(context, command);
      if (result.kind === 'denied') throw new ActionDeniedError(result.code);
      return result.outcome;
    },
  };
}

/** Read-only preparation uses a strict stored record, never a default-creating config service. */
export function createWebSetupIntentResolver() {
  return createSetupIntentResolver({
    authority: createWebAuthority(),
    provider: {
      isConfigured: (method) =>
        method === 'discord_image'
          ? captchaImageSecretConfigured(process.env.DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET)
          : captchaProviderConfigurationIssues().length === 0,
    },
    loadGuildResources: loadWebSetupGuildResources,
    loadHeuristicDefaults: async (scope) => shippedResetChanges(scope),
    async loadServer(guildId) {
      const result = await getPostgresPool().query('select * from servers where guild_id=$1', [
        guildId,
      ]);
      return result.rows[0] ? parseSetupStoredRecord(result.rows[0]) : null;
    },
  });
}

async function loadWebSetupGuildResources(guildId: string): Promise<SetupSelectionResources> {
  return {
    roles: await fetchDiscordGuildRoles(guildId),
    channels: await fetchDiscordGuildChannels(guildId),
  };
}
