import { describe, expect, it } from 'vitest';
import { fixtureModerationInboxItems } from './inboxFixtures';
import {
  findInboxActionRequest,
  hasActiveInboxActionRequests,
  reconcileLocalInboxActionRequestIds,
} from './inboxActionReceipts';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';

function buildRequest(
  overrides: Partial<ModerationActionRequestSummary>
): ModerationActionRequestSummary {
  return {
    id: 'request-1',
    actionType: 'refresh_case_notification',
    actorSurface: 'web',
    completedAt: null,
    detectionEventId: null,
    failedAt: null,
    lastError: null,
    requestedAt: '2026-06-08T01:00:00.000Z',
    reportIntakeId: null,
    requestedAction: null,
    resultSummary: null,
    status: 'queued',
    targetUserId: 'user-100',
    updatedAt: '2026-06-08T01:00:00.000Z',
    verificationEventId: null,
    ...overrides,
  };
}

describe('inboxActionReceipts', () => {
  const items = fixtureModerationInboxItems();
  const caseItem = items.find((item) => item.kind === 'case');
  const observedItem = items.find((item) => item.kind === 'observed_alert');
  const reportItem = items.find((item) => item.kind === 'submitted_report');

  it('matches requests by action family and durable subject id', () => {
    expect(caseItem).toBeDefined();
    expect(observedItem).toBeDefined();
    expect(reportItem).toBeDefined();

    const requests = [
      buildRequest({ verificationEventId: caseItem?.sourceId ?? null }),
      buildRequest({
        id: 'request-2',
        actionType: 'ban_observed_detection',
        detectionEventId: observedItem?.sourceId ?? null,
      }),
      buildRequest({
        id: 'request-3',
        actionType: 'open_case_from_observed_detection',
        reportIntakeId: reportItem?.sourceId ?? null,
      }),
    ];

    expect(findInboxActionRequest(requests, caseItem!, 'refresh_notification')?.id).toBe(
      'request-1'
    );
    expect(findInboxActionRequest(requests, observedItem!, 'ban_user')?.id).toBe('request-2');
    expect(findInboxActionRequest(requests, reportItem!, 'open_case')?.id).toBe('request-3');
    expect(findInboxActionRequest(requests, caseItem!, 'ban_user')).toBeNull();
  });

  it('uses request metadata to distinguish shared worker action types', () => {
    expect(caseItem).toBeDefined();
    const request = buildRequest({
      actionType: 'repair_active_case',
      requestedAction: 'create_thread',
      verificationEventId: caseItem?.sourceId ?? null,
    });

    expect(findInboxActionRequest([request], caseItem!, 'create_thread')?.id).toBe('request-1');
    expect(findInboxActionRequest([request], caseItem!, 'repair_thread')).toBeNull();
  });

  it('does not share a report-open receipt with its observed-alert mirror', () => {
    expect(observedItem).toBeDefined();
    expect(reportItem).toBeDefined();
    const reportRequest = buildRequest({
      actionType: 'open_case_from_observed_detection',
      detectionEventId: observedItem?.sourceId ?? null,
      reportIntakeId: reportItem?.sourceId ?? null,
    });

    expect(findInboxActionRequest([reportRequest], reportItem!, 'open_case')?.id).toBe('request-1');
    expect(findInboxActionRequest([reportRequest], observedItem!, 'open_case')).toBeNull();
  });

  it('reports only queued and processing requests as active', () => {
    expect(hasActiveInboxActionRequests([buildRequest({ status: 'processing' })])).toBe(true);
    expect(hasActiveInboxActionRequests([buildRequest({ status: 'queued' })])).toBe(true);
    expect(hasActiveInboxActionRequests([buildRequest({ status: 'completed' })])).toBe(false);
    expect(hasActiveInboxActionRequests([buildRequest({ status: 'failed' })])).toBe(false);
  });

  it('retains local polling ids until server data reports a terminal state', () => {
    const localRequestIds = new Set([
      'request-unobserved',
      'request-active',
      'request-completed',
      'request-failed',
    ]);

    const whileActive = reconcileLocalInboxActionRequestIds(localRequestIds, [
      buildRequest({ id: 'request-active', status: 'processing' }),
    ]);
    expect(whileActive).toBe(localRequestIds);

    expect(
      reconcileLocalInboxActionRequestIds(localRequestIds, [
        buildRequest({ id: 'request-active', status: 'processing' }),
        buildRequest({ id: 'request-completed', status: 'completed' }),
        buildRequest({ id: 'request-failed', status: 'failed' }),
      ])
    ).toEqual(new Set(['request-unobserved', 'request-active']));
  });
});
