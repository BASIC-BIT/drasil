import {
  createDelegatedActionService,
  ActionDeniedError,
  type DirectActionExecutor,
  type HumanOutcome,
  type IntentResolver,
  type DelegatedPrincipal,
  type IntentInvocation,
  type PublicActionResult,
  type HumanCommand,
  type ActionContext,
  type IntentPreconditions,
} from '@drasil/application';
import { createDelegationStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from './adapters/database';
import { createWebDelegatedAccess } from './access';
import { createWebApplication, type WebApplication } from '../application/createWebApplication';

export interface ApprovedSetupExecutor {
  execute(
    context: ActionContext,
    command: HumanCommand,
    preconditions: Extract<IntentPreconditions, { kind: 'setup' }>
  ): Promise<HumanOutcome>;
}
/** Setup registration must supply Task 11's atomic approved-state comparison and write. */
export function createMcpDirectExecutor(
  app: WebApplication,
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
export interface McpDeadlineClock {
  after(ms: number, callback: () => void): () => void;
}
const clock: McpDeadlineClock = {
  after: (ms, callback) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};
export async function withinMcpDeadline<T>(
  work: Promise<T>,
  pending: () => T,
  timer: McpDeadlineClock = clock
): Promise<T> {
  let cancel = (): void => {};
  const deadline = new Promise<T>((resolve) => {
    cancel = timer.after(5000, () => resolve(pending()));
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    cancel();
  }
}
/** Family resolvers are registered by Tasks 9–12; no effectful default resolver exists. */
export function createMcpActionDelivery(
  resolver: IntentResolver,
  options: { setup?: ApprovedSetupExecutor; clock?: McpDeadlineClock } = {}
) {
  return createDelegatedActionService({
    store: createDelegationStore(createWebDelegationDatabase()),
    access: createWebDelegatedAccess(),
    resolver,
    direct: createMcpDirectExecutor(createWebApplication(), options.setup),
    waitForExecution: (work, pending) => withinMcpDeadline(work, pending, options.clock),
  });
}
export function submitMcpAction(
  service: ReturnType<typeof createMcpActionDelivery>,
  principal: DelegatedPrincipal,
  invocation: IntentInvocation
): Promise<PublicActionResult> {
  return service.submit(principal, invocation);
}
export function confirmMcpAction(
  service: ReturnType<typeof createMcpActionDelivery>,
  principal: DelegatedPrincipal,
  id: string
): Promise<PublicActionResult> {
  return service.confirm(principal, id, 'client_confirmation');
}
export function getMcpActionStatus(
  service: ReturnType<typeof createMcpActionDelivery>,
  principal: DelegatedPrincipal,
  id: string
): Promise<PublicActionResult> {
  return service.status(principal, id);
}
