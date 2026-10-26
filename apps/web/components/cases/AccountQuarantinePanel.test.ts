import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixtureCaseDetails, fixtureParkedCaseDetails } from '@/lib/caseFixtures';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import type { AccountQuarantineActionRequests } from '@/lib/inboxActionReceipts';
import type { WorkspaceMutation } from '@/lib/workspaceActionTypes';
import { AccountQuarantinePanel } from './AccountQuarantinePanel';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { parseInboxLocation } from '@/lib/inboxLocation';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
const submit: WorkspaceMutation = async () => ({ kind: 'failed', message: 'unused' });
const policy: CaseWorkspaceData['policy'] = {
  allowedActions: ['quarantine_compromised_account', 'verify_user'],
  canQueueCaseActions: true,
  canOpenReportCases: false,
  canManageCleanup: false,
  kickReasonRequired: true,
  banReasonRequired: true,
};
const data: CaseWorkspaceData = {
  securityCheckConfiguration: null,
  actorUserId: 'moderator-1',
  detail: {
    ...fixtureCaseDetails[0],
    allowedActions: ['quarantine_compromised_account', 'verify_user'],
  },
  report: null,
  membership: null,
  requests: [],
  cleanup: null,
  policy,
  loadedAt: '2026-10-25T12:00:00.000Z',
};
const requests: AccountQuarantineActionRequests = { execute: null, preview: null };
function render(value = data, bindings = requests) {
  return renderToStaticMarkup(
    createElement(AccountQuarantinePanel, {
      data: value,
      requests: bindings,
      policy,
      submissions: { preview: submit, execute: submit, release: submit },
    })
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());
it('offers contextual preview confirmation and never invents a release role list', () => {
  const html = render();
  expect(html).toContain('Preview account quarantine');
  expect(html).not.toContain('Roles to restore:');
});
it('shows actual parking actor/time and recorded role counts without a close action', () => {
  const html = render({ ...data, detail: fixtureParkedCaseDetails[0] });
  expect(html).toContain('moderator-1');
  expect(html).toContain('2026-06-05T10:00:00.000Z');
  expect(html).toContain('Verify and release');
  expect(html).not.toContain('Close case');
  expect(html).not.toContain('Preview account quarantine');
});
it('keeps incomplete containment in review and shows recorded effects', () => {
  const html = render({
    ...data,
    detail: {
      ...fixtureParkedCaseDetails[0],
      attentionState: 'review_required',
      containmentStatus: 'incomplete',
      parkedAt: null,
      parkedBy: null,
    },
  });
  expect(html).toContain('Containment incomplete');
  expect(html).toContain('Review required');
  expect(html).toContain('Roles removed');
});
it('blocks duplicate containment while the case is in progress', () => {
  const html = render({ ...data, detail: { ...data.detail, containmentStatus: 'in_progress' } });
  expect(html).toMatch(/disabled=""[^>]*>Preview account quarantine/);
});

it.each(['recovery_reply', 'quarantine_breach'] as const)(
  'links %s to its selected concrete attention record',
  (subtype) => {
    const item = {
      ...fixtureModerationInboxItems()[0],
      id: `queue:${subtype}`,
      title: subtype,
      kind: 'support_attention' as const,
      subtype,
    };
    const html = render({
      ...data,
      detail: { ...fixtureParkedCaseDetails[0], guildId: 'guild/one' },
      recoveryAttention: [item],
    });
    const href = html.match(/href="([^"]+inbox[^"]+)"/)?.[1].replace(/&amp;/g, '&');
    const url = new URL(href!, 'https://test.invalid');
    expect(url.pathname).toBe('/admin/guild/guild%2Fone/inbox');
    expect(parseInboxLocation(url.searchParams).selectedItemId).toBe(item.id);
  }
);

function preview(ageMinutes = 1): NonNullable<AccountQuarantineActionRequests['preview']> {
  const at = new Date(Date.now() - ageMinutes * 60000).toISOString();
  return {
    id: 'preview-1',
    actorUserId: 'moderator-1',
    actorSurface: 'web',
    actionType: 'preview_account_quarantine',
    status: 'completed',
    completedAt: at,
    requestedAt: at,
    updatedAt: at,
    targetUserId: data.detail.userId,
    verificationEventId: data.detail.id,
    requestedAction: 'quarantine_compromised_account',
    detectionEventId: null,
    failedAt: null,
    lastError: null,
    messageDeletionJobId: null,
    reportIntakeId: null,
    resultSummary: null,
    accountQuarantinePreview: {
      enabled: true,
      canContain: true,
      caseRole: { roleId: 'case-role', roleName: 'Case role', reason: null },
      caseRoleReady: true,
      adminNotificationReady: true,
      recoveryThreadId: 'thread',
      recoveryThreadReady: true,
      previewedAt: at,
      plannedRoles: [{ roleId: 'member-role', roleName: 'Member', reason: null }],
      privilegedRoles: [],
      retainedRoles: [],
      unremovablePrivilegeReasons: [],
      lockdownErrorCount: 0,
      lockdownIssueCount: 0,
      lockdownPlannedActionCount: 0,
      memberBypassCount: 0,
    },
  };
}
function withPreview(request = preview()) {
  return { ...data, actorUserId: 'moderator-1', requests: [request] };
}
it('offers a fresh own matching preview, including incomplete attempts', () => {
  const request = preview();
  const partial = {
    ...request,
    accountQuarantinePreview: { ...request.accountQuarantinePreview!, canContain: false },
  };
  const html = render(withPreview(partial), { preview: partial, execute: null });
  expect(html).toContain('Attempt account quarantine');
  expect(html).not.toMatch(/disabled=""[^>]*>Attempt account quarantine/);
  expect(html).toContain('Member (member-role)');
  expect(html).toContain('Incomplete containment remains in review');
});
it.each(['expired', 'foreign actor', 'unknown actor', 'foreign target', 'replaced'] as const)(
  'disables execution for %s saved preview while preserving its record',
  (kind) => {
    const original = preview(kind === 'expired' ? 10 : 1);
    const request = {
      ...original,
      ...(kind === 'foreign actor' ? { actorUserId: 'another-moderator' } : {}),
      ...(kind === 'unknown actor' ? { actorUserId: null } : {}),
      ...(kind === 'foreign target' ? { targetUserId: 'another-member' } : {}),
    };
    const value = withPreview(request);
    if (kind === 'replaced') value.requests = [{ ...request, id: 'newer-preview' }, request];
    const html = render(value, { preview: request, execute: null });
    expect(html).toMatch(/disabled=""[^>]*>Attempt account quarantine/);
    expect(html).toContain('Saved preview');
    expect(html).toContain('Refresh quarantine preview');
  }
);
it('requires a confirmed preview refresh after execution rejects the saved binding', () => {
  const request = preview();
  const failed = {
    ...request,
    id: 'execution-1',
    actionType: 'quarantine_compromised_account',
    status: 'failed',
    accountQuarantinePreviewRequestId: request.id,
    accountQuarantinePreview: null,
    lastError: 'Saved preview no longer matches the member or server.',
  } satisfies NonNullable<AccountQuarantineActionRequests['execute']>;
  const html = render(
    { ...withPreview(request), requests: [failed, request] },
    { preview: request, execute: failed }
  );
  expect(html).toMatch(/disabled=""[^>]*>Attempt account quarantine/);
  expect(html).toContain('Saved preview no longer matches the member or server.');
  expect(html).toContain('Refresh quarantine preview');
});
it('keeps the previous saved preview readable while a confirmed refresh is queued', () => {
  const old = preview(10);
  const queued = {
    ...old,
    id: 'refresh-queued',
    status: 'queued',
    accountQuarantinePreview: null,
    completedAt: null,
  } satisfies NonNullable<AccountQuarantineActionRequests['preview']>;
  const html = render(
    { ...withPreview(old), requests: [queued, old] },
    { preview: queued, execute: null }
  );
  expect(html).toContain('Saved preview');
  expect(html).toContain('preview-1');
  expect(html).toMatch(/disabled=""[^>]*>Attempt account quarantine/);
});
