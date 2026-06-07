import type { CaseDetail, CaseSummary } from '@drasil/contracts';

export const fixtureCaseDetails: CaseDetail[] = [
  {
    id: 'case-stale',
    guildId: 'guild-1',
    userId: 'user-100',
    createdAt: '2026-06-01T08:00:00.000Z',
    updatedAt: '2026-06-02T08:00:00.000Z',
    stale: true,
    staleHours: 48,
    presenceState: 'in_server',
    confidence: 0.91,
    latestDetectionType: 'gpt_analysis',
    latestDetectionAt: '2026-06-01T08:10:00.000Z',
    lastActionType: 'restrict',
    lastActionAt: '2026-06-01T08:12:00.000Z',
    surfaces: [
      {
        kind: 'admin_notification',
        label: 'Admin notification',
        url: 'https://discord.com/channels/guild-1/admin-channel-1/admin-message-1',
      },
      {
        kind: 'admin_evidence_thread',
        label: 'Admin evidence',
        url: 'https://discord.com/channels/guild-1/evidence-thread-1',
      },
      {
        kind: 'verification_thread',
        label: 'Verification thread',
        url: 'https://discord.com/channels/guild-1/verification-thread-1',
      },
      {
        kind: 'source_message',
        label: 'Source message',
        url: 'https://discord.com/channels/guild-1/source-channel-1/source-message-1',
      },
    ],
    allowedActions: ['view_history', 'verify_user', 'ban_user', 'repair_thread'],
    notes: 'User was restricted after suspicious DM-style promotion language.',
    detectionHistory: [
      {
        id: 'det-1',
        detectionType: 'gpt_analysis',
        confidence: 0.91,
        detectedAt: '2026-06-01T08:10:00.000Z',
        reasons: ['Repeated prize language and a short-link ask in a new account context.'],
      },
      {
        id: 'det-2',
        detectionType: 'suspicious_content',
        confidence: 0.72,
        detectedAt: '2026-06-01T07:55:00.000Z',
        reasons: ['Message matched scam-keyword heuristics.'],
      },
    ],
    moderationOutcomes: [
      {
        id: 'out-1',
        outcomeType: 'restricted',
        source: 'drasil',
        actorId: 'bot-1',
        reason: 'Restricted pending review',
        occurredAt: '2026-06-01T08:12:00.000Z',
      },
    ],
  },
  {
    id: 'case-left',
    guildId: 'guild-1',
    userId: 'user-200',
    createdAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T18:00:00.000Z',
    stale: false,
    staleHours: 4,
    presenceState: 'left_or_removed',
    confidence: 0.84,
    latestDetectionType: 'user_report',
    latestDetectionAt: '2026-06-03T10:00:00.000Z',
    lastActionType: null,
    lastActionAt: null,
    surfaces: [
      {
        kind: 'admin_notification',
        label: 'Admin notification',
        url: 'https://discord.com/channels/guild-1/admin-channel-1/admin-message-2',
      },
      {
        kind: 'report_intake_thread',
        label: 'Report intake',
        url: 'https://discord.com/channels/guild-1/report-thread-1',
      },
    ],
    allowedActions: ['view_history', 'ban_by_id', 'close_no_action'],
    notes: null,
    detectionHistory: [
      {
        id: 'det-3',
        detectionType: 'user_report',
        confidence: 0.84,
        detectedAt: '2026-06-03T10:00:00.000Z',
        reasons: ['Reporter supplied screenshots and the user left before review.'],
      },
    ],
    moderationOutcomes: [
      {
        id: 'out-2',
        outcomeType: 'member_left',
        source: 'native_discord',
        actorId: null,
        reason: null,
        occurredAt: '2026-06-03T18:00:00.000Z',
      },
    ],
  },
];

export function fixtureCaseSummaries(): CaseSummary[] {
  return fixtureCaseDetails.map((detail) => ({
    id: detail.id,
    guildId: detail.guildId,
    userId: detail.userId,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    stale: detail.stale,
    staleHours: detail.staleHours,
    presenceState: detail.presenceState,
    confidence: detail.confidence,
    latestDetectionType: detail.latestDetectionType,
    latestDetectionAt: detail.latestDetectionAt,
    lastActionType: detail.lastActionType,
    lastActionAt: detail.lastActionAt,
    surfaces: detail.surfaces,
    allowedActions: detail.allowedActions,
  }));
}
