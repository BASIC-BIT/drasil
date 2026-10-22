import type { ActionContext } from '../context';
import type { ActionResult } from '../results';
import { authorizeSetup, validateSetupPolicy } from './policy';
import type { SetupCommand } from './commands';
import type {
  SetupDependencies,
  SetupProvisioningOutcome,
  SetupHeuristics,
  ReportInstructionsOutcome,
  SetupPersistenceChange,
  SetupConfigurationState,
} from './ports';
import { buildSetupSettingsPatch, type SettingsChanges } from './settings';
export type SetupOutcome =
  | { readonly kind: 'complete_setup_verification'; readonly result: SetupProvisioningOutcome }
  | { readonly kind: 'upsert_report_instructions'; readonly result: ReportInstructionsOutcome }
  | { readonly kind: 'clear_report_instructions'; readonly action: 'cleared' | 'unchanged' }
  | {
      readonly kind:
        | 'update_setup'
        | 'update_settings'
        | 'lockdown_allow_add'
        | 'lockdown_allow_remove'
        | 'disable_lockdown';
      readonly server: SetupConfigurationState;
    }
  | { readonly kind: 'update_heuristics' | 'reset_heuristics'; readonly settings: SetupHeuristics };
export interface SetupActions {
  execute(context: ActionContext, command: SetupCommand): Promise<ActionResult<SetupOutcome>>;
}

type SetupConfirmation = { readonly kind: string; readonly operationId: string };
type SetupResetFields = SetupPersistenceChange['resetSettings'];
export function setupNeedsConfirmation(command: SetupCommand): boolean {
  return command.kind === 'upsert_report_instructions' && command.repost;
}

export function setupConfirmationCommand(
  context: ActionContext,
  command: SetupCommand
): SetupConfirmation {
  return { kind: command.kind, operationId: JSON.stringify([context.guildId, command]) };
}

export function createSetupActions(deps: SetupDependencies): SetupActions {
  return { execute: (context, command) => executeSetup(deps, context, command) };
}

async function executeSetup(
  deps: SetupDependencies,
  context: ActionContext,
  command: SetupCommand
): Promise<ActionResult<SetupOutcome>> {
  const authority = await authorizeSetup(context, deps);
  if (typeof authority === 'string') {
    return { kind: 'denied', code: authority };
  }
  const current = await deps.configuration.loadFresh(context.guildId);
  const changes = mutationChanges(context, command);
  const denied = validateSetupPolicy(
    command,
    changes,
    current,
    authority.owner,
    deps.provider.isConfigured()
  );
  if (denied) {
    return { kind: 'denied', code: denied };
  }
  if (
    setupNeedsConfirmation(command) &&
    !(await deps.confirmations.verify(context, setupConfirmationCommand(context, command)))
  ) {
    return { kind: 'denied', code: 'confirmation_required' };
  }
  const outcome = await run(deps, context, command, changes, current);
  return { kind: 'outcome', outcome };
}

function mutationChanges(context: ActionContext, command: SetupCommand): SettingsChanges {
  if (command.kind === 'update_settings') {
    return command.changes;
  }
  if (command.kind === 'update_setup') {
    const update = { ...command.changes, guildId: context.guildId };
    return buildSetupSettingsPatch(update);
  }
  const unchanged: SettingsChanges = {};
  return unchanged;
}

function resetFields(command: SetupCommand): SetupResetFields {
  if (command.kind !== 'update_settings' || command.section !== 'verification') {
    return undefined;
  }
  if (command.reset === 'prompt') {
    return ['verification_prompt_template'];
  }
  if (command.reset === 'context') {
    return ['server_about', 'verification_context', 'expected_topics'];
  }
  return undefined;
}

async function run(
  deps: SetupDependencies,
  context: ActionContext,
  command: SetupCommand,
  settings: SettingsChanges,
  current: SetupConfigurationState | null
): Promise<SetupOutcome> {
  switch (command.kind) {
    case 'complete_setup_verification':
      return { kind: command.kind, result: await deps.provisioning.complete(context, command) };
    case 'upsert_report_instructions':
      return { kind: command.kind, result: await deps.panels.upsert(context, command) };
    case 'clear_report_instructions':
      return { kind: command.kind, ...(await deps.panels.clear(context)) };
    case 'update_heuristics':
      return {
        kind: command.kind,
        settings: await deps.configuration.updateHeuristics(context, command.changes),
      };
    case 'reset_heuristics':
      return {
        kind: command.kind,
        settings: await deps.configuration.resetHeuristics(context, command.scope),
      };
    case 'update_setup':
      return {
        kind: command.kind,
        server: await deps.configuration.save(context, { columns: command.changes, settings }),
      };
    case 'update_settings':
      return {
        kind: command.kind,
        server: await deps.configuration.save(context, {
          settings,
          resetSettings: resetFields(command),
        }),
      };
    case 'disable_lockdown':
      return {
        kind: command.kind,
        server: await deps.configuration.save(context, {
          settings: { case_role_lockdown_enabled: false },
        }),
      };
    case 'lockdown_allow_add':
    case 'lockdown_allow_remove': {
      const key =
        command.targetKind === 'channel'
          ? 'case_role_lockdown_allowed_channel_ids'
          : 'case_role_lockdown_allowed_category_ids';
      const ids = new Set(current?.settings[key] ?? []);
      if (command.kind === 'lockdown_allow_add') {
        ids.add(command.targetId);
      } else {
        ids.delete(command.targetId);
      }
      return {
        kind: command.kind,
        server: await deps.configuration.save(context, {
          settings: {
            case_role_lockdown_allowed_channel_ids:
              current?.settings.case_role_lockdown_allowed_channel_ids ?? [],
            case_role_lockdown_allowed_category_ids:
              current?.settings.case_role_lockdown_allowed_category_ids ?? [],
            [key]: [...ids],
          },
        }),
      };
    }
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

// The web applies configuration directly; Discord provisioning remains a durable bot operation.
export type SetupUpdateDependencies = Pick<SetupDependencies, 'authority' | 'provider'> & {
  readonly configuration: Pick<SetupDependencies['configuration'], 'loadFresh' | 'save'>;
};
export interface SetupUpdateActions {
  execute(
    context: ActionContext,
    command: Extract<SetupCommand, { kind: 'update_setup' }>
  ): Promise<ActionResult<SetupOutcome>>;
}

export function createSetupUpdateActions(deps: SetupUpdateDependencies): SetupUpdateActions {
  return {
    async execute(context, command): Promise<ActionResult<SetupOutcome>> {
      const authority = await authorizeSetup(context, deps);
      if (typeof authority === 'string') {
        return { kind: 'denied', code: authority };
      }
      const current = await deps.configuration.loadFresh(context.guildId);
      const settings = mutationChanges(context, command);
      const denial = validateSetupPolicy(
        command,
        settings,
        current,
        authority.owner,
        deps.provider.isConfigured()
      );
      if (denial) {
        return { kind: 'denied', code: denial };
      }
      return {
        kind: 'outcome',
        outcome: {
          kind: command.kind,
          server: await deps.configuration.save(context, { columns: command.changes, settings }),
        },
      };
    },
  };
}
