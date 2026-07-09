import type { CaseDetail, CaseSummary } from '@drasil/contracts';

// Keep fixture avatars local and deterministic for Storybook and Playwright snapshots.
const fixtureAvatarUrl = null;

export const fixtureCaseDetails: CaseDetail[] = [
  {
    id: 'case-stale',
    guildId: 'guild-1',
    userId: 'user-100',
    userIdentity: {
      id: 'user-100',
      username: 'prize.runner',
      globalName: 'Prize Runner',
      nickname: 'Prize Patrol',
      displayName: 'Prize Patrol',
      avatarUrl: fixtureAvatarUrl,
      displayLabel: 'Prize Patrol',
    },
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
    allowedActions: [
      'view_history',
      'verify_user',
      'kick_user',
      'ban_user',
      'close_no_action',
      'refresh_notification',
      'repair_thread',
    ],
    notes: 'User was restricted after suspicious DM-style promotion language.',
    evidenceItems: [
      {
        id: 'evidence-1',
        kind: 'reported_text',
        content: 'They asked me to claim a prize through a short link and said it expires today.',
        createdAt: '2026-06-01T08:02:00.000Z',
        url: 'https://discord.com/channels/guild-1/source-channel-1/source-message-1',
      },
      {
        id: 'evidence-2',
        kind: 'reporter_text',
        content: 'The account joined today and immediately posted this in general.',
        createdAt: '2026-06-01T08:03:00.000Z',
        url: null,
      },
    ],
    messageContext: [
      {
        id: 'context-1',
        messageId: 'source-message-1',
        channelId: 'source-channel-1',
        contentPreview:
          'free rewards for early members, claim here before it expires: https://short.example/prize',
        createdAt: '2026-06-01T07:55:00.000Z',
        url: 'https://discord.com/channels/guild-1/source-channel-1/source-message-1',
        isSource: true,
      },
      {
        id: 'context-2',
        messageId: 'message-2',
        channelId: 'source-channel-1',
        contentPreview: 'dm me if the link does not work and I can send another prize link',
        createdAt: '2026-06-01T08:00:00.000Z',
        url: 'https://discord.com/channels/guild-1/source-channel-1/message-2',
        isSource: false,
      },
    ],
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
    userIdentity: {
      id: 'user-200',
      username: 'left.before.review',
      globalName: 'Gone User',
      nickname: null,
      displayName: 'Gone User',
      avatarUrl: fixtureAvatarUrl,
      displayLabel: 'Gone User',
    },
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
    allowedActions: ['view_history', 'ban_by_id', 'close_no_action', 'refresh_notification'],
    notes: null,
    evidenceItems: [
      {
        id: 'evidence-3',
        kind: 'reporter_text',
        content: 'Reporter supplied screenshots and says the user left after being challenged.',
        createdAt: '2026-06-03T10:05:00.000Z',
        url: null,
      },
    ],
    messageContext: [],
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
  {
    id: 'case-banned',
    guildId: 'guild-1',
    userId: 'user-300',
    userIdentity: {
      id: 'user-300',
      username: 'already.banned',
      globalName: 'Banned User',
      nickname: null,
      displayName: 'Banned User',
      avatarUrl: fixtureAvatarUrl,
      displayLabel: 'Banned User',
    },
    createdAt: '2026-06-04T09:00:00.000Z',
    updatedAt: '2026-06-04T12:00:00.000Z',
    stale: false,
    staleHours: 3,
    presenceState: 'banned',
    confidence: 0.88,
    latestDetectionType: 'gpt_analysis',
    latestDetectionAt: '2026-06-04T09:05:00.000Z',
    lastActionType: null,
    lastActionAt: null,
    surfaces: [
      {
        kind: 'admin_notification',
        label: 'Admin notification',
        url: 'https://discord.com/channels/guild-1/admin-channel-1/admin-message-3',
      },
      {
        kind: 'admin_evidence_thread',
        label: 'Admin evidence',
        url: 'https://discord.com/channels/guild-1/evidence-thread-3',
      },
    ],
    allowedActions: ['view_history', 'sync_existing_ban', 'refresh_notification'],
    notes: 'Discord already shows this user as banned, but the case still needs a synced outcome.',
    evidenceItems: [],
    messageContext: [],
    detectionHistory: [
      {
        id: 'det-4',
        detectionType: 'gpt_analysis',
        confidence: 0.88,
        detectedAt: '2026-06-04T09:05:00.000Z',
        reasons: ['Account matched multiple high-confidence spam indicators.'],
      },
    ],
    moderationOutcomes: [
      {
        id: 'out-3',
        outcomeType: 'banned',
        source: 'native_discord',
        actorId: null,
        reason: 'Existing Discord ban detected.',
        occurredAt: '2026-06-04T12:00:00.000Z',
      },
    ],
  },
];

export const fixtureResolvedCaseDetails: CaseDetail[] = [
  {
    id: 'case-resolved-ban',
    guildId: 'guild-1',
    userId: 'user-410',
    userIdentity: {
      id: 'user-410',
      username: 'resolved.ban',
      globalName: 'Resolved Ban',
      nickname: null,
      displayName: 'Resolved Ban',
      avatarUrl: fixtureAvatarUrl,
      displayLabel: 'Resolved Ban',
    },
    createdAt: '2026-05-26T16:00:00.000Z',
    updatedAt: '2026-05-26T16:30:00.000Z',
    stale: false,
    staleHours: 0,
    presenceState: 'banned',
    confidence: 0.94,
    latestDetectionType: 'gpt_analysis',
    latestDetectionAt: '2026-05-26T16:03:00.000Z',
    lastActionType: 'ban',
    lastActionAt: '2026-05-26T16:30:00.000Z',
    surfaces: [
      {
        kind: 'admin_notification',
        label: 'Admin notification',
        url: 'https://discord.com/channels/guild-1/admin-channel-1/resolved-message-1',
      },
      {
        kind: 'verification_thread',
        label: 'Case thread',
        url: 'https://discord.com/channels/guild-1/resolved-thread-1',
      },
    ],
    allowedActions: ['view_history', 'refresh_notification'],
    notes: 'Case resolved after moderator review.',
    evidenceItems: [],
    messageContext: [],
    detectionHistory: [
      {
        id: 'det-resolved-ban',
        detectionType: 'gpt_analysis',
        confidence: 0.94,
        detectedAt: '2026-05-26T16:03:00.000Z',
        reasons: ['Account behavior matched high-confidence spam signals.'],
      },
    ],
    moderationOutcomes: [
      {
        id: 'out-resolved-ban',
        outcomeType: 'banned',
        source: 'drasil',
        actorId: 'moderator-1',
        reason: 'Resolved from case review.',
        occurredAt: '2026-05-26T16:30:00.000Z',
      },
    ],
  },
  {
    id: 'case-resolved-verified',
    guildId: 'guild-1',
    userId: 'user-420',
    userIdentity: {
      id: 'user-420',
      username: 'resolved.member',
      globalName: 'Resolved Member',
      nickname: 'Resolved Friend',
      displayName: 'Resolved Friend',
      avatarUrl: fixtureAvatarUrl,
      displayLabel: 'Resolved Friend',
    },
    createdAt: '2026-05-24T14:00:00.000Z',
    updatedAt: '2026-05-24T15:45:00.000Z',
    stale: false,
    staleHours: 0,
    presenceState: 'in_server',
    confidence: 0.42,
    latestDetectionType: 'user_report',
    latestDetectionAt: '2026-05-24T14:05:00.000Z',
    lastActionType: 'verify',
    lastActionAt: '2026-05-24T15:45:00.000Z',
    surfaces: [
      {
        kind: 'verification_thread',
        label: 'Case thread',
        url: 'https://discord.com/channels/guild-1/resolved-thread-2',
      },
    ],
    allowedActions: ['view_history', 'reopen_case'],
    notes: 'Case resolved after the member responded in the support thread.',
    evidenceItems: [],
    messageContext: [],
    detectionHistory: [
      {
        id: 'det-resolved-verified',
        detectionType: 'user_report',
        confidence: 0.42,
        detectedAt: '2026-05-24T14:05:00.000Z',
        reasons: ['Submitted report required moderator review.'],
      },
    ],
    moderationOutcomes: [
      {
        id: 'out-resolved-verified',
        outcomeType: 'verified',
        source: 'drasil',
        actorId: 'moderator-1',
        reason: 'Member verified after review.',
        occurredAt: '2026-05-24T15:45:00.000Z',
      },
    ],
  },
];

function summarizeCaseDetail(detail: CaseDetail): CaseSummary {
  return {
    id: detail.id,
    guildId: detail.guildId,
    userId: detail.userId,
    userIdentity: detail.userIdentity,
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
  };
}

export function fixtureCaseSummaries(): CaseSummary[] {
  return fixtureCaseDetails.map(summarizeCaseDetail);
}

export function fixtureResolvedCaseSummaries(): CaseSummary[] {
  return fixtureResolvedCaseDetails.map(summarizeCaseDetail);
}
