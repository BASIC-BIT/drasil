import { evaluateCasePolicy } from './policy';
import type { RoleGateResolutionResult } from './roleGate';
import type { ActionContext } from '../context';
import type { ActionResult } from '../results';
import type { CaseCommand } from './commands';
import type {
  CaseDependencies,
  CaseOpenResult,
  CaseRepairResult,
  CaseRefreshResult,
} from './ports';

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
export function createCaseActions(deps: CaseDependencies): CaseActions {
  return {
    async execute(context, command): Promise<ActionResult<CaseOutcome>> {
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      const actor = await deps.authority.loadFresh(context.guildId, context.actor.userId);
      if (!actor || !actor.present) return { kind: 'denied', code: 'actor_unavailable' };
      if (actor.guildId !== context.guildId || actor.userId !== context.actor.userId)
        return { kind: 'denied', code: 'binding_mismatch' };
      const bits = /^\d+$/.test(actor.permissions) ? BigInt(actor.permissions) : 0n;
      const admin = actor.owner || (bits & (1n << 3n)) !== 0n;
      const required =
        (command.kind === 'repair_active_case' && command.intent === 'administrator_repair') ||
        command.kind === 'refresh_case_notification' ||
        command.kind === 'manual_flag_user'
          ? 0n
          : command.kind === 'kick_case_user'
            ? 1n << 1n
            : command.kind === 'ban_case_user' ||
                command.kind === 'ban_case_user_by_id' ||
                command.kind === 'sync_existing_ban'
              ? 1n << 2n
              : (1n << 5n) | (1n << 40n);
      if (!admin && (bits & required) === 0n) return { kind: 'denied', code: 'permission_denied' };

      if ('caseId' in command) {
        const state = await deps.repository.findById(command.caseId);
        if (!state || state.server_id !== context.guildId || state.user_id !== command.targetUserId)
          return { kind: 'denied', code: 'binding_mismatch' };
        if (command.kind !== 'refresh_case_notification' && command.kind !== 'reopen_case') {
          if (state.status !== 'pending') return { kind: 'denied', code: 'stale_state' };
          const active = await deps.repository.findActive(context.guildId, command.targetUserId);
          if (active?.id !== command.caseId) return { kind: 'denied', code: 'stale_state' };
        }
        if (command.kind === 'reopen_case') {
          const active = await deps.repository.findActive(context.guildId, command.targetUserId);
          if (state.status === 'pending' || active?.status === 'pending')
            return { kind: 'denied', code: 'stale_state' };
        }
        if (
          (command.kind === 'close_case_no_action' && state.case_kind === 'compromised_account') ||
          (command.kind === 'repair_active_case' && state.attention_state === 'parked')
        )
          return { kind: 'denied', code: 'stale_state' };
      }
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
          return { kind: 'denied', code: 'binding_mismatch' };
      }
      if (command.kind === 'open_admin_case' && command.selectedMessage) {
        const source = await deps.repository.findSourceMessage(
          command.selectedMessage.channelId,
          command.selectedMessage.messageId
        );
        if (
          source &&
          (source.guildId !== context.guildId || source.userId !== command.targetUserId)
        )
          return { kind: 'denied', code: 'binding_mismatch' };
      }
      const policy = await deps.settings.loadFresh(context.guildId);
      const reason = 'reason' in command ? command.reason?.trim() || undefined : undefined;
      const policyDenial = evaluateCasePolicy(command, policy);
      if (policyDenial) return { kind: 'denied', code: policyDenial };
      if (command.kind !== 'repair_active_case' && command.kind !== 'refresh_case_notification') {
        const proof = await deps.confirmations.loadVerified(context, command);
        if (
          !proof ||
          proof.guildId !== context.guildId ||
          proof.actorId !== context.actor.userId ||
          proof.action !== command.kind ||
          proof.targetId !== ('caseId' in command ? command.caseId : command.targetUserId)
        )
          return { kind: 'denied', code: 'confirmation_required' };
      }
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
      let outcome: CaseOutcome;
      switch (command.kind) {
        case 'open_admin_case':
          outcome = {
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
          break;
        case 'open_case_from_observed_detection':
          outcome = {
            kind: command.kind,
            succeeded: await deps.workflows.openObserved({
              ...input,
              detectionEventId: command.detectionEventId,
            }),
          };
          break;
        case 'manual_flag_user':
          outcome = {
            kind: command.kind,
            succeeded: await deps.workflows.manualFlag({ ...input, reason }),
          };
          break;
        case 'verify_case_user':
          outcome = {
            kind: command.kind,
            succeeded: await deps.workflows.verify({ ...input, caseId: command.caseId }),
          };
          break;
        case 'close_case_no_action':
          outcome = {
            kind: command.kind,
            count: await deps.workflows.closeNoAction({ ...input, caseId: command.caseId }),
          };
          break;
        case 'sync_existing_ban':
          outcome = {
            kind: command.kind,
            count: await deps.workflows.syncExistingBan({ ...input, caseId: command.caseId }),
          };
          break;
        case 'repair_active_case':
          outcome = {
            kind: command.kind,
            result: await deps.workflows.repair({ ...input, caseId: command.caseId }),
          };
          break;
        case 'reopen_case':
          outcome = {
            kind: command.kind,
            succeeded: await deps.workflows.reopen({ ...input, caseId: command.caseId }),
          };
          break;
        case 'refresh_case_notification':
          outcome = {
            kind: command.kind,
            result: await deps.workflows.refresh({ ...input, caseId: command.caseId }),
          };
          break;
        case 'kick_case_user':
          outcome = {
            kind: command.kind,
            succeeded: await deps.workflows.kick({
              ...input,
              caseId: command.caseId,
              reason:
                reason ||
                (context.source === 'web'
                  ? 'No reason provided for web kick action.'
                  : 'Kicked by moderator during verification'),
              detectionEventId: command.detectionEventId ?? undefined,
            }),
          };
          break;
        case 'ban_case_user':
          outcome = {
            kind: command.kind,
            succeeded: await deps.workflows.ban({
              ...input,
              caseId: command.caseId,
              reason:
                reason ||
                (context.source === 'web'
                  ? 'No reason provided for web ban action.'
                  : 'Banned by moderator during verification'),
              detectionEventId: command.detectionEventId ?? undefined,
            }),
          };
          break;
        case 'ban_case_user_by_id':
          outcome = {
            kind: command.kind,
            succeeded: await deps.workflows.banById({
              ...input,
              caseId: command.caseId,
              reason:
                reason ||
                (context.source === 'web'
                  ? 'No reason provided for web ban action.'
                  : 'Banned by moderator during verification'),
              detectionEventId: command.detectionEventId ?? undefined,
            }),
          };
          break;
        default: {
          const exhaustive: never = command;
          return exhaustive;
        }
      }
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
