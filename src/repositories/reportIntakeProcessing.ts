import {
  reportAnalysisMetadataSchema,
  reportAnalysisOutcomeSchema,
  reportSourceVersionSchema,
  type ReportAnalysisMetadata,
  type ReportAnalysisOutcome,
} from '@drasil/application';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  ReportIntakeStatus,
  type ReportAnalysisClaim,
  type ReportEvidenceBatch,
  type ReportIntake,
} from './types';
import { getReportIntakeSettings, type ReportIntakeSettings } from '../utils/reportIntakeSettings';

export const ANALYSIS_CLAIM_SCAN_LIMIT = 10;
export const ANALYSIS_DEADLINE_MS = 45_000;
export const CONFIRMATION_TIMEOUT_MS = 10 * 60_000;
const MAX_BATCH_DELAY_MS = 30_000;
const MAX_MODEL_ATTEMPTS = 2;
export const OPEN_ANALYSIS_STATUSES = [
  ReportIntakeStatus.COLLECTING_EVIDENCE,
  ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
  ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
];

export function processingMetadata(intake: ReportIntake): {
  metadata: Record<string, unknown>;
  analysis: ReportAnalysisMetadata;
} {
  const metadata = z.record(z.string(), z.unknown()).parse(intake.metadata ?? {});
  const analysis =
    metadata.analysis === undefined
      ? reportAnalysisMetadataSchema.parse({
          schemaVersion: 1,
          sources: {},
          outcome: null,
          coverage: null,
          requestReservations: [],
          handoff: { state: 'none' },
        })
      : reportAnalysisMetadataSchema.parse(metadata.analysis);
  return { metadata, analysis };
}

export function evidenceBatchChange(
  intake: ReportIntake,
  input: ReportEvidenceBatch,
  settings: ReportIntakeSettings = getReportIntakeSettings()
): {
  result: 'recorded' | 'duplicate' | 'stale' | 'closed';
  change?: Partial<ReportIntake>;
  appendEvidence?: boolean;
} {
  if (
    intake.closed_at ||
    intake.status === ReportIntakeStatus.CLOSED_BY_REPORTER ||
    intake.status === ReportIntakeStatus.EXPIRED
  )
    return { result: 'closed' };
  const { metadata, analysis } = processingMetadata(intake);
  const source = reportSourceVersionSchema.parse({
    ...input,
    availabilityFailureToken: input.availability === 'unavailable' ? randomUUID() : null,
    observedAt: input.observedAt.toISOString(),
    editedAt: input.editedAt?.toISOString() ?? null,
  });
  const previous = Object.prototype.hasOwnProperty.call(analysis.sources, input.sourceMessageId)
    ? analysis.sources[input.sourceMessageId]
    : undefined;
  if (previous) {
    if (previous.operation === 'delete')
      return { result: source.operation === 'delete' ? 'duplicate' : 'stale' };
    // Only a fetch begun from the latest failure observation may recover unavailable evidence.
    if (
      source.operation === 'upsert' &&
      source.availability === 'available' &&
      previous.availability === 'unavailable' &&
      (!input.recoveryToken || input.recoveryToken !== previous.availabilityFailureToken)
    )
      return { result: 'stale' };
    if (
      previous.sourceVersion === source.sourceVersion &&
      previous.sourceFingerprint === source.sourceFingerprint &&
      previous.operation === source.operation &&
      previous.availability === source.availability
    ) {
      if (source.availability === 'unavailable') {
        analysis.sources = { ...analysis.sources, [input.sourceMessageId]: source };
        return {
          result: 'duplicate',
          change: {
            metadata: { ...metadata, analysis } as ReportIntake['metadata'],
            updated_at: input.observedAt,
          },
          appendEvidence: false,
        };
      }
      return { result: 'duplicate' };
    }
    if (
      source.operation === 'upsert' &&
      (previous.sourceVersion > source.sourceVersion ||
        (previous.sourceVersion === source.sourceVersion &&
          previous.sourceFingerprint !== source.sourceFingerprint))
    )
      return { result: 'stale' };
    // Discord message IDs cannot be recreated; an observed deletion outranks clock ordering.
    if (source.operation === 'delete') {
      source.sourceVersion = Math.max(previous.sourceVersion, source.sourceVersion);
      source.sourceAuthorId = previous.sourceAuthorId;
    }
  }
  analysis.sources = { ...analysis.sources, [input.sourceMessageId]: source };
  // An unseen deletion establishes ordering only, not eligible evidence or a new investigation.
  if (!previous && source.operation === 'delete')
    return {
      result: 'recorded',
      change: {
        metadata: { ...metadata, analysis } as ReportIntake['metadata'],
        updated_at: input.observedAt,
      },
      appendEvidence: false,
    };
  const change: Partial<ReportIntake> = {
    evidence_revision: intake.evidence_revision + 1,
    metadata: { ...metadata, analysis } as ReportIntake['metadata'],
    updated_at: input.observedAt,
  };
  if (canAnalyze(intake)) {
    const batchingStartedAt =
      typeof analysis.batchingStartedAt === 'string'
        ? new Date(analysis.batchingStartedAt).getTime()
        : input.observedAt.getTime();
    if (!Number.isFinite(batchingStartedAt)) throw new Error('Invalid batching start timestamp');
    const due = Math.max(
      Math.min(
        input.observedAt.getTime() + settings.debounceMs,
        batchingStartedAt + MAX_BATCH_DELAY_MS
      ),
      intake.analysis_started_at
        ? intake.analysis_started_at.getTime() + settings.minAnalysisIntervalMs
        : 0
    );
    analysis.batchingStartedAt = new Date(batchingStartedAt).toISOString();
    analysis.outcome = null;
    analysis.coverage = null;
    analysis.requestReservations = [];
    // Retire authorization immediately; Discord presentation is reconciled by the worker.
    delete metadata.last_confirmation_prompt_token;
    delete metadata.last_confirmation_prompt_message_id;
    delete metadata.confirmation_prompt_candidate_ids_by_token;
    change.metadata = { ...metadata, analysis } as ReportIntake['metadata'];
    Object.assign(change, {
      analysis_due_at: new Date(due),
      analysis_deadline_at: null,
      analysis_attempts: 0,
      analysis_lease_until: null,
      analysis_lease_token: null,
      status:
        intake.status === ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
          ? ReportIntakeStatus.COLLECTING_EVIDENCE
          : intake.status,
    });
  }
  return {
    result: 'recorded',
    change,
    appendEvidence:
      source.availability === 'available' &&
      (!previous ||
        previous.sourceVersion !== source.sourceVersion ||
        previous.sourceFingerprint !== source.sourceFingerprint),
  };
}

export function canAnalyze(intake: ReportIntake): boolean {
  return (
    OPEN_ANALYSIS_STATUSES.includes(intake.status) &&
    intake.analysis_failure_code === null &&
    intake.closed_at === null &&
    intake.confirmed_target_user_id === null
  );
}
export function analysisClaimChange(
  intake: ReportIntake,
  now: Date,
  leaseMs: number
): { claim: ReportAnalysisClaim | null; change: Partial<ReportIntake> } | null {
  if (
    !canAnalyze(intake) ||
    !intake.analysis_due_at ||
    intake.analysis_due_at > now ||
    (intake.analysis_lease_until && intake.analysis_lease_until > now)
  )
    return null;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('Analysis lease must be positive');
  let parsed: ReturnType<typeof processingMetadata>;
  try {
    parsed = processingMetadata(intake);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    // Keep malformed metadata verbatim so operators can diagnose and explicitly repair it.
    return {
      claim: null,
      change: {
        analysis_failure_code: 'invalid_metadata',
        status: ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
        analysis_due_at: null,
        analysis_lease_token: null,
        analysis_lease_until: null,
        updated_at: now,
      },
    };
  }
  const { metadata, analysis } = parsed;
  const kind =
    intake.status === ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION &&
    intake.analysis_revision === intake.evidence_revision &&
    analysis.outcome?.kind === 'confirm'
      ? 'confirmation_timeout'
      : 'analyze';
  if (kind === 'analyze' && intake.evidence_revision <= intake.analysis_revision) return null;
  const leaseToken = randomUUID();
  const deadline =
    kind === 'confirmation_timeout'
      ? intake.analysis_due_at
      : (intake.analysis_deadline_at ?? new Date(now.getTime() + ANALYSIS_DEADLINE_MS));
  delete analysis.batchingStartedAt;
  const change: Partial<ReportIntake> = {
    analysis_lease_token: leaseToken,
    analysis_lease_until: new Date(now.getTime() + leaseMs),
    analysis_deadline_at: kind === 'analyze' ? deadline : intake.analysis_deadline_at,
    analysis_started_at:
      kind === 'analyze' && !intake.analysis_deadline_at ? now : intake.analysis_started_at,
    metadata: { ...metadata, analysis } as ReportIntake['metadata'],
    updated_at: now,
  };
  return {
    change,
    claim: {
      kind,
      intake: { ...intake, ...change },
      revision: intake.evidence_revision,
      leaseToken,
      deadline,
      attempts: intake.analysis_attempts,
    },
  };
}
export function ownsAnalysis(intake: ReportIntake, claim: ReportAnalysisClaim, now: Date): boolean {
  return (
    canAnalyze(intake) &&
    intake.evidence_revision === claim.revision &&
    intake.analysis_lease_token === claim.leaseToken &&
    !!intake.analysis_lease_until &&
    intake.analysis_lease_until > now
  );
}
export function reserveAnalysisChange(
  intake: ReportIntake,
  claim: ReportAnalysisClaim,
  now: Date
): Partial<ReportIntake> | null {
  if (
    !ownsAnalysis(intake, claim, now) ||
    claim.kind !== 'analyze' ||
    intake.analysis_attempts >= MAX_MODEL_ATTEMPTS ||
    !intake.analysis_deadline_at ||
    now >= intake.analysis_deadline_at
  )
    return null;
  const { metadata, analysis } = processingMetadata(intake);
  analysis.requestReservations.push({
    revision: claim.revision,
    leaseToken: claim.leaseToken,
    reservedAt: now.toISOString(),
  });
  return {
    analysis_attempts: intake.analysis_attempts + 1,
    metadata: { ...metadata, analysis } as ReportIntake['metadata'],
    updated_at: now,
  };
}
export function completeAnalysisChange(
  intake: ReportIntake,
  claim: ReportAnalysisClaim,
  input: ReportAnalysisOutcome,
  now: Date
): Partial<ReportIntake> | null {
  if (!ownsAnalysis(intake, claim, now)) return null;
  let outcome = reportAnalysisOutcomeSchema.parse(input);
  if (
    outcome.kind === 'confirm' &&
    claim.kind === 'analyze' &&
    (!intake.analysis_deadline_at || now >= intake.analysis_deadline_at)
  )
    return null;

  const { metadata, analysis } = processingMetadata(intake);
  const alreadyHandedOff =
    intake.status === ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION ||
    analysis.handoff.state !== 'none';
  if (outcome.kind === 'confirm' && alreadyHandedOff) return null;
  if (claim.kind === 'confirmation_timeout')
    outcome = {
      kind: 'admin_review',
      reason: 'confirmation_timeout',
      candidates: analysis.outcome?.kind === 'confirm' ? [analysis.outcome.candidate] : [],
      coverage: outcome.coverage,
      includedEvidenceIds: outcome.includedEvidenceIds,
      excludedEvidenceIds: outcome.excludedEvidenceIds,
    };
  analysis.outcome = outcome;
  analysis.coverage = outcome.coverage;
  if (outcome.kind === 'admin_review' && analysis.handoff.state === 'none')
    analysis.handoff = {
      state: 'pending',
      reason: outcome.reason,
      attempts: 0,
      nextDueAt: now.toISOString(),
      receipt: 'pending',
    };
  return {
    analysis_revision: claim.revision,
    analysis_due_at:
      outcome.kind === 'confirm' ? new Date(now.getTime() + CONFIRMATION_TIMEOUT_MS) : null,
    analysis_lease_token: null,
    analysis_lease_until: null,
    status:
      outcome.kind === 'confirm'
        ? ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION
        : ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
    metadata: { ...metadata, analysis } as ReportIntake['metadata'],
    updated_at: now,
  };
}
