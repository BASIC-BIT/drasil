import { describe, expect, it } from 'vitest';
import { FixtureMemberProfileDataAdapter } from './memberProfileDataAdapter';

describe('memberProfileDataAdapter', () => {
  it('builds fixture member profiles from case and report history', async () => {
    const adapter = new FixtureMemberProfileDataAdapter();

    await expect(adapter.getMemberProfile('guild-1', 'user-300')).resolves.toEqual(
      expect.objectContaining({
        guildId: 'guild-1',
        userId: 'user-300',
        identity: expect.objectContaining({ displayLabel: 'Banned User' }),
        presenceState: 'banned',
        cases: [expect.objectContaining({ id: 'case-banned' })],
        detections: [
          expect.objectContaining({
            accounting: expect.objectContaining({ excluded: false }),
          }),
        ],
        reports: [expect.objectContaining({ id: 'report-1' })],
        outcomes: [expect.objectContaining({ outcomeType: 'banned' })],
      })
    );
  });

  it('exposes undoable observed action state in fixture member profiles', async () => {
    const adapter = new FixtureMemberProfileDataAdapter();

    await expect(adapter.getMemberProfile('guild-1', 'user-500')).resolves.toEqual(
      expect.objectContaining({
        guildId: 'guild-1',
        userId: 'user-500',
        detections: [
          expect.objectContaining({
            id: 'det-observed-1',
            accounting: expect.objectContaining({
              excluded: true,
              reason: 'Marked false positive',
            }),
            observedAction: 'false_positive',
            observedActionBy: 'moderator-1',
            sourceChannelId: 'source-channel-5',
            sourceMessageId: 'source-message-5',
          }),
        ],
      })
    );
  });

  it('returns null when fixture history has no matching member', async () => {
    const adapter = new FixtureMemberProfileDataAdapter();

    await expect(adapter.getMemberProfile('guild-1', 'missing-user')).resolves.toBeNull();
  });
});
