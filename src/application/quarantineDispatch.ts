import type {
  ActionContext,
  QuarantineActions,
  QuarantineTarget,
  QueuedQuarantineCommand,
  QuarantinePreviewData,
} from '@drasil/application';
import { requireQuarantineOutcome } from './adapters/quarantine';
type QuarantineRoleReceipt = {
  readonly role_id: string;
  readonly role_name: string | null;
};
export type QuarantinePreviewReceipt = {
  readonly action_type: 'preview_account_quarantine';
  readonly admin_notification_ready: boolean;
  readonly can_contain: boolean;
  readonly containment_fingerprint: string;
  readonly case_role: QuarantineRoleReceipt | null;
  readonly case_role_ready: boolean;
  readonly enabled: boolean;
  readonly lockdown_error_count: number;
  readonly lockdown_issues: Array<QuarantinePreviewData['preview']['lockdown']['issues'][number]>;
  readonly lockdown_planned_actions: number;
  readonly member_bypasses: {
    readonly channel_id: string;
    readonly channel_name: string;
    readonly permissions: string[];
    readonly subject_id: string;
    readonly subject_type: string;
  }[];
  readonly planned_roles: QuarantineRoleReceipt[];
  readonly previewed_at: string;
  readonly privileged_roles: QuarantineRoleReceipt[];
  readonly recovery_thread_ready: boolean;
  readonly recovery_thread_id: string | null;
  readonly retained_roles: {
    readonly role_id: string;
    readonly role_name?: string;
    readonly reason: string;
  }[];
  readonly target_user_id: string;
  readonly unremovable_privilege_reasons: string[];
  readonly verification_event_id: string;
};
function previewReceipt(
  input: QuarantineTarget,
  data: QuarantinePreviewData
): QuarantinePreviewReceipt {
  const { preview, readiness, fingerprint: containmentFingerprint, roleNames } = data;
  const { recoveryThreadReady, adminNotificationReady } = readiness;
  const event = { thread_id: readiness.recoveryThreadId };
  const roleSummary = (roleId: string): { role_id: string; role_name: string | null } => ({
    role_id: roleId,
    role_name: roleNames[roleId] ?? null,
  });
  return {
    action_type: 'preview_account_quarantine' as const,
    admin_notification_ready: adminNotificationReady,
    can_contain: preview.enabled && preview.canContain,
    containment_fingerprint: containmentFingerprint,
    case_role: preview.caseRoleId ? roleSummary(preview.caseRoleId) : null,
    case_role_ready:
      preview.caseRoleId !== null &&
      preview.lockdown.enabled &&
      preview.lockdown.errorCount === 0 &&
      preview.lockdown.plannedActions.length === 0 &&
      !preview.lockdown.issues.some(
        (issue) => issue.code === 'lockdown-case-role-global-permissions'
      ),
    enabled: preview.enabled,
    lockdown_error_count: preview.lockdown.errorCount,
    lockdown_issues: preview.lockdown.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
    })),
    lockdown_planned_actions: preview.lockdown.plannedActions.length,
    member_bypasses: preview.memberAudit.bypasses.map((bypass) => ({
      channel_id: bypass.channelId,
      channel_name: bypass.channelName,
      permissions: [...bypass.permissions],
      subject_id: bypass.subjectId,
      subject_type: bypass.subjectType,
    })),
    planned_roles: preview.rolePreview.plannedRoleIds.map(roleSummary),
    previewed_at: new Date().toISOString(),
    privileged_roles: preview.rolePreview.privilegedRoleIds.map(roleSummary),
    recovery_thread_ready: recoveryThreadReady,
    recovery_thread_id: event.thread_id,
    retained_roles: preview.rolePreview.skippedRoles.map((role) => ({ ...role })),
    target_user_id: input.targetUserId,
    unremovable_privilege_reasons: [...preview.memberAudit.unremovablePrivilegeReasons],
    verification_event_id: input.caseId,
  };
}
export type QueuedQuarantineOutcome =
  | QuarantinePreviewReceipt
  | {
      readonly action_type: 'quarantine_compromised_account';
      readonly containment_status: string;
      readonly failed_role_removals: number;
      readonly member_bypasses: number;
      readonly parked: boolean;
      readonly preview_request_id: string;
      readonly recovered_after_worker_interruption?: boolean;
      readonly retained_roles: number;
      readonly target_user_id: string;
      readonly verification_event_id: string;
    };
export async function dispatchQuarantineAction(
  actions: QuarantineActions,
  context: ActionContext,
  command: QueuedQuarantineCommand
): Promise<QueuedQuarantineOutcome> {
  if (command.kind === 'preview_account_quarantine')
    return previewReceipt(
      command,
      requireQuarantineOutcome(await actions.preview(context, command))
    );
  const result = requireQuarantineOutcome(await actions.execute(context, command));
  return {
    action_type: command.kind,
    containment_status: result.containmentStatus,
    failed_role_removals: result.failedRoleRemovals,
    member_bypasses: result.memberBypasses,
    parked: result.status === 'parked',
    preview_request_id: command.previewReference.requestId,
    ...(result.recovered ? { recovered_after_worker_interruption: true } : {}),
    retained_roles: result.retainedRoles,
    target_user_id: command.targetUserId,
    verification_event_id: command.caseId,
  };
}
