export type RoleGateResolutionAction = 'verify' | 'close_no_action';

export interface RoleGateRolePreview {
  readonly roleId: string;
  readonly roleName: string | null;
  readonly mention: string;
  readonly exists: boolean;
  readonly current: boolean;
  readonly quarantined: boolean;
}

export interface RoleGateResolutionPreview {
  readonly enabled: boolean;
  readonly honeypotRole: RoleGateRolePreview | null;
  readonly memberAccessRole: RoleGateRolePreview | null;
  readonly shouldRemoveHoneypot: boolean;
  readonly shouldAddMemberAccess: boolean;
  readonly warnings: readonly string[];
  readonly activeSnapshotId: string | null;
}

export interface RoleGateRoleResult {
  readonly roleId: string;
  readonly roleName: string | null;
  readonly operation: 'remove_honeypot' | 'add_member_access';
  readonly status:
    | 'removed'
    | 'added'
    | 'already_absent'
    | 'already_present'
    | 'kept_removed_by_quarantine'
    | 'failed';
  readonly message: string;
  readonly error?: string;
}

export interface RoleGateResolutionResult {
  readonly applied: boolean;
  readonly results: readonly RoleGateRoleResult[];
  readonly warnings: readonly string[];
  readonly summaryLines: readonly string[];
}
