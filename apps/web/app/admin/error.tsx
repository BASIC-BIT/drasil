'use client';

import { PublicShell } from '@/components/workspace/PublicShell';
import { WorkspaceReadFailure } from '@/components/workspace/WorkspaceReadFailure';

// Next 16 supplies error: unknown and retry: () => void. A document navigation
// deliberately makes a fresh GET, including after an uncertain action response.
export default function AdminError() {
  return (
    <PublicShell>
      <main className="shell">
        <WorkspaceReadFailure
          code="internal_error"
          headingLevel={1}
          returnTo="/admin"
          onRetry={() => window.location.assign(window.location.href)}
        />
      </main>
    </PublicShell>
  );
}
