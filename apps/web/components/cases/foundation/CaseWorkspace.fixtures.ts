import type { CaseDetail, MemberProfile } from '@drasil/contracts';
import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { everydayReports } from '@/components/inbox/foundation/ReportInbox.fixtures';

export const openedReport = { ...everydayReports[0], latestCaseId: 'case-report-1' };
export const everydayCase: CaseDetail = {
  id: 'case-report-1',
  guildId: openedReport.guildId,
  userId: 'user-300',
  userIdentity: {
    id: 'user-300',
    username: 'riverstone',
    globalName: null,
    nickname: null,
    displayName: 'riverstone',
    displayLabel: 'riverstone',
    avatarUrl: null,
  },
  createdAt: '2026-06-02T12:10:00.000Z',
  updatedAt: '2026-06-02T12:10:00.000Z',
  caseKind: 'standard',
  attentionState: 'review_required',
  containmentStatus: 'not_applicable',
  stale: false,
  staleHours: 0,
  presenceState: 'in_server',
  confidence: null,
  latestDetectionType: 'user_report',
  latestDetectionAt: openedReport.createdAt,
  lastActionType: 'restrict',
  lastActionAt: '2026-06-02T12:10:00.000Z',
  surfaces: [
    {
      kind: 'verification_thread',
      label: 'Case thread',
      url: 'https://discord.com/channels/guild-1/case-thread-300',
    },
  ],
  allowedActions: ['view_history', 'verify_user', 'close_no_action', 'kick_user', 'ban_user'],
  notes: null,
  evidenceItems: [],
  messageContext: [],
  detectionHistory: [],
  moderationOutcomes: [
    {
      id: 'out-report-1',
      outcomeType: 'restricted',
      source: 'drasil',
      actorId: 'moderator-1',
      reason: 'Case role applied for report review.',
      occurredAt: '2026-06-02T12:10:00.000Z',
    },
  ],
};
export const everydayCaseMember: MemberProfile = {
  guildId: everydayCase.guildId,
  userId: everydayCase.userId,
  identity: everydayCase.userIdentity,
  presenceState: 'in_server',
  membership: {
    joinDate: null,
    lastMessageAt: null,
    messageCount: null,
    verificationStatus: null,
    caseRoleActive: true,
    screeningPending: null,
  },
  cases: [],
  detections: [],
  reports: [],
  outcomes: [],
};

// An explicit density fixture: existing source quotations/checks plus additional saved replies.
const savedReplies = [
  'Is this an official community event?',
  'I cannot find an announcement for this reward.',
  'The sign-in page looks different from the usual one.',
  'Please wait for a moderator before opening it.',
  'I have saved the messages for the report.',
  'Can someone check the source of this link?',
  'The same offer was mentioned earlier in this channel.',
  'I am waiting for the team to respond.',
  'The report has the screenshot attached.',
  'The screenshots are attached to the report now.',
];
export const busyCase: CaseDetail = {
  ...fixtureCaseDetails[0],
  userIdentity: {
    ...fixtureCaseDetails[0].userIdentity,
    username: 'fieldnote',
    displayName: 'fieldnote',
    displayLabel: 'fieldnote',
    nickname: null,
    globalName: null,
  },
  messageContext: [
    ...fixtureCaseDetails[0].messageContext,
    ...savedReplies.map((contentPreview, index) => ({
      id: `density-context-${index}`,
      messageId: `density-message-${index}`,
      channelId: 'source-channel-1',
      contentPreview,
      createdAt: new Date(Date.UTC(2026, 5, 1, 8, 1, index)).toISOString(),
      url: null,
      isSource: false,
    })),
  ],
};
