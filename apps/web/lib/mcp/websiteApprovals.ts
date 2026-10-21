import { createAlternativeApprovals } from '@drasil/application';
import { createActorApprovalStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from './adapters/database';
import { createWebDelegatedAccess } from './access';
import { createWebMcpActionService } from './actionService';
import { getMcpConnectionContext } from './connectionData';
import type { IssuerSession } from './auth/flows';
function runtime() {
  const context = getMcpConnectionContext();
  if (!context) throw new Error('Approvals unavailable.');
  return {
    context,
    approvals: createAlternativeApprovals({
      store: createActorApprovalStore(createWebDelegationDatabase()),
      access: createWebDelegatedAccess(),
      service: createWebMcpActionService(),
    }),
  };
}
/** Trusted helper, deliberately outside the remotely callable use-server export surface. */
export async function approveMcpIntentFromWebsite(session: IssuerSession, confirmationId: string) {
  const { context, approvals } = runtime();
  return approvals.approve(await context.actor(session), confirmationId, 'website');
}
export async function cancelMcpIntentFromWebsite(session: IssuerSession, confirmationId: string) {
  const { context, approvals } = runtime();
  return approvals.cancel(await context.actor(session), confirmationId);
}
export async function loadMcpWebsiteApproval(session: IssuerSession, confirmationId: string) {
  const { context, approvals } = runtime();
  return approvals.load(await context.actor(session), confirmationId);
}
