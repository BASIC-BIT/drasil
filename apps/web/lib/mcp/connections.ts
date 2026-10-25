import { z } from 'zod';
import type { ConnectionGrant, DelegationStore, GuildSelection } from '@drasil/application';
import type { AuthorizationFlow, IssuerSession } from './auth/flows';

const selectionSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('selected'),
      guildIds: z
        .array(z.string().regex(/^\d{17,20}$/))
        .min(1)
        .max(1000),
    })
    .strict(),
  z.object({ mode: z.literal('all_eligible') }).strict(),
]);
const scopesSchema = z
  .array(z.enum(['drasil:read', 'drasil:moderate', 'drasil:configure', 'offline_access']))
  .min(1)
  .max(4);
export interface ConnectionIssuer {
  requireBrowserSession(request: Request): Promise<IssuerSession>;
  requireSession(headers: Headers): Promise<IssuerSession>;
  flows: {
    createAuthorizationFlow(session: IssuerSession, query: string): Promise<AuthorizationFlow>;
    selectAuthorizationFlow(
      session: IssuerSession,
      query: string,
      selection: GuildSelection,
      scopes?: readonly string[]
    ): Promise<{ id: string; referenceId: string; scopes: string[] }>;
    cancelAuthorizationFlow(session: IssuerSession, query: string): Promise<void>;
  };
  handler(request: Request): Promise<Response>;
}
export interface ConnectionServiceDependencies {
  issuer: ConnectionIssuer;
  origin: string;
  actor(session: IssuerSession): Promise<string>;
  eligible(actorId: string, guildId: string): Promise<boolean>;
  store: Pick<DelegationStore, 'findConnection' | 'updateSelection' | 'revokeConnection'>;
}
function invalid(): never {
  throw new Error('This connection request is unavailable. Start again from your client.');
}
export function createMcpConnectionService(deps: ConnectionServiceDependencies) {
  async function provider(
    request: Request,
    path: string,
    body: Record<string, unknown>
  ): Promise<string> {
    const response = await deps.issuer.handler(
      new Request(`${deps.origin}/api/mcp-auth/oauth2/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: deps.origin,
          cookie: request.headers.get('cookie') ?? '',
        },
        body: JSON.stringify(body),
      })
    );
    if (!response.ok) invalid();
    const parsed = z.object({ url: z.string() }).safeParse(await response.json());
    if (!parsed.success) invalid();
    const url = new URL(parsed.data.url, deps.origin);
    if (path === 'continue' && (url.origin !== deps.origin || url.pathname !== '/mcp/consent'))
      invalid();
    return url.href;
  }
  async function validateSelection(actor: string, input: GuildSelection): Promise<GuildSelection> {
    const selection = selectionSchema.parse(input);
    if (selection.mode === 'selected') {
      // At most four Discord refreshes are in flight, even for a large submitted selection.
      for (let index = 0; index < selection.guildIds.length; index += 4) {
        const allowed = await Promise.all(
          selection.guildIds.slice(index, index + 4).map((id) => deps.eligible(actor, id))
        );
        if (allowed.some((value) => !value)) invalid();
      }
      return { mode: 'selected', guildIds: [...new Set(selection.guildIds)] };
    }
    return selection;
  }
  async function owned(request: Request, id: string, version: number): Promise<ConnectionGrant> {
    const session = await deps.issuer.requireBrowserSession(request);
    z.string().uuid().parse(id);
    z.number().int().positive().parse(version);
    const actor = await deps.actor(session);
    const grant = await deps.store.findConnection(id);
    if (!grant || grant.userId !== actor || grant.revokedAt || grant.version !== version) invalid();
    return grant;
  }
  function principal(grant: ConnectionGrant) {
    return {
      userId: grant.userId,
      clientId: grant.clientId,
      connectionId: grant.connectionId,
      grantVersion: grant.version,
      scopes: grant.scopes,
    };
  }
  return {
    async selectMcpServers(
      request: Request,
      flowId: string,
      input: GuildSelection,
      approvedScopes?: readonly string[]
    ): Promise<string> {
      const session = await deps.issuer.requireBrowserSession(request);
      const flow = await deps.issuer.flows.createAuthorizationFlow(session, flowId);
      const scopes = scopesSchema.parse(approvedScopes ?? flow.requestedScopes);
      if (
        scopes.some((scope) => !flow.requestedScopes.includes(scope)) ||
        !scopes.some((scope) => scope !== 'offline_access')
      )
        invalid();
      const selection = await validateSelection(await deps.actor(session), input);
      await deps.issuer.flows.selectAuthorizationFlow(session, flowId, selection, scopes);
      return provider(request, 'continue', { postLogin: true, oauth_query: flowId });
    },
    async consentMcpConnection(
      request: Request,
      flowId: string,
      grantedScopes: readonly string[]
    ): Promise<string> {
      const session = await deps.issuer.requireBrowserSession(request);
      const flow = await deps.issuer.flows.createAuthorizationFlow(session, flowId);
      const scopes = scopesSchema.parse(grantedScopes);
      if (
        !flow.referenceId ||
        !flow.approvedScopes ||
        scopes.join(' ') !== flow.approvedScopes.join(' ')
      )
        invalid();
      return provider(request, 'consent', {
        accept: true,
        oauth_query: flowId,
        scope: flow.approvedScopes.join(' '),
      });
    },
    async declineMcpConnection(request: Request, flowId: string): Promise<string> {
      const session = await deps.issuer.requireBrowserSession(request);
      await deps.issuer.flows.cancelAuthorizationFlow(session, flowId);
      return provider(request, 'consent', { accept: false, oauth_query: flowId });
    },
    async revokeMcpConnection(
      request: Request,
      connectionId: string,
      expectedVersion: number
    ): Promise<void> {
      const grant = await owned(request, connectionId, expectedVersion);
      if ((await deps.store.revokeConnection(principal(grant), expectedVersion)).kind !== 'updated')
        invalid();
    },
    async updateMcpSelection(
      request: Request,
      connectionId: string,
      expectedVersion: number,
      input: GuildSelection
    ): Promise<void> {
      const grant = await owned(request, connectionId, expectedVersion);
      const selection = await validateSelection(grant.userId, input);
      if (
        (await deps.store.updateSelection(principal(grant), selection, expectedVersion)).kind !==
        'updated'
      )
        invalid();
    },
  };
}
