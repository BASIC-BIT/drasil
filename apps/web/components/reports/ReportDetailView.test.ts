import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportDetailView } from './ReportDetailView';
import { fixtureReportDetails } from '@/lib/reportFixtures';
import { initialInboxActionState } from '@/lib/inboxActionState';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
const detail = {
  ...fixtureReportDetails[0],
  targetDisplayName: 'Reported member',
  allowedActions: ['ban_user'] as const,
};
function render(changes: Partial<Parameters<typeof ReportDetailView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(ReportDetailView, {
      detail: { ...detail, allowedActions: [...detail.allowedActions] },
      guildId: 'guild-1',
      guildName: 'Fixture Guild',
      sessionUsername: 'Moderator',
      canOpenReportCases: true,
      closeReportAction: async () => {},
      openReportCaseAction: async () => {},
      banReportAction: async () => initialInboxActionState,
      banUnavailableReason: null,
      banRequiresReason: true,
      ...changes,
    })
  );
}
describe('report ban confirmation', () => {
  it('shows readable identity, immutable ID, reason and explicit target confirmation', () => {
    const markup = render();
    expect(markup).toContain('Reported member');
    expect(markup).toContain('user-300');
    expect(markup).toContain('name="reason"');
    expect(markup).toContain('name="confirmAction"');
    expect(markup).toContain('name="confirmedTargetUserId"');
    expect(markup).toContain('Confirm Ban');
  });
  it('explains why an unauthorized moderator cannot ban', () => {
    const markup = render({ banUnavailableReason: 'Requires Ban Members permission.' });
    expect(markup).toContain('Requires Ban Members permission.');
    expect(markup).not.toContain('name="confirmAction"');
  });
  it.each([
    ['banned_updates_pending', 'submitted'],
    ['banned_updates_pending', 'actioned'],
    ['ban_outcome_unknown', 'submitted'],
    ['ban_outcome_unknown', 'actioned'],
  ] as const)(
    'retains the %s receipt on a %s report without another ban submit',
    (status, reportStatus) => {
      const request: ModerationActionRequestSummary = {
        id: 'request-1',
        actionType: 'ban_observed_detection',
        actorSurface: 'web_report',
        completedAt: null,
        failedAt: null,
        detectionEventId: 'det-report-1',
        lastError: 'Cleanup failed',
        messageDeletionJobId: null,
        reportIntakeId: 'report-1',
        requestedAction: 'ban_user',
        requestedAt: '2026-10-15T00:00:00Z',
        resultSummary:
          status === 'banned_updates_pending'
            ? 'Banned. Report updates are still pending.'
            : 'Ban outcome needs review.',
        status: 'failed',
        targetUserId: 'user-300',
        updatedAt: '2026-10-15T00:00:00Z',
        verificationEventId: null,
        observedBanResult: { status, operationId: 'request-1' },
      };
      const markup = render({
        banRequest: request,
        detail: {
          ...detail,
          status: reportStatus,
          allowedActions: reportStatus === 'actioned' ? [] : ['ban_user'],
        },
      });
      expect(markup).toContain(request.resultSummary);
      expect(markup).not.toContain('name="confirmAction"');
      expect(markup).not.toContain('Cleanup failed');
    }
  );
});
