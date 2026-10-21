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
import type { WorkflowId, WorkflowCommandBindings } from './commands';
import type { QueuedCommand } from '../requests/commands';
import type { EnqueueInput } from '../requests/receipt';
import type { HumanCommand } from './commands';

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
  | 'elicitation'
  | 'client_confirmation'
  | 'website'
  | 'discord'
  | 'not_required';
export type IntentPreconditions =
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
  | { readonly kind: 'setup'; readonly approvedState: SetupServerRecord };
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
  | readonly AttentionOutcome[];
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
export interface DelegationStore extends IntentStore {
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
    | { readonly kind: 'direct' }
    | { readonly kind: 'queued'; readonly command: QueuedCommand };
  readonly preconditions: IntentPreconditions;
  readonly relevantState: unknown;
  readonly summary: string;
  readonly previewExpiresAt: Date | null;
}
export interface IntentResolver {
  resolve(principal: DelegatedPrincipal, invocation: IntentInvocation): Promise<IntentResolution>;
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
  readonly outcome: HumanOutcome | null;
}
export type IntentDelivery = { readonly kind: 'direct' } | EnqueueInput;
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
