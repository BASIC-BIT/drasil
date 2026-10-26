import type { AuthorityPort } from '../authorization';
import type { ActionContext } from '../context';
import type { ConfirmationPort } from '../confirmation';
import type { SetupCommand, SetupChanges, HeuristicChanges } from './commands';
import type { CaptchaMethod, SetupServerRecord, SettingsChanges } from './settings';
export interface SetupDiagnosticReportData {
  readonly guildId: string;
  readonly checkedAt: Date;
  readonly issues: readonly {
    readonly severity: 'error' | 'warning';
    readonly code: string;
    readonly message: string;
  }[];
  readonly errorCount: number;
  readonly warningCount: number;
}
export type SetupProvisioningOutcome =
  | { status: 'candidate_validation_failed'; report: SetupDiagnosticReportData }
  | {
      status: 'verification_channel_failed';
      error: Error;
      setupFailureDetail: string;
      createdVerificationChannelId?: string;
    }
  | {
      status: 'final_validation_failed';
      report: SetupDiagnosticReportData;
      setupFailureDetail: string;
      createdVerificationChannelId?: string;
    }
  | {
      status: 'config_save_failed';
      error: unknown;
      setupFailureDetail: string;
      createdVerificationChannelId?: string;
    }
  | {
      status: 'completed';
      candidateReport: SetupDiagnosticReportData;
      caseRoleWasCreated: boolean;
      caseRoleId: string;
      adminChannelId: string;
      verificationChannelId: string;
      verificationChannelAction: 'configured' | 'created' | 'synced';
      reportInstructions?: {
        readonly action: string | null;
        readonly messageId: string | null;
        readonly error: string | null;
      };
    }
  | {
      readonly status: 'ambiguous_case_role';
      readonly roleName: string;
      readonly roleIds: readonly string[];
    }
  | { readonly status: 'ambiguous_verification_channel'; readonly channelIds: readonly string[] }
  | { readonly status: 'invalid_selection'; readonly detail: string };
export type SetupConfigurationState = Pick<SetupServerRecord, 'settings' | 'case_role_id'>;
export interface SetupPersistenceChange {
  readonly columns?: SetupChanges;
  readonly settings: SettingsChanges;
  readonly resetSettings?: readonly (
    'verification_prompt_template' | 'server_about' | 'verification_context' | 'expected_topics'
  )[];
}
export interface SetupHeuristics {
  readonly messageThreshold: number;
  readonly timeWindowMs: number;
  readonly suspiciousKeywords: readonly string[];
}
export interface ReportInstructionsOutcome {
  readonly action: 'sent' | 'updated' | 'recreated' | 'reposted';
  readonly messageId: string;
}
export interface SetupDependencies {
  readonly authority: AuthorityPort;
  readonly confirmations: ConfirmationPort;
  readonly provider: { isConfigured(method: Exclude<CaptchaMethod, 'none'>): boolean };
  readonly configuration: {
    loadFresh(guildId: string): Promise<SetupConfigurationState | null>;
    save(context: ActionContext, change: SetupPersistenceChange): Promise<SetupConfigurationState>;
    updateHeuristics(context: ActionContext, changes: HeuristicChanges): Promise<SetupHeuristics>;
    resetHeuristics(context: ActionContext, scope: 'all' | 'keywords'): Promise<SetupHeuristics>;
  };
  readonly provisioning: {
    complete(
      context: ActionContext,
      command: Extract<SetupCommand, { kind: 'complete_setup_verification' }>
    ): Promise<SetupProvisioningOutcome>;
  };
  readonly panels: {
    upsert(
      context: ActionContext,
      command: Extract<SetupCommand, { kind: 'upsert_report_instructions' }>
    ): Promise<ReportInstructionsOutcome>;
    clear(context: ActionContext): Promise<{ readonly action: 'cleared' | 'unchanged' }>;
  };
}
