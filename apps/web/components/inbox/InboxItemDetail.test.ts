import { fixtureReportDetails, fixtureReportQueueItems } from '@/lib/reportFixtures';
import { reportQueueItemToInboxItem } from '@/lib/moderationInboxDataAdapter';
import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { workspaceItemDetailSchema } from '@/lib/moderationWorkspaceTypes';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { InboxItemDetail, matchingInboxRequests } from './InboxItemDetail';
import type { WorkspaceActions } from '@/lib/workspaceActionTypes';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));

it('retains a completed maintenance receipt after reload even when the action is no longer eligible', () => {
  const item = fixtureModerationInboxItems().find((item) => item.kind === 'case')!;
  const detail = fixtureCaseDetails.find((detail) => detail.id === item.sourceId)!;
  const policy = {
    allowedActions: [],
    canQueueCaseActions: true,
    canOpenReportCases: true,
    canManageCleanup: false,
    kickReasonRequired: false,
    banReasonRequired: false,
  };
  const model = workspaceItemDetailSchema.parse({
    kind: 'case',
    item: { ...item, allowedActions: [] },
    policy,
    data: {
      detail: { ...detail, allowedActions: [] },
      policy,
      report: null,
      membership: null,
      cleanup: null,
      loadedAt: '2026-10-25T12:00:00Z',
      requests: [
        {
          id: 'historical-maintenance',
          guildId: item.guildId,
          actionType: 'refresh_case_notification',
          requestedAction: 'refresh_notification',
          actorSurface: 'web',
          actorUserId: 'moderator-1',
          status: 'completed',
          targetUserId: detail.userId,
          verificationEventId: detail.id,
          requestedAt: '2026-10-24T12:00:00Z',
          updatedAt: '2026-10-24T12:01:00Z',
          completedAt: '2026-10-24T12:01:00Z',
          failedAt: null,
          lastError: null,
          resultSummary: 'Notification refreshed.',
          detectionEventId: null,
          reportIntakeId: null,
          messageDeletionJobId: null,
        },
      ],
    },
  });
  const submit = vi.fn();
  const html = renderToStaticMarkup(
    createElement(InboxItemDetail, {
      detail: model,
      loadedAt: '2026-10-25T12:00:00Z',
      returnHref: '/inbox',
      trackedRequestId: null,
      onTrackedRequest() {},
      actions: {
        caseAction: submit,
        observedAction: submit,
        reportAction: submit,
        attentionAction: submit,
      },
    })
  );
  expect(html).toContain('Request historical-maintenance');
  expect(html).toContain('This request already completed for this case.');
  expect(html).toMatch(/disabled=""[^>]*>Refresh notification/);
  expect(submit).not.toHaveBeenCalled();
});

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

it.each(['ordinary', 'compromised_account'] as const)(
  'describes member-wide resolution and applicable role effects for %s cases',
  (kind) => {
    const item = fixtureModerationInboxItems().find((item) => item.kind === 'case')!;
    const source = fixtureCaseDetails.find((detail) => detail.id === item.sourceId)!;
    const allowedActions = ['verify_user', 'close_no_action'];
    const policy = {
      allowedActions,
      canQueueCaseActions: true,
      canOpenReportCases: true,
      canManageCleanup: false,
      kickReasonRequired: false,
      banReasonRequired: false,
    };
    const model = workspaceItemDetailSchema.parse({
      kind: 'case',
      item: { ...item, allowedActions },
      policy,
      data: {
        detail: { ...source, caseKind: kind === 'ordinary' ? 'standard' : kind, allowedActions },
        policy,
        requests: [],
        report: null,
        membership: null,
        cleanup: null,
        loadedAt: '2026-10-25T12:00:00Z',
      },
    });
    const submit = vi.fn();
    const actions: WorkspaceActions = {
      caseAction: submit,
      reportAction: submit,
      observedAction: submit,
      attentionAction: submit,
    };
    const html = renderToStaticMarkup(
      createElement(InboxItemDetail, {
        detail: model,
        actions,
        loadedAt: '2026-10-25T12:00:00Z',
        returnHref: '/inbox',
        trackedRequestId: null,
        onTrackedRequest() {},
      })
    );
    expect(html).toContain('all pending cases for this member in this server');
    expect(html).toContain('restore eligible snapshotted roles under current role policy');
    if (kind === 'ordinary') {
      expect(html).toContain('remove the active case-role restriction when applicable');
      expect(html).toContain('Close cannot release active compromised-account quarantine');
    } else expect(html).toContain('Confirm account recovery');
  }
);

it.each([
  ['matching', {}],
  ['guild', { guildId: 'other-guild' }],
  ['record', { reportIntakeId: 'other-report' }],
  ['member', { targetUserId: 'other-member' }],
  ['action', { requestedAction: 'kick_user' }],
] as const)('restores only a matching report receipt on a fresh mount: %s', (scope, override) => {
  const report = { ...fixtureReportDetails[0], allowedActions: [] };
  const request = {
    id: 'claimed-ban',
    guildId: report.guildId,
    actionType: 'ban_observed_detection',
    requestedAction: 'ban_user',
    actorSurface: 'web',
    actorUserId: 'moderator-1',
    targetUserId: report.targetUserId,
    reportIntakeId: report.id,
    detectionEventId: report.latestDetectionId,
    verificationEventId: null,
    messageDeletionJobId: null,
    status: 'failed',
    resultSummary: null,
    requestedAt: '2026-10-24T12:00:00Z',
    updatedAt: '2026-10-24T12:01:00Z',
    completedAt: null,
    failedAt: '2026-10-24T12:01:00Z',
    lastError: null,
    observedBanResult: { status: 'ban_outcome_unknown', operationId: 'claimed-ban' },
    ...override,
  };
  const detail = workspaceItemDetailSchema.parse({
    kind: 'submitted_report',
    report,
    item: reportQueueItemToInboxItem({ ...fixtureReportQueueItems[0], allowedActions: [] }),
    requests: [request],
    policy: {
      allowedActions: [],
      canQueueCaseActions: true,
      canOpenReportCases: true,
      canManageCleanup: false,
      kickReasonRequired: false,
      banReasonRequired: false,
    },
  });
  const submit = vi.fn();
  const html = renderToStaticMarkup(
    createElement(InboxItemDetail, {
      detail,
      loadedAt: '2026-10-25T12:00:00Z',
      returnHref: '/inbox',
      trackedRequestId: null,
      onTrackedRequest() {},
      actions: {
        caseAction: submit,
        reportAction: submit,
        observedAction: submit,
        attentionAction: submit,
      },
    })
  );
  if (scope === 'matching') {
    expect(html).toContain('Request claimed-ban');
    expect(html).toContain('/review-report-ban operation:claimed-ban');
    expect(html).toMatch(/disabled=""[^>]*>Ban member/);
  } else expect(html).not.toContain('Request claimed-ban');
});
