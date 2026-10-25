import { CaseTools } from './CaseTools';
import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import {
  getMessageCleanupExecutionEligibility,
  messageCleanupJobDetailSchema,
  type MessageCleanupJobDetail,
} from '@drasil/contracts';
import {
  fixtureMessageCleanupJobDetails,
  fixtureMessageCleanupCaseWorkspaces,
} from '@/lib/messageCleanupFixtures';
import type { WorkspaceActionPolicy } from '@/lib/moderationWorkspaceTypes';
import { MessageCleanupPanel } from './MessageCleanupPanel';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
const policy: WorkspaceActionPolicy = {
  allowedActions: ['ban_user'],
  canManageCleanup: true,
  canQueueCaseActions: true,
  canOpenReportCases: false,
  kickReasonRequired: true,
  banReasonRequired: true,
};
function job(overrides: Partial<MessageCleanupJobDetail> = {}) {
  const value = { ...fixtureMessageCleanupJobDetails[0], ...overrides };
  return messageCleanupJobDetailSchema.parse({
    ...value,
    execution: getMessageCleanupExecutionEligibility({
      ...value,
      candidateCount: value.outcomes.candidateCount,
    }),
  });
}
const submit = async () => ({ requestId: null, message: 'Unused', status: 'failed' as const });
function render(value = job(), canManageCleanup = true, withCombined = false) {
  return renderToStaticMarkup(
    createElement(MessageCleanupPanel, {
      policy: { ...policy, canManageCleanup },
      integration: {
        workspace: {
          ...fixtureMessageCleanupCaseWorkspaces[0],
          latestJobs: withCombined ? [value, job(fixtureMessageCleanupJobDetails[1])] : [value],
        },
        deleteOnlyJob: value.mode === 'delete_only' ? value : null,
        combinedJob:
          value.mode === 'ban_with_cleanup'
            ? value
            : withCombined
              ? job(fixtureMessageCleanupJobDetails[1])
              : null,
        previewAction: submit,
        executeAction: submit,
        combinedBanAction: submit,
        loadedAt: '2026-10-25T12:00:00Z',
        returnHref: '/admin/guild/guild-1/inbox',
        requests: [],
      },
    })
  );
}
it('pins shared execution boundaries on parsed fixture records', () => {
  const singleSourcePartial = job();
  const partialWindow = job({ scope: 'last_day' });
  const over100Candidates = job({
    coverage: 'ready',
    outcomes: { ...singleSourcePartial.outcomes, candidateCount: 101 },
  });
  const completedBanFailedFinalization = job(fixtureMessageCleanupJobDetails[1]);
  expect(singleSourcePartial.execution.canExecute).toBe(true);
  expect(partialWindow.execution.canExecute).toBe(false);
  expect(over100Candidates.execution.canExecute).toBe(false);
  expect(completedBanFailedFinalization.banStatus).toBe('succeeded');
  expect(completedBanFailedFinalization.caseFinalizationStatus).toBe('failed');
});
it('renders source identity, author, frozen reason and real partial coverage', () => {
  const value = job();
  const html = render(value);
  expect(html).toContain(value.items[0].messageId);
  expect(html).toContain(value.items[0].authorId);
  expect(html).toContain(`dateTime="${value.items[0].messageCreatedAt}"`);
  expect(html).toContain(value.reason);
  expect(html).toContain('partial');
  expect(html).toContain('Delete 1 message');
  expect(html).toContain('maxLength="1000"');
});
it('renders all actual item outcomes without treating completion as complete deletion', () => {
  const statuses = [
    'deleted',
    'already_missing',
    'changed_since_preview',
    'evidence_failed',
    'delete_failed',
    'permission_denied',
  ] as const;
  const value = job({
    status: 'completed',
    items: statuses.map((status, i) => ({ ...job().items[0], id: `item-${i}`, status })),
    outcomes: {
      candidateCount: 6,
      preservedCount: 3,
      deletedCount: 1,
      alreadyMissingCount: 1,
      changedSincePreviewCount: 1,
      evidenceFailedCount: 1,
      deleteFailedCount: 1,
      permissionDeniedCount: 1,
    },
  });
  const html = render(value);
  for (const text of [
    'Deleted',
    'Already missing',
    'Changed after preview',
    'Evidence failed',
    'Delete failed',
    'Permission denied',
  ])
    expect(html).toContain(text);
  expect(html).toContain('1 deleted');
});
it('shows ban success and failed finalization independently with same-job retry', () => {
  const html = render(job(fixtureMessageCleanupJobDetails[1]));
  expect(html).toContain('Ban succeeded');
  expect(html).toContain('Case finalization failed');
  expect(html).toContain('Retry case finalization');
});
it('blocks a partial time window and offers new preview', () => {
  const html = render(job({ scope: 'last_day' }));
  expect(html).toContain('New preview');
  expect(html).not.toMatch(/<button[^>]*>Delete 1 message<\/button>/);
});
it('never offers mutations without cleanup authority', () => {
  expect(render(job(), false)).not.toContain('>Delete 1 message<');
});

it('does not attribute the hidden combined job outcome to a selected delete-only preview', () => {
  expect(render(job(), true, true)).not.toContain('Member banned.');
});

it('CaseTools retains finalization-only review with no ordinary actions on a banned case', () => {
  const value = job(fixtureMessageCleanupJobDetails[1]);
  const workspace = {
    ...fixtureMessageCleanupCaseWorkspaces[0],
    caseStatus: 'banned' as const,
    canPreview: false,
    blockedReason: 'case_not_pending' as const,
    latestJobs: [value],
  };
  const integration = {
    workspace,
    deleteOnlyJob: null,
    combinedJob: value,
    previewAction: submit,
    executeAction: submit,
    combinedBanAction: submit,
    requests: [],
    loadedAt: '2026-10-25T12:00:00Z',
    returnHref: '/admin/guild/guild-1/inbox',
  };
  const mutation = async () => ({ kind: 'failed' as const, message: 'unused' });
  const html = renderToStaticMarkup(
    createElement(CaseTools, {
      data: {
        detail: {
          ...fixtureCaseDetails[0],
          id: value.verificationEventId,
          userId: value.targetUserId,
          guildId: value.guildId,
          status: 'banned',
          allowedActions: [],
        },
        actorUserId: 'admin-2',
        report: null,
        membership: null,
        requests: [],
        cleanup: { workspace, jobs: [value] },
        securityCheckConfiguration: null,
        policy: { ...policy, allowedActions: [] },
        loadedAt: integration.loadedAt,
      },
      actions: {
        caseAction: mutation,
        reportAction: mutation,
        observedAction: mutation,
        attentionAction: mutation,
      },
      returnHref: integration.returnHref,
      cleanup: integration,
    })
  );
  expect(html).toMatch(/<button[^>]*>Retry case finalization<\/button>/);
  expect(html).not.toMatch(/<button[^>]*>Preview messages<\/button>/);
});
