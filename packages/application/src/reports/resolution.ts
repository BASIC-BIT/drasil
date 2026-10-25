import { IntentError } from '../delegation/intents';
import { ActionDeniedError } from '../results';
import { workflowDefinitions, type HumanCommand } from '../delegation/commands';
import type { DelegatedAccess } from '../delegation/access';
import type {
  DelegatedPrincipal,
  IntentResolver,
  IntentResolution,
  ResolvedIntent,
} from '../delegation/types';
import { queuedCommandSchema } from '../requests/commands';
import { validateReportCaseTerminal } from './terminal';
import type { ReportCasePreparation } from './review';
import type { ResolvedIntakeChoice } from './delegation';
import type { PortableReportReview } from './reviewReference';
export interface ReportMessagePrecondition {
  readonly kind: 'report_message';
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly targetUserId: string;
  readonly fingerprint: string;
}
export interface ReportResolutionResources {
  prepareSubmittedReportCaseOpen(reportId: string): Promise<ReportCasePreparation>;
  resolveIntakeChoice(reference: string): Promise<ResolvedIntakeChoice>;
  loadReview(reference: string): Promise<PortableReportReview | null>;
  message(input: {
    channelId: string;
    messageId: string;
    targetUserId: string;
  }): Promise<ReportMessagePrecondition | null>;
  detection(
    id: string
  ): Promise<{ guildId: string | null; targetUserId: string; reportId: string | null } | null>;
}

/** Quote user-controlled values as display data; never serialize runtime bindings. */
function reportSummary(
  command: HumanCommand,
  delivery: IntentResolution['delivery'],
  candidateIds: readonly string[]
): string {
  const display = (value: string | null | readonly string[]): string => JSON.stringify(value);
  const detection =
    'detectionEventId' in command && 'targetUserId' in command
      ? `detection ${display(command.detectionEventId)}; target ${display(command.targetUserId)}`
      : '';
  switch (command.kind) {
    case 'submit_user_report':
      return `Submit user report: target ${display(command.targetUserId)}; label ${display(command.targetLabel)}; reason ${command.passUndefinedReason ? 'not supplied' : display(command.reason)}.`;
    case 'submit_message_report':
      return `Submit message report: target ${display(command.targetUserId)}; channel ${display(command.channelId)}; message ${display(command.messageId)}; reason ${display(command.reason)}.`;
    case 'start_report_intake':
      return `Start report intake: channel ${display(command.channelId)}.`;
    case 'close_report_intake':
      return `Close report intake: intake ${display(command.intakeId)}.`;
    case 'confirm_intake_candidate':
      return `Confirm intake candidate: intake ${display(command.intakeId)}; target ${display(command.targetUserId)}.`;
    case 'reject_intake_candidates':
      return `Reject intake candidates: intake ${display(command.intakeId)}; candidates ${display(candidateIds)}.`;
    case 'dismiss_observed_detection':
      return `Dismiss observed detection: ${detection}.`;
    case 'mark_observed_detection_false_positive':
      return `Mark observed detection false positive: ${detection}.`;
    case 'undo_observed_detection_action':
      return `Undo observed detection action: ${detection}.`;
    case 'kick_observed_detection':
      return `Kick observed detection target: ${detection}; reason ${display(command.reason)}.`;
    case 'ban_observed_detection':
      return `Ban observed detection target: ${detection}; ${command.subject.kind === 'report' ? `report ${display(command.subject.reportId)}` : 'subject observed detection'}; reason ${display(command.reason)}.`;
    case 'ignore_detection_accounting':
      return `Ignore detection accounting: ${detection}; reason ${display(command.reason)}.`;
    case 'restore_detection_accounting':
      return `Restore detection accounting: ${detection}; reason ${display(command.reason)}.`;
    case 'prepare_report_ban_review':
      return `Prepare report ban review: operation ${display(command.operationId)}.`;
    case 'review_uncertain_report_ban':
      return `Review uncertain report ban: operation ${display(command.operationId)}; target ${display(command.targetUserId)}; reason ${display(command.reason)}.`;
    case 'close_submitted_report':
      return `Close submitted report: report ${display(command.reportId)}; action ${display(command.action)}.`;
    case 'open_submitted_report_case':
      if (
        delivery.kind === 'queued' &&
        delivery.command.kind === 'open_case_from_observed_detection'
      )
        return `Open submitted report case: report ${display(delivery.command.reportId)}; target ${display(delivery.command.targetUserId)}; detection ${display(delivery.command.detectionEventId)}.`;
      if (delivery.kind === 'report_case_terminal')
        return `Open submitted report case: report ${display(command.reportId)}; status ${display(delivery.outcome.status)}.`;
      throw new IntentError('delivery_mismatch');
    default:
      throw new IntentError('unsupported_report_workflow');
  }
}

export function createReportIntentResolver(deps: {
  readonly access: DelegatedAccess;
  readonly resources: (
    principal: DelegatedPrincipal,
    guildId: string,
    previous?: ResolvedIntent
  ) => ReportResolutionResources;
}): IntentResolver {
  return {
    async resolve(principal, invocation, context): Promise<IntentResolution> {
      try {
        const workflow = workflowDefinitions.find(
          (w) =>
            w.id === invocation.workflowId &&
            ['reports', 'detections', 'reportReview'].includes(w.family)
        );
        if (!workflow) throw new ActionDeniedError('unsupported_report_workflow');
        const permission = await deps.access.authorizeWorkflowId(
          principal,
          invocation.guildId,
          workflow.id
        );
        if (permission.kind === 'denied') throw new ActionDeniedError(permission.reason);
        const resources = deps.resources(principal, invocation.guildId, context?.previous);
        const input = workflow.inputSchema.parse(invocation.input);
        let bindings: IntentResolution['bindings'];
        let candidateIds: readonly string[] = [];
        let preconditions: IntentResolution['preconditions'] = { kind: 'none' };
        let previewExpiresAt: Date | null = null;
        if (
          workflow.id === 'confirm_intake_candidate' ||
          workflow.id === 'reject_intake_candidates'
        ) {
          const choice = await resources.resolveIntakeChoice(String(input.intakePromptReference));
          if (choice.guildId !== invocation.guildId || choice.intakeId !== input.intakeId)
            throw new ActionDeniedError('binding_mismatch');
          if (
            workflow.id === 'confirm_intake_candidate' &&
            (input.targetUserId === principal.userId ||
              !choice.candidateIds.includes(String(input.targetUserId)))
          )
            throw new ActionDeniedError('confirmation_required');
          bindings = {
            intakePrompt: {
              threadId: choice.threadId,
              promptMessageId: choice.promptMessageId,
              promptToken: choice.promptToken,
            },
          };
          candidateIds = choice.candidateIds;
          preconditions = choice.precondition;
        }
        const command = workflow.parseCommand(input, bindings);
        let delivery: IntentResolution['delivery'];
        if (command.kind === 'open_submitted_report_case') {
          const prepared = await resources.prepareSubmittedReportCaseOpen(command.reportId);
          if (prepared.kind === 'denied') throw new ActionDeniedError(prepared.code);
          if (prepared.kind === 'ready') {
            delivery = { kind: 'queued', command: prepared.command };
            preconditions = prepared.precondition;
          } else
            delivery = {
              kind: 'report_case_terminal',
              outcome: validateReportCaseTerminal(
                { workflowId: workflow.id, command, userId: principal.userId },
                prepared.outcome
              ),
            };
        } else
          delivery =
            workflow.delivery === 'direct'
              ? { kind: 'direct' }
              : { kind: 'queued', command: queuedCommandSchema.parse(command) };
        if (command.kind === 'submit_message_report') {
          const message = await resources.message(command);
          if (
            !message ||
            message.guildId !== invocation.guildId ||
            message.channelId !== command.channelId ||
            message.messageId !== command.messageId ||
            message.targetUserId !== command.targetUserId
          )
            throw new ActionDeniedError('binding_mismatch');
          preconditions = message;
        }
        if (command.kind === 'review_uncertain_report_ban') {
          const review = await resources.loadReview(command.reviewReference);
          if (
            !review ||
            review.operationId !== command.operationId ||
            review.targetUserId !== command.targetUserId
          )
            throw new ActionDeniedError('stale_state');
          previewExpiresAt = review.expiresAt;
          preconditions = {
            kind: 'report_ban_review',
            operationId: command.operationId,
            reviewReference: command.reviewReference,
            expiresAt: review.expiresAt,
          };
        }
        let relevantState: unknown = preconditions;
        if (
          workflow.family === 'detections' &&
          'detectionEventId' in command &&
          command.detectionEventId
        ) {
          const detection = await resources.detection(command.detectionEventId);
          if (
            !detection ||
            detection.guildId !== invocation.guildId ||
            detection.targetUserId !== command.targetUserId ||
            (command.kind === 'ban_observed_detection' &&
              command.subject.kind === 'report' &&
              detection.reportId !== command.subject.reportId)
          )
            throw new ActionDeniedError('binding_mismatch');
          relevantState = detection;
        }
        return {
          bindings,
          delivery,
          preconditions,
          relevantState,
          summary: reportSummary(command, delivery, candidateIds),
          previewExpiresAt,
        };
      } catch (error) {
        if (error instanceof ActionDeniedError) throw new IntentError(error.code);
        throw error;
      }
    },
  };
}
