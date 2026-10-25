import { validateReportCaseTerminal } from './terminal';
it('accepts only report-open no-effect outcomes with exact actor/report binding', () => {
  const context = {
    workflowId: 'open_submitted_report_case' as const,
    guildId: 'guild',
    userId: 'actor',
    command: { kind: 'open_submitted_report_case' as const, reportId: 'report' },
  };
  const outcome = {
    actor: { id: 'actor', surface: 'mcp' },
    action: 'open_case' as const,
    reportId: 'report',
    status: 'busy' as const,
    caseId: null,
    detectionEventId: null,
    targetUserId: null,
    queueCleanupStatus: 'skipped' as const,
  };
  expect(() => validateReportCaseTerminal(context, outcome)).not.toThrow();
  expect(() => validateReportCaseTerminal(context, { ...outcome, status: 'opened' })).toThrow();
  expect(() => validateReportCaseTerminal({ ...context, userId: 'other' }, outcome)).toThrow();
  expect(() =>
    validateReportCaseTerminal({ ...context, workflowId: 'submit_user_report' }, outcome)
  ).toThrow();
});

import { projectHumanOutcome } from '../delegation/execution';
it('keeps failed intake creation failed and strips nonopaque preparation secrets', () => {
  expect(
    projectHumanOutcome(
      { kind: 'start_report_intake', channelId: 'channel' },
      { status: 'activation_failed' }
    )
  ).toMatchObject({ state: 'failed' });
  expect(
    JSON.stringify(
      projectHumanOutcome(
        { kind: 'prepare_report_ban_review', operationId: 'operation' },
        {
          reviewReference: 'PRIVATE-TOKEN',
          expiresAt: 'not-an-expiry',
          attemptToken: 'PRIVATE-TOKEN',
          updatedAt: 'private-date',
        }
      )
    )
  ).not.toContain('PRIVATE');
});
