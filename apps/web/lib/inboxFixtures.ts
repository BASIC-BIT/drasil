import { moderationInboxItemSchema, sortModerationInboxItems } from '@drasil/contracts';
import type { ModerationInboxItem } from '@drasil/contracts';

// Keep fixture avatars local and deterministic for Storybook and Playwright snapshots.
const fixtureAvatarUrl = null;

export function fixtureModerationInboxItems(guildId = 'guild-1'): ModerationInboxItem[] {
  return sortModerationInboxItems([
    moderationInboxItemSchema.parse({
      id: 'fixture-case-stale',
      guildId,
      kind: 'case',
      sourceId: 'case-stale',
      queueItemId: null,
      subject: {
        userId: 'user-100',
        displayLabel: 'Prize Patrol',
        secondaryLabel: 'prize.runner',
        avatarUrl: fixtureAvatarUrl,
      },
      title: 'Pending moderation case',
      summary: 'Latest detection: gpt_analysis.',
      statusLabel: 'in_server',
      signalLabel: '91% confidence',
      createdAt: '2026-06-01T08:00:00.000Z',
      updatedAt: '2026-06-02T08:00:00.000Z',
      stale: true,
      staleHours: 48,
      detailHref: `/admin/guild/${guildId}/cases/case-stale`,
      links: [
        {
          label: 'Admin notification',
          url: 'https://discord.com/channels/guild-1/admin-channel-1/admin-message-1',
        },
      ],
      allowedActions: [
        'view_case',
        'view_history',
        'verify_user',
        'kick_user',
        'ban_user',
        'close_no_action',
        'refresh_notification',
        'repair_thread',
      ],
    }),
    moderationInboxItemSchema.parse({
      id: 'fixture-report-1',
      guildId,
      kind: 'submitted_report',
      sourceId: 'report-1',
      queueItemId: null,
      subject: {
        userId: 'user-300',
        displayLabel: 'Target user-300',
        secondaryLabel: 'Reporter reporter-100',
        avatarUrl: null,
      },
      title: 'Submitted report',
      summary: 'Reporter supplied screenshots of a suspicious Nitro link.',
      statusLabel: 'submitted',
      signalLabel: '3 evidence items',
      createdAt: '2026-06-02T12:00:00.000Z',
      updatedAt: '2026-06-03T12:00:00.000Z',
      stale: true,
      staleHours: 36,
      detailHref: `/admin/guild/${guildId}/reports`,
      links: [
        {
          label: 'Report thread',
          url: 'https://discord.com/channels/guild-1/report-thread-100',
        },
      ],
      allowedActions: [
        'view_report',
        'open_discord',
        'open_case',
        'mark_actioned',
        'dismiss_no_action',
        'mark_false_positive',
      ],
    }),
    moderationInboxItemSchema.parse({
      id: 'fixture-support-attention-1',
      guildId,
      kind: 'support_attention',
      sourceId: 'case-stale',
      queueItemId: 'queue-support-1',
      subject: {
        userId: 'user-100',
        displayLabel: 'Prize Patrol',
        secondaryLabel: 'Support reply',
        avatarUrl: fixtureAvatarUrl,
      },
      title: 'Support reply needs review',
      summary: 'The restricted member replied in the support-check thread.',
      statusLabel: 'needs_attention',
      signalLabel: null,
      createdAt: '2026-06-03T12:00:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
      stale: true,
      staleHours: 24,
      detailHref: `/admin/guild/${guildId}/cases/case-stale`,
      links: [
        {
          label: 'Latest message',
          url: 'https://discord.com/channels/guild-1/verification-thread-1/message-1',
        },
      ],
      allowedActions: ['acknowledge', 'open_discord'],
    }),
    moderationInboxItemSchema.parse({
      id: 'fixture-observed-1',
      guildId,
      kind: 'observed_alert',
      sourceId: 'det-observed-1',
      queueItemId: 'queue-observed-1',
      subject: {
        userId: 'user-500',
        displayLabel: 'Observed User',
        secondaryLabel: null,
        avatarUrl: null,
      },
      title: 'Observed alert pending review',
      summary: 'Message looked suspicious but server policy kept it as notify-only.',
      statusLabel: 'suspicious_content',
      signalLabel: '82% confidence',
      createdAt: '2026-06-04T10:00:00.000Z',
      updatedAt: '2026-06-04T10:00:00.000Z',
      stale: false,
      staleHours: 2,
      detailHref: null,
      links: [
        {
          label: 'Observed notification',
          url: 'https://discord.com/channels/guild-1/admin-channel-1/observed-message-1',
        },
      ],
      allowedActions: [
        'open_case',
        'view_history',
        'dismiss_no_action',
        'mark_false_positive',
        // Deliberately stale against fixture policy so E2E proves server-side denial is visible.
        'kick_user',
        'ban_user',
        'open_discord',
      ],
    }),
  ]);
}
