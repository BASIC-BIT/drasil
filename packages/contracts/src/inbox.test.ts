import { describe, expect, it } from 'vitest';
import {
  moderationInboxItemSchema,
  sortModerationInboxItems,
  type ModerationInboxItem,
} from './inbox';

const buildItem = (id: string, stale: boolean, updatedAt: string): ModerationInboxItem => ({
  id,
  guildId: 'guild-1',
  kind: 'case',
  sourceId: `source-${id}`,
  queueItemId: null,
  subject: {
    userId: `user-${id}`,
    displayLabel: `user-${id}`,
    secondaryLabel: null,
    avatarUrl: null,
  },
  title: 'Pending case',
  summary: null,
  statusLabel: stale ? 'Stale' : 'Fresh',
  signalLabel: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt,
  stale,
  staleHours: stale ? 24 : 0,
  detailHref: null,
  links: [],
  allowedActions: ['view_case', 'refresh_notification'],
});

describe('moderation inbox contracts', () => {
  it('sorts stale items first, then oldest movement first', () => {
    const sorted = sortModerationInboxItems([
      buildItem('fresh-old', false, '2026-06-01T00:00:00.000Z'),
      buildItem('stale-new', true, '2026-06-03T00:00:00.000Z'),
      buildItem('stale-old', true, '2026-06-02T00:00:00.000Z'),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['stale-old', 'stale-new', 'fresh-old']);
  });

  it('validates non-case inbox item shapes', () => {
    expect(() =>
      moderationInboxItemSchema.parse({
        ...buildItem('attention', true, '2026-06-02T00:00:00.000Z'),
        kind: 'support_attention',
        queueItemId: 'queue-1',
        title: 'Support reply needs review',
        allowedActions: ['acknowledge', 'open_discord'],
      })
    ).not.toThrow();
  });
});
