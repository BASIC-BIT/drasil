import type { MessageCleanupCaseWorkspace, MessageCleanupJobDetail } from '@drasil/contracts';
import type { InboxStateAction } from '@/components/inbox/InboxActionForm';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';

export interface CaseMessageCleanupIntegration {
  readonly workspace: MessageCleanupCaseWorkspace;
  readonly deleteOnlyJob: MessageCleanupJobDetail | null;
  readonly combinedJob: MessageCleanupJobDetail | null;
  readonly previewAction: InboxStateAction;
  readonly executeAction: InboxStateAction;
  readonly combinedBanAction: InboxStateAction;
  readonly deleteOnlyRequest?: ModerationActionRequestSummary | null;
  readonly combinedRequest?: ModerationActionRequestSummary | null;
  /** Completed fresh same-case read; never a job event timestamp. */
  readonly loadedAt: string;
  readonly returnHref: string;
  readonly requests: readonly ModerationActionRequestSummary[];
  readonly channelNames?: Readonly<Record<string, string>>;
}
