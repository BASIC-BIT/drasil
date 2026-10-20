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
import type { SetupConfigurationState } from '../setup/ports';
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
      readonly expiresAt: Date;
    }
  | {
      readonly kind: 'quarantine_preview';
      readonly requestId: string;
      readonly fingerprint: string;
      readonly expiresAt: Date;
    }
  | { readonly kind: 'setup'; readonly approvedState: SetupConfigurationState };
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
