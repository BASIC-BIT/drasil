import { z } from 'zod';
import type { ActionDenialCode } from '../results';
import type { CaseCommand } from './commands';
import type { CasePolicy } from './ports';
const policySettingsSchema = z.object({
  admin_case_open_requires_reason: z.boolean().default(false),
  moderator_ban_action_enabled: z.boolean().default(true),
  moderator_ban_action_requires_reason: z.boolean().default(false),
  moderator_kick_action_enabled: z.boolean().default(true),
  moderator_kick_action_requires_reason: z.boolean().default(false),
});
export function readCasePolicy(settings: unknown): CasePolicy {
  const parsed = policySettingsSchema.parse(settings);
  return {
    adminCaseOpenRequiresReason: parsed.admin_case_open_requires_reason,
    moderatorBanActionEnabled: parsed.moderator_ban_action_enabled,
    moderatorBanActionRequiresReason: parsed.moderator_ban_action_requires_reason,
    moderatorKickActionEnabled: parsed.moderator_kick_action_enabled,
    moderatorKickActionRequiresReason: parsed.moderator_kick_action_requires_reason,
  };
}
type ReasonCommand = Extract<CaseCommand, { reason: string | null }>;
export type CasePolicyIntent =
  | Pick<ReasonCommand, 'kind' | 'reason'>
  | { readonly kind: Exclude<CaseCommand['kind'], ReasonCommand['kind']> };
export function evaluateCasePolicy(
  command: CasePolicyIntent,
  policy: CasePolicy
): ActionDenialCode | null {
  const reason = 'reason' in command ? command.reason?.trim() : null;
  if (command.kind === 'ban_case_user' || command.kind === 'ban_case_user_by_id') {
    if (!policy.moderatorBanActionEnabled) return 'policy_disabled';
    if (policy.moderatorBanActionRequiresReason && !reason) return 'reason_required';
  }
  if (command.kind === 'kick_case_user') {
    if (!policy.moderatorKickActionEnabled) return 'policy_disabled';
    if (policy.moderatorKickActionRequiresReason && !reason) return 'reason_required';
  }
  if (command.kind === 'open_admin_case' && policy.adminCaseOpenRequiresReason && !reason)
    return 'reason_required';
  return null;
}
