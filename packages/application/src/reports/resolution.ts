import { IntentError } from '../delegation/intents';
import { ActionDeniedError } from '../results';
import { workflowDefinitions } from '../delegation/commands';
import type { DelegatedAccess } from '../delegation/access';
import type { DelegatedPrincipal, IntentResolver, IntentResolution } from '../delegation/types';
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
export function createReportIntentResolver(deps: {
  readonly access: DelegatedAccess;
  readonly resources: (principal: DelegatedPrincipal, guildId: string) => ReportResolutionResources;
}): IntentResolver {
  return {
    async resolve(principal, invocation): Promise<IntentResolution> {
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
        const resources = deps.resources(principal, invocation.guildId);
        const input = workflow.inputSchema.parse(invocation.input);
        let bindings: IntentResolution['bindings'];
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
          bindings = { intakePrompt: choice };
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
          summary: command.kind.replace(/_/g, ' '),
          previewExpiresAt,
        };
      } catch (error) {
        if (error instanceof ActionDeniedError) throw new IntentError(error.code);
        throw error;
      }
    },
  };
}
