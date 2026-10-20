import type { AuthorityPort } from '../authorization';
import type { ConfirmationPort } from '../confirmation';
import type { OperationCommand } from './commands';
import type {
  CaseRoleLockdownReport,
  CaseThreadClosureSweepReport,
  IntegrityAuditReport,
  RoleIntakeResult,
} from './reports';
export interface OperationsDependencies {
  readonly authority: AuthorityPort;
  readonly confirmations: ConfirmationPort;
  readonly policy: {
    loadFresh(guildId: string): Promise<{ readonly intakeReasonRequired: boolean }>;
  };
  readonly queue: { sync(guildId: string): Promise<void>; clear(guildId: string): Promise<number> };
  readonly closure: {
    sweep(
      input: Extract<OperationCommand, { kind: 'close_resolved_case_threads' }> & {
        readonly guildId: string;
      }
    ): Promise<CaseThreadClosureSweepReport>;
  };
  readonly lockdown: {
    audit(guildId: string): Promise<CaseRoleLockdownReport>;
    apply(input: {
      readonly guildId: string;
      readonly actorId: string;
      readonly unsyncAllowedChannels: boolean;
    }): Promise<CaseRoleLockdownReport>;
  };
  readonly integrity: {
    audit(
      input: Extract<OperationCommand, { kind: 'audit_integrity' }> & { readonly guildId: string }
    ): Promise<IntegrityAuditReport>;
  };
  readonly intake: {
    run(
      input: Extract<OperationCommand, { kind: 'intake_role_members' }> & {
        readonly guildId: string;
        readonly actorId: string;
      }
    ): Promise<RoleIntakeResult>;
  };
}
