import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { CaptchaChallengeSummary } from '@drasil/contracts';
import { fixtureCaseDetails } from '@/lib/caseFixtures';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import type { WorkspaceMutation } from '@/lib/workspaceActionTypes';
import { BrowserSecurityPanel } from './BrowserSecurityPanel';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
export const challenge: CaptchaChallengeSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  method: 'turnstile',
  methodRevision: 2,
  generation: 2,
  status: 'pending',
  requestSource: 'moderator',
  passEffect: 'evidence_only',
  requestedAt: '2026-10-25T11:00:00Z',
  deliveredAt: '2026-10-25T11:01:00Z',
  deliveryErrorCode: null,
  expiresAt: '2026-10-25T12:00:00Z',
  submissionCount: 3,
  passedAt: null,
  bypassedAt: null,
  bypassedBy: null,
  bypassReason: null,
};
const policy: CaseWorkspaceData['policy'] = {
  allowedActions: ['challenge_user', 'retry_captcha', 'bypass_captcha'],
  canQueueCaseActions: true,
  canOpenReportCases: false,
  canManageCleanup: false,
  kickReasonRequired: true,
  banReasonRequired: true,
};
const submit: WorkspaceMutation = async () => ({ kind: 'failed', message: 'unused' });
function render(
  captchaChallenge: CaptchaChallengeSummary | null,
  overrides: Partial<CaseWorkspaceData['detail']> = {},
  allowed = policy
) {
  return renderToStaticMarkup(
    createElement(BrowserSecurityPanel, {
      detail: {
        ...fixtureCaseDetails[0],
        caseKind: 'standard',
        status: 'pending',
        presenceState: 'in_server',
        allowedActions: ['challenge_user', 'retry_captcha', 'bypass_captcha'],
        captchaChallenge,
        ...overrides,
      },
      configuration: { method: 'turnstile', methodRevision: 2 },
      policy: allowed,
      submissions: { issue: submit, retry: submit, bypass: submit },
      requests: [],
      loadedAt: '2026-10-25T12:00:00Z',
      returnHref: '/admin/guild/guild-1/inbox',
    })
  );
}
it('offers issue only before a check exists and never for a compromised account', () => {
  expect(render(null)).toContain('Request security check');
  expect(render(null, { caseKind: 'compromised_account' })).not.toContain('Request security check');
  expect(render(challenge)).not.toContain('Request security check');
});
it.each([
  ['pending', null, false, true],
  ['pending', 'cannot_dm_user', true, true],
  ['failed', null, true, true],
  ['expired', null, true, true],
  ['bypassed', null, true, false],
  ['cancelled', null, true, false],
  ['passed', null, false, false],
] as const)(
  'shows truthful status/actions for %s delivery %s',
  (status, deliveryErrorCode, retry, bypass) => {
    const html = render({
      ...challenge,
      status,
      deliveryErrorCode,
      deliveredAt: deliveryErrorCode ? null : challenge.deliveredAt,
    });
    expect(html.includes('Retry security check')).toBe(retry);
    expect(html.includes('Continue without security check')).toBe(bypass);
    expect(html).toContain('Generation 2');
    expect(html).toContain('Method revision 2');
    expect(html).toContain('Submissions');
    if (deliveryErrorCode) {
      expect(html).toContain('cannot_dm_user');
      expect(html).not.toContain('2026-10-25T11:01:00Z');
    }
  }
);
it('leaves evidence-only and automatic passes in their actual pending case state', () => {
  for (const passEffect of ['evidence_only', 'verify_join_only'] as const) {
    const html = render({
      ...challenge,
      status: 'passed',
      passEffect,
      passedAt: '2026-10-25T11:02:00Z',
      requestSource: passEffect === 'verify_join_only' ? 'automatic_suspicious_join' : 'moderator',
    });
    expect(html).toContain('Case open');
    expect(html).not.toContain('Case resolved');
    expect(html).toContain(
      passEffect === 'evidence_only' ? 'Evidence only' : 'Automatic suspicious-join check'
    );
  }
});
it('shows bypass provenance and complete generation history', () => {
  const html = render({
    ...challenge,
    method: 'discord_image',
    status: 'bypassed',
    bypassedBy: 'mod-9',
    bypassedAt: '2026-10-25T11:05:00Z',
    bypassReason: 'Reviewed the member directly',
    history: [
      {
        ...challenge,
        caseRevisionAtIssue: 1,
        requestedBy: 'mod-8',
        presentedAt: null,
        outcome: 'failed',
        outcomeAt: '2026-10-25T11:03:00Z',
      },
    ],
  });
  expect(html).toContain('Discord image CAPTCHA');
  expect(html).toContain('mod-9');
  expect(html).toContain('Reviewed the member directly');
  expect(html).toContain('mod-8');
  expect(html).toContain('Generation history');
});
it('leaves bypass available for an absent member without retry and respects actor policy', () => {
  const html = render({ ...challenge, status: 'failed' }, { presenceState: 'left_or_removed' });
  expect(html).toContain('Continue without security check');
  expect(html).not.toContain('Retry security check');
  expect(render(null, {}, { ...policy, canQueueCaseActions: false })).not.toContain(
    'Request security check'
  );
});
