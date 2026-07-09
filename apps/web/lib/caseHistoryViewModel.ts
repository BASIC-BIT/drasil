import type { CaseSummary } from '@drasil/contracts';
import {
  formatConfidence,
  formatDetectionType,
  formatPresenceState,
  formatUtc,
} from './casePresentation';

export type CaseHistoryPresenceFilter =
  | 'all'
  | 'banned'
  | 'in_server'
  | 'kicked'
  | 'left_or_removed'
  | 'unknown';

export type CaseHistorySortMode = 'newest' | 'oldest' | 'signal' | 'last_action';

export const caseHistoryPresenceFilterOptions: readonly {
  readonly label: string;
  readonly value: CaseHistoryPresenceFilter;
}[] = [
  { value: 'all', label: 'All Outcomes' },
  { value: 'banned', label: 'Banned' },
  { value: 'kicked', label: 'Kicked' },
  { value: 'in_server', label: 'Still In Server' },
  { value: 'left_or_removed', label: 'Left Or Removed' },
  { value: 'unknown', label: 'Unknown' },
];

export const caseHistorySortOptions: readonly {
  readonly label: string;
  readonly value: CaseHistorySortMode;
}[] = [
  { value: 'newest', label: 'Newest Resolution' },
  { value: 'oldest', label: 'Oldest Resolution' },
  { value: 'signal', label: 'Highest Signal' },
  { value: 'last_action', label: 'Last Action' },
];

function caseSearchText(item: CaseSummary): string {
  return [
    item.id,
    item.userId,
    item.userIdentity.displayLabel,
    item.userIdentity.username,
    item.userIdentity.globalName,
    item.userIdentity.nickname,
    item.latestDetectionType,
    item.lastActionType,
    item.presenceState,
    ...item.surfaces.map((surface) => `${surface.kind} ${surface.label} ${surface.url}`),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
}

function sortCases(cases: readonly CaseSummary[], sortMode: CaseHistorySortMode): CaseSummary[] {
  return [...cases].sort((left, right) => {
    switch (sortMode) {
      case 'oldest':
        return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
      case 'signal':
        return (right.confidence ?? -1) - (left.confidence ?? -1);
      case 'last_action':
        return (left.lastActionType ?? '').localeCompare(right.lastActionType ?? '');
      case 'newest':
        return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    }
  });
}

export function getVisibleHistoryCases(
  cases: readonly CaseSummary[],
  presenceFilter: CaseHistoryPresenceFilter,
  searchQuery: string,
  sortMode: CaseHistorySortMode
): CaseSummary[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = cases.filter((item) => {
    if (presenceFilter !== 'all' && item.presenceState !== presenceFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return caseSearchText(item).includes(normalizedQuery);
  });

  return sortCases(filtered, sortMode);
}

export function buildVisibleHistoryExportText(
  guildId: string,
  cases: readonly CaseSummary[]
): string {
  const lines = [
    [
      'case_id',
      'user_id',
      'user',
      'presence',
      'latest_detection',
      'signal',
      'last_action',
      'resolved_or_updated',
      'detail_path',
    ].join('\t'),
  ];

  for (const item of cases) {
    lines.push(
      [
        item.id,
        item.userId,
        item.userIdentity.displayLabel,
        formatPresenceState(item.presenceState),
        formatDetectionType(item.latestDetectionType),
        formatConfidence(item.confidence),
        item.lastActionType ? formatDetectionType(item.lastActionType) : 'None recorded',
        formatUtc(item.updatedAt),
        `/admin/guild/${guildId}/cases/${item.id}`,
      ].join('\t')
    );
  }

  return lines.join('\n');
}
