import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { workspaceItemDetailSchema } from '@/lib/moderationWorkspaceTypes';
import { expect, it } from 'vitest';
import { matchingInboxRequests } from './InboxItemDetail';

it('keeps dedicated cleanup requests in the selected case polling scope', () => {
  const item = fixtureModerationInboxItems().find((item) => item.kind === 'case')!;
  const detail = fixtureCaseDetails.find((detail) => detail.id === item.sourceId)!;
  const request = {
    id: 'cleanup-request',
    actionType: 'preview_case_message_deletion',
    actorSurface: 'web',
    verificationEventId: detail.id,
    targetUserId: detail.userId,
    requestedAction: null,
    detectionEventId: null,
    reportIntakeId: null,
    messageDeletionJobId: null,
    completedAt: null,
    failedAt: null,
    lastError: null,
    resultSummary: null,
    requestedAt: '2026-10-25T12:00:00Z',
    updatedAt: '2026-10-25T12:00:00Z',
    status: 'queued',
  };
  const policy = {
    allowedActions: [],
    canQueueCaseActions: true,
    canOpenReportCases: true,
    canManageCleanup: true,
    kickReasonRequired: true,
    banReasonRequired: true,
  };
  const model = workspaceItemDetailSchema.parse({
    kind: 'case',
    item,
    policy,
    data: {
      detail,
      policy,
      report: null,
      membership: null,
      detectionHistory: [],
      requests: [request, { ...request, id: 'other', verificationEventId: 'other' }],
      cleanup: null,
      loadedAt: '2026-10-25T12:00:00Z',
    },
  });
  expect(matchingInboxRequests(model).map((request) => request.id)).toEqual(['cleanup-request']);
});
