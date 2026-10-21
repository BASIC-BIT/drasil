import {
  ActionDeniedError,
  parseSetupStoredRecord,
  setupStateMatches,
  type SetupWritePrecondition,
  type SetupStoredChange,
} from '@drasil/application';
import type { IConfigService } from '../../config/ConfigService';
import type { Server } from '../../repositories/types';

export type SetupWorkflowConfig = Pick<
  IConfigService,
  'getServerConfig' | 'updateServerSettings' | 'updateSetupConfiguration'
>;
/** A stale compare after Discord work is an uncertain outcome, never a no-effect denial. */
export class SetupEffectsStateChangedError extends Error {
  constructor() {
    super('Configuration changed during external setup work.');
  }
}
export interface ApprovedSetupConfiguration {
  readonly config: SetupWorkflowConfig;
  read(guildId: string): Promise<Server>;
  save(guildId: string, change: SetupStoredChange): Promise<Server>;
  startEffects(): void;
}
export function createApprovedSetupConfiguration(
  config: IConfigService,
  approved: SetupWritePrecondition
): ApprovedSetupConfiguration {
  let expected = approved;
  let effectsStarted = false;
  function stale(): never {
    if (effectsStarted) throw new SetupEffectsStateChangedError();
    throw new ActionDeniedError('stale_state');
  }
  const read = async (guildId: string): Promise<Server> => {
    if (guildId !== expected.approvedState.guild_id)
      throw new ActionDeniedError('binding_mismatch');
    const current = await config.findServerConfig(guildId);
    if (
      !current ||
      !setupStateMatches(
        parseSetupStoredRecord(current as unknown as Record<string, unknown>),
        expected
      )
    )
      stale();
    return current;
  };
  const save = async (guildId: string, change: SetupStoredChange): Promise<Server> => {
    if (guildId !== expected.approvedState.guild_id)
      throw new ActionDeniedError('binding_mismatch');
    const updated = await config.updateSetupIfUnchanged(guildId, expected, change);
    if (!updated) stale();
    // Advance only from the row returned by this transaction, never from a fresh external read.
    expected = {
      approvedState: parseSetupStoredRecord(updated as unknown as Record<string, unknown>),
    };
    return updated;
  };
  return {
    read,
    save,
    startEffects: (): void => {
      effectsStarted = true;
    },
    config: {
      getServerConfig: read,
      updateServerSettings: (guildId, settings) => save(guildId, { settings: { ...settings } }),
      updateSetupConfiguration: (guildId, change) =>
        save(guildId, {
          columns: {
            case_role_id: change.caseRoleId,
            admin_channel_id: change.adminChannelId,
            verification_channel_id: change.verificationChannelId,
            is_active: true,
          },
          settings: { ...change.settingsPatch },
        }),
    },
  };
}
