'use client';
import { PublicShell } from '@/components/workspace/PublicShell';
import { useEffect, useState, useTransition } from 'react';
import type { GuildSelection } from '@drasil/application';
import {
  consentMcpConnection,
  declineMcpConnection,
  loadMcpConnections,
  loadMcpFlow,
  loadMcpServers,
  mcpSessionStatus,
  revokeMcpConnection,
  selectMcpServers,
  updateMcpSelection,
} from '../../app/mcp/actions';

const scopeCopy: Record<string, string> = {
  'drasil:read': 'Read moderation data',
  'drasil:moderate': 'Take moderation actions',
  'drasil:configure': 'Change server settings',
  offline_access: 'Stay connected when you sign out',
};
type FlowView = Awaited<ReturnType<typeof loadMcpFlow>>;
type OwnConnection = Awaited<ReturnType<typeof loadMcpConnections>>['connections'][number];
export function ConnectionPanel({
  step,
}: {
  step: 'connect' | 'select' | 'consent' | 'connections';
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('loading');
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [connectionCursor, setConnectionCursor] = useState<string | null>(null);
  const [connections, setConnections] = useState<OwnConnection[]>([]);
  const [servers, setServers] = useState<{ id: string; name: string }[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [allEligible, setAllEligible] = useState(false);
  const [scopes, setScopes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<OwnConnection | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let current = true;
    const exactQuery = window.location.search.slice(1);
    setQuery(exactQuery);
    void (async () => {
      try {
        const sessionStatus = await mcpSessionStatus();
        if (current) setStatus(sessionStatus);
        if (sessionStatus !== 'authenticated') return;
        if (step === 'connections') {
          const own = await loadMcpConnections();
          if (!current) return;
          setConnections(own.connections);
          setConnectionCursor(own.nextCursor);
          return;
        }
        const view = await loadMcpFlow(exactQuery);
        if (!current) return;
        setFlow(view);
        setServers(view.servers);
        setCursor(view.nextCursor);
        setScopes(view.approvedScopes ?? view.requestedScopes);
        if (view.selection?.mode === 'selected') setIds([...view.selection.guildIds]);
        setAllEligible(view.selection?.mode === 'all_eligible');
      } catch {
        if (current)
          setError('This request is unavailable or expired. Start again from your client.');
      }
    })();
    return () => {
      current = false;
    };
  }, [step]);
  function run(action: () => Promise<void>) {
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        await action();
      } catch {
        setError(
          'Could not save this request. It may have expired or changed. Reload and try again.'
        );
      }
    });
  }
  async function login() {
    const callbackURL =
      step === 'connections' ? '/mcp/connections' : `/mcp/select-servers?${query}`;
    const response = await fetch('/api/mcp-auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'discord', callbackURL }),
    });
    if (!response.ok) throw new Error('Login unavailable');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('url' in body) || typeof body.url !== 'string')
      throw new Error('Login unavailable');
    window.location.assign(body.url);
  }
  const selection: GuildSelection = allEligible
    ? { mode: 'all_eligible' }
    : { mode: 'selected', guildIds: ids };
  const choosing = step === 'select' || step === 'connect' || !!editing;
  const title =
    status === 'disabled'
      ? 'Connections unavailable'
      : status === 'login'
        ? 'Connect to Drasil'
        : step === 'connections'
          ? 'Your connections'
          : step === 'consent'
            ? 'Allow this connection?'
            : 'Choose servers';
  return (
    <PublicShell actions={<a href="/mcp/connections">Your connections</a>}>
      <main className="mcp-shell">
        <h1>{title}</h1>
        {status === 'loading' && <p role="status">Loading your connection…</p>}
        {status === 'disabled' && <p>Client connections are not enabled here.</p>}
        {status === 'login' && (
          <>
            <p>Sign in with Discord to choose the servers this client can access.</p>
            <button className="button" disabled={pending} onClick={() => run(login)}>
              Continue with Discord
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {flow && (
          <>
            <p className="mcp-client">
              Client: <strong>{flow.label}</strong>
              <code>Client ID: {flow.clientId}</code>
            </p>
            <p>Your current Discord permissions still apply to every action.</p>
          </>
        )}
        {status === 'authenticated' && choosing && (flow || editing) && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                if (editing) {
                  await updateMcpSelection(
                    editing.grant.connectionId,
                    editing.grant.version,
                    selection
                  );
                  setEditing(null);
                  const own = await loadMcpConnections();
                  setConnections(own.connections);
                  setConnectionCursor(own.nextCursor);
                  setNotice(
                    'Selection saved. Reconnect from your client and approve again to use it. Previous credentials no longer work.'
                  );
                } else window.location.assign(await selectMcpServers(query, selection, scopes));
              });
            }}
          >
            {editing && <h2>Edit servers for {editing.label}</h2>}
            <fieldset disabled={pending}>
              <legend>Server access</legend>
              <label className="mcp-choice">
                <input
                  type="radio"
                  name="mode"
                  checked={!allEligible}
                  onChange={() => setAllEligible(false)}
                />
                Only selected servers
              </label>
              <label className="mcp-choice">
                <input
                  type="radio"
                  name="mode"
                  checked={allEligible}
                  onChange={() => setAllEligible(true)}
                />
                All eligible servers, including servers you become eligible for in the future
              </label>
              <p>
                Only active Drasil servers where you have staff or moderation access are eligible.
              </p>
              {!allEligible && (
                <div>
                  {servers.map((server) => (
                    <label className="mcp-choice" key={server.id}>
                      <input
                        type="checkbox"
                        checked={ids.includes(server.id)}
                        onChange={(event) =>
                          setIds(
                            event.target.checked
                              ? [...ids, server.id]
                              : ids.filter((id) => id !== server.id)
                          )
                        }
                      />
                      {server.name} <small>{server.id}</small>
                    </label>
                  ))}
                  {ids
                    .filter((id) => !servers.some((server) => server.id === id))
                    .map((id) => (
                      <label className="mcp-choice" key={id}>
                        <input
                          type="checkbox"
                          checked
                          onChange={() =>
                            setIds((current) => current.filter((value) => value !== id))
                          }
                        />
                        Selected server {id}. Remove it if you no longer have access.
                      </label>
                    ))}
                  {!servers.length && <p>No eligible servers on this page.</p>}
                  {cursor && (
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        run(async () => {
                          const page = await loadMcpServers(editing ? null : query, cursor);
                          setServers((current) => [...current, ...page.servers]);
                          setCursor(page.nextCursor);
                        })
                      }
                    >
                      Load more servers
                    </button>
                  )}
                </div>
              )}
            </fieldset>
            {flow && !editing && (
              <fieldset disabled={pending}>
                <legend>Capabilities</legend>
                {flow.requestedScopes.map((scope) => (
                  <label className="mcp-choice" key={scope}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={(event) =>
                        setScopes(
                          event.target.checked
                            ? [...scopes, scope]
                            : scopes.filter((value) => value !== scope)
                        )
                      }
                    />
                    <span>
                      {scopeCopy[scope]} <code>{scope}</code>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {editing && (
              <p>
                Saving ends access for existing credentials. Start a new connection from your client
                and approve it again.
              </p>
            )}
            <div className="mcp-actions">
              <button
                className="button"
                type="submit"
                disabled={
                  pending ||
                  (!allEligible && !ids.length) ||
                  (!editing && !scopes.some((scope) => scope !== 'offline_access'))
                }
              >
                {pending ? 'Saving…' : editing ? 'Save and require reconnection' : 'Continue'}
              </button>
              {editing && (
                <button className="button secondary" type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
        {flow && step === 'consent' && (
          <>
            <section aria-label="Connection summary">
              <h2>Server access</h2>
              {flow.selection?.mode === 'all_eligible' ? (
                <p>All eligible servers, including future servers.</p>
              ) : (
                <ul>
                  {flow.selection?.guildIds.map((id) => (
                    <li key={id}>
                      {flow.servers.find((server) => server.id === id)?.name ?? id}{' '}
                      <small>{id}</small>
                    </li>
                  ))}
                </ul>
              )}
              <h2>Selected capabilities</h2>
              <ul>
                {flow.approvedScopes?.map((scope) => (
                  <li key={scope}>
                    {scopeCopy[scope]} <code>{scope}</code>
                  </li>
                ))}
              </ul>
            </section>
            <p>Only approve if you trust this client. You can revoke access in Your connections.</p>
            <div className="mcp-actions">
              <button
                className="button"
                disabled={pending || !flow.selection}
                onClick={() =>
                  run(async () => window.location.assign(await consentMcpConnection(query, scopes)))
                }
              >
                Allow connection
              </button>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() =>
                  run(async () => window.location.assign(await declineMcpConnection(query)))
                }
              >
                Decline
              </button>
            </div>
          </>
        )}
        {step === 'connections' && status === 'authenticated' && !editing && (
          <>
            <p>Review client access or revoke it at any time.</p>
            {!connections.length && (
              <p>No connections yet. Start from your MCP client to connect.</p>
            )}
            <ul className="mcp-connections">
              {connections.map((item) => (
                <li key={item.grant.connectionId}>
                  <h2>{item.label}</h2>
                  <p>
                    {item.grant.revokedAt
                      ? 'Revoked'
                      : item.completed
                        ? 'Consent recorded'
                        : 'Awaiting consent or reconnection'}
                  </p>
                  <p>
                    {item.grant.selection.mode === 'all_eligible'
                      ? 'All eligible servers, including future servers'
                      : `Selected servers: ${item.grant.selection.guildIds.join(', ')}`}
                  </p>
                  <p>{item.grant.scopes.join(' · ')}</p>
                  {!item.grant.revokedAt && (
                    <div className="mcp-actions">
                      <button
                        className="button secondary"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const page = await loadMcpServers(null, null);
                            setServers(page.servers);
                            setCursor(page.nextCursor);
                            setEditing(item);
                            setIds(
                              item.grant.selection.mode === 'selected'
                                ? [...item.grant.selection.guildIds]
                                : []
                            );
                            setAllEligible(item.grant.selection.mode === 'all_eligible');
                          })
                        }
                      >
                        Edit servers
                      </button>
                      <button
                        className="button secondary"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            await revokeMcpConnection(item.grant.connectionId, item.grant.version);
                            const own = await loadMcpConnections();
                            setConnections(own.connections);
                            setConnectionCursor(own.nextCursor);
                            setNotice('Connection revoked.');
                          })
                        }
                      >
                        Revoke access
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {connectionCursor && (
              <button
                className="button secondary"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const page = await loadMcpConnections(connectionCursor);
                    setConnections((current) => [...current, ...page.connections]);
                    setConnectionCursor(page.nextCursor);
                  })
                }
              >
                Load more connections
              </button>
            )}
          </>
        )}
      </main>
    </PublicShell>
  );
}
