import { createApprovedSetupExecutor } from './adapters/setup';
import {
  createDelegatedActionService,
  createDelegatedDirectExecutor,
  type ApprovedSetupExecutor,
  type IntentResolver,
  type DelegatedPrincipal,
  type IntentInvocation,
  type PublicActionResult,
} from '@drasil/application';
import { createDelegationStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from './adapters/database';
import { createWebDelegatedAccess } from './access';
import { createWebApplication } from '../application/createWebApplication';

export { createDelegatedDirectExecutor as createMcpDirectExecutor } from '@drasil/application';
export type { ApprovedSetupExecutor } from '@drasil/application';
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
    direct: createDelegatedDirectExecutor(
      createWebApplication(),
      options.setup ?? createApprovedSetupExecutor()
    ),
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
  id: string,
  method: 'client_confirmation' | 'elicitation' = 'client_confirmation'
): Promise<PublicActionResult> {
  return service.confirm(principal, id, method);
}
export function getMcpActionStatus(
  service: ReturnType<typeof createMcpActionDelivery>,
  principal: DelegatedPrincipal,
  id: string
): Promise<PublicActionResult> {
  return service.status(principal, id);
}
/** Observe only this connection's receipt. Polling and a stalled status read share one deadline. */
export async function waitForMcpReceipt(
  service: Pick<import('@drasil/application').DelegatedActionService, 'status'>,
  principal: DelegatedPrincipal,
  initial: PublicActionResult,
  budgetMs = 5000
): Promise<PublicActionResult> {
  // Observation is optional; a read-scope denial must not replace an accepted mutation.
  if (
    !principal.scopes.includes('drasil:read') ||
    !initial.executionId ||
    !['queued', 'running'].includes(initial.state) ||
    budgetMs <= 0
  )
    return initial;
  let latest = initial;
  let stopped = false;
  let cancelDelay = (): void => {};
  let cancelDeadline = (): void => {};
  const deadline = new Promise<PublicActionResult>((resolve) => {
    cancelDeadline = clock.after(Math.min(budgetMs, 5000), () => {
      stopped = true;
      cancelDelay();
      resolve(latest);
    });
  });
  const observe = async (): Promise<PublicActionResult> => {
    while (!stopped && ['queued', 'running'].includes(latest.state)) {
      await new Promise<void>((resolve) => {
        const cancel = clock.after(250, resolve);
        cancelDelay = () => {
          cancel();
          resolve();
        };
      });
      if (stopped) break;
      latest = await service.status(principal, initial.executionId!).catch(() => latest);
    }
    return latest;
  };
  try {
    return await Promise.race([observe(), deadline]);
  } finally {
    stopped = true;
    cancelDeadline();
    cancelDelay();
  }
}
