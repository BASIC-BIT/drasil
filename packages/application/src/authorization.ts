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

export const ADMINISTRATOR = 1n << 3n;
export const MANAGE_GUILD = 1n << 5n;
export const MODERATE_MEMBERS = 1n << 40n;
export const BAN_MEMBERS = 1n << 2n;
export const KICK_MEMBERS = 1n << 1n;
export const MODERATION_PERMISSIONS = MANAGE_GUILD | MODERATE_MEMBERS;

/** Guild permission predicate only; callers must first establish fresh identity and presence. */
export function hasAuthority(facts: AuthorityFacts, permissions: bigint): boolean {
  const bits = /^\d+$/.test(facts.permissions) ? BigInt(facts.permissions) : 0n;
  return facts.owner || (bits & (ADMINISTRATOR | permissions)) !== 0n;
}
export function hasStaffAuthority(facts: AuthorityFacts, roleIds: readonly string[]): boolean {
  return (
    hasAuthority(facts, MODERATION_PERMISSIONS) || roleIds.some((id) => facts.roleIds.includes(id))
  );
}

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
  return hasAuthority(facts, MODERATION_PERMISSIONS) ? null : 'permission_denied';
}
