import { describe, expect, it, vi } from 'vitest';
import { createMcpConnectionService } from '../../lib/mcp/connections';

const selection = { mode: 'selected', guildIds: ['123456789012345678'] } as const;
function fixture() {
  const session = {
    user: { id: 'issuer-user' },
    session: { id: 'session', userId: 'issuer-user' },
  };
  const flow = {
    id: 'flow',
    clientId: 'client',
    requestedScopes: ['drasil:read', 'drasil:moderate', 'offline_access'],
    approvedScopes: null,
    referenceId: null,
    expiresAt: new Date(Date.now() + 60000),
  };
  const issuer = {
    requireBrowserSession: vi.fn(async () => session),
    requireSession: vi.fn(async () => session),
    flows: {
      createAuthorizationFlow: vi.fn(async () => flow),
      selectAuthorizationFlow: vi.fn(async () => ({
        id: 'connection',
        referenceId: 'ref',
        scopes: ['drasil:read', 'offline_access'],
      })),
      cancelAuthorizationFlow: vi.fn(async () => undefined),
    },
    handler: vi.fn(async (_request: Request) =>
      Response.json({ url: 'http://localhost:3001/mcp/consent?signed=exact&ba_param=a&ba_param=b' })
    ),
  };
  const deps = {
    issuer,
    origin: 'http://localhost:3001',
    actor: vi.fn(async () => '123456789012345678'),
    eligible: vi.fn(async () => true),
    store: { findConnection: vi.fn(), updateSelection: vi.fn(), revokeConnection: vi.fn() },
  };
  return { ...deps, service: createMcpConnectionService(deps) };
}
const request = () =>
  new Request('http://localhost:3001/mcp/select-servers', {
    method: 'POST',
    headers: { origin: 'http://localhost:3001', cookie: 'issuer-session' },
  });
describe('MCP browser actions', () => {
  it('freezes reduced scopes and forwards the exact per-tab query to the provider', async () => {
    const f = fixture();
    await f.service.selectMcpServers(request(), 'signed=tab-a&ba_param=a&ba_param=b', selection, [
      'drasil:read',
      'offline_access',
    ]);
    expect(f.issuer.flows.selectAuthorizationFlow).toHaveBeenCalledWith(
      expect.anything(),
      'signed=tab-a&ba_param=a&ba_param=b',
      selection,
      ['drasil:read', 'offline_access']
    );
    const providerRequest = f.issuer.handler.mock.calls[0][0];
    expect(await providerRequest.json()).toEqual({
      postLogin: true,
      oauth_query: 'signed=tab-a&ba_param=a&ba_param=b',
    });
  });
  it('requires a fresh browser session before selection, including all eligible', async () => {
    const f = fixture();
    f.issuer.requireBrowserSession.mockRejectedValue(new Error('CSRF'));
    await expect(
      f.service.selectMcpServers(request(), 'query', { mode: 'all_eligible' }, ['drasil:read'])
    ).rejects.toThrow();
    expect(f.issuer.flows.selectAuthorizationFlow).not.toHaveBeenCalled();
  });
  it('checks verified actor eligibility without inventing a grant', async () => {
    const f = fixture();
    f.eligible.mockResolvedValue(false);
    await expect(
      f.service.selectMcpServers(request(), 'query', selection, ['drasil:read'])
    ).rejects.toThrow();
    expect(f.eligible).toHaveBeenCalledWith('123456789012345678', '123456789012345678');
    expect(f.issuer.flows.selectAuthorizationFlow).not.toHaveBeenCalled();
  });
  it('declines only the bound flow before calling maintained provider', async () => {
    const f = fixture();
    await f.service.declineMcpConnection(request(), 'tab-b');
    expect(f.issuer.flows.cancelAuthorizationFlow).toHaveBeenCalledWith(expect.anything(), 'tab-b');
    expect(await f.issuer.handler.mock.calls[0][0].json()).toEqual({
      accept: false,
      oauth_query: 'tab-b',
    });
  });
  it('rejects consent scope substitution against the frozen reference', async () => {
    const f = fixture();
    Object.assign(await f.issuer.flows.createAuthorizationFlow(), {
      referenceId: 'ref',
      approvedScopes: ['drasil:read'],
    });
    await expect(
      f.service.consentMcpConnection(request(), 'query', ['drasil:moderate'])
    ).rejects.toThrow();
    expect(f.issuer.handler).not.toHaveBeenCalled();
  });
  it('does not expose or revoke another actor connection', async () => {
    const f = fixture();
    f.store.findConnection.mockResolvedValue({ userId: 'other' });
    await expect(
      f.service.revokeMcpConnection(request(), '00000000-0000-4000-8000-000000000001', 1)
    ).rejects.toThrow();
    expect(f.store.revokeConnection).not.toHaveBeenCalled();
  });
  it('keeps all eligible as a dynamic selection without snapshotting current servers', async () => {
    const f = fixture();
    await f.service.selectMcpServers(request(), 'future-flow', { mode: 'all_eligible' }, [
      'drasil:read',
    ]);
    expect(f.issuer.flows.selectAuthorizationFlow).toHaveBeenCalledWith(
      expect.anything(),
      'future-flow',
      { mode: 'all_eligible' },
      ['drasil:read']
    );
    expect(f.eligible).not.toHaveBeenCalled();
  });
  it('sends the frozen reduced scope string to maintained consent', async () => {
    const f = fixture();
    Object.assign(await f.issuer.flows.createAuthorizationFlow(), {
      referenceId: 'ref',
      approvedScopes: ['drasil:read', 'offline_access'],
    });
    await f.service.consentMcpConnection(request(), 'exact-consent&ba_param=a&ba_param=b', [
      'drasil:read',
      'offline_access',
    ]);
    expect(await f.issuer.handler.mock.calls[0][0].json()).toEqual({
      accept: true,
      oauth_query: 'exact-consent&ba_param=a&ba_param=b',
      scope: 'drasil:read offline_access',
    });
  });
  it('uses the persisted identity and expected version for edits and revocation', async () => {
    const f = fixture();
    const grant = {
      userId: '123456789012345678',
      clientId: 'stored-client',
      connectionId: '00000000-0000-4000-8000-000000000001',
      version: 2,
      scopes: ['drasil:read'],
      selection,
      revokedAt: null,
      createdAt: new Date(),
    };
    f.store.findConnection.mockResolvedValue(grant);
    f.store.updateSelection.mockResolvedValue({ kind: 'updated', grant: { ...grant, version: 3 } });
    f.store.revokeConnection.mockResolvedValue({
      kind: 'updated',
      grant: { ...grant, version: 3 },
    });
    await expect(
      f.service.updateMcpSelection(request(), grant.connectionId, 1, selection)
    ).rejects.toThrow();
    expect(f.store.updateSelection).not.toHaveBeenCalled();
    await f.service.updateMcpSelection(request(), grant.connectionId, 2, selection);
    expect(f.store.updateSelection).toHaveBeenCalledWith(
      {
        userId: grant.userId,
        clientId: grant.clientId,
        connectionId: grant.connectionId,
        grantVersion: 2,
        scopes: grant.scopes,
      },
      selection,
      2
    );
    await f.service.revokeMcpConnection(request(), grant.connectionId, 2);
    expect(f.store.revokeConnection).toHaveBeenCalledWith(
      expect.objectContaining({ userId: grant.userId, grantVersion: 2 }),
      2
    );
  });
  it('does not authorize a flow from another issuer session', async () => {
    const f = fixture();
    f.issuer.flows.createAuthorizationFlow.mockRejectedValue(new Error('session binding'));
    await expect(
      f.service.selectMcpServers(request(), 'other-session-flow', selection, ['drasil:read'])
    ).rejects.toThrow();
    expect(f.issuer.flows.selectAuthorizationFlow).not.toHaveBeenCalled();
  });
  it('uses the maintained provider callback for a registered native client', async () => {
    const f = fixture();
    Object.assign(await f.issuer.flows.createAuthorizationFlow(), {
      referenceId: 'ref',
      approvedScopes: ['drasil:read'],
    });
    f.issuer.handler.mockResolvedValue(
      Response.json({ url: 'com.example.client:/callback?code=provider-code' })
    );
    await expect(
      f.service.consentMcpConnection(request(), 'signed-native-flow', ['drasil:read'])
    ).resolves.toBe('com.example.client:/callback?code=provider-code');
  });
});
