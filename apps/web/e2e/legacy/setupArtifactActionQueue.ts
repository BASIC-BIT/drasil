// Explicit legacy test-build boundary. Never imported by the release build.
import type { ModerationActionRequestReceipt } from '@/lib/moderationActionRequestQueue';
import { type ActionContext } from '@drasil/application';
export * from '../../lib/setupArtifactActionQueue';

export async function queueReportInstructionsRepairRequest(input: {
  readonly context: ActionContext;
  readonly channelId: string;
  readonly repost?: boolean;
  readonly expectedMessageId?: string | null;
  readonly expectedChannelId?: string | null;
  readonly submissionId?: string;
}): Promise<ModerationActionRequestReceipt> {
  return { id: `fixture-report-instructions-${input.channelId}`, status: 'queued' };
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
  return { id: input.submissionId ?? 'fixture-setup-request', status: 'queued' };
}
