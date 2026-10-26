'use client';

import type { CaseCleanupActions } from '@/components/cases/CaseWorkspaceController';
import { ParkedRecoveryList } from './ParkedRecoveryList';
import { ActionButton } from '@/components/workspace/Foundation';
import { chooseInboxContinuation } from '@/lib/inboxContinuation';
import {
  parseInboxLocation,
  serializeInboxLocation,
  type InboxLocation,
} from '@/lib/inboxLocation';
import {
  getModerationInboxVisibleItems,
  isModerationInboxSavedViewActive,
  moderationInboxSavedViews,
} from '@/lib/moderationInboxViewModel';
import type { WorkspaceItemDetail } from '@/lib/moderationWorkspaceTypes';
import type { WorkspaceActions } from '@/lib/workspaceActionTypes';
import {
  moderationInboxItemKindSchema,
  type ModerationInboxItem,
  type CaseSummary,
} from '@drasil/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InboxActionRequestPollingProvider } from './InboxActionRequestPoller';
import { InboxItemDetail, inboxDetailRequests, matchingInboxRequests } from './InboxItemDetail';
import { InboxQueue, inboxKindLabels } from './InboxQueue';
import styles from './InboxWorkspace.module.css';

export interface InboxWorkspaceProps {
  readonly guildId: string;
  readonly items: readonly ModerationInboxItem[];
  readonly parkedCases?: readonly CaseSummary[];
  readonly initialLocation: InboxLocation;
  readonly loadDetail: (itemId: string, signal: AbortSignal) => Promise<WorkspaceItemDetail>;
  readonly actions: WorkspaceActions;
  readonly cleanupActions?: CaseCleanupActions;
}
export type InboxDetailState =
  | { readonly kind: 'loading'; readonly guildId: string; readonly itemId: string }
  | {
      readonly kind: 'ready';
      readonly guildId: string;
      readonly itemId: string;
      readonly detail: WorkspaceItemDetail;
      readonly loadedAt: string;
    }
  | { readonly kind: 'unavailable'; readonly guildId: string; readonly itemId: string };
interface QueueRestoration {
  readonly ordering: readonly string[];
  readonly focusId: string | null;
  readonly scrollTop: number;
}
function parseRestoration(value: unknown): QueueRestoration | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('ordering' in value) ||
    !Array.isArray(value.ordering) ||
    !value.ordering.every((id: unknown) => typeof id === 'string') ||
    !('focusId' in value) ||
    (value.focusId !== null && typeof value.focusId !== 'string') ||
    !('scrollTop' in value) ||
    typeof value.scrollTop !== 'number' ||
    !Number.isFinite(value.scrollTop) ||
    value.scrollTop < 0
  )
    return null;
  return { ordering: value.ordering, focusId: value.focusId, scrollTop: value.scrollTop };
}
function readRestoration(key: string, guildId: string): QueueRestoration | null {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && 'moderationInbox' in state) {
    const metadata = state.moderationInbox;
    if (
      metadata &&
      typeof metadata === 'object' &&
      'guildId' in metadata &&
      metadata.guildId === guildId &&
      'key' in metadata &&
      metadata.key === key
    ) {
      const parsed = parseRestoration(metadata);
      if (parsed) return parsed;
    }
  }
  try {
    return parseRestoration(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
  } catch {
    return null;
  }
}
function restorationKey(guildId: string, location: InboxLocation): string {
  const viewId =
    moderationInboxSavedViews.find((view) =>
      isModerationInboxSavedViewActive(location.controls, view)
    )?.id ?? 'custom';
  return `drasil:inbox:${encodeURIComponent(guildId)}:${viewId}`;
}
function matchesDetailIdentity(
  detail: WorkspaceItemDetail,
  guildId: string,
  itemId: string
): boolean {
  if (
    detail.item.guildId !== guildId ||
    detail.item.id !== itemId ||
    detail.item.kind !== detail.kind
  )
    return false;
  switch (detail.kind) {
    case 'case':
      return (
        detail.data.detail.guildId === guildId &&
        detail.data.detail.id === detail.item.sourceId &&
        detail.data.detail.userId === detail.item.subject.userId
      );
    case 'submitted_report':
      return (
        detail.report.guildId === guildId &&
        detail.report.id === detail.item.sourceId &&
        detail.report.targetUserId === detail.item.subject.userId
      );
    case 'observed_alert':
      return detail.detection.id === detail.item.sourceId;
    case 'report_attention':
      return detail.intake.guildId === guildId && detail.intake.id === detail.item.sourceId;
    case 'support_attention':
      return (
        !detail.caseData ||
        (detail.caseData.detail.guildId === guildId &&
          detail.caseData.detail.id ===
            (detail.item.sourceMetadata?.caseId ?? detail.item.sourceId) &&
          detail.caseData.detail.userId === detail.item.subject.userId)
      );
    case 'pending_screening':
      return true;
  }
}
const locationKeys = ['view', 'kind', 'freshness', 'sort', 'q', 'selected', 'request', 'resume'];

// A document restored from browser history can contain the old queue snapshot.
// Fetch fresh route data once, carrying only explicit continuation intent in the URL.
function refreshHistoryReturn(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('resume', parseInboxLocation(url.searchParams).selectedItemId ?? '');
  window.location.replace(url);
}

export function InboxWorkspace(props: InboxWorkspaceProps) {
  // A guild change discards asynchronous and action state even for an empty queue.
  return <GuildInboxWorkspace key={props.guildId} {...props} />;
}
function GuildInboxWorkspace({
  guildId,
  items,
  parkedCases = [],
  initialLocation,
  loadDetail,
  actions,
  cleanupActions,
}: InboxWorkspaceProps) {
  const [location, setLocation] = useState(initialLocation);
  const [detailState, setDetailState] = useState<InboxDetailState | null>(null);
  const [refresh, setRefresh] = useState(0);
  const queue = useRef<HTMLDivElement>(null);
  const detailRegion = useRef<HTMLDivElement>(null);
  const ordering = useRef<readonly string[]>([]);
  const focusId = useRef<string | null>(null);
  const focusedDetail = useRef<string | null>(null);
  const pendingQueueFocus = useRef(false);
  const loadSequence = useRef(0);
  const completedReadTime = useRef(0);
  const initialRestore = useRef(true);
  const locationRef = useRef(location);
  locationRef.current = location;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const visible = useMemo(
    () =>
      getModerationInboxVisibleItems(
        items.filter((item) => item.guildId === guildId),
        location.controls
      ),
    [items, guildId, location.controls]
  );
  const storageKey = restorationKey(guildId, location);
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;
  const saveRestoration = useCallback(() => {
    const metadata: QueueRestoration = {
      ordering: ordering.current,
      focusId: focusId.current,
      scrollTop: queue.current?.scrollTop ?? 0,
    };
    try {
      sessionStorage.setItem(storageKeyRef.current, JSON.stringify(metadata));
    } catch {
      /* Storage may be disabled. URL navigation still works. */
    }
    const state: unknown = window.history.state;
    window.history.replaceState(
      {
        ...(state && typeof state === 'object' ? state : {}),
        moderationInbox: { guildId, key: storageKeyRef.current, ...metadata },
      },
      ''
    );
  }, [guildId]);
  const navigate = useCallback(
    (next: InboxLocation, replace = false) => {
      saveRestoration();
      const url = new URL(window.location.href);
      for (const key of locationKeys) url.searchParams.delete(key);
      serializeInboxLocation(next).forEach((value, key) => url.searchParams.set(key, value));
      // Next copies its router state into external native-history updates. Passing
      // its internal-write markers would skip that synchronization, letting a
      // server-action refresh restore the URL from before this selection.
      const historyState = { ...window.history.state };
      delete historyState.__NA;
      delete historyState._N;
      window.history[replace ? 'replaceState' : 'pushState'](historyState, '', url);
      setLocation(next);
    },
    [saveRestoration]
  );
  const focusQueue = useCallback((id: string | null) => {
    const rows = queue.current?.querySelectorAll<HTMLAnchorElement>('[data-inbox-item]');
    const target =
      Array.from(rows ?? []).find((row) => row.dataset.inboxItem === id) ??
      queue.current?.querySelector<HTMLHeadingElement>('h2');
    target?.focus({ preventScroll: true });
    // Preserve restored scroll when the row remains visible; reveal surviving focus otherwise.
    if (target && queue.current) {
      const bounds = target.getBoundingClientRect();
      const container = queue.current.getBoundingClientRect();
      if (
        bounds.top < Math.max(0, container.top) ||
        bounds.bottom > Math.min(window.innerHeight, container.bottom)
      )
        target.scrollIntoView({ block: 'center' });
    }
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stored = readRestoration(storageKey, guildId);
    if (initialRestore.current || !location.selectedItemId) {
      ordering.current = stored?.ordering.length ? stored.ordering : visible.map((item) => item.id);
      focusId.current = stored?.focusId ?? location.selectedItemId;
    }
    if (queue.current) queue.current.scrollTop = stored?.scrollTop ?? 0;
    if (
      initialRestore.current &&
      !params.has('resume') &&
      (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
        ?.type === 'back_forward'
    ) {
      refreshHistoryReturn();
      return;
    }
    if (initialRestore.current && params.has('resume')) {
      const validated = params.get('resume') === (location.selectedItemId ?? '');
      const nextId = validated
        ? chooseInboxContinuation({
            previousIds: ordering.current,
            selectedId: location.selectedItemId ?? focusId.current,
            currentItems: visible,
          })
        : location.selectedItemId;
      focusId.current = nextId;
      navigate(
        {
          ...location,
          selectedItemId: location.selectedItemId ? nextId : null,
          trackedRequestId: nextId === location.selectedItemId ? location.trackedRequestId : null,
        },
        true
      );
      if (!location.selectedItemId || !nextId) pendingQueueFocus.current = true;
    } else if (initialRestore.current && !location.selectedItemId && focusId.current) {
      pendingQueueFocus.current = true;
    }
    initialRestore.current = false;
    // Keep the review's captured order while filters change or a resolved row disappears.
  }, [storageKey]);
  useEffect(() => {
    const pop = () => {
      focusedDetail.current = null;
      const restored = parseInboxLocation(new URLSearchParams(window.location.search));
      const stored = readRestoration(restorationKey(guildId, restored), guildId);
      if (stored) {
        ordering.current = stored.ordering;
        focusId.current = stored.focusId;
      }
      const current = getModerationInboxVisibleItems(
        itemsRef.current.filter((item) => item.guildId === guildId),
        restored.controls
      );
      const nextId = chooseInboxContinuation({
        previousIds: ordering.current,
        selectedId: restored.selectedItemId ?? focusId.current,
        currentItems: current,
      });
      focusId.current = nextId;
      navigate(
        {
          ...restored,
          selectedItemId: restored.selectedItemId ? nextId : null,
          trackedRequestId: nextId === restored.selectedItemId ? restored.trackedRequestId : null,
        },
        true
      );
      requestAnimationFrame(() => {
        if (queue.current && stored) queue.current.scrollTop = stored.scrollTop;
      });
      if (!restored.selectedItemId || !nextId) pendingQueueFocus.current = true;
    };
    const save = () => saveRestoration();
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) refreshHistoryReturn();
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('pagehide', save);
    window.addEventListener('pageshow', show);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('pageshow', show);
    };
  }, [saveRestoration, guildId, navigate, focusQueue]);
  useEffect(() => {
    // A frame can run before the selection update reveals the mobile queue.
    // Apply explicit return focus only after that visibility change is committed.
    if (!pendingQueueFocus.current || location.selectedItemId) return;
    pendingQueueFocus.current = false;
    focusQueue(focusId.current);
  }, [location, focusQueue]);
  useEffect(() => {
    const itemId = location.selectedItemId;
    if (!itemId) return;
    const controller = new AbortController();
    const sequence = ++loadSequence.current;
    setDetailState((previous) =>
      previous?.kind === 'ready' && previous.guildId === guildId && previous.itemId === itemId
        ? previous
        : { kind: 'loading', guildId, itemId }
    );
    void loadDetail(itemId, controller.signal)
      .then((detail) => {
        if (
          controller.signal.aborted ||
          sequence !== loadSequence.current ||
          locationRef.current.selectedItemId !== itemId
        )
          return;
        if (!matchesDetailIdentity(detail, guildId, itemId)) {
          setDetailState({ kind: 'unavailable', guildId, itemId });
          return;
        }
        completedReadTime.current = Math.max(Date.now(), completedReadTime.current + 1);
        setDetailState({
          kind: 'ready',
          guildId,
          itemId,
          detail,
          loadedAt: new Date(completedReadTime.current).toISOString(),
        });
      })
      .catch(() => {
        if (controller.signal.aborted || sequence !== loadSequence.current) return;
        // Failed refreshes retain the selected evidence/result and do not reconcile a lost response.
        setDetailState((previous) =>
          previous?.kind === 'ready' && previous.itemId === itemId
            ? previous
            : { kind: 'unavailable', guildId, itemId }
        );
      });
    return () => controller.abort();
  }, [guildId, location.selectedItemId, items, loadDetail, refresh]);
  const selected =
    detailState?.kind === 'ready' &&
    detailState.itemId === location.selectedItemId &&
    detailState.guildId === guildId
      ? detailState
      : null;
  useEffect(() => {
    if (!selected || focusedDetail.current === selected.itemId) return;
    focusedDetail.current = selected.itemId;
    detailRegion.current?.focus({ preventScroll: true });
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const requests = matchingInboxRequests(selected.detail);
    const tracked = location.trackedRequestId;
    if (tracked && !requests.some((request) => request.id === tracked))
      navigate({ ...location, trackedRequestId: null }, true);
  }, [selected, location, navigate]);
  const returnHref = `/admin/guild/${encodeURIComponent(guildId)}/inbox?${serializeInboxLocation(location)}`;
  function select(id: string): void {
    ordering.current = visible.map((item) => item.id);
    focusId.current = id;
    navigate({ ...location, selectedItemId: id, trackedRequestId: null });
  }
  function back(): void {
    focusId.current = chooseInboxContinuation({
      previousIds: ordering.current,
      selectedId: location.selectedItemId,
      currentItems: visible,
    });
    focusedDetail.current = null;
    navigate({ ...location, selectedItemId: null, trackedRequestId: null });
    pendingQueueFocus.current = true;
  }
  function next(): void {
    const id = chooseInboxContinuation({
      previousIds: ordering.current,
      selectedId: location.selectedItemId,
      currentItems: visible.filter((item) => item.id !== location.selectedItemId),
    });
    if (id) select(id);
    else back();
  }
  return (
    <section
      className={styles.workspace}
      data-selected={Boolean(location.selectedItemId)}
      aria-label="Moderation inbox"
    >
      <div className={styles.controls}>
        <div className={styles.presets}>
          {moderationInboxSavedViews.map((view) => (
            <button
              key={view.id}
              aria-pressed={isModerationInboxSavedViewActive(location.controls, view)}
              onClick={() => navigate({ ...location, controls: view.controls })}
            >
              {view.label}
            </button>
          ))}
        </div>
        <label>
          Kind
          <select
            aria-label="Inbox kind"
            value={location.controls.kind}
            onChange={(event) => {
              const value = event.target.value;
              const parsed = moderationInboxItemKindSchema.safeParse(value);
              if (value === 'all' || parsed.success)
                navigate({
                  ...location,
                  controls: { ...location.controls, kind: parsed.success ? parsed.data : 'all' },
                });
            }}
          >
            <option value="all">All kinds</option>
            {moderationInboxItemKindSchema.options.map((kind) => (
              <option key={kind} value={kind}>
                {inboxKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Freshness
          <select
            aria-label="Inbox freshness"
            value={location.controls.freshness}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === 'all' ||
                value === 'fresh' ||
                value === 'stale' ||
                value === 'attention'
              )
                navigate({ ...location, controls: { ...location.controls, freshness: value } });
            }}
          >
            {['all', 'fresh', 'stale', 'attention'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            aria-label="Inbox sort"
            value={location.controls.sortMode}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === 'priority' ||
                value === 'newest' ||
                value === 'oldest' ||
                value === 'stale'
              )
                navigate({ ...location, controls: { ...location.controls, sortMode: value } });
            }}
          >
            {['priority', 'newest', 'oldest', 'stale'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.search}>
          Search
          <input
            aria-label="Search inbox"
            type="search"
            value={location.controls.searchQuery}
            onChange={(event) =>
              navigate({
                ...location,
                controls: { ...location.controls, searchQuery: event.target.value },
              })
            }
          />
        </label>
      </div>
      <div className={styles.columns}>
        <div
          className={styles.queue}
          ref={queue}
          role="region"
          aria-label="Inbox queue"
          onScroll={saveRestoration}
          onFocusCapture={(event) => {
            if (event.target instanceof HTMLAnchorElement && event.target.dataset.inboxItem)
              focusId.current = event.target.dataset.inboxItem;
          }}
        >
          <InboxQueue guildId={guildId} items={visible} location={location} onSelect={select} />
          <ParkedRecoveryList guildId={guildId} cases={parkedCases} returnHref={returnHref} />
        </div>
        {location.selectedItemId ? (
          <div>
            <div className={styles.toolbar}>
              {selected?.detail.kind === 'case' ? (
                <a
                  href={`/admin/guild/${encodeURIComponent(guildId)}/cases/${encodeURIComponent(selected.detail.data.detail.id)}?${new URLSearchParams({ returnTo: returnHref })}`}
                >
                  Open case
                </a>
              ) : null}
              <ActionButton onClick={back}>Back to inbox</ActionButton>
              <ActionButton onClick={next}>Next item</ActionButton>
              <ActionButton onClick={() => setRefresh((value) => value + 1)}>
                Refresh item
              </ActionButton>
            </div>
            <div
              ref={detailRegion}
              tabIndex={-1}
              role="region"
              aria-label="Selected inbox item"
              className={styles.detail}
            >
              {selected ? (
                <InboxActionRequestPollingProvider
                  enabled
                  serverRequests={matchingInboxRequests(selected.detail)}
                >
                  {!visible.some((item) => item.id === selected.itemId) ? (
                    <p className={styles.retained}>This item is outside the current queue.</p>
                  ) : null}
                  <InboxItemDetail
                    detail={selected.detail}
                    loadedAt={selected.loadedAt}
                    returnHref={returnHref}
                    trackedRequestId={location.trackedRequestId}
                    actions={actions}
                    cleanupActions={cleanupActions}
                    available={items.some(
                      (item) => item.guildId === guildId && item.id === selected.itemId
                    )}
                    onTrackedRequest={(id) => {
                      if (
                        inboxDetailRequests(selected.detail).some((request) => request.id === id) &&
                        matchingInboxRequests(selected.detail).some((request) => request.id === id)
                      )
                        navigate({ ...locationRef.current, trackedRequestId: id }, true);
                    }}
                  />
                </InboxActionRequestPollingProvider>
              ) : detailState?.kind === 'unavailable' &&
                detailState.itemId === location.selectedItemId ? (
                <p>Item unavailable. Return to the queue or refresh this item.</p>
              ) : (
                <p role="status">Loading item...</p>
              )}
            </div>
          </div>
        ) : visible.length ? (
          <p className={styles.empty}>Select an item to review.</p>
        ) : null}
      </div>
    </section>
  );
}
