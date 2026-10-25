export type IntegrityAuditFindingSeverity = 'error' | 'warning' | 'info';

export interface IntegrityAuditFinding {
  readonly severity: IntegrityAuditFindingSeverity;
  readonly code: string;
  readonly subject: string;
  readonly detail: string;
  readonly userId?: string;
  readonly verificationEventId?: string;
}

export interface IntegrityAuditReport {
  readonly guildId: string;
  readonly checkedAt: Date;
  readonly scope: 'all' | 'cases' | 'case_role' | 'queue';
  readonly days: number;
  readonly limit: number;
  readonly userId?: string;
  readonly candidateCounts: {
    readonly pendingCases: number;
    readonly recentResolvedCases: number;
    readonly caseRoleMembers: number;
    readonly activeRoleQuarantines: number;
    readonly queueItems: number;
  };
  readonly findings: IntegrityAuditFinding[];
}

export type CaseRoleLockdownSeverity = 'error' | 'warning';
export type CaseRoleLockdownActionScope = 'category' | 'channel';

export interface CaseRoleLockdownIssue {
  readonly severity: CaseRoleLockdownSeverity;
  readonly code: string;
  readonly message: string;
}

export interface CaseRoleLockdownPlannedAction {
  readonly scope: CaseRoleLockdownActionScope;
  readonly channelId: string;
  readonly channelName: string;
}

export interface CaseRoleLockdownApplyFailure extends CaseRoleLockdownPlannedAction {
  readonly message: string;
}

export interface CaseRoleLockdownReport {
  readonly guildId: string;
  readonly checkedAt: Date;
  readonly enabled: boolean;
  readonly allowedChannelIds: readonly string[];
  readonly allowedCategoryIds: readonly string[];
  readonly autoAllowedChannelIds: readonly string[];
  readonly issues: readonly CaseRoleLockdownIssue[];
  readonly plannedActions: readonly CaseRoleLockdownPlannedAction[];
  readonly appliedActions: readonly CaseRoleLockdownPlannedAction[];
  readonly failedActions: readonly CaseRoleLockdownApplyFailure[];
  readonly syncedAllowedChannels: readonly CaseRoleLockdownPlannedAction[];
  readonly unsyncedAllowedChannels: readonly CaseRoleLockdownPlannedAction[];
  readonly errorCount: number;
  readonly warningCount: number;
}

export interface ResolvedThreadClosureResult {
  threadId: string;
  threadKind: 'case' | 'private_evidence';
  wouldClose: boolean;
  closed: boolean;
  alreadyClosed: boolean;
  missing: boolean;
  error: string | null;
}

export interface CaseThreadClosureSweepCaseResult {
  readonly verificationEventId: string;
  readonly userId: string;
  readonly status: 'pending' | 'verified' | 'banned' | 'kicked' | 'closed_no_action';
  readonly threadResults: ResolvedThreadClosureResult[];
}

export interface CaseThreadClosureSweepReport {
  readonly execute: boolean;
  readonly days: number;
  readonly limit: number;
  readonly checkedCases: number;
  readonly checkedThreads: number;
  readonly wouldCloseThreads: number;
  readonly closedThreads: number;
  readonly alreadyClosedThreads: number;
  readonly missingThreads: number;
  readonly failedThreads: number;
  readonly cases: CaseThreadClosureSweepCaseResult[];
}

export interface RoleIntakeFailure {
  userId: string;
  message: string;
}

export interface RoleIntakeResult {
  batchId: string;
  roleId: string;
  roleName: string;
  action: 'open_case';
  execute: boolean;
  totalMembers: number;
  eligibleMembers: number;
  processed: number;
  opened: number;
  skippedBots: number;
  skippedActiveCases: number;
  skippedOverLimit: number;
  failed: number;
  failures: RoleIntakeFailure[];
}

export interface RoleIntakeProgress {
  result: RoleIntakeResult;
  completedMembers: number;
}
