import { ActionDeniedError } from '../results';
import type { AttentionActions } from '../operations/attention';
import type { ReportReviewActions } from '../reports/review';
import type { ActionContext } from '../context';
import type { HumanCommand } from './commands';
import type { DirectActionExecutor, HumanOutcome, IntentPreconditions } from './types';
export interface ApprovedSetupExecutor {
  execute(
    context: ActionContext,
    command: HumanCommand,
    preconditions: Extract<IntentPreconditions, { kind: 'setup' }>
  ): Promise<HumanOutcome>;
}
/** Setup registration must supply Task 11's atomic approved-state comparison and write. */
export function createDelegatedDirectExecutor(
  app: {
    attention: Pick<AttentionActions, 'acknowledge'>;
    reportReview: Pick<ReportReviewActions, 'close'>;
  },
  setup?: ApprovedSetupExecutor
): DirectActionExecutor {
  return {
    async execute(context, command, preconditions): Promise<HumanOutcome> {
      switch (command.kind) {
        case 'acknowledge_attention': {
          const items = [];
          for (const itemId of command.itemIds) {
            try {
              const result = await app.attention.acknowledge(context, { itemId });
              items.push(
                result.kind === 'denied'
                  ? { itemId, state: 'denied' as const }
                  : { itemId, state: 'completed' as const, status: result.outcome.status }
              );
            } catch {
              items.push({ itemId, state: 'uncertain' as const });
            }
          }
          return { kind: 'attention_batch', items };
        }
        case 'close_submitted_report': {
          const result = await app.reportReview.close(context, {
            reportId: command.reportId,
            action: command.action,
          });
          if (result.kind === 'denied') throw new ActionDeniedError(result.code);
          return result.outcome;
        }
        case 'update_setup':
        case 'update_settings':
        case 'update_heuristics':
        case 'reset_heuristics':
        case 'lockdown_allow_add':
        case 'lockdown_allow_remove':
        case 'disable_lockdown':
          if (!setup || preconditions.kind !== 'setup')
            throw new ActionDeniedError('approved_setup_executor_required');
          return setup.execute(context, command, preconditions);
        default:
          throw new ActionDeniedError('unsupported_direct_workflow');
      }
    },
  };
}
