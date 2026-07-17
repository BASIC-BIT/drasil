'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const REFRESH_INTERVAL_MS = 2_000;

export function MessageCleanupJobPoller({ active }: { readonly active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = window.setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [active, router]);

  return null;
}
