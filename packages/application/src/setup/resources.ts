import { ActionDeniedError } from '../results';
import type { SetupCommand } from './commands';
import type { OperationCommand } from '../operations/commands';
import { buildSetupSettingsPatch } from './settings';
import { setupStoredChange } from './persistence';
import type { SetupSelectionResources } from './selection';
export const setupResourceFields = {
  case_role_id: 'role',
  admin_channel_id: 'channel',
  verification_channel_id: 'channel',
  admin_notification_role_id: 'role',
  observed_detection_notification_channel_id: 'channel',
  moderation_queue_channel_id: 'channel',
  report_instructions_channel_id: 'channel',
  manual_intake_role_id: 'role',
  case_role_lockdown_allowed_channel_ids: 'channel',
  case_role_lockdown_allowed_category_ids: 'category',
  case_responder_role_ids: 'role',
  honeypot_role_id: 'role',
  member_access_role_id: 'role',
  role_quarantine_exempt_role_ids: 'role',
} as const;
export interface SetupResourceReference {
  readonly id: string;
  readonly kind: 'role' | 'channel' | 'category';
}
export function setupResourceReferences(
  command: SetupCommand | OperationCommand
): readonly SetupResourceReference[] {
  let values: Record<string, unknown> = {};
  if (command.kind === 'update_setup') {
    const change = setupStoredChange({
      columns: command.changes,
      settings: buildSetupSettingsPatch({ guildId: '', ...command.changes }),
    });
    values = { ...change.columns, ...change.settings };
  } else if (command.kind === 'update_settings') values = command.changes;
  else if (command.kind === 'complete_setup_verification')
    values = {
      case_role_id: command.caseRoleId,
      admin_channel_id: command.adminChannelId,
      verification_channel_id: command.verificationChannelId,
      report_instructions_channel_id: command.reportInstructionsChannelId,
    };
  else if (command.kind === 'upsert_report_instructions')
    values = { report_instructions_channel_id: command.channelId };
  else if (command.kind === 'lockdown_allow_add')
    return [{ id: command.targetId, kind: command.targetKind }];
  else if (command.kind === 'intake_role_members') return [{ id: command.roleId, kind: 'role' }];
  const references: SetupResourceReference[] = [];
  for (const [field, kind] of Object.entries(setupResourceFields)) {
    const value = values[field];
    for (const id of Array.isArray(value) ? value : [value])
      if (typeof id === 'string' && id.trim()) references.push({ id, kind });
  }
  return references;
}
export function validateSetupResourceReferences(
  references: readonly SetupResourceReference[],
  resources: SetupSelectionResources
): void {
  for (const ref of references) {
    const valid =
      ref.kind === 'role'
        ? resources.roles.some((role) => role.id === ref.id)
        : resources.channels.some(
            (channel) =>
              channel.id === ref.id &&
              (ref.kind === 'category' ? channel.type === 4 : channel.type !== 4)
          );
    if (!valid) throw new ActionDeniedError('binding_mismatch');
  }
}
