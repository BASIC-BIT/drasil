import type {
  ActionContext,
  OperationsActions,
  QueuedOperationCommand,
  OperationsOutcome,
} from '@drasil/application';
import { requireOperationsOutcome } from './adapters/operations';
export type QueuedOperationsOutcome = { readonly server_id: string } & (
  | {
      readonly action_type: 'audit_integrity';
      readonly error_count: number;
      readonly warning_count: number;
      readonly checked_cases: number;
    }
  | { readonly action_type: 'sync_moderation_queue'; readonly synced: true }
  | { readonly action_type: 'clear_moderation_queue'; readonly removed_count: number }
  | {
      readonly action_type: 'close_resolved_case_threads';
      readonly already_closed_threads: number;
      readonly checked_cases: number;
      readonly checked_threads: number;
      readonly closed_threads: number;
      readonly days: number;
      readonly execute: boolean;
      readonly failed_threads: number;
      readonly limit: number;
      readonly missing_threads: number;
      readonly would_close_threads: number;
    }
  | {
      readonly action_type: 'audit_case_role_lockdown' | 'apply_case_role_lockdown';
      readonly applied_writes: number;
      readonly enabled: boolean;
      readonly error_count: number;
      readonly failed_writes: number;
      readonly issues: { code: string; message: string; severity: 'error' | 'warning' }[];
      readonly planned_writes: number;
      readonly synced_allowed_channel_blockers: number;
      readonly unsynced_allowed_channels: number;
      readonly warning_count: number;
    }
  | {
      readonly action_type: 'intake_role_members';
      readonly batch_id: string;
      readonly eligible_members: number;
      readonly execute: boolean;
      readonly failed: number;
      readonly failures: { message: string; user_id: string }[];
      readonly opened: number;
      readonly processed: number;
      readonly role_id: string;
      readonly role_name: string;
      readonly skipped_active_cases: number;
      readonly skipped_bots: number;
      readonly skipped_over_limit: number;
      readonly total_members: number;
    }
);
export async function dispatchOperationsAction(
  actions: OperationsActions,
  context: ActionContext,
  command: QueuedOperationCommand
): Promise<QueuedOperationsOutcome> {
  return projectOperationsOutcome(
    context.guildId,
    requireOperationsOutcome(await actions.execute(context, command))
  );
}
function projectOperationsOutcome(
  serverId: string,
  outcome: OperationsOutcome
): QueuedOperationsOutcome {
  const base = { server_id: serverId };
  switch (outcome.kind) {
    case 'sync_moderation_queue':
      return { ...base, action_type: outcome.kind, synced: true };
    case 'clear_moderation_queue':
      return { ...base, action_type: outcome.kind, removed_count: outcome.removedCount };
    case 'close_resolved_case_threads': {
      const report = outcome.report;
      return {
        ...base,
        action_type: outcome.kind,
        already_closed_threads: report.alreadyClosedThreads,
        checked_cases: report.checkedCases,
        checked_threads: report.checkedThreads,
        closed_threads: report.closedThreads,
        days: report.days,
        execute: report.execute,
        failed_threads: report.failedThreads,
        limit: report.limit,
        missing_threads: report.missingThreads,
        would_close_threads: report.wouldCloseThreads,
      };
    }
    case 'audit_case_role_lockdown':
    case 'apply_case_role_lockdown': {
      const report = outcome.report;
      return {
        ...base,
        action_type: outcome.kind,
        applied_writes: report.appliedActions.length,
        enabled: report.enabled,
        error_count: report.errorCount,
        failed_writes: report.failedActions.length,
        issues: report.issues
          .slice(0, 8)
          .map((issue) => ({ code: issue.code, message: issue.message, severity: issue.severity })),
        planned_writes: report.plannedActions.length,
        synced_allowed_channel_blockers: report.syncedAllowedChannels.length,
        unsynced_allowed_channels: report.unsyncedAllowedChannels.length,
        warning_count: report.warningCount,
      };
    }
    case 'intake_role_members': {
      const result = outcome.result;
      return {
        ...base,
        action_type: outcome.kind,
        batch_id: result.batchId,
        eligible_members: result.eligibleMembers,
        execute: result.execute,
        failed: result.failed,
        failures: result.failures
          .slice(0, 8)
          .map((failure) => ({ message: failure.message, user_id: failure.userId })),
        opened: result.opened,
        processed: result.processed,
        role_id: result.roleId,
        role_name: result.roleName,
        skipped_active_cases: result.skippedActiveCases,
        skipped_bots: result.skippedBots,
        skipped_over_limit: result.skippedOverLimit,
        total_members: result.totalMembers,
      };
    }
    case 'audit_integrity':
      return {
        ...base,
        action_type: outcome.kind,
        error_count: outcome.report.findings.filter((f) => f.severity === 'error').length,
        warning_count: outcome.report.findings.filter((f) => f.severity === 'warning').length,
        checked_cases:
          outcome.report.candidateCounts.pendingCases +
          outcome.report.candidateCounts.recentResolvedCases,
      };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
