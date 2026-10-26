'use client';
import { PublicShell } from '@/components/workspace/PublicShell';
import { useState } from 'react';
/** Provider session login returns to this same saved confirmation; no approval occurs here. */
export function ApprovalSignIn({ confirmationId }: { confirmationId: string }) {
  const [error, setError] = useState(false);
  async function login() {
    try {
      const response = await fetch('/api/mcp-auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'discord',
          callbackURL: `/mcp/confirm/${encodeURIComponent(confirmationId)}`,
        }),
      });
      if (!response.ok) throw new Error('Login unavailable');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('url' in body) || typeof body.url !== 'string')
        throw new Error('Login unavailable');
      window.location.assign(body.url);
    } catch {
      setError(true);
    }
  }
  return (
    <PublicShell>
      <main className="mcp-shell">
        <h1>Sign in to review this action</h1>
        <button className="button" onClick={login}>
          Sign in with Discord
        </button>
        {error && <p role="alert">Sign in is unavailable. Try again.</p>}
      </main>
    </PublicShell>
  );
}
