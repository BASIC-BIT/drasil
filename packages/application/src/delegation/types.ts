import type { ActionContext } from '../context';
import type { CaseOutcome } from '../cases/actions';
import type { DetectionOutcome } from '../detections/actions';
import type { OperationsOutcome } from '../operations/actions';
import type { ReportOutcome } from '../reports/actions';
import type { SetupOutcome } from '../setup/actions';
import type { MessageCleanupOutcome } from '../messageCleanup/actions';
import type { CaptchaOutcome } from '../containment/captcha';
import type { QuarantinePreviewData, QuarantineExecutionResult } from '../containment/ports';
import type { CloseSubmittedReportResult, OpenSubmittedReportCaseResult } from '../reports/review';
import type { AttentionOutcome } from '../operations/attention';
import type { SetupServerRecord } from '../setup/settings';
import { type WorkflowId, type WorkflowCommandBindings, type HumanCommand } from './commands';
import type { QueuedCommand } from '../requests/commands';
import type { EnqueueInput } from '../requests/receipt';
import type { DecodedQueuedAction, QueuedRow } from '../requests/decode';
import type { AccessDecision } from './access';

export type DelegatedScope = 'drasil:read' | 'drasil:moderate' | 'drasil:configure';
export type GuildSelection =
  | { readonly mode: 'selected'; readonly guildIds: readonly string[] }
  | { readonly mode: 'all_eligible' };
/** Constructed only after verified authentication and a fresh persisted grant lookup. */
export interface DelegatedPrincipal {
  readonly userId: string;
  readonly clientId: string;
  readonly connectionId: string;
  readonly grantVersion: number;
  readonly scopes: readonly DelegatedScope[];
}
export interface ConnectionGrant {
  readonly userId: string;
  readonly clientId: string;
  readonly connectionId: string;
  readonly selection: GuildSelection;
  readonly scopes: readonly DelegatedScope[];
  readonly version: number;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}
export type ConfirmationMethod =
  'elicitation' | 'client_confirmation' | 'website' | 'discord' | 'not_required';
export type IntentPreconditions =
  | import('../reports/resolution').ReportMessagePrecondition
  | import('../reports/review').ReportCasePrecondition
  | import('../reports/delegation').IntakePromptPrecondition
  | import('../cases/delegation').CasePreconditions
  | {
      readonly kind: 'cleanup_job_provision';
      readonly jobId: string;
      readonly caseId: string;
      readonly targetUserId: string;
      readonly revision: number;
      readonly evidenceThreadId: string;
      readonly detectionEventId: string | null;
    }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'resource_revision';
      readonly resource: {
        readonly kind: 'case' | 'report' | 'detection' | 'intake' | 'operation';
        readonly id: string;
      };
      readonly revision: number;
    }
  | {
      readonly kind: 'cleanup_preview';
      readonly jobId: string;
      readonly generation: string | null;
      readonly expiresAt: Date | null;
    }
  | {
      readonly kind: 'quarantine_preview';
      readonly requestId: string;
      readonly fingerprint: string;
      readonly expiresAt: Date;
    }
  | {
      readonly kind: 'report_ban_review';
      readonly operationId: string;
      readonly reviewReference: string;
      readonly expiresAt: Date;
    }
  | {
      readonly kind: 'setup';
      readonly approvedState: SetupServerRecord;
      readonly provisioning?: import('../setup/selection').SetupProvisioningSelection;
    };
export type HumanOutcome =
  | CaseOutcome
  | DetectionOutcome
  | OperationsOutcome
  | ReportOutcome
  | SetupOutcome
  | MessageCleanupOutcome
  | Exclude<CaptchaOutcome, { action_type: 'apply_captcha_pass' | 'notify_captcha_attention' }>
  | QuarantinePreviewData
  | QuarantineExecutionResult
  | CloseSubmittedReportResult
  | OpenSubmittedReportCaseResult
  | AttentionOutcome
  | readonly AttentionOutcome[]
  | { readonly kind: 'attention_batch'; readonly items: readonly PublicItemOutcome[] };
export interface DirectActionExecutor {
  execute(
    context: ActionContext,
    command: HumanCommand,
    preconditions: IntentPreconditions
  ): Promise<HumanOutcome>;
}
export interface DelegatedDeliveryBinding {
  readonly executionId: string;
  readonly connectionId: string;
  readonly grantVersion: number;
  readonly commandDigest: string;
}

export type CreateConnectionInput = Pick<
  ConnectionGrant,
  'userId' | 'clientId' | 'selection' | 'scopes'
>;
export type ConnectionMutationResult =
  | { readonly kind: 'updated'; readonly grant: ConnectionGrant }
  | { readonly kind: 'conflict' }
  | {
      readonly kind: 'denied';
      readonly reason: 'not_found' | 'identity_mismatch' | 'revoked';
    };
export interface DelegationStore extends IntentStore, ExecutionStore {
  createConnection(input: CreateConnectionInput): Promise<ConnectionGrant>;
  findConnection(id: string): Promise<ConnectionGrant | null>;
  updateSelection(
    principal: DelegatedPrincipal,
    selection: GuildSelection,
    expectedVersion: number
  ): Promise<ConnectionMutationResult>;
  revokeConnection(
    principal: DelegatedPrincipal,
    expectedVersion: number
  ): Promise<ConnectionMutationResult>;
}

export type AuthorizedDelivery =
  | import('../reports/terminal').ReportCaseTerminalDelivery
  | { readonly kind: 'direct' }
  | { readonly kind: 'queued'; readonly command: QueuedCommand; readonly commandDigest: string };
export interface IntentInvocation {
  readonly workflowId: WorkflowId;
  readonly guildId: string;
  readonly idempotencyKey: string;
  readonly input: unknown;
}
/** Runtime-only resolution. Implementations must read current state without consuming previews,
 * creating defaults, performing enforcement, writing settings or queuing work. */
export interface IntentResolution {
  readonly bindings?: WorkflowCommandBindings;
  readonly delivery:
    | import('../reports/terminal').ReportCaseTerminalDelivery
    | { readonly kind: 'direct' }
    | { readonly kind: 'queued'; readonly command: QueuedCommand };
  readonly preconditions: IntentPreconditions;
  readonly relevantState: unknown;
  readonly summary: string;
  readonly previewExpiresAt: Date | null;
}
export interface IntentResolver {
  resolve(
    principal: DelegatedPrincipal,
    invocation: IntentInvocation,
    context?: { readonly kind: 'revalidate'; readonly previous: ResolvedIntent }
  ): Promise<IntentResolution>;
}
export interface ResolvedIntent {
  readonly workflowId: WorkflowId;
  readonly guildId: string;
  readonly command: HumanCommand;
  readonly commandDigest: string;
  readonly authorizedDelivery: AuthorizedDelivery;
  readonly preconditions: IntentPreconditions;
  readonly stateFingerprint: string;
  readonly summary: string;
  readonly previewExpiresAt: Date | null;
}
export interface IntentRecord extends ResolvedIntent {
  readonly userId: string;
  readonly clientId: string;
  readonly connectionId: string;
  readonly grantVersion: number;
  readonly confirmationId: string;
  readonly idempotencyKey: string;
  readonly invocationDigest: string;
  readonly input: unknown;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly state: 'pending' | 'consumed' | 'cancelled' | 'expired' | 'denied';
  readonly confirmationMethod: ConfirmationMethod | null;
  readonly executionId: string | null;
}
export interface ExecutionRecord extends ResolvedIntent {
  readonly userId: string;
  readonly clientId: string;
  readonly connectionId: string;
  readonly grantVersion: number;
  readonly executionId: string;
  readonly confirmationId: string;
  readonly confirmationMethod: ConfirmationMethod;
  readonly queueRequestId: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly outcome: {
    readonly kind: 'delegated_terminal';
    readonly result: ActionCompletion;
  } | null;
}
export type IntentDelivery =
  { readonly kind: 'direct' } | { readonly kind: 'report_case_terminal' } | EnqueueInput;
/** Trusted persistence interface. The runtime resolves/revalidates before acceptance;
 * this store atomically binds only the frozen, canonical delivery. */
export interface IntentStore {
  saveIntent(principal: DelegatedPrincipal, intent: IntentRecord): Promise<IntentRecord>;
  findIntentByKey(principal: DelegatedPrincipal, key: string): Promise<IntentRecord | null>;
  loadIntent(principal: DelegatedPrincipal, confirmationId: string): Promise<IntentRecord | null>;
  denyIntent(principal: DelegatedPrincipal, confirmationId: string): Promise<IntentRecord | null>;
  cancelIntent(principal: DelegatedPrincipal, confirmationId: string): Promise<IntentRecord | null>;
  acceptIntent(
    principal: DelegatedPrincipal,
    confirmationId: string,
    method: ConfirmationMethod,
    delivery: IntentDelivery
  ): Promise<ExecutionRecord>;
}

export type PublicActionState =
  | 'confirmation_required'
  | 'queued'
  | 'running'
  | 'completed'
  | 'denied'
  | 'failed'
  | 'partial'
  | 'uncertain';
export type PublicScalar = string | number | boolean | null;
export interface PublicItemOutcome {
  readonly itemId: string;
  readonly state: 'completed' | 'denied' | 'failed' | 'uncertain';
  readonly status?: string;
}
export interface PublicFamilyOutcome {
  readonly status?: string;
  readonly queueCleanupStatus?: string;
  readonly succeeded?: boolean;
  readonly count?: number;
  readonly items?: readonly PublicItemOutcome[];
  readonly details?: Readonly<Record<string, PublicScalar>>;
}
export interface ActionCompletion {
  readonly state: 'completed' | 'denied' | 'failed' | 'partial' | 'uncertain';
  readonly code?: string;
  readonly outcome?: PublicFamilyOutcome;
}
export interface PublicActionResult {
  readonly state: PublicActionState;
  readonly executionId?: string;
  readonly requestId?: string;
  readonly operation?: WorkflowId;
  readonly guildId?: string;
  readonly targetUserId?: string;
  readonly confirmationId?: string;
  readonly summary?: string;
  readonly expiresAt?: string;
  readonly previewReference?: string;
  readonly previewExpiresAt?: string | null;
  readonly retryAfterMs?: number;
  readonly code?: string;
  readonly outcome?: PublicFamilyOutcome;
}
export type WorkerAdmission =
  | { readonly kind: 'ordinary' }
  | {
      readonly kind: 'new_execution' | 'committed_reconciliation' | 'committed_containment';
      readonly execution: ExecutionRecord;
    }
  | { readonly kind: 'already_bound'; readonly execution: ExecutionRecord }
  | { readonly kind: 'denied'; readonly code: string; readonly persistence?: 'observe_only' };
export interface DelegatedQueueAdmission {
  readonly request: QueuedRow;
  readonly action: DecodedQueuedAction;
  readonly recovery: boolean;
}
export type ExecutionAuthorization = (
  principal: DelegatedPrincipal,
  execution: ExecutionRecord
) => Promise<AccessDecision>;
/** Trusted runtime port: admission holds the connection lock through fresh authority and start. */
export interface ExecutionStore {
  loadExecution(
    principal: DelegatedPrincipal,
    executionId: string
  ): Promise<ExecutionRecord | null>;
  startDirectExecution(
    executionId: string,
    authorize: ExecutionAuthorization
  ): Promise<WorkerAdmission>;
  admitQueuedExecution(
    input: DelegatedQueueAdmission,
    authorize: ExecutionAuthorization
  ): Promise<WorkerAdmission>;
  completeExecution(executionId: string, result: ActionCompletion): Promise<void>;
}
