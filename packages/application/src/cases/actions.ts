import { evaluateCasePolicy } from './policy';
import type { RoleGateResolutionResult } from './roleGate';
import type { ActionContext } from '../context';
import type { ActionResult, ActionDenialCode } from '../results';
import type { CaseCommand } from './commands';
import type {
  CaseDependencies,
  CaseWorkflowInput,
  CaseOpenResult,
  CaseRepairResult,
  CaseRefreshResult,
} from './ports';

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;
const MODERATE_MEMBERS = 1n << 40n;
const BAN_MEMBERS = 1n << 2n;
const KICK_MEMBERS = 1n << 1n;

type BooleanCaseKind = Exclude<
  CaseCommand['kind'],
  | 'open_admin_case'
  | 'repair_active_case'
  | 'refresh_case_notification'
  | 'close_case_no_action'
  | 'sync_existing_ban'
  | 'verify_case_user'
>;
type BooleanCaseOutcome = {
  [K in BooleanCaseKind]: { readonly kind: K; readonly succeeded: boolean };
}[BooleanCaseKind];

export type CaseOutcome =
  | {
      readonly kind: 'verify_case_user';
      readonly succeeded: boolean;
      readonly roleGateResult?: RoleGateResolutionResult;
    }
  | {
      readonly kind: 'open_admin_case';
      readonly result: CaseOpenResult & { readonly sourceMessageFetched?: boolean };
    }
  | { readonly kind: 'repair_active_case'; readonly result: CaseRepairResult }
  | { readonly kind: 'refresh_case_notification'; readonly result: CaseRefreshResult }
  | {
      readonly kind: 'close_case_no_action';
      readonly count: number;
      readonly roleGateResult?: RoleGateResolutionResult;
    }
  | { readonly kind: 'sync_existing_ban'; readonly count: number }
  | BooleanCaseOutcome;
export interface CaseActions {
  execute(context: ActionContext, command: CaseCommand): Promise<ActionResult<CaseOutcome>>;
}
function requiredPermissions(command: CaseCommand): bigint {
  return (command.kind === 'repair_active_case' && command.intent === 'administrator_repair') ||
    command.kind === 'refresh_case_notification' ||
    command.kind === 'manual_flag_user'
    ? 0n
    : command.kind === 'open_admin_case'
      ? command.intent === 'native_case_open'
        ? MODERATE_MEMBERS
        : MANAGE_GUILD
      : command.kind === 'kick_case_user' || command.kind === 'kick_user'
        ? KICK_MEMBERS
        : command.kind === 'ban_user' ||
            command.kind === 'ban_case_user' ||
            command.kind === 'ban_case_user_by_id' ||
            command.kind === 'sync_existing_ban'
          ? BAN_MEMBERS
          : MANAGE_GUILD | MODERATE_MEMBERS;
}

async function authorizeCase(
  deps: CaseDependencies,
  context: ActionContext,
  command: CaseCommand
): Promise<ActionDenialCode | null> {
  if (context.actor.kind !== 'user') return 'permission_denied';
  const actor = await deps.authority.loadFresh(context.guildId, context.actor.userId);
  if (!actor || !actor.present) return 'actor_unavailable';
  if (actor.guildId !== context.guildId || actor.userId !== context.actor.userId)
    return 'binding_mismatch';
  const bits = /^\d+$/.test(actor.permissions) ? BigInt(actor.permissions) : 0n;
  const admin = actor.owner || (bits & ADMINISTRATOR) !== 0n;
  const required = requiredPermissions(command);
  if (!admin && (bits & required) === 0n) return 'permission_denied';

  return null;
}

async function validateCaseState(
  deps: CaseDependencies,
  context: ActionContext,
  command: CaseCommand
): Promise<ActionDenialCode | null> {
  if (
    (command.kind === 'ban_user' || command.kind === 'kick_user') &&
    context.actor.kind === 'user' &&
    command.targetUserId === context.actor.userId
  )
    return 'permission_denied';
  if ('caseId' in command) {
    const state = await deps.repository.findById(command.caseId);
    if (!state || state.server_id !== context.guildId || state.user_id !== command.targetUserId)
      return 'binding_mismatch';
    if (command.kind !== 'refresh_case_notification' && command.kind !== 'reopen_case') {
      if (state.status !== 'pending') return 'stale_state';
      const active = await deps.repository.findActive(context.guildId, command.targetUserId);
      if (active?.id !== command.caseId) return 'stale_state';
    }
    if (command.kind === 'reopen_case') {
      const active = await deps.repository.findActive(context.guildId, command.targetUserId);
      if (state.status === 'pending' || active?.status === 'pending') return 'stale_state';
    }
    if (
      (command.kind === 'close_case_no_action' && state.case_kind === 'compromised_account') ||
      (command.kind === 'repair_active_case' && state.attention_state === 'parked')
    )
      return 'stale_state';
  }

  return null;
}

async function validateCaseReferences(
  deps: CaseDependencies,
  context: ActionContext,
  command: CaseCommand
): Promise<ActionDenialCode | null> {
  if ('detectionEventId' in command && command.detectionEventId) {
    const detection = await deps.repository.findDetection(command.detectionEventId);
    if (
      !detection ||
      detection.server_id !== context.guildId ||
      detection.user_id !== command.targetUserId ||
      (command.kind === 'open_case_from_observed_detection' &&
        command.reportId !== null &&
        command.reportId !== detection.reportId)
    )
      return 'binding_mismatch';
  }
  if ('selectedMessage' in command && command.selectedMessage) {
    const source = await deps.repository.findSourceMessage(
      command.selectedMessage.channelId,
      command.selectedMessage.messageId
    );
    if (source && (source.guildId !== context.guildId || source.userId !== command.targetUserId))
      return 'binding_mismatch';
  }

  return null;
}

function caseEnforcementReason(
  source: string,
  action: 'ban' | 'kick',
  reason: string | undefined
): string {
  if (reason) return reason;
  if (source === 'web') return `No reason provided for web ${action} action.`;
  return action === 'ban'
    ? 'Banned by moderator during verification'
    : 'Kicked by moderator during verification';
}
async function executeCaseWorkflow(
  deps: CaseDependencies,
  input: CaseWorkflowInput,
  command: CaseCommand,
  reason: string | undefined
): Promise<CaseOutcome> {
  switch (command.kind) {
    case 'ban_user':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.ban({
          ...input,
          reason:
            reason ||
            (command.intent === 'slash_command'
              ? 'No reason provided'
              : 'Banned by moderator action'),
          detectionEventId: undefined,
        }),
      };
    case 'kick_user':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.kick({
          ...input,
          reason: reason || 'Kicked by moderator action',
          detectionEventId: undefined,
        }),
      };
    case 'open_admin_case':
      return {
        kind: command.kind,
        result: await deps.workflows.openAdmin({
          ...input,
          reason,
          source: command.selectedMessage
            ? {
                source: 'message_context_case',
                source_channel_id: command.selectedMessage.channelId,
                source_message_id: command.selectedMessage.messageId,
              }
            : undefined,
        }),
      };
    case 'open_case_from_observed_detection':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.openObserved({
          ...input,
          detectionEventId: command.detectionEventId,
        }),
      };
    case 'manual_flag_user':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.manualFlag({ ...input, reason }),
      };
    case 'verify_case_user':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.verify({ ...input, caseId: command.caseId }),
      };
    case 'close_case_no_action':
      return {
        kind: command.kind,
        count: await deps.workflows.closeNoAction({ ...input, caseId: command.caseId }),
      };
    case 'sync_existing_ban':
      return {
        kind: command.kind,
        count: await deps.workflows.syncExistingBan({ ...input, caseId: command.caseId }),
      };
    case 'repair_active_case':
      return {
        kind: command.kind,
        result: await deps.workflows.repair({ ...input, caseId: command.caseId }),
      };
    case 'reopen_case':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.reopen({ ...input, caseId: command.caseId }),
      };
    case 'refresh_case_notification':
      return {
        kind: command.kind,
        result: await deps.workflows.refresh({ ...input, caseId: command.caseId }),
      };
    case 'kick_case_user':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.kick({
          ...input,
          caseId: command.caseId,
          reason: caseEnforcementReason(input.sourceSurface, 'kick', reason),
          detectionEventId: command.detectionEventId ?? undefined,
        }),
      };
    case 'ban_case_user':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.ban({
          ...input,
          caseId: command.caseId,
          reason: caseEnforcementReason(input.sourceSurface, 'ban', reason),
          detectionEventId: command.detectionEventId ?? undefined,
        }),
      };
    case 'ban_case_user_by_id':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.banById({
          ...input,
          caseId: command.caseId,
          reason: caseEnforcementReason(input.sourceSurface, 'ban', reason),
          detectionEventId: command.detectionEventId ?? undefined,
        }),
      };
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

export function createCaseActions(deps: CaseDependencies): CaseActions {
  return {
    async execute(context, command): Promise<ActionResult<CaseOutcome>> {
      // Consume per-attempt evidence even when fresh policy or authority later denies execution.
      const confirmationVerified =
        command.kind === 'repair_active_case' ||
        command.kind === 'refresh_case_notification' ||
        (await deps.confirmations.verify(context, command));
      const authorityDenial = await authorizeCase(deps, context, command);
      if (authorityDenial) return { kind: 'denied', code: authorityDenial };
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      const stateDenial = await validateCaseState(deps, context, command);
      if (stateDenial) return { kind: 'denied', code: stateDenial };
      const referenceDenial = await validateCaseReferences(deps, context, command);
      if (referenceDenial) return { kind: 'denied', code: referenceDenial };
      const policy = await deps.settings.loadFresh(context.guildId);
      const reason = 'reason' in command ? command.reason?.trim() || undefined : undefined;
      const policyDenial = evaluateCasePolicy(command, policy);
      if (policyDenial) return { kind: 'denied', code: policyDenial };
      if (!confirmationVerified) return { kind: 'denied', code: 'confirmation_required' };
      const input = {
        guildId: context.guildId,
        actorId: context.actor.userId,
        targetUserId: command.targetUserId,
        sourceSurface: context.source,
      };
      const bound = 'caseId' in command ? { ...input, caseId: command.caseId } : input;
      const roleGatePreview =
        (command.kind === 'verify_case_user' || command.kind === 'close_case_no_action') &&
        deps.roleGate
          ? await deps.roleGate.preview(bound).catch(() => null)
          : null;
      const outcome = await executeCaseWorkflow(deps, input, command, reason);
      if (
        deps.roleGate &&
        roleGatePreview &&
        ((outcome.kind === 'verify_case_user' && outcome.succeeded) ||
          (outcome.kind === 'close_case_no_action' && outcome.count > 0))
      ) {
        const roleGateResult = await deps.roleGate.apply(
          bound,
          outcome.kind === 'verify_case_user' ? 'verify' : 'close_no_action',
          roleGatePreview
        );
        return { kind: 'outcome', outcome: { ...outcome, roleGateResult } };
      }
      return { kind: 'outcome', outcome };
    },
  };
}
