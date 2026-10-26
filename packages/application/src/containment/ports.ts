import type { ActionContext } from '../context';
import type { AuthorityPort } from '../authorization';
import type { CaseState, CaseRepairResult } from '../cases/ports';
import type { QuarantineExecuteInput, QuarantineTarget } from './quarantine';

export interface QuarantineRoleDetail {
  readonly role_id: string;
  readonly role_name?: string;
  readonly reason: string;
}
export interface QuarantinePreview {
  readonly enabled: boolean;
  readonly caseRoleId: string | null;
  readonly canContain: boolean;
  readonly rolePreview: {
    readonly plannedRoleIds: readonly string[];
    readonly privilegedRoleIds: readonly string[];
    readonly skippedRoles: readonly QuarantineRoleDetail[];
  };
  readonly lockdown: {
    readonly enabled: boolean;
    readonly errorCount: number;
    readonly issues: readonly {
      readonly code: string;
      readonly message: string;
      readonly severity: string;
    }[];
    readonly plannedActions: readonly unknown[];
  };
  readonly memberAudit: {
    readonly bypasses: readonly {
      readonly channelId: string;
      readonly channelName: string;
      readonly permissions: readonly string[];
      readonly subjectId: string;
      readonly subjectType: string;
    }[];
    readonly unremovablePrivilegeReasons: readonly string[];
  };
}
export interface QuarantineReadiness {
  readonly adminNotificationReady: boolean;
  readonly recoveryThreadId: string | null;
  readonly recoveryThreadReady: boolean;
}
export interface QuarantinePreviewData {
  readonly preview: QuarantinePreview;
  readonly readiness: QuarantineReadiness;
  readonly fingerprint: string;
  readonly roleNames: Readonly<Record<string, string>>;
}
export interface QuarantineExecutionResult {
  readonly status: 'parked' | 'incomplete';
  readonly containmentStatus: string;
  readonly failedRoleRemovals: number;
  readonly memberBypasses: number;
  readonly retainedRoles: number;
  readonly lockdownChangesRequired: number;
  readonly recovered: boolean;
}
export interface QuarantinePreviewBinding extends QuarantineTarget {
  readonly guildId: string;
  readonly actorId: string;
  readonly fingerprint: string;
  readonly expiresAt: number;
}
export interface QuarantinePolicy {
  readonly enabled: boolean;
}
export interface QuarantineDependencies {
  readonly authority: AuthorityPort;
  readonly settings: { loadFresh(guildId: string): Promise<QuarantinePolicy> };
  readonly repository: {
    findActive(guildId: string, targetUserId: string): Promise<CaseState | null>;
  };
  readonly previews: {
    resolve(
      context: ActionContext,
      input: QuarantineExecuteInput
    ): Promise<QuarantinePreviewBinding | null>;
  };
  readonly workflows: {
    preview(context: ActionContext, input: QuarantineTarget): Promise<QuarantinePreviewData>;
    repair(context: ActionContext, input: QuarantineTarget): Promise<CaseRepairResult>;
    quarantine(
      context: ActionContext,
      input: QuarantineExecuteInput
    ): Promise<QuarantineExecutionResult>;
    recoverCommitted(
      context: ActionContext,
      input: QuarantineExecuteInput
    ): Promise<QuarantineExecutionResult | null>;
  };
  readonly now: () => number;
}
