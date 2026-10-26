import type {
  RoleGateResolutionPreview,
  RoleGateResolutionResult,
  RoleGateResolutionAction,
} from './roleGate';
import type { AuthorityPort } from '../authorization';
import type { ConfirmationPort } from '../confirmation';

export interface CaseState {
  readonly case_revision?: number;
  readonly id: string;
  readonly server_id: string;
  readonly user_id: string | null;
  readonly status: string;
  readonly case_kind?: string;
  readonly attention_state?: string;
}
export interface CasePolicy {
  readonly adminCaseOpenRequiresReason: boolean;
  readonly moderatorBanActionEnabled: boolean;
  readonly moderatorBanActionRequiresReason: boolean;
  readonly moderatorKickActionEnabled: boolean;
  readonly moderatorKickActionRequiresReason: boolean;
}
export interface CaseWorkflowInput {
  readonly guildId: string;
  readonly actorId: string;
  readonly targetUserId: string;
  readonly sourceSurface: string;
}
export interface BoundCaseWorkflowInput extends CaseWorkflowInput {
  readonly caseId: string;
}
export interface CaseSource {
  readonly source: 'message_context_case';
  readonly source_channel_id: string;
  readonly source_message_id: string;
}
export interface CaseOpenResult {
  readonly opened: boolean;
  readonly caseRoleActive: boolean;
  readonly caseRoleAttempted: boolean;
}
export interface CaseRepairResult {
  readonly repaired: boolean;
  readonly message: string;
  readonly threadCreated: boolean;
  readonly userAdded: boolean;
  readonly promptSent: boolean;
  readonly promptAlreadyPresent: boolean;
  readonly threadId?: string | null;
  readonly verificationEventId?: string;
  readonly notificationReady?: boolean;
}
export interface CaseRefreshResult {
  readonly refreshed: boolean;
  readonly message: string;
  readonly verificationEventId?: string;
  readonly status?: string;
  readonly notificationMessageId?: string | null;
  readonly notificationChannelId?: string | null;
}
export interface CaseWorkflows {
  openAdmin(
    input: CaseWorkflowInput & {
      readonly reason: string | undefined;
      readonly source: CaseSource | undefined;
    }
  ): Promise<CaseOpenResult & { readonly sourceMessageFetched?: boolean }>;
  openObserved(input: CaseWorkflowInput & { readonly detectionEventId: string }): Promise<boolean>;
  manualFlag(input: CaseWorkflowInput & { readonly reason: string | undefined }): Promise<boolean>;
  verify(input: BoundCaseWorkflowInput): Promise<boolean>;
  closeNoAction(input: BoundCaseWorkflowInput): Promise<number>;
  kick(
    input: CaseWorkflowInput & {
      readonly caseId?: string;
      readonly reason: string;
      readonly detectionEventId: string | undefined;
    }
  ): Promise<boolean>;
  ban(
    input: CaseWorkflowInput & {
      readonly caseId?: string;
      readonly reason: string;
      readonly detectionEventId: string | undefined;
    }
  ): Promise<boolean>;
  banById(
    input: BoundCaseWorkflowInput & {
      readonly reason: string;
      readonly detectionEventId: string | undefined;
    }
  ): Promise<boolean>;
  repair(input: BoundCaseWorkflowInput): Promise<CaseRepairResult>;
  reopen(input: BoundCaseWorkflowInput & { readonly caseId: string }): Promise<boolean>;
  refresh(input: BoundCaseWorkflowInput & { readonly caseId: string }): Promise<CaseRefreshResult>;
  syncExistingBan(input: BoundCaseWorkflowInput): Promise<number>;
}
export interface CaseDependencies {
  readonly roleGate: {
    preview(input: CaseWorkflowInput): Promise<RoleGateResolutionPreview | null>;
    apply(
      input: CaseWorkflowInput,
      action: RoleGateResolutionAction,
      preview: RoleGateResolutionPreview
    ): Promise<RoleGateResolutionResult>;
  } | null;
  readonly authority: AuthorityPort;
  readonly repository: {
    findSourceMessage(
      channelId: string,
      messageId: string
    ): Promise<{ readonly guildId: string | null; readonly userId: string } | null>;
    findById(caseId: string): Promise<CaseState | null>;
    findActive(guildId: string, userId: string): Promise<CaseState | null>;
    findDetection(detectionEventId: string): Promise<{
      readonly server_id: string | null;
      readonly user_id: string | null;
      readonly reportId: string | null;
    } | null>;
  };
  readonly settings: { loadFresh(guildId: string): Promise<CasePolicy> };
  readonly confirmations: ConfirmationPort;
  readonly workflows: CaseWorkflows;
}
