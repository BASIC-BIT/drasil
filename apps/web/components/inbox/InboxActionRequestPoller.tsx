'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  hasActiveInboxActionRequests,
  reconcileLocalInboxActionRequestIds,
} from '@/lib/inboxActionReceipts';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';

const REFRESH_INTERVAL_MS = 2_000;
type SetLocalRequestActive = (requestId: string, active: boolean) => void;

const InboxActionRequestPollingContext = createContext<SetLocalRequestActive>(() => undefined);

function EnabledInboxActionRequestPolling({
  children,
  serverRequests,
}: {
  readonly children: ReactNode;
  readonly serverRequests: readonly ModerationActionRequestSummary[];
}) {
  const router = useRouter();
  const [localActiveRequestIds, setLocalActiveRequestIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const setLocalRequestActive = useCallback<SetLocalRequestActive>((requestId, active) => {
    setLocalActiveRequestIds((previous) => {
      if (previous.has(requestId) === active) {
        return previous;
      }

      const next = new Set(previous);
      if (active) {
        next.add(requestId);
      } else {
        next.delete(requestId);
      }
      return next;
    });
  }, []);
  const serverActive = hasActiveInboxActionRequests(serverRequests);
  const active = serverActive || localActiveRequestIds.size > 0;

  useEffect(() => {
    setLocalActiveRequestIds((previous) =>
      reconcileLocalInboxActionRequestIds(previous, serverRequests)
    );
  }, [serverRequests]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = window.setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [active, router]);

  const contextValue = useMemo(() => setLocalRequestActive, [setLocalRequestActive]);
  return (
    <InboxActionRequestPollingContext.Provider value={contextValue}>
      {children}
    </InboxActionRequestPollingContext.Provider>
  );
}

export function InboxActionRequestPollingProvider({
  children,
  enabled,
  serverRequests,
}: {
  readonly children: ReactNode;
  readonly enabled: boolean;
  readonly serverRequests: readonly ModerationActionRequestSummary[];
}) {
  if (!enabled) {
    return children;
  }
  return (
    <EnabledInboxActionRequestPolling serverRequests={serverRequests}>
      {children}
    </EnabledInboxActionRequestPolling>
  );
}

export function useInboxActionRequestPolling(): SetLocalRequestActive {
  return useContext(InboxActionRequestPollingContext);
}
