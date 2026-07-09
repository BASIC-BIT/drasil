import { describe, expect, it } from 'vitest';
import { memberProfileSchema } from './members';

describe('member profile contract', () => {
  it('accepts a composed member history payload', () => {
    expect(() =>
      memberProfileSchema.parse({
        guildId: 'guild-1',
        userId: 'user-1',
        identity: {
          id: 'user-1',
          username: 'member',
          globalName: null,
          nickname: null,
          displayName: null,
          avatarUrl: null,
          displayLabel: 'member',
        },
        presenceState: 'in_server',
        membership: {
          joinDate: '2026-06-01T00:00:00.000Z',
          lastMessageAt: null,
          messageCount: 4,
          verificationStatus: 'pending',
          caseRoleActive: true,
          screeningPending: false,
        },
        cases: [],
        detections: [
          {
            id: 'det-1',
            detectionType: 'gpt_analysis',
            confidence: 0.91,
            detectedAt: '2026-06-01T00:00:00.000Z',
            reasons: ['High-confidence signal.'],
            latestCaseId: 'case-1',
            accounting: {
              excluded: true,
              scope: 'server',
              reason: 'Marked false positive',
              excludedBy: 'moderator-1',
              excludedAt: '2026-06-01T00:10:00.000Z',
            },
            observedAction: 'dismiss',
            observedActionAt: '2026-06-01T00:10:00.000Z',
            observedActionBy: 'moderator-1',
            sourceChannelId: 'channel-1',
            sourceMessageId: 'message-1',
            sourceMessageUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
          },
        ],
        reports: [
          {
            id: 'report-1',
            reporterId: 'reporter-1',
            status: 'submitted',
            summary: 'Reporter supplied context.',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:30:00.000Z',
            reportThreadUrl: null,
            latestCaseId: 'case-1',
          },
        ],
        outcomes: [
          {
            id: 'outcome-1',
            outcomeType: 'restricted',
            source: 'drasil',
            actorId: 'bot-1',
            reason: 'Restricted pending review.',
            occurredAt: '2026-06-01T00:05:00.000Z',
            verificationEventId: 'case-1',
            detectionEventId: 'det-1',
          },
        ],
      })
    ).not.toThrow();
  });
});
