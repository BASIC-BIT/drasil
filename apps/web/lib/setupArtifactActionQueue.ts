import { queuedSetupCommandSchema, type ActionContext } from '@drasil/application';
import { submitQueuedAction, submitSerializedSetupAction } from './application/queuedSubmission';
import type { ModerationActionRequestReceipt } from './moderationActionRequestQueue';

export async function queueReportInstructionsRepairRequest(input: {
  readonly context: ActionContext;
  readonly channelId: string;
  readonly repost?: boolean;
  readonly expectedMessageId?: string | null;
  readonly expectedChannelId?: string | null;
  readonly submissionId?: string;
}): Promise<ModerationActionRequestReceipt> {
  return submitQueuedAction({
    context: input.context,
    command: queuedSetupCommandSchema.parse({
      kind: 'upsert_report_instructions',
      channelId: input.channelId,
      repost: input.repost === true,
      ...(input.repost
        ? {
            expectedMessageId: input.expectedMessageId ?? null,
            expectedChannelId: input.expectedChannelId ?? null,
            submissionId: input.submissionId ?? input.context.requestId,
          }
        : {}),
    }),
  });
}

export async function queueCompleteSetupVerificationRequestWithReceipt(input: {
  readonly context: ActionContext;
  readonly adminChannelId: string;
  readonly caseRoleId?: string | null;
  readonly caseRoleName?: string | null;
  readonly detectionResponseMode?: 'off' | 'record_only' | 'notify_only' | 'restrict';
  readonly reportInstructionsChannelId?: string | null;
  readonly verificationChannelId?: string | null;
  readonly submissionId?: string;
  readonly onboardingWizard?: boolean;
}): Promise<ModerationActionRequestReceipt> {
  return submitSerializedSetupAction({
    context: input.context,
    command: {
      kind: 'complete_setup_verification',
      mode: 'provision',
      adminChannelId: input.adminChannelId,
      caseRoleId: input.caseRoleId,
      caseRoleName: input.caseRoleName,
      detectionResponseMode: input.detectionResponseMode,
      reportInstructionsChannelId: input.reportInstructionsChannelId,
      verificationChannelId: input.verificationChannelId,
      submissionId: input.submissionId,
      onboardingWizard: input.onboardingWizard === true,
    },
  });
}
