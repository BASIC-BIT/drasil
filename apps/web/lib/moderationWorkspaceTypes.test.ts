import { expect, it } from 'vitest';
import { workspaceItemDetailSchema } from './moderationWorkspaceTypes';
import { fixtureCaseDetails } from './caseFixtures';
import { fixtureReportDetail } from './reportFixtures';
import { fixtureModerationInboxItems } from './inboxFixtures';
const policy = {
  allowedActions: [],
  canQueueCaseActions: false,
  canOpenReportCases: false,
  canManageCleanup: false,
  kickReasonRequired: false,
  banReasonRequired: false,
};
const baseItem = fixtureModerationInboxItems()[0];
const report = fixtureReportDetail('report-1');
const reply = { kind: 'unavailable', sourceUrl: null };
it.each([
  {
    kind: 'case',
    data: {
      detail: fixtureCaseDetails[0],
      report: null,
      membership: null,
      requests: [],
      cleanup: null,
      policy,
      loadedAt: '2026-10-25T00:00:00.000Z',
    },
  },
  { kind: 'submitted_report', report, requests: [] },
  {
    kind: 'observed_alert',
    detection: {
      id: 'det',
      detectionType: 'suspicious_content',
      confidence: 0.8,
      detectedAt: '2026-10-21T14:40:00.000Z',
      reasons: ['complete source text'],
      latestCaseId: null,
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
      sourceChannelId: null,
      sourceMessageId: null,
      sourceMessageUrl: null,
    },
    requests: [],
  },
  { kind: 'report_attention', intake: { ...report, status: 'collecting_evidence' }, reply },
  { kind: 'support_attention', subtype: 'quarantine_breach', caseData: null, reply },
  {
    kind: 'pending_screening',
    screening: { pendingSince: null, thresholdDays: null, lastCheckedAt: null },
  },
])('validates the $kind payload and rejects a missing payload', (branch) => {
  const input = { ...branch, item: { ...baseItem, kind: branch.kind }, policy };
  expect(workspaceItemDetailSchema.safeParse(input).success).toBe(true);
  expect(
    workspaceItemDetailSchema.safeParse({ kind: branch.kind, item: input.item, policy }).success
  ).toBe(false);
});
it('requires a message when a reply is available', () => {
  expect(
    workspaceItemDetailSchema.safeParse({
      kind: 'support_attention',
      item: { ...baseItem, kind: 'support_attention' },
      policy,
      subtype: 'support_reply',
      caseData: null,
      reply: { kind: 'available' },
    }).success
  ).toBe(false);
});
