import type { CaseDetail } from '@drasil/contracts';
import { describe, expect, it, vi } from 'vitest';
import { fetchCaseDiscordSnapshot } from './caseDiscordContent';
import { fetchBotChannelMessages, fetchBotMessage } from './discordApi';

vi.mock('./discordApi', () => ({
  fetchBotChannelMessages: vi.fn(),
  fetchBotMessage: vi.fn(),
}));

const baseDetail: CaseDetail = {
  id: 'case-1',
  guildId: 'guild-1',
  userId: 'user-1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T01:00:00.000Z',
  latestDetectionAt: '2026-06-01T00:30:00.000Z',
  latestDetectionType: 'gpt_analysis',
  lastActionType: null,
  lastActionAt: null,
  confidence: 0.9,
  stale: false,
  staleHours: 0,
  presenceState: 'in_server',
  allowedActions: ['view_history'],
  surfaces: [],
  notes: null,
  evidenceItems: [],
  messageContext: [],
  detectionHistory: [],
  moderationOutcomes: [],
};

describe('caseDiscordContent', () => {
  it('does not fetch bot-token content for cross-guild surface URLs', async () => {
    const snapshot = await fetchCaseDiscordSnapshot('guild-1', {
      ...baseDetail,
      surfaces: [
        {
          kind: 'source_message',
          label: 'Source message',
          url: 'https://discord.com/channels/guild-2/channel-1/message-1',
        },
        {
          kind: 'verification_thread',
          label: 'Verification thread',
          url: 'https://discord.com/channels/guild-2/thread-1',
        },
      ],
    });

    expect(fetchBotMessage).not.toHaveBeenCalled();
    expect(fetchBotChannelMessages).not.toHaveBeenCalled();
    expect(snapshot.sourceMessage).toBeNull();
    expect(snapshot.threads[0]).toEqual(
      expect.objectContaining({
        channelId: 'thread-1',
        messages: [],
        error: 'Discord surface URL belongs to a different guild.',
      })
    );
  });
});
