'use client';

import type { WorkspaceReadFailureCode } from '@/lib/workspaceReadFailure';
import { ActionButton, DrasilBrand, Foundation } from './Foundation';
import styles from './WorkspaceReadFailure.module.css';

const messages: Record<WorkspaceReadFailureCode, { title: string; description: string }> = {
  authentication_required: {
    title: 'Sign in to continue',
    description: 'Your Discord sign-in is no longer valid. Sign in again to verify access.',
  },
  access_denied: {
    title: 'Server access required',
    description:
      'You need to be the server owner or have Administrator or Manage Server permission. After your permissions change, try again.',
  },
  unavailable: {
    title: 'Unable to verify server access',
    description:
      'Discord access could not be verified. Check that Drasil still has access to this server, then try again.',
  },
  not_found: {
    title: 'Item not found',
    description:
      'This item is no longer available in this server. Return to the inbox to choose another item.',
  },
  internal_error: {
    title: 'Unable to load this workspace',
    description: 'Try again in a moment.',
  },
};
export function WorkspaceReadFailure({
  code,
  returnTo,
  onRetry,
}: {
  readonly code: WorkspaceReadFailureCode;
  readonly returnTo: string;
  readonly onRetry: () => void;
}) {
  const message = messages[code];
  return (
    <section className={styles.failure} role="alert">
      <h2>{message.title}</h2>
      <p>{message.description}</p>
      <div className={styles.actions}>
        {code === 'authentication_required' ? (
          <a href={`/api/auth/discord?${new URLSearchParams({ returnTo })}`}>
            Sign in with Discord
          </a>
        ) : (
          <ActionButton onClick={onRetry}>Try again</ActionButton>
        )}
        <a href="/admin">Choose a server</a>
      </div>
    </section>
  );
}
export function WorkspaceAccessFailure({
  code,
}: {
  readonly code: 'access_denied' | 'unavailable';
}) {
  return (
    <Foundation>
      <main className={styles.page}>
        <DrasilBrand href="/admin" />
        <WorkspaceReadFailure
          code={code}
          returnTo="/admin"
          onRetry={() => window.location.reload()}
        />
      </main>
    </Foundation>
  );
}
