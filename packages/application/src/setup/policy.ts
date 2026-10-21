import { hasAuthority } from '../authorization';
import type { ActionContext } from '../context';
import type { ActionDenialCode } from '../results';
import type { SetupCommand } from './commands';
import type { SetupDependencies, SetupConfigurationState } from './ports';
import type { SettingsChanges } from './settings';
type SetupAuthority = { readonly owner: boolean } | ActionDenialCode;

export async function authorizeSetup(
  context: ActionContext,
  deps: Pick<SetupDependencies, 'authority'>
): Promise<SetupAuthority> {
  if (context.actor.kind !== 'user') {
    return 'permission_denied';
  }
  const facts = await deps.authority.loadFresh(context.guildId, context.actor.userId);
  if (!facts?.present) {
    return 'actor_unavailable';
  }
  if (facts.guildId !== context.guildId || facts.userId !== context.actor.userId) {
    return 'binding_mismatch';
  }
  return hasAuthority(facts, 0n) ? { owner: facts.owner } : 'permission_denied';
}

export function validateSetupPolicy(
  command: SetupCommand,
  changes: SettingsChanges,
  current: SetupConfigurationState | null,
  owner: boolean,
  providerConfigured: boolean
): ActionDenialCode | null {
  if (
    'analytics_consent_level' in changes &&
    changes.analytics_consent_level === 'full' &&
    !owner &&
    (command.kind !== 'update_setup' || current?.settings.analytics_consent_level !== 'full')
  ) {
    return 'permission_denied';
  }
  if (
    'captcha_mode' in changes &&
    changes.captcha_mode &&
    changes.captcha_mode !== 'off' &&
    !providerConfigured
  ) {
    return 'policy_disabled';
  }
  return validateManualIntake(command, changes, current);
}

function validateManualIntake(
  command: SetupCommand,
  changes: SettingsChanges,
  current: SetupConfigurationState | null
): ActionDenialCode | null {
  if (
    !('manual_intake_enabled' in changes) &&
    !('manual_intake_role_id' in changes) &&
    !(command.kind === 'update_setup' && command.changes.caseRoleId !== undefined)
  ) {
    return null;
  }
  const intakeRole =
    'manual_intake_role_id' in changes
      ? changes.manual_intake_role_id
      : current?.settings.manual_intake_role_id;
  const intakeEnabled =
    'manual_intake_enabled' in changes
      ? changes.manual_intake_enabled
      : current?.settings.manual_intake_enabled;
  const caseRole =
    command.kind === 'update_setup' && command.changes.caseRoleId !== undefined
      ? command.changes.caseRoleId
      : current?.case_role_id;
  if (intakeEnabled && (!intakeRole || intakeRole === caseRole)) {
    return 'policy_disabled';
  }
  return null;
}
