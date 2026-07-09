import { describe, expect, it } from 'vitest';
import { caseDetailSchema, type CaseSummary, sortCaseSummariesForQueue } from './cases';

const buildCase = (id: string, stale: boolean, updatedAt: string): CaseSummary => ({
  id,
  guildId: 'guild-1',
  userId: `user-${id}`,
  userIdentity: {
    id: `user-${id}`,
    username: `user-${id}`,
    globalName: null,
    nickname: null,
    displayName: `user-${id}`,
    avatarUrl: null,
    displayLabel: `user-${id}`,
  },
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt,
  stale,
  staleHours: stale ? 24 : 0,
  presenceState: 'in_server',
  confidence: 0.8,
  latestDetectionType: 'gpt_analysis',
  latestDetectionAt: '2026-06-01T00:00:00.000Z',
  lastActionType: null,
  lastActionAt: null,
  surfaces: [],
  allowedActions: ['view_history', 'verify_user', 'refresh_notification'],
});

describe('case contracts', () => {
  it('sorts queue summaries with stale cases first and oldest movement first', () => {
    const sorted = sortCaseSummariesForQueue([
      buildCase('fresh-old', false, '2026-06-01T00:00:00.000Z'),
      buildCase('stale-new', true, '2026-06-03T00:00:00.000Z'),
      buildCase('stale-old', true, '2026-06-02T00:00:00.000Z'),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['stale-old', 'stale-new', 'fresh-old']);
  });

  it('validates case detail shape', () => {
    expect(() =>
      caseDetailSchema.parse({
        ...buildCase('detail', true, '2026-06-02T00:00:00.000Z'),
        notes: null,
        evidenceItems: [
          {
            id: 'ev-1',
            kind: 'reported_text',
            content: 'Suspicious message content',
            createdAt: '2026-06-01T00:00:00.000Z',
            url: null,
          },
        ],
        messageContext: [
          {
            id: 'msg-1',
            messageId: 'message-1',
            channelId: 'channel-1',
            contentPreview: 'claim your prize',
            createdAt: '2026-06-01T00:00:00.000Z',
            url: 'https://discord.com/channels/guild-1/channel-1/message-1',
            isSource: true,
          },
        ],
        detectionHistory: [
          {
            id: 'det-1',
            detectionType: 'gpt_analysis',
            confidence: 0.91,
            detectedAt: '2026-06-01T00:00:00.000Z',
            reasons: ['Suspicious report'],
          },
        ],
        moderationOutcomes: [
          {
            id: 'out-1',
            outcomeType: 'member_left',
            source: 'native_discord',
            actorId: null,
            reason: null,
            occurredAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      })
    ).not.toThrow();
  });
});
