import {
  encodeQueuedAction,
  type QueuedReportCommand,
  createReportRequestSubmission,
  type ActionContext,
  type ConfirmationPort,
  type ReportAdmissionFacts,
} from '@drasil/application';
import { randomUUID } from 'node:crypto';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';
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

export async function queueUserReportSubmissionRequest(input: {
  readonly actorId: string;
  readonly guildId: string;
  readonly reason?: string | null;
  readonly targetLabel: string;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  await ensureReportTargetUser({
    actorId: input.actorId,
    targetUserId: input.targetUserId,
  });

  return queueReportRequest(input, {
    kind: 'submit_user_report',
    targetUserId: input.targetUserId,
    targetLabel: input.targetLabel,
    reason: input.reason ?? null,
  });
}

export async function queueGuidedReportIntakeRequest(input: {
  readonly actorId: string;
  readonly channelId: string;
  readonly guildId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueReportRequest(input, { kind: 'start_report_intake', channelId: input.channelId });
}

export async function queueReportIntakeCloseRequest(input: {
  readonly actorId: string;
  readonly guildId: string;
  readonly reportIntakeId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueReportRequest(input, { kind: 'close_report_intake', intakeId: input.reportIntakeId });
}

function queueReportRequest(
  input: { actorId: string; guildId: string },
  command: QueuedReportCommand
): Promise<ModerationActionRequestQueueStatus> {
  return queueModerationActionRequest(
    encodeQueuedAction(
      {
        guildId: input.guildId,
        requestId: randomUUID(),
        source: 'web_report',
        actor: { kind: 'user', userId: input.actorId },
      },
      command
    )
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
        const identity = { guildId: context.guildId, actorId: context.actor.userId };
        switch (command.kind) {
          case 'submit_user_report':
            return queueUserReportSubmissionRequest({ ...identity, ...command });
          case 'start_report_intake':
            return queueGuidedReportIntakeRequest({ ...identity, channelId: command.channelId });
          case 'close_report_intake':
            return queueReportIntakeCloseRequest({ ...identity, reportIntakeId: command.intakeId });
        }
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
