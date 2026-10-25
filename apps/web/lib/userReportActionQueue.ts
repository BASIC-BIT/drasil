import {
  type QueuedReportCommand,
  createReportRequestSubmission,
  type ActionContext,
  type ConfirmationPort,
  type ReportAdmissionFacts,
} from '@drasil/application';
import { isWebE2eFixtureMode } from './e2eFixtures';
import type { ModerationActionRequestQueueStatus } from './moderationActionRequestQueue';
import { submitQueuedAction } from './application/queuedSubmission';
import { getPostgresPool } from './setupDataAdapter';

async function ensureReportTargetUser(input: {
  readonly actorId: string;
  readonly targetUserId: string;
}): Promise<void> {
  await getPostgresPool().query(
    `insert into users (discord_id, created_by, updated_by, metadata)
     values ($1, $2, $2, $3::jsonb)
     on conflict (discord_id) do nothing`,
    [
      input.targetUserId,
      input.actorId,
      JSON.stringify({
        source: 'web_report',
      }),
    ]
  );
}

export async function submitReportRequest(input: {
  readonly context: ActionContext;
  readonly command: QueuedReportCommand;
  readonly access: ReportAdmissionFacts;
  readonly confirmations: ConfirmationPort;
  readonly openIntake: () => Promise<{ readonly id: string } | null>;
}): Promise<ModerationActionRequestQueueStatus> {
  const actions = createReportRequestSubmission({
    access: { load: async () => input.access },
    intakes: { openForReporter: input.openIntake },
    confirmations: input.confirmations,
    queue: {
      async enqueue(context, command) {
        if (context.actor.kind !== 'user') throw new Error('Reporter session is unavailable.');
        if (isWebE2eFixtureMode()) return 'queued';
        if (command.kind === 'submit_user_report') {
          await ensureReportTargetUser({
            actorId: context.actor.userId,
            targetUserId: command.targetUserId,
          });
        }
        return (await submitQueuedAction({ context, command })).status;
      },
    },
  });
  const result = await actions.execute(input.context, input.command);
  if (result.kind === 'outcome') return result.outcome.status;
  const errors = {
    actor_unavailable: 'This report destination is not available to the signed-in Discord account.',
    permission_denied: 'You cannot report yourself.',
    reason_required: 'This server requires a report reason.',
    stale_state: 'This report intake is no longer available.',
    confirmation_required:
      input.command.kind === 'close_report_intake'
        ? 'Confirm the report intake close before submitting it.'
        : 'Confirm the report before submitting it.',
    binding_mismatch: 'This report does not match the signed-in account.',
    policy_disabled: 'Reporting is unavailable.',
  };
  throw new Error(errors[result.code]);
}
