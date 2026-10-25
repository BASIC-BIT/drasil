import {
  createReportRequestSubmission,
  type ReportRequestSubmissionDependencies,
} from './submission';
import { matchesConfirmation } from '../confirmation';
const context = {
  guildId: 'guild',
  requestId: 'request',
  source: 'web_report',
  actor: { kind: 'user' as const, userId: 'reporter' },
};
it('report submission requires authenticated action-bound form evidence', async () => {
  let queued = 0;
  const deps: ReportRequestSubmissionDependencies = {
    access: { load: async () => ({ member: true, active: true, reasonRequired: false }) },
    intakes: { openForReporter: async () => ({ id: 'intake' }) },
    confirmations: {
      verify: async (ctx, command) =>
        matchesConfirmation(ctx, command, {
          guildId: 'guild',
          actorId: 'another-user',
          action: 'close_report_intake',
          targetId: 'intake',
        }),
    },
    queue: {
      enqueue: async () => {
        queued++;
        return 'queued';
      },
    },
  };
  const result = await createReportRequestSubmission(deps).execute(context, {
    kind: 'close_report_intake',
    intakeId: 'intake',
  });
  expect(result).toEqual({ kind: 'denied', code: 'confirmation_required' });
  expect(queued).toBe(0);
});
