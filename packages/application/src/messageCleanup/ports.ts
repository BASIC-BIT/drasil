import type { AuthorityPort } from '../authorization';
import type { ConfirmationPort } from '../confirmation';
import type { ActionContext } from '../context';
import type { MessageCleanupCommand } from './commands';
export interface MessageCleanupJob {
  id: string;
  guildId: string;
  caseId: string;
  targetUserId: string;
  requestedBy: string;
  source: string;
  mode: MessageCleanupCommand['mode'];
  scope: MessageCleanupCommand['scope'];
  reason: string;
  evidenceThreadId: string;
  generation: string | null;
  status: string;
  coverage: string | null;
  candidateCount: number;
  banStatus: 'not_requested' | 'pending' | 'succeeded' | 'failed';
  caseFinalizationStatus: 'not_applicable' | 'pending' | 'succeeded' | 'failed';
}
export interface MessageCleanupCase {
  readonly id: string;
  readonly guildId: string;
  readonly targetUserId: string | null;
  readonly evidenceThreadId: string | null;
  readonly status: string;
}
export interface MessageCleanupCounts {
  readonly alreadyCompleted: boolean;
  readonly preservedCount: number;
  readonly deletedCount: number;
  readonly alreadyMissingCount: number;
  readonly changedCount: number;
  readonly evidenceFailedCount: number;
  readonly deleteFailedCount: number;
  readonly permissionDeniedCount: number;
}
export interface MessageCleanupDependencies {
  readonly authority: AuthorityPort;
  readonly confirmations: ConfirmationPort;
  readonly settings: {
    loadFresh(guildId: string): Promise<{ readonly moderatorBanActionEnabled: boolean }>;
  };
  readonly cases: { find(caseId: string): Promise<MessageCleanupCase | null> };
  readonly jobs: {
    find(jobId: string): Promise<MessageCleanupJob | null>;
    fail(jobId: string, message: string): Promise<void>;
    setBanStatus(jobId: string, status: MessageCleanupJob['banStatus']): Promise<void>;
    setFinalizationStatus(
      jobId: string,
      status: MessageCleanupJob['caseFinalizationStatus']
    ): Promise<void>;
  };
  readonly recovery: {
    resolveCommitted(
      context: ActionContext,
      command: MessageCleanupCommand
    ): Promise<{
      readonly kind: 'recorded_operation' | 'legacy_unowned';
      readonly context: ActionContext;
    } | null>;
  };
  readonly workflows: {
    preview(jobId: string): Promise<MessageCleanupJob>;
    cleanup(jobId: string): Promise<MessageCleanupCounts>;
    assertBotPermissions(
      guildId: string,
      requirements: { ban: boolean; deleteMessages: boolean }
    ): Promise<void>;
    markPending(caseId: string, jobId: string): Promise<void>;
    clearMarker(caseId: string, jobId: string): Promise<void>;
    ban(context: ActionContext, command: MessageCleanupCommand): Promise<void>;
    finalize(context: ActionContext, command: MessageCleanupCommand): Promise<void>;
  };
}
