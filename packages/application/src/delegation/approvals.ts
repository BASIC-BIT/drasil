import { assertIntentSummary, IntentError } from './intents';
import type { DelegatedAccess } from './access';
import type { DelegatedActionService } from './execution';
import type { DelegatedPrincipal, IntentRecord, PublicActionResult } from './types';

/** Internal port. actorId comes only from a verified browser session or Discord interaction. */
export interface ActorApprovalStore {
  loadApprovalForActor(
    actorId: string,
    confirmationId: string
  ): Promise<{
    principal: DelegatedPrincipal;
    intent: IntentRecord;
    receipt?: PublicActionResult;
  } | null>;
}
export interface ApprovalSummary {
  readonly confirmationId: string;
  readonly summary: string;
  readonly guildId: string;
  readonly clientId: string;
  readonly connectionId: string;
  readonly receipt?: PublicActionResult;
  readonly state: IntentRecord['state'];
  readonly expiresAt: string;
}
export interface AlternativeApprovals {
  load(actorId: string, id: string, guildId?: string): Promise<ApprovalSummary>;
  approve(
    actorId: string,
    id: string,
    method: 'website' | 'discord',
    guildId?: string
  ): Promise<PublicActionResult>;
  cancel(actorId: string, id: string, guildId?: string): Promise<PublicActionResult>;
}
export function createAlternativeApprovals(deps: {
  store: ActorApprovalStore;
  access: Pick<DelegatedAccess, 'authorizeWorkflow'>;
  service: Pick<DelegatedActionService, 'confirm' | 'cancel'>;
}): AlternativeApprovals {
  async function owned(
    actorId: string,
    id: string,
    guildId?: string
  ): Promise<NonNullable<Awaited<ReturnType<ActorApprovalStore['loadApprovalForActor']>>>> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new IntentError('not_found');
    const saved = await deps.store.loadApprovalForActor(actorId, id);
    if (!saved || (guildId !== undefined && guildId !== saved.intent.guildId))
      throw new IntentError('not_found');
    return saved;
  }
  return {
    async load(actor, id, guild): Promise<ApprovalSummary> {
      const saved = await owned(actor, id, guild);
      const decision = await deps.access.authorizeWorkflow(
        saved.principal,
        saved.intent.guildId,
        saved.intent.command
      );
      if (decision.kind === 'denied') throw new IntentError(decision.reason);
      const { intent } = saved;
      assertIntentSummary(intent.summary);
      return {
        confirmationId: intent.confirmationId,
        summary: intent.summary,
        guildId: intent.guildId,
        clientId: intent.clientId,
        connectionId: intent.connectionId,
        ...(saved.receipt ? { receipt: saved.receipt } : {}),
        state: intent.state,
        expiresAt: intent.expiresAt.toISOString(),
      };
    },
    async approve(actor, id, method, guild): Promise<PublicActionResult> {
      try {
        const { principal } = await owned(actor, id, guild);
        return deps.service.confirm(principal, id, method);
      } catch (error) {
        if (error instanceof IntentError) return { state: 'denied', code: error.code };
        throw error;
      }
    },
    async cancel(actor, id, guild): Promise<PublicActionResult> {
      const { principal } = await owned(actor, id, guild);
      return deps.service.cancel(principal, id);
    },
  };
}
