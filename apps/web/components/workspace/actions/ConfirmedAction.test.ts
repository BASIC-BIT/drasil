import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ConfirmedAction } from './ConfirmedAction';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
it('includes the actual server ID in shared modal context and accessible description', () => {
  const html = renderToStaticMarkup(
    createElement(ConfirmedAction, {
      target: {
        guildId: 'actual-guild',
        kind: 'case',
        recordId: 'case-1',
        targetUserId: 'member-1',
        label: 'Member one',
        loadedAt: '2026-10-25T12:00:00Z',
      },
      action: { id: 'verify_user', label: 'Verify member', description: 'Verify pending cases.' },
      durableRequest: null,
      submit: vi.fn(),
    })
  );
  expect(html).toContain('Server ID actual-guild');
  expect(html).toMatch(/aria-describedby="[^"]*-context [^"]*-description"/);
});

const request: ModerationActionRequestSummary = {
  id: 'request-1',
  actionType: 'ban_observed_detection',
  actorSurface: 'web',
  actorUserId: 'moderator-1',
  completedAt: null,
  failedAt: null,
  lastError: null,
  requestedAt: '2026-10-24T12:00:00Z',
  updatedAt: '2026-10-25T12:00:00Z',
  detectionEventId: 'detection-1',
  verificationEventId: null,
  reportIntakeId: null,
  messageDeletionJobId: null,
  targetUserId: 'member-1',
  requestedAction: 'ban_user',
  resultSummary:
    'Use /review-report-ban operation:operation-1 reason:<review reason> if no current ban exists.',
  status: 'failed',
  observedBanResult: { status: 'ban_outcome_unknown', operationId: 'operation-1' },
};
function renderReceipt(
  durableRequest: ModerationActionRequestSummary,
  kind: 'observed_alert' | 'submitted_report' = 'observed_alert'
) {
  return renderToStaticMarkup(
    createElement(ConfirmedAction, {
      target: {
        guildId: 'actual-guild',
        kind,
        recordId: 'detection-1',
        targetUserId: 'member-1',
        label: 'Member one',
        loadedAt: '2026-10-25T12:00:00Z',
      },
      action: { id: 'ban_user', label: 'Ban member', description: 'Ban this member.' },
      durableRequest,
      submit: vi.fn(),
    })
  );
}
it('exposes inspectable request/operation identity, actor, actual times and supported instructions', () => {
  const html = renderReceipt(request);
  expect(html).toContain('Request request-1');
  expect(html).toContain('Operation operation-1');
  expect(html).toContain(
    '/admin/guild/actual-guild/operations?request=request-1#request-request-1'
  );
  expect(html).toContain('moderator-1');
  expect(html).toContain('dateTime="2026-10-24T12:00:00Z"');
  expect(html).toContain('/review-report-ban operation:operation-1');
});
it('presents reviewed current absence separately from historical uncertainty', () => {
  const html = renderReceipt({
    ...request,
    observedBanResult: { status: 'ban_reviewed_no_current_ban', operationId: 'operation-1' },
    resultSummary: 'Matching claims released.',
  });
  expect(html).toContain('Reviewed: no current ban');
  expect(html).toContain('historical outcome remains uncertain');
  expect(html).toContain('Matching claims released.');
  expect(html).not.toContain('Request failed.');
});
it('does not render a receipt for another record or explicit foreign guild', () => {
  expect(renderReceipt({ ...request, detectionEventId: 'other' })).not.toContain(
    'Operation operation-1'
  );
  expect(
    renderReceipt({ ...request, guildId: 'foreign' } as ModerationActionRequestSummary)
  ).not.toContain('Operation operation-1');
});
it('keeps completed maintenance historical, inspectable and disabled', () => {
  const html = renderToStaticMarkup(
    createElement(ConfirmedAction, {
      target: {
        guildId: 'actual-guild',
        kind: 'case',
        recordId: 'case-1',
        targetUserId: 'member-1',
        label: 'Member one',
        loadedAt: '2026-10-26T12:00:00Z',
      },
      action: {
        id: 'refresh_notification',
        label: 'Refresh notification',
        description: 'Refresh notification.',
      },
      durableRequest: {
        ...request,
        actionType: 'refresh_case_notification',
        requestedAction: 'refresh_notification',
        verificationEventId: 'case-1',
        detectionEventId: null,
        observedBanResult: null,
        status: 'completed',
        completedAt: '2026-10-25T12:00:00Z',
        resultSummary: 'Notification refreshed.',
      },
      submit: vi.fn(),
    })
  );
  expect(html).toMatch(/disabled=""[^>]*>Refresh notification/);
  expect(html).toContain('This request already completed for this case.');
  expect(html).toContain('historical receipt');
  expect(html).toContain('Notification refreshed.');
  expect(html).toContain('dateTime="2026-10-25T12:00:00Z"');
});
