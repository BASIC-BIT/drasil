import {
  sortModerationInboxItems,
  type ModerationInboxItem,
  type ModerationInboxItemKind,
} from '@drasil/contracts';

export type ModerationInboxKindFilter = 'all' | ModerationInboxItemKind;
export type ModerationInboxFreshnessFilter = 'all' | 'stale' | 'fresh' | 'attention';
export type ModerationInboxSortMode = 'priority' | 'newest' | 'oldest' | 'stale';
export type ModerationInboxSavedViewId =
  | 'all'
  | 'stale_cases'
  | 'reports'
  | 'observed_alerts'
  | 'reply_attention'
  | 'screening';

export interface ModerationInboxViewControls {
  readonly kind: ModerationInboxKindFilter;
  readonly freshness: ModerationInboxFreshnessFilter;
  readonly sortMode: ModerationInboxSortMode;
  readonly searchQuery: string;
}

export interface ModerationInboxSavedView {
  readonly id: ModerationInboxSavedViewId;
  readonly label: string;
  readonly controls: ModerationInboxViewControls;
}

const attentionKinds = new Set<ModerationInboxItemKind>(['report_attention', 'support_attention']);

export const moderationInboxSavedViews: readonly ModerationInboxSavedView[] = [
  {
    id: 'all',
    label: 'All',
    controls: { kind: 'all', freshness: 'all', sortMode: 'priority', searchQuery: '' },
  },
  {
    id: 'stale_cases',
    label: 'Stale Cases',
    controls: { kind: 'case', freshness: 'stale', sortMode: 'stale', searchQuery: '' },
  },
  {
    id: 'reports',
    label: 'Reports',
    controls: { kind: 'submitted_report', freshness: 'all', sortMode: 'newest', searchQuery: '' },
  },
  {
    id: 'observed_alerts',
    label: 'Observed Alerts',
    controls: { kind: 'observed_alert', freshness: 'all', sortMode: 'priority', searchQuery: '' },
  },
  {
    id: 'reply_attention',
    label: 'Replies',
    controls: { kind: 'all', freshness: 'attention', sortMode: 'stale', searchQuery: '' },
  },
  {
    id: 'screening',
    label: 'Screening',
    controls: { kind: 'pending_screening', freshness: 'all', sortMode: 'stale', searchQuery: '' },
  },
];

function normalize(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? '';
}

function sanitizeExportField(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

export function isModerationInboxSavedViewActive(
  controls: ModerationInboxViewControls,
  savedView: ModerationInboxSavedView
): boolean {
  return (
    controls.kind === savedView.controls.kind &&
    controls.freshness === savedView.controls.freshness &&
    controls.sortMode === savedView.controls.sortMode &&
    controls.searchQuery === savedView.controls.searchQuery
  );
}

function itemMatchesSearch(item: ModerationInboxItem, query: string): boolean {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return true;
  }

  const searchableValues = [
    item.title,
    item.summary,
    item.statusLabel,
    item.signalLabel,
    item.subject.displayLabel,
    item.subject.userId,
    item.subject.secondaryLabel,
    item.sourceId,
    item.queueItemId,
    ...item.links.map((link) => link.label),
  ];

  return searchableValues.some((value) => normalize(value).includes(normalizedQuery));
}

export function isModerationInboxAttentionKind(kind: ModerationInboxItemKind): boolean {
  return attentionKinds.has(kind);
}

export function filterModerationInboxItems(
  items: readonly ModerationInboxItem[],
  controls: ModerationInboxViewControls
): ModerationInboxItem[] {
  return items.filter((item) => {
    if (controls.kind !== 'all' && item.kind !== controls.kind) {
      return false;
    }

    if (controls.freshness === 'stale' && !item.stale) {
      return false;
    }

    if (controls.freshness === 'fresh' && item.stale) {
      return false;
    }

    if (controls.freshness === 'attention' && !isModerationInboxAttentionKind(item.kind)) {
      return false;
    }

    return itemMatchesSearch(item, controls.searchQuery);
  });
}

export function sortModerationInboxItemsForView(
  items: readonly ModerationInboxItem[],
  sortMode: ModerationInboxSortMode
): ModerationInboxItem[] {
  switch (sortMode) {
    case 'newest':
      return [...items].sort(
        (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      );
    case 'oldest':
      return [...items].sort(
        (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
      );
    case 'stale':
      return [...items].sort((left, right) => {
        if (left.stale !== right.stale) {
          return left.stale ? -1 : 1;
        }

        if (left.staleHours !== right.staleHours) {
          return right.staleHours - left.staleHours;
        }

        return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
      });
    case 'priority':
      return sortModerationInboxItems(items);
  }
}

export function getModerationInboxVisibleItems(
  items: readonly ModerationInboxItem[],
  controls: ModerationInboxViewControls
): ModerationInboxItem[] {
  return sortModerationInboxItemsForView(
    filterModerationInboxItems(items, controls),
    controls.sortMode
  );
}

export function buildModerationInboxExportText(items: readonly ModerationInboxItem[]): string {
  const header = ['kind', 'title', 'user_id', 'source_id', 'queue_item_id', 'detail_href', 'links'];
  const rows = items.map((item) =>
    [
      item.kind,
      item.title,
      item.subject.userId,
      item.sourceId,
      item.queueItemId ?? '',
      item.detailHref ?? '',
      item.links.map((link) => `${link.label}: ${link.url}`).join(' | '),
    ]
      .map(sanitizeExportField)
      .join('\t')
  );

  return [header.join('\t'), ...rows].join('\n');
}
