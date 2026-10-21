import {
  hasAuthority,
  hasStaffAuthority,
  BAN_MEMBERS,
  KICK_MEMBERS,
  MANAGE_GUILD,
  MODERATION_PERMISSIONS,
  type AuthorityFacts,
  type AuthorityPort,
} from '../authorization';
import { caseRequiredPermissions } from '../cases/actions';
import { caseCommandSchema } from '../cases/commands';
import { detectionRequiredPermissions } from '../detections/actions';
import { detectionCommandSchema, queuedDetectionCommandSchema } from '../detections/commands';
import { operationRequiredPermissions } from '../operations/actions';
import { operationCommandSchema, queuedOperationCommandSchema } from '../operations/commands';
import {
  humanCommandSchema,
  workflowDefinitions,
  type WorkflowAuthorityCommand,
  type WorkflowId,
} from './commands';
import type { HumanCommand } from './commands';
import type { ConnectionGrant, DelegatedPrincipal, DelegatedScope, DelegationStore } from './types';

export type MemberContextPurpose = 'report' | 'case' | 'ban' | 'kick' | 'configure';
export type ResourceReadQuery =
  | {
      readonly kind: 'cases' | 'detections' | 'attention' | 'setup' | 'diagnostics';
      readonly guildId: string;
    }
  | {
      readonly kind: 'reports' | 'intakes';
      readonly guildId: string;
      readonly audience?: 'staff' | 'reporter';
    }
  | {
      readonly kind: 'member_context';
      readonly guildId: string;
      readonly purpose: MemberContextPurpose;
    };
/** Status ownership and resource policy come from persisted provenance, never public arguments. */
export type DelegatedReadQuery =
  | ResourceReadQuery
  | {
      readonly kind: 'own_execution';
      readonly guildId: string;
      readonly userId: string;
      readonly connectionId: string;
      readonly resource: ResourceReadQuery;
    };
export type ReadKind = DelegatedReadQuery['kind'];
export interface AccessBinding {
  readonly kind: 'allowed';
  readonly grant: ConnectionGrant;
  readonly facts: AuthorityFacts;
  readonly guildId: string;
  readonly scope: DelegatedScope;
  readonly staffRoleIds: readonly string[];
  /** When present, adapters must bind reporter ownership in the repository query. */
  readonly reporterId?: string;
}
export interface AccessDenial {
  readonly kind: 'denied';
  readonly reason:
    | 'invalid_grant'
    | 'scope_denied'
    | 'guild_denied'
    | 'actor_unavailable'
    | 'binding_mismatch'
    | 'permission_denied'
    | 'unavailable'
    | 'invalid_page';
}
export type AccessDecision = AccessBinding | AccessDenial;
export interface GuildPageRequest {
  readonly limit?: number;
  readonly cursor?: string | null;
}
export interface GuildCapabilities {
  readonly guildId: string;
  readonly reads: readonly Exclude<ReadKind, 'own_execution' | 'member_context'>[];
  readonly memberContext: readonly MemberContextPurpose[];
  /** Token and persisted grant scope ceiling, independent of current guild authority. */
  readonly scopes: readonly DelegatedScope[];
  readonly workflows: readonly WorkflowId[];
}
export type GuildPage =
  | AccessDenial
  | {
      readonly kind: 'allowed';
      readonly guilds: readonly GuildCapabilities[];
      readonly nextCursor: string | null;
    };
export interface DelegatedGuildDirectory {
  isActive(guildId: string): Promise<boolean>;
  listActive(page: {
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<{ readonly guildIds: readonly string[]; readonly nextCursor: string | null }>;
}
export interface DelegatedAccessDependencies {
  readonly store: Pick<DelegationStore, 'findConnection'>;
  readonly authority: AuthorityPort;
  readonly staffRoles: { loadRoleIds(guildId: string): Promise<readonly string[]> };
  readonly guilds: DelegatedGuildDirectory;
  readonly now?: () => number;
}
export interface DelegatedAccess {
  authorizeGuild(
    principal: DelegatedPrincipal,
    guildId: string,
    scope: DelegatedScope
  ): Promise<AccessDecision>;
  authorizeRead(principal: DelegatedPrincipal, query: DelegatedReadQuery): Promise<AccessDecision>;
  authorizeWorkflow(
    principal: DelegatedPrincipal,
    guildId: string,
    command: HumanCommand
  ): Promise<AccessDecision>;
  listEligibleGuilds(principal: DelegatedPrincipal, page: GuildPageRequest): Promise<GuildPage>;
}

function denied(reason: AccessDenial['reason']): AccessDenial {
  return { kind: 'denied', reason };
}
function grantMatches(
  grant: ConnectionGrant | null,
  principal: DelegatedPrincipal
): grant is ConnectionGrant {
  return (
    !!grant &&
    grant.revokedAt === null &&
    grant.connectionId === principal.connectionId &&
    grant.userId === principal.userId &&
    grant.clientId === principal.clientId &&
    grant.version === principal.grantVersion
  );
}
function permitsPurpose(binding: AccessBinding, purpose: MemberContextPurpose): boolean {
  switch (purpose) {
    case 'report':
      return hasStaffAuthority(binding.facts, binding.staffRoleIds);
    case 'case':
      return hasAuthority(
        binding.facts,
        caseRequiredPermissions({ kind: 'open_case_from_observed_detection' })
      );
    case 'ban':
      return hasAuthority(binding.facts, BAN_MEMBERS);
    case 'kick':
      return hasAuthority(binding.facts, KICK_MEMBERS);
    case 'configure':
      return hasAuthority(binding.facts, 0n);
  }
}
function permitsRead(binding: AccessBinding, query: ResourceReadQuery): boolean {
  switch (query.kind) {
    case 'cases':
    case 'detections':
      return hasStaffAuthority(binding.facts, binding.staffRoleIds);
    case 'reports':
    case 'intakes':
      return (
        query.audience === 'reporter' || hasStaffAuthority(binding.facts, binding.staffRoleIds)
      );
    case 'attention':
      return hasAuthority(binding.facts, MODERATION_PERMISSIONS);
    case 'setup':
      return hasAuthority(binding.facts, 0n);
    case 'diagnostics':
      return hasAuthority(binding.facts, MANAGE_GUILD);
    case 'member_context':
      return permitsPurpose(binding, query.purpose);
  }
}
/** Admission checks authority only. Execution must still enforce resource binding, state and domain policy. */
function permitsWorkflow(binding: AccessBinding, command: WorkflowAuthorityCommand): boolean {
  const family = workflowDefinitions.find(
    (definition) => definition.commandKind === command.kind
  )?.family;
  switch (family) {
    case 'cases': {
      const kind = caseCommandSchema.options
        .map((schema) => schema.shape.kind.value)
        .find((kind) => kind === command.kind);
      return (
        kind !== undefined &&
        hasAuthority(binding.facts, caseRequiredPermissions({ kind, intent: command.intent }))
      );
    }
    case 'detections': {
      const kind = [
        ...queuedDetectionCommandSchema.options,
        detectionCommandSchema.options[1],
        detectionCommandSchema.options[2],
      ]
        .map((schema) => schema.shape.kind.value)
        .find((kind) => kind === command.kind);
      return (
        kind !== undefined && hasAuthority(binding.facts, detectionRequiredPermissions({ kind }))
      );
    }
    case 'operations': {
      const kind = [
        ...queuedOperationCommandSchema.options,
        operationCommandSchema.options[1],
        operationCommandSchema.options[2],
      ]
        .map((schema) => schema.shape.kind.value)
        .find((kind) => kind === command.kind);
      return (
        kind !== undefined &&
        hasAuthority(binding.facts, operationRequiredPermissions({ kind, intent: command.intent }))
      );
    }
    case 'setup':
    case 'cleanup':
      return hasAuthority(binding.facts, 0n);
    case 'attention':
    case 'captcha':
    case 'quarantine':
      return hasAuthority(binding.facts, MODERATION_PERMISSIONS);
    case 'reportReview':
      return command.kind === 'close_submitted_report'
        ? hasStaffAuthority(binding.facts, binding.staffRoleIds)
        : hasAuthority(binding.facts, MODERATION_PERMISSIONS);
    // Reporter ownership is checked by the existing intake action at execution.
    case 'reports':
      return true;
    default:
      return false;
  }
}
function capabilities(binding: AccessBinding, principal: DelegatedPrincipal): GuildCapabilities {
  const scopes = principal.scopes.filter((scope) => binding.grant.scopes.includes(scope));
  const kinds = [
    'cases',
    'detections',
    'reports',
    'intakes',
    'attention',
    'setup',
    'diagnostics',
  ] as const;
  const purposes = ['report', 'case', 'ban', 'kick', 'configure'] as const;
  return {
    guildId: binding.guildId,
    scopes,
    workflows: workflowDefinitions
      .filter(
        (definition) =>
          scopes.includes(definition.scope) && permitsWorkflow(binding, definition.authorityCommand)
      )
      .map((definition) => definition.id),
    reads: scopes.includes('drasil:read')
      ? kinds.filter((kind) => permitsRead(binding, { kind, guildId: binding.guildId }))
      : [],
    memberContext: scopes.includes('drasil:read')
      ? purposes.filter((purpose) => permitsPurpose(binding, purpose))
      : [],
  };
}
export function createDelegatedAccess(deps: DelegatedAccessDependencies): DelegatedAccess {
  const now = deps.now ?? Date.now;
  // Only bounded directory pages are cached. No grant, role or permission decisions are cached.
  const hints = new Map<
    string,
    { expiresAt: number; page: Awaited<ReturnType<DelegatedGuildDirectory['listActive']>> }
  >();
  async function authorizeGuild(
    principal: DelegatedPrincipal,
    guildId: string,
    scope: DelegatedScope
  ): Promise<AccessDecision> {
    try {
      const grant = await deps.store.findConnection(principal.connectionId);
      if (!grantMatches(grant, principal)) return denied('invalid_grant');
      if (!principal.scopes.includes(scope) || !grant.scopes.includes(scope))
        return denied('scope_denied');
      if (grant.selection.mode === 'selected' && !grant.selection.guildIds.includes(guildId))
        return denied('guild_denied');
      if (!(await deps.guilds.isActive(guildId))) return denied('guild_denied');
      const facts = await deps.authority.loadFresh(guildId, principal.userId);
      if (!facts?.present) return denied('actor_unavailable');
      if (facts.userId !== principal.userId || facts.guildId !== guildId)
        return denied('binding_mismatch');
      const staffRoleIds = await deps.staffRoles.loadRoleIds(guildId);
      if (
        !hasAuthority(facts, MODERATION_PERMISSIONS | BAN_MEMBERS | KICK_MEMBERS) &&
        !hasStaffAuthority(facts, staffRoleIds)
      )
        return denied('permission_denied');
      return { kind: 'allowed', grant, facts, guildId, scope, staffRoleIds };
    } catch {
      return denied('unavailable');
    }
  }
  async function authorizeRead(
    principal: DelegatedPrincipal,
    query: DelegatedReadQuery
  ): Promise<AccessDecision> {
    const binding = await authorizeGuild(principal, query.guildId, 'drasil:read');
    if (binding.kind === 'denied') return binding;
    if (
      query.kind === 'own_execution' &&
      (query.userId !== principal.userId ||
        query.connectionId !== principal.connectionId ||
        query.resource.guildId !== query.guildId)
    )
      return denied('binding_mismatch');
    const resource = query.kind === 'own_execution' ? query.resource : query;
    if (!permitsRead(binding, resource)) return denied('permission_denied');
    return (resource.kind === 'reports' || resource.kind === 'intakes') &&
      resource.audience === 'reporter'
      ? { ...binding, reporterId: principal.userId }
      : binding;
  }
  return {
    authorizeGuild,
    authorizeRead,
    async authorizeWorkflow(principal, guildId, command): Promise<AccessDecision> {
      const parsed = humanCommandSchema.safeParse(command);
      if (!parsed.success) return denied('permission_denied');
      const definition = workflowDefinitions.find(
        (candidate) => candidate.commandKind === command.kind
      );
      if (!definition) return denied('permission_denied');
      const binding = await authorizeGuild(principal, guildId, definition.scope);
      if (binding.kind === 'denied') return binding;
      try {
        return permitsWorkflow(binding, parsed.data) ? binding : denied('permission_denied');
      } catch {
        return denied('permission_denied');
      }
    },
    async listEligibleGuilds(principal, request): Promise<GuildPage> {
      const limit = request.limit ?? 25;
      const cursor = request.cursor ?? null;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (cursor !== null && (!cursor.length || cursor.length > 256))
      )
        return denied('invalid_page');
      try {
        const grant = await deps.store.findConnection(principal.connectionId);
        if (!grantMatches(grant, principal)) return denied('invalid_grant');
        const scope = principal.scopes.find((candidate) => grant.scopes.includes(candidate));
        if (!scope) return denied('scope_denied');
        const key = JSON.stringify([limit, cursor]);
        let entry = hints.get(key);
        if (!entry || entry.expiresAt <= now()) {
          entry = {
            page: await deps.guilds.listActive({ limit, cursor }),
            expiresAt: now() + 60_000,
          };
          if (entry.page.guildIds.length > limit) return denied('unavailable');
          if (hints.size >= 128) hints.delete(hints.keys().next().value!);
          hints.set(key, entry);
        }
        const guilds: GuildCapabilities[] = [];
        // Each batch has at most four in-flight membership refreshes and preserves directory ordering.
        for (let index = 0; index < entry.page.guildIds.length; index += 4) {
          const decisions = await Promise.all(
            entry.page.guildIds
              .slice(index, index + 4)
              .map((id) => authorizeGuild(principal, id, scope))
          );
          for (const decision of decisions) {
            if (decision.kind === 'allowed') guilds.push(capabilities(decision, principal));
            else if (decision.reason === 'unavailable' || decision.reason === 'invalid_grant')
              return decision;
          }
        }
        return { kind: 'allowed', guilds, nextCursor: entry.page.nextCursor };
      } catch {
        return denied('unavailable');
      }
    },
  };
}
