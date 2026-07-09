import { describe, expect, it } from 'vitest';
import type { CaseSummary, ReportQueueItem } from '@drasil/contracts';
import {
  caseSummaryToInboxItem,
  parseModerationQueueRow,
  reportQueueItemToInboxItem,
  type ModerationQueueRow,
} from './moderationInboxDataAdapter';

const baseCase: CaseSummary = {
  id: 'case-1',
  guildId: 'guild-1',
  userId: 'user-1',
  userIdentity: {
    id: 'user-1',
    username: 'stored-user',
    globalName: null,
    nickname: null,
    displayName: 'Stored User',
    avatarUrl: null,
    displayLabel: 'Stored User',
  },
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  stale: true,
  staleHours: 25,
  presenceState: 'in_server',
  confidence: 0.91,
  latestDetectionType: 'gpt_analysis',
  latestDetectionAt: '2026-06-01T00:00:00.000Z',
  lastActionType: null,
  lastActionAt: null,
  surfaces: [
    {
      kind: 'admin_notification',
      label: 'Admin notification',
      url: 'https://discord.com/channels/guild-1/admin-channel-1/admin-message-1',
    },
  ],
  allowedActions: ['view_history', 'verify_user', 'close_no_action', 'refresh_notification'],
};

const baseReport: ReportQueueItem = {
  id: 'report-1',
  guildId: 'guild-1',
  reporterId: 'reporter-1',
  targetUserId: 'user-2',
  status: 'submitted',
  summary: 'Reporter supplied message evidence.',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  stale: true,
  staleHours: 26,
  evidenceCount: 2,
  reportThreadUrl: 'https://discord.com/channels/guild-1/report-thread-1',
  latestDetectionId: 'det-1',
  latestCaseId: null,
  allowedActions: [
    'open_report_thread',
    'open_case',
    'mark_actioned',
    'dismiss_no_action',
    'mark_false_positive',
  ],
};

const baseQueueRow: ModerationQueueRow = {
  id: 'queue-1',
  server_id: 'guild-1',
  user_id: 'user-3',
  item_type: 'observed_alert_mirror',
  verification_event_id: null,
  detection_event_id: 'det-observed-1',
  report_intake_id: null,
  source_thread_id: null,
  queue_channel_id: 'queue-channel-1',
  queue_message_id: 'queue-message-1',
  last_source_message_id: null,
  last_notified_at: null,
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-02T00:00:00.000Z'),
  metadata: {},
  server_settings: {},
  detection_type: 'suspicious_content',
  detection_confidence: 0.82,
  detection_detected_at: new Date('2026-06-01T00:00:00.000Z'),
  detection_reasons: ['Suspicious link pattern.'],
  detection_metadata: {
    observed_notification_channel_id: 'admin-channel-1',
    observed_notification_message_id: 'observed-message-1',
  },
  case_status: null,
  report_status: null,
  report_summary: null,
  user_username: 'observed-user',
  user_metadata: {},
};

describe('moderationInboxDataAdapter', () => {
  it('converts active case summaries into inbox case items', () => {
    const item = caseSummaryToInboxItem(baseCase);

    expect(item).toEqual(
      expect.objectContaining({
        id: 'case:case-1',
        kind: 'case',
        sourceId: 'case-1',
        title: 'Pending moderation case',
        detailHref: '/admin/guild/guild-1/cases/case-1',
        signalLabel: '91% confidence',
        allowedActions: [
          'view_case',
          'view_history',
          'verify_user',
          'close_no_action',
          'refresh_notification',
        ],
      })
    );
  });

  it('converts submitted reports into inbox report items', () => {
    const item = reportQueueItemToInboxItem(baseReport);

    expect(item).toEqual(
      expect.objectContaining({
        id: 'report:report-1',
        kind: 'submitted_report',
        sourceId: 'report-1',
        title: 'Submitted report',
        detailHref: '/admin/guild/guild-1/reports/report-1',
        signalLabel: '2 evidence items',
        allowedActions: [
          'view_report',
          'open_discord',
          'open_case',
          'mark_actioned',
          'dismiss_no_action',
          'mark_false_positive',
        ],
      })
    );
  });

  it('parses observed alert queue rows for the inbox', () => {
    const item = parseModerationQueueRow(baseQueueRow, new Date('2026-06-03T02:00:00.000Z'));

    expect(item).toEqual(
      expect.objectContaining({
        id: 'queue:queue-1',
        kind: 'observed_alert',
        sourceId: 'det-observed-1',
        queueItemId: 'queue-1',
        stale: true,
        staleHours: 26,
        statusLabel: 'suspicious_content',
        signalLabel: '82% confidence',
        allowedActions: [
          'open_case',
          'view_history',
          'dismiss_no_action',
          'mark_false_positive',
          'ban_user',
          'open_discord',
        ],
      })
    );
    expect(item?.links).toEqual(
      expect.arrayContaining([
        {
          label: 'Queue message',
          url: 'https://discord.com/channels/guild-1/queue-channel-1/queue-message-1',
        },
        {
          label: 'Observed notification',
          url: 'https://discord.com/channels/guild-1/admin-channel-1/observed-message-1',
        },
      ])
    );
  });

  it('includes observed kick when the server enables observed alert kicks', () => {
    const item = parseModerationQueueRow(
      {
        ...baseQueueRow,
        server_settings: { observed_action_kick_enabled: true },
      },
      new Date('2026-06-03T02:00:00.000Z')
    );

    expect(item?.allowedActions).toEqual([
      'open_case',
      'view_history',
      'dismiss_no_action',
      'mark_false_positive',
      'kick_user',
      'ban_user',
      'open_discord',
    ]);
  });
});
