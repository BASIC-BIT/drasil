import { z } from 'zod';
import { reportAnalysisMetadataSchema, type ReportAnalysisMetadata } from './analysis';
import type { ReportIntakeState } from './ports';

export const reportSubmissionProgressSchema = z
  .object({
    token: z.string().min(1),
    targetUserId: z.string().min(1),
    state: z.enum(['not_dispatched', 'dispatching', 'unknown', 'accepted']),
    claimedAt: z.iso.datetime(),
    dispatchedAt: z.iso.datetime().optional(),
    settledAt: z.iso.datetime().optional(),
  })
  .refine((value) => value.state === 'not_dispatched' || Boolean(value.dispatchedAt))
  .refine(
    (value) => (value.state !== 'unknown' && value.state !== 'accepted') || Boolean(value.settledAt)
  );
export type ReportSubmissionProgress = z.infer<typeof reportSubmissionProgressSchema>;

export interface ReportIntakeSnapshot {
  id: string;
  server_id: string;
  reporter_id: string;
  thread_id: string | null;
  status: string;
  confirmed_target_user_id: string | null;
  evidence_revision: number;
  metadata: unknown;
}

export function projectReportIntakeState(intake: ReportIntakeSnapshot): ReportIntakeState {
  const root = z.record(z.string(), z.unknown()).safeParse(intake.metadata);
  const metadata = root.success ? root.data : {};
  const parsed = reportAnalysisMetadataSchema.safeParse(metadata.analysis);
  const analysis = parsed.success ? parsed.data : null;
  const submission = reportSubmissionProgressSchema.safeParse(metadata.submission);
  const confirmation = confirmationState(metadata, analysis, intake.status);
  return {
    id: intake.id,
    guildId: intake.server_id,
    reporterId: intake.reporter_id,
    threadId: intake.thread_id,
    status: intake.status,
    confirmedTargetUserId: intake.confirmed_target_user_id,
    submission:
      submission.success && submission.data.targetUserId === intake.confirmed_target_user_id
        ? submission.data
        : null,
    promptMessageId: confirmation.promptMessageId,
    promptToken: confirmation.promptToken,
    candidateIds: confirmation.candidateIds,
    claimed:
      typeof metadata.report_ban_operation_id === 'string' &&
      metadata.report_ban_operation_id.length > 0,
    evidenceRevision: intake.evidence_revision,
    presentationRevision: confirmation.presentationRevision,
    staged:
      metadata.workflow === 'staged' ||
      metadata.analysis !== undefined ||
      intake.evidence_revision > 0 ||
      metadata.last_confirmation_prompt_revision !== undefined,
  };
}

type ConfirmationState = Pick<
  ReportIntakeState,
  'promptMessageId' | 'promptToken' | 'candidateIds' | 'presentationRevision'
>;
function confirmationState(
  metadata: Record<string, unknown>,
  analysis: ReportAnalysisMetadata | null,
  status: string
): ConfirmationState {
  const admin = status === 'needs_admin_confirmation';
  const handoff = analysis?.handoff;
  const adminPrompt =
    admin &&
    handoff &&
    handoff.state !== 'none' &&
    handoff.state !== 'pending' &&
    handoff.state !== 'resolved' &&
    typeof handoff.messageId === 'string' &&
    handoff.messageId === metadata.admin_review_prompt_message_id;
  const promptId = admin
    ? adminPrompt
      ? handoff.messageId
      : null
    : metadata.last_confirmation_prompt_message_id;
  const boundRevision = admin
    ? metadata.admin_review_prompt_revision
    : metadata.last_confirmation_prompt_revision;
  const outcome = analysis?.outcome;
  const candidateIds = admin
    ? outcome?.kind === 'admin_review'
      ? outcome.candidates.map((candidate) => candidate.discordUserId)
      : []
    : metadata.last_confirmation_prompt_candidate_ids;
  return {
    promptMessageId: typeof promptId === 'string' ? promptId : null,
    promptToken: admin
      ? typeof promptId === 'string'
        ? promptId
        : null
      : typeof metadata.last_confirmation_prompt_token === 'string'
        ? metadata.last_confirmation_prompt_token
        : null,
    candidateIds: Array.isArray(candidateIds)
      ? candidateIds.filter((id): id is string => typeof id === 'string')
      : [],
    presentationRevision:
      typeof boundRevision === 'number' &&
      Number.isSafeInteger(boundRevision) &&
      boundRevision >= 0 &&
      (metadata.analysis === undefined || analysis !== null) &&
      (!admin || adminPrompt)
        ? boundRevision
        : null,
  };
}
