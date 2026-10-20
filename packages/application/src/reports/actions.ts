import type { ActionContext } from '../context';
import type { ActionResult } from '../results';
import { reportCommandSchema, type ReportCommand } from './commands';
import type {
  ReportCloseResult,
  ReportDependencies,
  ReportIntakeState,
  ReportSubmissionResult,
} from './ports';
export type ReportOutcome =
  | {
      kind: 'submit_user_report';
      status: Exclude<ReportSubmissionResult['status'], 'failed'>;
      result: Exclude<ReportSubmissionResult, { status: 'failed' }>;
    }
  | {
      kind: 'submit_message_report';
      status: 'submitted';
      result: { status: 'submitted' };
    }
  | {
      kind: 'start_report_intake';
      status: 'opened' | 'existing' | 'create_failed' | 'activation_failed';
      intake: ReportIntakeState | null;
      threadUrl?: string;
    }
  | {
      kind: 'close_report_intake';
      status: 'closed' | 'busy' | 'not_closed';
      result: ReportCloseResult;
      intake: ReportIntakeState;
      archived?: boolean;
    }
  | {
      kind: 'confirm_intake_candidate';
      status: 'submitted' | 'not_confirmed';
      message: string;
      targetUserId?: string;
      statusRecorded?: boolean;
    }
  | {
      kind: 'reject_intake_candidates';
      status: 'rejected' | 'not_rejected';
      result: { rejected: boolean; message: string };
    };
export interface ReportActions {
  execute(context: ActionContext, command: ReportCommand): Promise<ActionResult<ReportOutcome>>;
}
const STAFF_PERMISSIONS = (1n << 3n) | (1n << 5n) | (1n << 40n);
export function createReportActions(deps: ReportDependencies): ReportActions {
  async function staff(context: ActionContext): Promise<boolean> {
    if (context.actor.kind !== 'user') return false;
    const facts = await deps.authority.loadFresh(context.guildId, context.actor.userId);
    if (
      !facts?.present ||
      facts.guildId !== context.guildId ||
      facts.userId !== context.actor.userId
    )
      return false;
    if (facts.owner || (BigInt(facts.permissions) & STAFF_PERMISSIONS) !== 0n) return true;
    const settings = await deps.settings.loadFresh(context.guildId);
    return settings.staffRoleIds.some((id) => facts.roleIds.includes(id));
  }
  async function start(context: ActionContext, channelId: string): Promise<ReportOutcome> {
    const existing = await deps.intakes.findOpen(context);
    if (existing) return { kind: 'start_report_intake', status: 'existing', intake: existing };
    const thread = await deps.threads.create(context, channelId);
    if (!thread) return { kind: 'start_report_intake', status: 'create_failed', intake: null };
    let activated = false;
    try {
      const intake = await deps.intakes.open(context, channelId, thread.id);
      activated = await deps.threads.activate(context, thread.id, intake.id);
      if (!activated) {
        await deps.intakes.markOpenFailed(intake.id);
        return { kind: 'start_report_intake', status: 'activation_failed', intake };
      }
      await deps.threads.notifyOpened(context, thread.id, intake.id);
      return { kind: 'start_report_intake', status: 'opened', intake, threadUrl: thread.url };
    } finally {
      if (!activated) await deps.threads.deleteFailed(thread.id);
    }
  }
  async function confirm(
    context: ActionContext,
    command: Extract<ReportCommand, { kind: 'confirm_intake_candidate' }>,
    isStaff: boolean
  ): Promise<ActionResult<ReportOutcome>> {
    const confirmation = await deps.intakes.confirm(context, command, isStaff);
    if (!confirmation.confirmed || !confirmation.reason)
      return {
        kind: 'outcome',
        outcome: { kind: command.kind, status: 'not_confirmed', message: confirmation.message },
      };
    const current = await deps.intakes.load(command.intakeId);
    if (
      !current ||
      current.guildId !== context.guildId ||
      current.confirmedTargetUserId !== command.targetUserId ||
      current.claimed
    )
      return { kind: 'denied', code: 'stale_state' };
    const submission = await deps.submissions.confirmed(context, current, confirmation);
    if (submission.status === 'failed') throw submission.error;
    if (submission.status !== 'submitted') return { kind: 'denied', code: 'stale_state' };
    const statusRecorded = await deps.intakes.markSubmitted(context, current).catch(() => false);
    await deps.threads.notifySubmitted(context, current, {
      promptMessageId: command.promptMessageId,
      statusRecorded,
      targetUsername: submission.targetUsername,
    });
    return {
      kind: 'outcome',
      outcome: {
        kind: command.kind,
        status: 'submitted',
        targetUserId: current.confirmedTargetUserId,
        statusRecorded,
        message: statusRecorded
          ? 'Report submitted.'
          : "Report submitted. Drasil couldn't record its final status. Please ask a moderator to review this thread.",
      },
    };
  }
  async function intakeAction(
    context: ActionContext,
    command: Extract<ReportCommand, { intakeId: string }>
  ): Promise<ActionResult<ReportOutcome>> {
    const intake = await deps.intakes.load(command.intakeId);
    if (!intake || intake.guildId !== context.guildId)
      return { kind: 'denied', code: 'binding_mismatch' };
    const isReporter = context.actor.kind === 'user' && intake.reporterId === context.actor.userId;
    const isStaff = !isReporter && (await staff(context));
    if (!isReporter && !isStaff) return { kind: 'denied', code: 'permission_denied' };
    if (command.kind === 'close_report_intake') {
      if (intake.claimed)
        return {
          kind: 'outcome',
          outcome: {
            kind: command.kind,
            status: 'busy',
            intake,
            result: {
              closed: false,
              message: 'A report action is already in progress. Please try again later.',
            },
          },
        };
      const thread = await deps.threads.prepareClose(context, intake);
      const result = await deps.intakes.close(context, intake, isStaff);
      const claimed = !result.closed && (await deps.intakes.load(intake.id))?.claimed === true;
      const closed = result.closed ? await thread.finish(result) : null;
      return {
        kind: 'outcome',
        outcome: {
          kind: command.kind,
          status: result.closed ? 'closed' : claimed ? 'busy' : 'not_closed',
          result: { ...result, ...(closed ? { message: closed.message } : {}) },
          intake,
          ...(closed ? { archived: closed.archived } : {}),
        },
      };
    }
    if (intake.threadId !== command.threadId) return { kind: 'denied', code: 'binding_mismatch' };
    if (
      intake.status !== 'needs_reporter_confirmation' ||
      intake.confirmedTargetUserId ||
      intake.promptMessageId !== command.promptMessageId
    )
      return { kind: 'denied', code: 'confirmation_required' };
    if (command.kind === 'confirm_intake_candidate') {
      if (!intake.candidateIds.includes(command.targetUserId))
        return { kind: 'denied', code: 'confirmation_required' };
      return confirm(context, command, isStaff);
    }
    if (intake.promptToken !== command.promptToken)
      return { kind: 'denied', code: 'confirmation_required' };
    const result = await deps.intakes.reject(context, command, isStaff);
    return {
      kind: 'outcome',
      outcome: {
        kind: command.kind,
        status: result.rejected ? 'rejected' : 'not_rejected',
        result,
      },
    };
  }
  return {
    async execute(context, input): Promise<ActionResult<ReportOutcome>> {
      const parsed = reportCommandSchema.safeParse(input);
      if (!parsed.success || context.actor.kind !== 'user')
        return { kind: 'denied', code: 'permission_denied' };
      const command = parsed.data;
      if ('intakeId' in command) return intakeAction(context, command);
      if (command.kind !== 'submit_message_report') {
        const facts = await deps.authority.loadFresh(context.guildId, context.actor.userId);
        if (!facts?.present) return { kind: 'denied', code: 'actor_unavailable' };
        if (facts.guildId !== context.guildId || facts.userId !== context.actor.userId)
          return { kind: 'denied', code: 'binding_mismatch' };
      }
      if (command.kind === 'start_report_intake')
        return { kind: 'outcome', outcome: await start(context, command.channelId) };
      if (command.targetUserId === context.actor.userId)
        return { kind: 'denied', code: 'permission_denied' };
      if (
        context.guildId !== '0' &&
        (await deps.settings.loadFresh(context.guildId)).reasonRequired &&
        !command.reason?.trim()
      )
        return { kind: 'denied', code: 'reason_required' };
      if (command.kind === 'submit_user_report') {
        const result = await deps.submissions.user(context, command);
        if (result.status === 'failed') throw result.error;
        return { kind: 'outcome', outcome: { kind: command.kind, status: result.status, result } };
      }
      const result = await deps.submissions.message(context, command);
      if (result.status === 'failed') throw result.error;
      return { kind: 'outcome', outcome: { kind: command.kind, status: result.status, result } };
    },
  };
}
