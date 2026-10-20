import type { ActionContext } from '../context';
import type { ActionDenialCode, ActionResult } from '../results';
import type { DetectionCommand, QueuedDetectionCommand } from './commands';
import type {
  DetectionDependencies,
  DetectionInput,
  DetectionOperation,
  ObservedBanResult,
  ReviewReference,
} from './ports';
export type DetectionOutcome =
  | {
      readonly kind: 'ban_observed_detection';
      readonly result: ObservedBanResult;
      readonly banById?: boolean;
    }
  | {
      readonly kind: 'undo_observed_detection_action';
      readonly undoneAction: 'dismiss' | 'false_positive' | null;
    }
  | { readonly kind: 'prepare_report_ban_review'; readonly reference: ReviewReference }
  | {
      readonly kind: Exclude<
        DetectionCommand['kind'],
        'ban_observed_detection' | 'undo_observed_detection_action' | 'prepare_report_ban_review'
      >;
      readonly succeeded: boolean;
    };
export interface DetectionActions {
  execute(
    context: ActionContext,
    command: DetectionCommand
  ): Promise<ActionResult<DetectionOutcome>>;
}
export function createDetectionActions(deps: DetectionDependencies): DetectionActions {
  return {
    async execute(context, command): Promise<ActionResult<DetectionOutcome>> {
      // Claim the pending evidence before the first external read, including denied attempts.
      const confirmed =
        command.kind === 'prepare_report_ban_review' ||
        (await deps.confirmations.verify(context, command));
      if (command.kind === 'ban_observed_detection') {
        const operation = await deps.repository.findOperation(context.requestId);
        if (!matchesOperation(context, command, operation))
          return { kind: 'denied', code: 'binding_mismatch' };
        if (operation.continuation !== 'fresh')
          return continueBan(deps, context, command, operation);
      }
      const denial = await authorize(deps, context, command);
      if (denial) return { kind: 'denied', code: denial };
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      if (!confirmed) return { kind: 'denied', code: 'confirmation_required' };
      if ('operationId' in command) {
        const binding = await checkReviewBinding(deps, context, command);
        if (binding) return { kind: 'denied', code: binding };
      }
      if (command.kind === 'prepare_report_ban_review')
        return {
          kind: 'outcome',
          outcome: {
            kind: command.kind,
            reference: await deps.workflows.prepareReview({
              guildId: context.guildId,
              actorId: context.actor.userId,
              operationId: command.operationId,
            }),
          },
        };
      if (command.kind === 'review_uncertain_report_ban') {
        if (!command.reason.trim()) return { kind: 'denied', code: 'reason_required' };
        await deps.workflows.review({
          guildId: context.guildId,
          actorId: context.actor.userId,
          reference: command,
          reason: command.reason,
        });
        return { kind: 'outcome', outcome: { kind: command.kind, succeeded: true } };
      }
      const binding = await checkDetection(deps, context, command);
      if (binding) return { kind: 'denied', code: binding };
      const policyDenial = await checkPolicy(deps, context.guildId, command);
      if (policyDenial) return { kind: 'denied', code: policyDenial };
      return {
        kind: 'outcome',
        outcome: await executeFresh(deps, command, {
          guildId: context.guildId,
          actorId: context.actor.userId,
          source: context.source,
          operationId: context.requestId,
          targetUserId: command.targetUserId,
          detectionEventId: command.detectionEventId,
        }),
      };
    },
  };
}
function matchesOperation(
  context: ActionContext,
  command: Extract<DetectionCommand, { kind: 'ban_observed_detection' }>,
  operation: DetectionOperation | null
): operation is DetectionOperation {
  return (
    operation !== null &&
    operation.owned &&
    operation.id === context.requestId &&
    operation.guildId === context.guildId &&
    operation.targetUserId === command.targetUserId &&
    operation.detectionEventId === command.detectionEventId &&
    operation.reportId === (command.subject.kind === 'report' ? command.subject.reportId : null) &&
    operation.source === context.source &&
    (context.actor.kind === 'system'
      ? context.actor.purpose === 'report_ban_recovery'
      : operation.actorId === context.actor.userId)
  );
}
async function continueBan(
  deps: DetectionDependencies,
  context: ActionContext,
  command: QueuedDetectionCommand,
  operation: DetectionOperation
): Promise<ActionResult<DetectionOutcome>> {
  const denial = await checkDetection(deps, context, command);
  if (denial) return { kind: 'denied', code: denial };
  const result =
    operation.continuation === 'completed'
      ? { status: 'already_handled' as const }
      : await deps.workflows.reconcile({
          guildId: operation.guildId,
          actorId: operation.actorId,
          source: operation.source,
          operationId: operation.id,
          targetUserId: operation.targetUserId,
          detectionEventId: operation.detectionEventId,
        });
  return { kind: 'outcome', outcome: { kind: 'ban_observed_detection', result } };
}
async function authorize(
  deps: DetectionDependencies,
  context: ActionContext,
  command: DetectionCommand
): Promise<ActionDenialCode | null> {
  if (context.actor.kind !== 'user') return 'permission_denied';
  const actor = await deps.authority.loadFresh(context.guildId, context.actor.userId);
  if (!actor?.present) return 'actor_unavailable';
  if (actor.guildId !== context.guildId || actor.userId !== context.actor.userId)
    return 'binding_mismatch';
  const bits = /^\d+$/.test(actor.permissions) ? BigInt(actor.permissions) : 0n;
  const required =
    command.kind === 'kick_observed_detection'
      ? 1n << 1n
      : [
            'ban_observed_detection',
            'prepare_report_ban_review',
            'review_uncertain_report_ban',
          ].includes(command.kind)
        ? 1n << 2n
        : (1n << 5n) | (1n << 40n);
  return actor.owner || (bits & (1n << 3n)) !== 0n || (bits & required) !== 0n
    ? null
    : 'permission_denied';
}
async function checkDetection(
  deps: DetectionDependencies,
  context: ActionContext,
  command: QueuedDetectionCommand
): Promise<ActionDenialCode | null> {
  const detection = await deps.repository.findDetection(command.detectionEventId);
  if (
    !detection ||
    detection.guildId !== context.guildId ||
    detection.targetUserId !== command.targetUserId
  )
    return 'binding_mismatch';
  if (
    command.kind === 'ban_observed_detection' &&
    detection.reportId !== (command.subject.kind === 'report' ? command.subject.reportId : null)
  )
    return 'binding_mismatch';
  return null;
}
async function checkPolicy(
  deps: DetectionDependencies,
  guildId: string,
  command: QueuedDetectionCommand
): Promise<ActionDenialCode | null> {
  if (command.kind !== 'ban_observed_detection' && command.kind !== 'kick_observed_detection')
    return null;
  const policy = await deps.settings.loadFresh(guildId);
  const ban = command.kind === 'ban_observed_detection';
  if (!(ban ? policy.banEnabled : policy.kickEnabled)) return 'policy_disabled';
  if ((ban ? policy.banRequiresReason : policy.kickRequiresReason) && !command.reason?.trim())
    return 'reason_required';
  return null;
}
async function executeFresh(
  deps: DetectionDependencies,
  command: QueuedDetectionCommand,
  input: DetectionInput
): Promise<DetectionOutcome> {
  switch (command.kind) {
    case 'ban_observed_detection':
      return {
        kind: command.kind,
        ...(await deps.workflows.ban(
          input,
          command.reason?.trim() || 'Banned from observed suspicious notification'
        )),
      };
    case 'kick_observed_detection':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.kick(
          input,
          command.reason?.trim() || 'Kicked from observed suspicious notification'
        ),
      };
    case 'dismiss_observed_detection':
    case 'mark_observed_detection_false_positive':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.dismiss(
          input,
          command.kind === 'dismiss_observed_detection' ? 'dismiss' : 'false_positive'
        ),
      };
    case 'undo_observed_detection_action':
      return { kind: command.kind, undoneAction: await deps.workflows.undo(input) };
    case 'ignore_detection_accounting':
    case 'restore_detection_accounting':
      return {
        kind: command.kind,
        succeeded: await deps.workflows.changeAccounting(
          input,
          command.kind === 'ignore_detection_accounting',
          command.reason?.trim() || null
        ),
      };
  }
}

async function checkReviewBinding(
  deps: DetectionDependencies,
  context: ActionContext,
  command: Extract<DetectionCommand, { operationId: string }>
): Promise<ActionDenialCode | null> {
  const operation = await deps.repository.findOperation(command.operationId);
  if (
    !operation ||
    operation.id !== command.operationId ||
    operation.guildId !== context.guildId ||
    ('targetUserId' in command && operation.targetUserId !== command.targetUserId)
  )
    return 'binding_mismatch';
  return operation.continuation === 'uncertain' ? null : 'stale_state';
}
