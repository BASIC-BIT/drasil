import { memberProfileSchema, type MemberProfile } from '@drasil/contracts';
import {
  fixtureCaseDetails,
  fixtureCaseSummaries,
  fixtureResolvedCaseDetails,
  fixtureResolvedCaseSummaries,
} from './caseFixtures';
import { fixtureReportDetails } from './reportFixtures';

export function fixtureMemberProfile(guildId: string, userId: string): MemberProfile | null {
  const cases = [...fixtureCaseSummaries(), ...fixtureResolvedCaseSummaries()].filter(
    (item) => item.guildId === guildId && item.userId === userId
  );
  const detailCases = [...fixtureCaseDetails, ...fixtureResolvedCaseDetails].filter(
    (item) => item.guildId === guildId && item.userId === userId
  );
  const reports = fixtureReportDetails.filter(
    (report) => report.guildId === guildId && report.targetUserId === userId
  );
  if (guildId === 'guild-1' && userId === 'user-500') {
    return memberProfileSchema.parse({
      guildId,
      userId,
      identity: {
        id: userId,
        username: 'observed.user',
        globalName: 'Observed User',
        nickname: null,
        displayName: 'Observed User',
        avatarUrl: null,
        displayLabel: 'Observed User',
      },
      presenceState: 'in_server',
      membership: {
        joinDate: '2026-06-04T09:30:00.000Z',
        lastMessageAt: '2026-06-04T10:00:00.000Z',
        messageCount: 1,
        verificationStatus: null,
        caseRoleActive: false,
        screeningPending: false,
      },
      cases: [],
      detections: [
        {
          id: 'det-observed-1',
          detectionType: 'suspicious_content',
          confidence: 0.82,
          detectedAt: '2026-06-04T10:00:00.000Z',
          reasons: ['Message looked suspicious but server policy kept it as notify-only.'],
          latestCaseId: null,
          accounting: {
            excluded: true,
            scope: 'server',
            reason: 'Marked false positive',
            excludedBy: 'moderator-1',
            excludedAt: '2026-06-04T10:15:00.000Z',
          },
          observedAction: 'false_positive',
          observedActionAt: '2026-06-04T10:15:00.000Z',
          observedActionBy: 'moderator-1',
          sourceChannelId: 'source-channel-5',
          sourceMessageId: 'source-message-5',
          sourceMessageUrl:
            'https://discord.com/channels/guild-1/source-channel-5/source-message-5',
        },
      ],
      reports: [],
      outcomes: [],
    });
  }
  if (cases.length === 0 && detailCases.length === 0 && reports.length === 0) {
    return null;
  }

  const identity = detailCases[0]?.userIdentity ??
    cases[0]?.userIdentity ?? {
      id: userId,
      username: null,
      globalName: null,
      nickname: null,
      displayName: null,
      avatarUrl: null,
      displayLabel: userId,
    };
  const latestCase = detailCases[0];

  return memberProfileSchema.parse({
    guildId,
    userId,
    identity,
    presenceState: latestCase?.presenceState ?? cases[0]?.presenceState ?? 'unknown',
    membership: {
      joinDate: latestCase?.createdAt ?? null,
      lastMessageAt: latestCase?.latestDetectionAt ?? null,
      messageCount: latestCase?.messageContext.length ?? null,
      verificationStatus: latestCase?.presenceState === 'banned' ? 'banned' : null,
      caseRoleActive: latestCase?.presenceState === 'in_server' ? true : false,
      screeningPending: false,
    },
    cases,
    detections: detailCases.flatMap((item) => {
      const sourceContext = item.messageContext.find((message) => message.isSource);
      const sourceSurface = item.surfaces.find((surface) => surface.kind === 'source_message');

      return item.detectionHistory.map((detection) => ({
        ...detection,
        latestCaseId: item.id,
        accounting: {
          excluded: false,
          scope: null,
          reason: null,
          excludedBy: null,
          excludedAt: null,
        },
        observedAction: null,
        observedActionAt: null,
        observedActionBy: null,
        sourceChannelId: sourceContext?.channelId ?? null,
        sourceMessageId: sourceContext?.messageId ?? null,
        sourceMessageUrl: sourceContext?.url ?? sourceSurface?.url ?? null,
      }));
    }),
    reports: reports.map((report) => ({
      id: report.id,
      reporterId: report.reporterId,
      status: report.status,
      summary: report.summary,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      reportThreadUrl: report.reportThreadUrl,
      latestCaseId: report.latestCaseId,
    })),
    outcomes: detailCases.flatMap((item) =>
      item.moderationOutcomes.map((outcome) => ({
        ...outcome,
        verificationEventId: item.id,
        detectionEventId: item.detectionHistory[0]?.id ?? null,
      }))
    ),
  });
}
