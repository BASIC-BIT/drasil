// Explicit legacy test-build boundary. Never imported by the release build.
import { fixtureGuildId, fixtureServerRecord, updateFixtureServerRecord } from '@/lib/e2eFixtures';
import { ActionDeniedError, type SetupWritePrecondition } from '@drasil/application';
import { type GuildSetupUpdate, type SetupServerRecord } from '@drasil/contracts';
import { type SetupDataAdapter } from '../../lib/setupDataAdapter';
export * from '../../lib/setupDataAdapter';

export class FixtureSetupDataAdapter implements SetupDataAdapter {
  public readonly provider = 'postgres' as const;

  public async listConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    return new Set(guildIds.includes(fixtureGuildId) ? [fixtureGuildId] : []);
  }

  public async listCoreConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    return new Set(
      guildIds.includes(fixtureGuildId) && hasCoreSetupConfiguration(fixtureServerRecord())
        ? [fixtureGuildId]
        : []
    );
  }

  public async getServer(guildId: string): Promise<SetupServerRecord | null> {
    return guildId === fixtureGuildId ? fixtureServerRecord() : null;
  }

  public async updateGuildSetup(
    update: GuildSetupUpdate,
    precondition?: SetupWritePrecondition
  ): Promise<SetupServerRecord> {
    if (precondition) throw new ActionDeniedError('approved_setup_executor_required');
    return updateFixtureServerRecord(update);
  }
}

export function createSetupDataAdapter(): SetupDataAdapter {
  return new FixtureSetupDataAdapter();
}

function hasCoreSetupConfiguration(server: SetupServerRecord | null): boolean {
  return Boolean(
    server?.is_active &&
    server.case_role_id &&
    server.case_role_id !== server.guild_id &&
    server.admin_channel_id &&
    server.verification_channel_id
  );
}
