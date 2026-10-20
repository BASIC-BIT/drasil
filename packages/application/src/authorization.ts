import type { ActionContext } from './context';
import type { ActionDenialCode } from './results';

export interface AuthorityFacts {
  readonly userId: string;
  readonly guildId: string;
  readonly present: boolean;
  readonly owner: boolean;
  readonly permissions: string;
  readonly roleIds: readonly string[];
}
export interface AuthorityPort {
  loadFresh(guildId: string, userId: string): Promise<AuthorityFacts | null>;
}

const ACKNOWLEDGEMENT_PERMISSIONS = (1n << 3n) | (1n << 5n) | (1n << 40n);

export async function authorizeAttention(
  context: ActionContext,
  authority: AuthorityPort
): Promise<ActionDenialCode | null> {
  if (context.actor.kind !== 'user') return 'permission_denied';
  const facts = await authority.loadFresh(context.guildId, context.actor.userId);
  if (!facts || !facts.present) return 'actor_unavailable';
  if (facts.guildId !== context.guildId || facts.userId !== context.actor.userId) {
    return 'binding_mismatch';
  }
  if (facts.owner) return null;
  const permissions = /^\d+$/.test(facts.permissions) ? BigInt(facts.permissions) : 0n;
  return (permissions & ACKNOWLEDGEMENT_PERMISSIONS) !== 0n ? null : 'permission_denied';
}
