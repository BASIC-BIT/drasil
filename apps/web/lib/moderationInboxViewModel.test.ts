import { describe, expect, it } from 'vitest';
import type { ModerationInboxItem } from '@drasil/contracts';
import {
  buildModerationInboxExportText,
  filterModerationInboxItems,
  getModerationInboxAttentionQueueItemIds,
  getModerationInboxVisibleItems,
  isModerationInboxSavedViewActive,
  moderationInboxSavedViews,
  sortModerationInboxItemsForView,
  type ModerationInboxViewControls,
} from './moderationInboxViewModel';

const defaultControls: ModerationInboxViewControls = {
  kind: 'all',
  freshness: 'all',
  sortMode: 'priority',
  searchQuery: '',
};

function buildItem(id: string, overrides: Partial<ModerationInboxItem> = {}): ModerationInboxItem {
  return {
    id,
    guildId: 'guild-1',
    kind: 'case',
    sourceId: `source-${id}`,
    queueItemId: null,
    subject: {
      userId: `user-${id}`,
      displayLabel: `User ${id}`,
      secondaryLabel: null,
      avatarUrl: null,
    },
    title: `Item ${id}`,
    summary: null,
    statusLabel: 'Pending',
    signalLabel: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    stale: false,
    staleHours: 0,
    detailHref: null,
    links: [],
    allowedActions: [],
    ...overrides,
  };
}

describe('moderationInboxViewModel', () => {
  it('filters by kind, freshness, and attention queue items', () => {
    const items = [
      buildItem('case-stale', { stale: true, staleHours: 48 }),
      buildItem('report', { kind: 'submitted_report' }),
      buildItem('support', { kind: 'support_attention', stale: true, staleHours: 12 }),
    ];

    expect(
      filterModerationInboxItems(items, { ...defaultControls, kind: 'submitted_report' })
    ).toEqual([items[1]]);
    expect(filterModerationInboxItems(items, { ...defaultControls, freshness: 'fresh' })).toEqual([
      items[1],
    ]);
    expect(
      filterModerationInboxItems(items, { ...defaultControls, freshness: 'attention' })
    ).toEqual([items[2]]);
  });

  it('searches titles, subject identity, summary, status, signal, and link labels', () => {
    const item = buildItem('report', {
      kind: 'submitted_report',
      subject: {
        userId: 'target-300',
        displayLabel: 'Target user-300',
        secondaryLabel: 'Reporter reporter-100',
        avatarUrl: null,
      },
      title: 'Submitted report',
      summary: 'Reporter supplied suspicious link evidence.',
      statusLabel: 'Submitted',
      signalLabel: '3 evidence items',
      links: [{ label: 'Report thread', url: 'https://discord.com/channels/guild-1/thread-1' }],
    });

    expect(
      filterModerationInboxItems([item], { ...defaultControls, searchQuery: 'reporter-100' })
    ).toEqual([item]);
    expect(
      filterModerationInboxItems([item], { ...defaultControls, searchQuery: 'evidence' })
    ).toEqual([item]);
    expect(
      filterModerationInboxItems([item], { ...defaultControls, searchQuery: 'thread' })
    ).toEqual([item]);
    expect(
      filterModerationInboxItems([item], { ...defaultControls, searchQuery: 'missing' })
    ).toEqual([]);
  });

  it('sorts newest, oldest, stale, and priority views predictably', () => {
    const oldFresh = buildItem('old-fresh', { updatedAt: '2026-06-01T00:00:00.000Z' });
    const newFresh = buildItem('new-fresh', { updatedAt: '2026-06-03T00:00:00.000Z' });
    const stale = buildItem('stale', {
      stale: true,
      staleHours: 24,
      updatedAt: '2026-06-02T00:00:00.000Z',
    });

    const items = [oldFresh, newFresh, stale];

    expect(sortModerationInboxItemsForView(items, 'newest').map((item) => item.id)).toEqual([
      'new-fresh',
      'stale',
      'old-fresh',
    ]);
    expect(sortModerationInboxItemsForView(items, 'oldest').map((item) => item.id)).toEqual([
      'old-fresh',
      'stale',
      'new-fresh',
    ]);
    expect(sortModerationInboxItemsForView(items, 'stale').map((item) => item.id)).toEqual([
      'stale',
      'old-fresh',
      'new-fresh',
    ]);
    expect(getModerationInboxVisibleItems(items, defaultControls).map((item) => item.id)).toEqual([
      'stale',
      'old-fresh',
      'new-fresh',
    ]);
  });

  it('uses saved views as deterministic inbox filter presets', () => {
    const items = [
      buildItem('stale-case', { stale: true, staleHours: 48 }),
      buildItem('fresh-case'),
      buildItem('report', { kind: 'submitted_report' }),
      buildItem('reply', { kind: 'support_attention', stale: true, staleHours: 8 }),
      buildItem('screening', { kind: 'pending_screening', stale: true, staleHours: 12 }),
    ];
    const staleCasesView = moderationInboxSavedViews.find((view) => view.id === 'stale_cases');
    const repliesView = moderationInboxSavedViews.find((view) => view.id === 'reply_attention');

    expect(staleCasesView).toBeDefined();
    expect(repliesView).toBeDefined();
    expect(
      getModerationInboxVisibleItems(items, staleCasesView!.controls).map((item) => item.id)
    ).toEqual(['stale-case']);
    expect(
      getModerationInboxVisibleItems(items, repliesView!.controls).map((item) => item.id)
    ).toEqual(['reply']);
    expect(isModerationInboxSavedViewActive(staleCasesView!.controls, staleCasesView!)).toBe(true);
    expect(
      isModerationInboxSavedViewActive(
        { ...staleCasesView!.controls, searchQuery: 'manual' },
        staleCasesView!
      )
    ).toBe(false);
  });

  it('exports visible inbox rows as stable tab-separated review text', () => {
    const item = buildItem('case-1', {
      title: 'Case with\nnew line',
      queueItemId: 'queue-1',
      detailHref: '/admin/guild/guild-1/cases/case-1',
      links: [
        {
          label: 'Discord thread',
          url: 'https://discord.com/channels/guild-1/thread-1',
        },
      ],
    });

    expect(buildModerationInboxExportText([item])).toBe(
      [
        'kind\ttitle\tuser_id\tsource_id\tqueue_item_id\tdetail_href\tlinks',
        'case\tCase with new line\tuser-case-1\tsource-case-1\tqueue-1\t/admin/guild/guild-1/cases/case-1\tDiscord thread: https://discord.com/channels/guild-1/thread-1',
      ].join('\n')
    );
  });

  it('deduplicates attention queue IDs for selected batch acknowledgements', () => {
    const support = buildItem('support', {
      kind: 'support_attention',
      queueItemId: 'queue-1',
    });
    const duplicateReport = buildItem('report', {
      kind: 'report_attention',
      queueItemId: 'queue-1',
    });
    const observed = buildItem('observed', {
      kind: 'observed_alert',
      queueItemId: 'queue-observed',
    });

    expect(getModerationInboxAttentionQueueItemIds([support, duplicateReport, observed])).toEqual([
      'queue-1',
    ]);
  });
});
