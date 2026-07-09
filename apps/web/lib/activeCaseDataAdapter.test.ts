import { describe, expect, it } from 'vitest';
import {
  FixtureActiveCaseDataAdapter,
  parseCaseSummaryRow,
  resolveReportIntakeId,
} from './activeCaseDataAdapter';

const baseRow = {
  id: 'ver-1',
  server_id: 'guild-1',
  user_id: 'user-1',
  detection_event_id: 'det-1',
  thread_id: 'thread-1',
  private_evidence_thread_id: 'evidence-thread-1',
  notification_channel_id: 'notification-channel-1',
  notification_message_id: 'admin-message-1',
  status: 'pending',
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-02T00:00:00.000Z'),
  notes: null,
  metadata: {
    source_channel_id: 'source-channel-1',
    source_message_id: 'source-message-1',
  },
  admin_channel_id: 'admin-channel-1',
  latest_detection_type: 'gpt_analysis',
  latest_confidence: 0.91,
  latest_detection_at: new Date('2026-06-01T00:00:00.000Z'),
  latest_detection_metadata: {},
  source_channel_id: null,
  source_message_id: null,
  last_action_type: null,
  last_action_at: null,
  latest_outcome_type: null,
  latest_outcome_source: null,
  user_username: 'stored-username',
  user_metadata: {},
  member_user_id: 'user-1',
};

describe('activeCaseDataAdapter', () => {
  it('parses pending case summary rows with surface links and stale state', () => {
    const summary = parseCaseSummaryRow(baseRow, new Date('2026-06-03T01:00:00.000Z'));

    expect(summary).toEqual(
      expect.objectContaining({
        id: 'ver-1',
        guildId: 'guild-1',
        userId: 'user-1',
        userIdentity: expect.objectContaining({
          displayLabel: 'stored-username',
          username: 'stored-username',
          id: 'user-1',
        }),
        stale: true,
        staleHours: 25,
        presenceState: 'in_server',
        confidence: 0.91,
        latestDetectionType: 'gpt_analysis',
        allowedActions: [
          'view_history',
          'verify_user',
          'kick_user',
          'ban_user',
          'close_no_action',
          'refresh_notification',
          'repair_thread',
        ],
      })
    );
    expect(summary.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'admin_notification',
          url: 'https://discord.com/channels/guild-1/notification-channel-1/admin-message-1',
          desktopUrl:
            'discord://discord.com/channels/guild-1/notification-channel-1/admin-message-1',
        }),
        expect.objectContaining({
          kind: 'source_message',
          url: 'https://discord.com/channels/guild-1/source-channel-1/source-message-1',
          desktopUrl: 'discord://discord.com/channels/guild-1/source-channel-1/source-message-1',
        }),
      ])
    );
  });

  it('falls back to the admin channel when notification channel is missing', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, notification_channel_id: null },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'admin_notification',
          url: 'https://discord.com/channels/guild-1/admin-channel-1/admin-message-1',
        }),
      ])
    );
  });

  it('prefers snapshot identity over stored username', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        metadata: {
          user_snapshot: {
            username: 'snapshot-username',
            global_name: 'Snapshot Global',
            nickname: 'Snapshot Nick',
            display_name: 'Server Effective Name',
            avatar_url: 'https://cdn.discordapp.com/embed/avatars/3.png',
          },
        },
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.userIdentity).toEqual({
      id: 'user-1',
      username: 'snapshot-username',
      globalName: 'Snapshot Global',
      nickname: 'Snapshot Nick',
      displayName: 'Server Effective Name',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png',
      displayLabel: 'Server Effective Name',
    });
  });

  it('marks cases without current membership evidence as unknown', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, member_user_id: null },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('unknown');
    expect(summary.allowedActions).toEqual([
      'view_history',
      'ban_by_id',
      'close_no_action',
      'refresh_notification',
    ]);
  });

  it('marks departed users with ban-by-id and close actions', () => {
    const summary = parseCaseSummaryRow(
      {
        ...baseRow,
        metadata: { membership_state: 'left_or_removed' },
        latest_outcome_type: 'member_left',
      },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('left_or_removed');
    expect(summary.allowedActions).toEqual([
      'view_history',
      'ban_by_id',
      'close_no_action',
      'refresh_notification',
    ]);
  });

  it('marks externally banned users with sync action', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, latest_outcome_type: 'banned' },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('banned');
    expect(summary.allowedActions).toEqual([
      'view_history',
      'sync_existing_ban',
      'refresh_notification',
    ]);
  });

  it('keeps externally banned resolved rows read-only', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, latest_outcome_type: 'banned', status: 'banned' },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('banned');
    expect(summary.allowedActions).toEqual(['view_history', 'refresh_notification']);
  });

  it('exposes reopen for resolved cases when the member is still in server', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, status: 'verified' },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.presenceState).toBe('in_server');
    expect(summary.allowedActions).toEqual(['view_history', 'reopen_case', 'refresh_notification']);
  });

  it('does not expose refresh when a case has no stored notification message', () => {
    const summary = parseCaseSummaryRow(
      { ...baseRow, notification_message_id: null },
      new Date('2026-06-03T01:00:00.000Z')
    );

    expect(summary.allowedActions).toEqual([
      'view_history',
      'verify_user',
      'kick_user',
      'ban_user',
      'close_no_action',
      'repair_thread',
    ]);
  });

  it('keeps report evidence tied to the opening detection metadata', () => {
    expect(
      resolveReportIntakeId(
        { reportIntakeId: 'opening-intake' },
        { reportIntakeId: 'latest-intake' }
      )
    ).toBe('opening-intake');
    expect(resolveReportIntakeId({}, { reportIntakeId: 'latest-intake' })).toBe('latest-intake');
    expect(resolveReportIntakeId({}, {})).toBeNull();
  });

  it('queues fixture case actions only when the action is allowed', async () => {
    const adapter = new FixtureActiveCaseDataAdapter();

    await expect(
      adapter.queueCaseAction({
        action: 'repair_thread',
        adminId: 'admin-1',
        caseId: 'case-stale',
        guildId: 'guild-1',
      })
    ).resolves.toEqual({
      action: 'repair_thread',
      caseId: 'case-stale',
      status: 'queued',
    });
    await expect(
      adapter.queueCaseAction({
        action: 'refresh_notification',
        adminId: 'admin-1',
        caseId: 'case-stale',
        guildId: 'guild-1',
      })
    ).resolves.toEqual({
      action: 'refresh_notification',
      caseId: 'case-stale',
      status: 'queued',
    });
    await expect(
      adapter.queueCaseAction({
        action: 'verify_user',
        adminId: 'admin-1',
        caseId: 'case-left',
        guildId: 'guild-1',
      })
    ).resolves.toEqual({
      action: 'verify_user',
      caseId: 'case-left',
      status: 'not_allowed',
    });
    await expect(
      adapter.queueCaseAction({
        action: 'sync_existing_ban',
        adminId: 'admin-1',
        caseId: 'case-banned',
        guildId: 'guild-1',
      })
    ).resolves.toEqual({
      action: 'sync_existing_ban',
      caseId: 'case-banned',
      status: 'queued',
    });
  });

  it('lists resolved fixture cases newest first with read-only actions', async () => {
    const adapter = new FixtureActiveCaseDataAdapter();

    await expect(adapter.listResolvedCases('guild-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'case-resolved-ban',
        allowedActions: ['view_history', 'refresh_notification'],
      }),
      expect.objectContaining({
        id: 'case-resolved-verified',
        allowedActions: ['view_history', 'reopen_case'],
      }),
    ]);
  });
});
