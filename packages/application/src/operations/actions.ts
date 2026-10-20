import type { ActionContext } from '../context';
import type { ActionResult, ActionDenialCode } from '../results';
import type { OperationCommand } from './commands';
import type { OperationsDependencies } from './ports';
import type {
  CaseRoleLockdownReport,
  CaseThreadClosureSweepReport,
  IntegrityAuditReport,
  RoleIntakeResult,
} from './reports';
export type OperationsOutcome =
  | { readonly kind: 'sync_moderation_queue'; readonly synced: true }
  | { readonly kind: 'clear_moderation_queue'; readonly removedCount: number }
  | { readonly kind: 'close_resolved_case_threads'; readonly report: CaseThreadClosureSweepReport }
  | {
      readonly kind: 'audit_case_role_lockdown' | 'apply_case_role_lockdown';
      readonly report: CaseRoleLockdownReport;
    }
  | { readonly kind: 'audit_integrity'; readonly report: IntegrityAuditReport }
  | { readonly kind: 'intake_role_members'; readonly result: RoleIntakeResult };
export interface OperationsActions {
  execute(
    context: ActionContext,
    command: OperationCommand
  ): Promise<ActionResult<OperationsOutcome>>;
}
export function operationConfirmationCommand(
  context: ActionContext,
  command: OperationCommand
): { readonly kind: string; readonly operationId: string } {
  return {
    kind: command.kind,
    operationId: JSON.stringify([
      context.guildId,
      Object.entries(command).sort(([left], [right]) => left.localeCompare(right)),
    ]),
  };
}
function needsConfirmation(command: OperationCommand): boolean {
  switch (command.kind) {
    case 'clear_moderation_queue':
    case 'apply_case_role_lockdown':
      return true;
    case 'close_resolved_case_threads':
    case 'intake_role_members':
      return command.execute;
    case 'sync_moderation_queue':
    case 'audit_case_role_lockdown':
    case 'audit_integrity':
      return false;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
async function authorize(
  context: ActionContext,
  command: OperationCommand,
  deps: OperationsDependencies
): Promise<ActionDenialCode | null> {
  if (context.actor.kind !== 'user') return 'permission_denied';
  const facts = await deps.authority.loadFresh(context.guildId, context.actor.userId);
  if (!facts || !facts.present) return 'actor_unavailable';
  if (facts.guildId !== context.guildId || facts.userId !== context.actor.userId)
    return 'binding_mismatch';
  const permissions = /^\d+$/.test(facts.permissions) ? BigInt(facts.permissions) : 0n;
  if (facts.owner || (permissions & (1n << 3n)) !== 0n) return null;
  const manageGuildAllowed =
    command.kind === 'audit_integrity' ||
    (command.kind === 'close_resolved_case_threads' && command.intent === 'guild_audit');
  return manageGuildAllowed && (permissions & (1n << 5n)) !== 0n ? null : 'permission_denied';
}
export function createOperationsActions(deps: OperationsDependencies): OperationsActions {
  return {
    async execute(context, command): Promise<ActionResult<OperationsOutcome>> {
      const denial = await authorize(context, command, deps);
      if (denial) return { kind: 'denied', code: denial };
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      const policy = await deps.policy.loadFresh(context.guildId);
      if (command.kind === 'intake_role_members' && command.execute) {
        if (policy.intakeReasonRequired && !command.reason?.trim())
          return { kind: 'denied', code: 'reason_required' };
      }
      if (
        needsConfirmation(command) &&
        !(await deps.confirmations.verify(context, operationConfirmationCommand(context, command)))
      )
        return { kind: 'denied', code: 'confirmation_required' };
      return {
        kind: 'outcome',
        outcome: await run(deps, context.guildId, context.actor.userId, command),
      };
    },
  };
}
async function run(
  deps: OperationsDependencies,
  guildId: string,
  actorId: string,
  command: OperationCommand
): Promise<OperationsOutcome> {
  switch (command.kind) {
    case 'sync_moderation_queue':
      await deps.queue.sync(guildId);
      return { kind: command.kind, synced: true };
    case 'clear_moderation_queue':
      return { kind: command.kind, removedCount: await deps.queue.clear(guildId) };
    case 'close_resolved_case_threads':
      return { kind: command.kind, report: await deps.closure.sweep({ ...command, guildId }) };
    case 'audit_case_role_lockdown':
      return { kind: command.kind, report: await deps.lockdown.audit(guildId) };
    case 'apply_case_role_lockdown':
      return {
        kind: command.kind,
        report: await deps.lockdown.apply({
          guildId,
          actorId,
          unsyncAllowedChannels: command.unsyncAllowedChannels,
        }),
      };
    case 'audit_integrity':
      return { kind: command.kind, report: await deps.integrity.audit({ ...command, guildId }) };
    case 'intake_role_members':
      return {
        kind: command.kind,
        result: await deps.intake.run({ ...command, guildId, actorId }),
      };
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
