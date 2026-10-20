import type { AuthorityPort } from '../authorization';
import type { QueueMessageDeleter } from '../operations/attention';
import type {
  ReportReviewRepository,
  ReportReviewQueueRepository,
  ReportOpenCaseRepository,
  ReportCaseOpener,
} from './review';

export interface ReportReviewDependencies {
  readonly authority: AuthorityPort;
  readonly staffRoles: { loadRoleIds(guildId: string): Promise<readonly string[]> };
  readonly repository: ReportReviewRepository;
  readonly queueRepository: ReportReviewQueueRepository | null;
  readonly queueMessageDeleter: QueueMessageDeleter | null;
  readonly openCaseRepository: ReportOpenCaseRepository | null;
  readonly reportCaseOpener: ReportCaseOpener | null;
}

import type { ActionContext } from '../context';
import type { ReportCommand } from './commands';
export interface ReportIntakeState {
  id: string;
  guildId: string;
  reporterId: string;
  threadId: string | null;
  status: string;
  confirmedTargetUserId: string | null;
  promptMessageId: string | null;
  promptToken: string | null;
  candidateIds: readonly string[];
  claimed: boolean;
}
export interface ReportAttachment {
  id?: string;
  name?: string;
  url?: string;
  proxyUrl?: string;
  contentType?: string;
  size?: number;
}
export type ReportSubmissionResult =
  | { status: 'submitted'; targetUserId: string; targetUsername?: string }
  | { status: 'self_report' }
  | { status: 'reason_required' }
  | { status: 'member_not_found'; label: string }
  | { status: 'failed'; error: unknown };
export interface ReportConfirmationResult {
  confirmed: boolean;
  message: string;
  reporterId?: string;
  reason?: string;
  attachments?: ReportAttachment[];
}
export interface ReportCloseResult {
  closed: boolean;
  message: string;
  shouldArchiveThread?: boolean;
}
export interface ReportDependencies {
  readonly authority: AuthorityPort;
  readonly settings: {
    loadFresh(
      guildId: string
    ): Promise<{ reasonRequired: boolean; staffRoleIds: readonly string[] }>;
  };
  readonly intakes: {
    load(intakeId: string): Promise<ReportIntakeState | null>;
    findOpen(context: ActionContext): Promise<ReportIntakeState | null>;
    open(context: ActionContext, channelId: string, threadId: string): Promise<ReportIntakeState>;
    markOpenFailed(intakeId: string): Promise<void>;
    confirm(
      context: ActionContext,
      command: Extract<ReportCommand, { kind: 'confirm_intake_candidate' }>,
      staff: boolean
    ): Promise<ReportConfirmationResult>;
    reject(
      context: ActionContext,
      command: Extract<ReportCommand, { kind: 'reject_intake_candidates' }>,
      staff: boolean
    ): Promise<{ rejected: boolean; message: string }>;
    close(
      context: ActionContext,
      intake: ReportIntakeState,
      staff: boolean
    ): Promise<ReportCloseResult>;
    markSubmitted(context: ActionContext, intake: ReportIntakeState): Promise<boolean>;
  };
  readonly threads: {
    notifySubmitted(
      context: ActionContext,
      intake: ReportIntakeState,
      input: { promptMessageId: string; statusRecorded: boolean; targetUsername?: string }
    ): Promise<void>;
    prepareClose(
      context: ActionContext,
      intake: ReportIntakeState
    ): Promise<{
      finish(result: ReportCloseResult): Promise<{ archived: boolean; message: string }>;
    }>;
    create(context: ActionContext, channelId: string): Promise<{ id: string; url: string } | null>;
    activate(context: ActionContext, threadId: string, intakeId: string): Promise<boolean>;
    deleteFailed(threadId: string): Promise<void>;
    notifyOpened(context: ActionContext, threadId: string, intakeId: string): Promise<void>;
  };
  readonly submissions: {
    user(
      context: ActionContext,
      command: Extract<ReportCommand, { kind: 'submit_user_report' }>
    ): Promise<ReportSubmissionResult>;
    message(
      context: ActionContext,
      command: Extract<ReportCommand, { kind: 'submit_message_report' }>
    ): Promise<{ status: 'submitted' } | { status: 'failed'; error: unknown }>;
    confirmed(
      context: ActionContext,
      intake: ReportIntakeState,
      confirmation: ReportConfirmationResult
    ): Promise<ReportSubmissionResult>;
  };
}
