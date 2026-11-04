import { getReportIntakeSettings } from '../utils/reportIntakeSettings';
import type { ReportAnalysisOutcome } from '@drasil/application';
import {
  analysisClaimChange,
  presentationClaimChange,
  completePresentationChange,
  ANALYSIS_CLAIM_SCAN_LIMIT,
  OPEN_ANALYSIS_STATUSES as OPEN_INTAKE_STATUSES,
  completeAnalysisChange,
  evidenceBatchChange,
  ownsAnalysis,
  reserveAnalysisChange,
} from './reportIntakeProcessing';
import { injectable, inject } from 'inversify';
import {
  Prisma,
  PrismaClient,
  report_intake_evidence_kind,
  report_intake_status,
} from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  ReportIntake,
  ServerSettings,
  ReportEvidenceBatch,
  ReportAnalysisClaim,
  ReportPresentationClaim,
  ReportPresentationResult,
  ReportIntakeCreate,
  ReportIntakeEvidence,
  ReportIntakeEvidenceCreate,
  ReportIntakeStatus,
  ReportIntakeUpdate,
} from './types';

export interface ReportBanClaim {
  reportId: string;
  serverId: string;
  targetUserId: string;
  detectionEventId: string;
  operationId: string;
  attemptToken?: string;
}
export interface IReportIntakeRepository {
  claimPendingPresentation(now: Date, intakeId?: string): Promise<ReportPresentationClaim | null>;
  completePresentation(
    claim: ReportPresentationClaim,
    result: ReportPresentationResult
  ): Promise<boolean>;
  recordEvidenceBatch(
    input: ReportEvidenceBatch
  ): Promise<'recorded' | 'duplicate' | 'stale' | 'closed'>;
  claimAnalysis(now: Date, leaseMs: number): Promise<ReportAnalysisClaim | null>;
  reserveModelAttempt(claim: ReportAnalysisClaim, now: Date): Promise<boolean>;
  renewAnalysisLease(claim: ReportAnalysisClaim, now: Date, leaseMs: number): Promise<boolean>;
  completeAnalysis(
    claim: ReportAnalysisClaim,
    outcome: ReportAnalysisOutcome,
    now: Date
  ): Promise<boolean>;
  claimBan(input: ReportBanClaim): Promise<ReportIntake | null>;
  updateBan(
    reportId: string,
    operationId: string,
    input: { release?: boolean; complete?: boolean; metadata?: Record<string, unknown> }
  ): Promise<ReportIntake | null>;
  create(data: ReportIntakeCreate): Promise<ReportIntake>;
  findById(id: string): Promise<ReportIntake | null>;
  findByThreadId(threadId: string): Promise<ReportIntake | null>;
  findOpenByThreadId(threadId: string): Promise<ReportIntake | null>;
  findOpenByReporterAndServer(serverId: string, reporterId: string): Promise<ReportIntake | null>;
  confirmTargetIfUnset(
    id: string,
    data: {
      targetUserId: string;
      expectedMetadata: ReportIntake['metadata'];
      expectedEvidenceRevision?: number;
      expectedStatus?: ReportIntakeStatus;
      metadata: Record<string, unknown>;
    }
  ): Promise<ReportIntake | null>;
  update(id: string, data: ReportIntakeUpdate): Promise<ReportIntake | null>;
  updateIfCurrent(intake: ReportIntake, data: ReportIntakeUpdate): Promise<ReportIntake | null>;
  addEvidence(data: ReportIntakeEvidenceCreate): Promise<ReportIntakeEvidence>;
  listEvidence(intakeId: string): Promise<ReportIntakeEvidence[]>;
}

@injectable()
export class ReportIntakeRepository implements IReportIntakeRepository {
  // Fairness only; eligibility and ownership are rechecked under the report lock.
  private quarantinePresentationAfter: string | null = null;
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  private async lockedIntake(
    transaction: Prisma.TransactionClient,
    id: string
  ): Promise<ReportIntake | null> {
    const rows = await transaction.$queryRaw<
      ReportIntake[]
    >`SELECT * FROM report_intakes WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  private async writeProcessing(
    transaction: Prisma.TransactionClient,
    intake: ReportIntake,
    change: Partial<ReportIntake>
  ): Promise<void> {
    await transaction.report_intakes.update({
      where: { id: intake.id },
      data: {
        ...change,
        status: change.status as report_intake_status | undefined,
        metadata: change.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async recordEvidenceBatch(
    input: ReportEvidenceBatch
  ): Promise<'recorded' | 'duplicate' | 'stale' | 'closed'> {
    return this.prisma.$transaction(async (transaction) => {
      const intake = await this.lockedIntake(transaction, input.intakeId);
      if (!intake) return 'closed';
      const server = await transaction.servers.findUnique({
        where: { guild_id: intake.server_id },
        select: { settings: true },
      });
      const settings = getReportIntakeSettings((server?.settings ?? {}) as ServerSettings);
      const result = evidenceBatchChange(intake, input, settings);
      if (!result.change) return result.result;
      if (input.operation === 'upsert' && result.appendEvidence && input.evidence.length)
        await transaction.report_intake_evidence.createMany({
          data: input.evidence.map((evidence) => ({
            intake_id: intake.id,
            kind: evidence.kind as report_intake_evidence_kind,
            source_message_id: input.sourceMessageId,
            source_channel_id: input.sourceChannelId,
            attachment_id: evidence.attachmentId,
            content: evidence.content,
            metadata: {
              ...evidence.metadata,
              sourceVersion: input.sourceVersion,
              sourceFingerprint: input.sourceFingerprint,
              sourceAuthorId: input.sourceAuthorId,
            } as Prisma.InputJsonValue,
          })),
        });
      await this.writeProcessing(transaction, intake, result.change);
      return result.result;
    });
  }

  async claimAnalysis(now: Date, leaseMs: number): Promise<ReportAnalysisClaim | null> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ReportIntake[]>`
        SELECT * FROM report_intakes
        WHERE analysis_due_at <= ${now} AND (analysis_lease_until IS NULL OR analysis_lease_until <= ${now})
          AND status IN ('collecting_evidence', 'needs_reporter_confirmation', 'needs_admin_confirmation')
          AND confirmed_target_user_id IS NULL AND closed_at IS NULL AND analysis_failure_code IS NULL
          AND (evidence_revision > analysis_revision OR status = 'needs_reporter_confirmation')
          AND EXISTS (SELECT 1 FROM servers WHERE guild_id = report_intakes.server_id
            AND settings->'report_intake_staged_enabled' = 'true'::jsonb)
        ORDER BY analysis_due_at, id FOR UPDATE SKIP LOCKED LIMIT ${ANALYSIS_CLAIM_SCAN_LIMIT}`;
      for (const intake of rows) {
        const result = analysisClaimChange(intake, now, leaseMs);
        if (!result) continue;
        await this.writeProcessing(transaction, intake, result.change);
        if (result.claim) return result.claim;
      }
      return null;
    });
  }

  async claimPendingPresentation(
    now: Date,
    intakeId?: string
  ): Promise<ReportPresentationClaim | null> {
    const quarantined = await this.claimQuarantinedPresentation(now, intakeId);
    if (quarantined) return quarantined;
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ReportIntake[]>`
        SELECT * FROM report_intakes WHERE (${intakeId ?? null}::uuid IS NULL OR id = ${intakeId ?? null}::uuid)
        AND status IN ('needs_reporter_confirmation', 'needs_admin_confirmation')
        AND closed_at IS NULL AND confirmed_target_user_id IS NULL
        AND analysis_failure_code IS DISTINCT FROM 'invalid_metadata'
        AND jsonb_typeof(metadata->'analysis'->'outcome') = 'object'
        AND (status <> 'needs_reporter_confirmation' OR EXISTS (SELECT 1 FROM servers WHERE guild_id = report_intakes.server_id
          AND settings->'report_intake_staged_enabled' = 'true'::jsonb))
        AND analysis_revision = evidence_revision
        AND (metadata->'analysis'->'presentation' IS NULL OR
          (metadata->'analysis'->'presentation'->>'nextDueAt' <= ${now.toISOString()}
          AND (metadata->'analysis'->'presentation'->'lease'->>'until' IS NULL OR
            metadata->'analysis'->'presentation'->'lease'->>'until' <= ${now.toISOString()})))
        AND COALESCE(metadata->'analysis'->'handoff'->>'state', '') <> 'resolved'
        ORDER BY updated_at, id FOR UPDATE SKIP LOCKED LIMIT ${ANALYSIS_CLAIM_SCAN_LIMIT}`;
      for (const intake of rows) {
        const result = presentationClaimChange(intake, now);
        if (!result) continue;
        await this.writeProcessing(transaction, intake, result.change);
        return result.claim;
      }
      return null;
    });
  }

  private async claimQuarantinedPresentation(
    now: Date,
    intakeId?: string
  ): Promise<ReportPresentationClaim | null> {
    const after = intakeId ? null : this.quarantinePresentationAfter;
    const rows = await this.prisma.$queryRaw<ReportIntake[]>`
      SELECT * FROM report_intakes WHERE analysis_failure_code = 'invalid_metadata'
      AND status IN ('needs_reporter_confirmation', 'needs_admin_confirmation')
      AND closed_at IS NULL AND confirmed_target_user_id IS NULL
      AND (${intakeId ?? null}::uuid IS NULL OR id = ${intakeId ?? null}::uuid)
      AND (${after}::uuid IS NULL OR id > ${after}::uuid)
      ORDER BY id LIMIT ${ANALYSIS_CLAIM_SCAN_LIMIT}`;
    if (!intakeId)
      this.quarantinePresentationAfter =
        rows.length === ANALYSIS_CLAIM_SCAN_LIMIT ? rows[rows.length - 1].id : null;
    for (const snapshot of rows) {
      if (!presentationClaimChange(snapshot, now)) continue;
      const claim = await this.prisma.$transaction(async (transaction) => {
        const current = await this.lockedIntake(transaction, snapshot.id);
        if (!current || current.analysis_failure_code !== 'invalid_metadata') return null;
        const result = presentationClaimChange(current, now);
        if (!result) return null;
        await this.writeProcessing(transaction, current, result.change);
        return result.claim;
      });
      if (claim) return claim;
    }
    return null;
  }

  async completePresentation(
    claim: ReportPresentationClaim,
    result: ReportPresentationResult
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const intake = await this.lockedIntake(transaction, claim.intake.id);
      if (!intake) return false;
      const change = completePresentationChange(intake, claim, result, new Date());
      if (!change) return false;
      await this.writeProcessing(transaction, intake, change);
      return true;
    });
  }

  private async mutateAnalysis(
    claim: ReportAnalysisClaim,
    transition: (intake: ReportIntake) => Partial<ReportIntake> | null
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const intake = await this.lockedIntake(transaction, claim.intake.id);
      if (!intake) return false;
      const server = await transaction.servers.findUnique({
        where: { guild_id: intake.server_id },
        select: { settings: true },
      });
      if (!getReportIntakeSettings((server?.settings ?? {}) as ServerSettings).stagedEnabled)
        return false;
      const change = transition(intake);
      if (!change) return false;
      await this.writeProcessing(transaction, intake, change);
      return true;
    });
  }

  async reserveModelAttempt(claim: ReportAnalysisClaim, now: Date): Promise<boolean> {
    return this.mutateAnalysis(claim, (intake) => reserveAnalysisChange(intake, claim, now));
  }

  async renewAnalysisLease(
    claim: ReportAnalysisClaim,
    now: Date,
    leaseMs: number
  ): Promise<boolean> {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0)
      throw new Error('Analysis lease must be positive');
    return this.mutateAnalysis(claim, (intake) =>
      ownsAnalysis(intake, claim, now)
        ? { analysis_lease_until: new Date(now.getTime() + leaseMs), updated_at: now }
        : null
    );
  }

  async completeAnalysis(
    claim: ReportAnalysisClaim,
    outcome: ReportAnalysisOutcome,
    now: Date
  ): Promise<boolean> {
    return this.mutateAnalysis(claim, (intake) =>
      completeAnalysisChange(intake, claim, outcome, now)
    );
  }

  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new RepositoryError(
        `Database error during ${operation}: ${error.message} (Code: ${error.code})`,
        error
      );
    }
    if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    }
    throw new RepositoryError(`Unknown error during ${operation}`, error);
  }

  async claimBan(input: ReportBanClaim): Promise<ReportIntake | null> {
    return this.prisma.$transaction(async (transaction) => {
      const owner = await transaction.$queryRaw<
        Array<{ token: string | null; phase: string | null }>
      >`
        SELECT metadata->>'report_ban_attempt_token' AS token, metadata->>'report_ban_phase' AS phase FROM moderation_action_requests WHERE id::text = ${input.operationId} FOR UPDATE`;
      if (
        !owner.length ||
        owner[0].phase !== 'preparing' ||
        owner[0].token !== (input.attemptToken ?? null)
      )
        return null;
      // Match case opening's report-first lock order before checking the detection claim.
      await transaction.$queryRaw`select id from report_intakes where id = ${input.reportId}::uuid for update`;
      const rows = await transaction.$queryRaw<ReportIntake[]>`
      update report_intakes r
      set metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object('report_ban_operation_id', ${input.operationId}::text), updated_at = now()
      where r.id = ${input.reportId}::uuid and r.server_id = ${input.serverId}
        and r.status = 'submitted' and r.confirmed_target_user_id = ${input.targetUserId}
        and coalesce(r.metadata->>'report_ban_operation_id', '') = ''
        and exists (select 1 from detection_events d where d.id = ${input.detectionEventId}::uuid
          and d.server_id = r.server_id and d.user_id = r.confirmed_target_user_id
          and d.metadata->>'reportIntakeId' = r.id::text
          and not (coalesce(d.metadata, '{}'::jsonb) ? 'observed_action'))
      returning r.*`;
      return rows[0] ?? null;
    });
  }

  async updateBan(
    reportId: string,
    operationId: string,
    input: { release?: boolean; complete?: boolean; metadata?: Record<string, unknown> }
  ): Promise<ReportIntake | null> {
    const rows = await this.prisma.$queryRaw<ReportIntake[]>`
      update report_intakes
      set metadata = (case when ${input.release === true} then coalesce(metadata, '{}'::jsonb) - 'report_ban_operation_id' else coalesce(metadata, '{}'::jsonb) end) || ${JSON.stringify(input.metadata ?? {})}::jsonb,
        status = case when ${input.complete === true} then 'actioned'::report_intake_status else status end,
        closed_at = case when ${input.complete === true} then coalesce(closed_at, now()) else closed_at end,
        updated_at = now()
      where id = ${reportId}::uuid and metadata->>'report_ban_operation_id' = ${operationId}
      returning *`;
    return rows[0] ?? null;
  }

  async create(data: ReportIntakeCreate): Promise<ReportIntake> {
    try {
      const createData: Prisma.report_intakesCreateInput = {
        servers: { connect: { guild_id: data.serverId } },
        users: { connect: { discord_id: data.reporterId } },
        thread_id: data.threadId ?? undefined,
        status: (data.status ?? ReportIntakeStatus.COLLECTING_EVIDENCE) as report_intake_status,
        summary: data.summary ?? undefined,
        confirmed_target_user_id: data.confirmedTargetUserId ?? undefined,
        metadata: (data.metadata as Prisma.InputJsonValue | null | undefined) ?? undefined,
      };

      const created = await this.prisma.report_intakes.create({ data: createData });
      return created as ReportIntake;
    } catch (error) {
      this.handleError(error, 'createReportIntake');
    }
  }

  async findById(id: string): Promise<ReportIntake | null> {
    try {
      const intake = await this.prisma.report_intakes.findUnique({ where: { id } });
      return intake as ReportIntake | null;
    } catch (error) {
      this.handleError(error, 'findReportIntakeById');
    }
  }

  async findByThreadId(threadId: string): Promise<ReportIntake | null> {
    try {
      const intake = await this.prisma.report_intakes.findUnique({
        where: { thread_id: threadId },
      });
      return intake as ReportIntake | null;
    } catch (error) {
      this.handleError(error, 'findReportIntakeByThreadId');
    }
  }

  async findOpenByThreadId(threadId: string): Promise<ReportIntake | null> {
    try {
      const intake = await this.prisma.report_intakes.findUnique({
        where: { thread_id: threadId },
      });
      if (!intake || !(OPEN_INTAKE_STATUSES as report_intake_status[]).includes(intake.status)) {
        return null;
      }
      return intake as ReportIntake | null;
    } catch (error) {
      this.handleError(error, 'findOpenReportIntakeByThreadId');
    }
  }

  async findOpenByReporterAndServer(
    serverId: string,
    reporterId: string
  ): Promise<ReportIntake | null> {
    try {
      const intake = await this.prisma.report_intakes.findFirst({
        where: {
          server_id: serverId,
          reporter_id: reporterId,
          closed_at: null,
          metadata: { path: ['thread_closed_at'], equals: Prisma.AnyNull },
          status: { in: OPEN_INTAKE_STATUSES as report_intake_status[] },
        },
        orderBy: { created_at: 'desc' },
      });
      return intake as ReportIntake | null;
    } catch (error) {
      this.handleError(error, 'findOpenReportIntakeByReporterAndServer');
    }
  }

  async update(id: string, data: ReportIntakeUpdate): Promise<ReportIntake | null> {
    try {
      const updateData: Prisma.report_intakesUpdateManyMutationInput = {
        updated_at: new Date(),
      };

      if (data.status !== undefined) {
        updateData.status = data.status as report_intake_status;
      }
      if (data.summary !== undefined) {
        updateData.summary = data.summary;
      }
      if (data.confirmedTargetUserId !== undefined) {
        updateData.confirmed_target_user_id = data.confirmedTargetUserId;
      }
      if (data.closedAt !== undefined) {
        updateData.closed_at = data.closedAt;
      }
      if (data.metadata !== undefined) {
        updateData.metadata = data.metadata as Prisma.InputJsonValue;
      }

      const updated = await this.prisma.report_intakes.updateManyAndReturn({
        where: {
          id,
          OR: [
            { metadata: { path: ['report_ban_operation_id'], equals: Prisma.AnyNull } },
            { metadata: { path: ['report_ban_operation_id'], equals: '' } },
          ],
        },
        data: updateData,
      });
      return (updated[0] as ReportIntake | undefined) ?? null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to update non-existent report intake: ${id}`);
        return null;
      }
      this.handleError(error, 'updateReportIntake');
    }
  }

  async updateIfCurrent(
    intake: ReportIntake,
    data: ReportIntakeUpdate
  ): Promise<ReportIntake | null> {
    try {
      const updated = await this.prisma.report_intakes.updateManyAndReturn({
        where: {
          id: intake.id,
          OR: [
            { metadata: { path: ['report_ban_operation_id'], equals: Prisma.AnyNull } },
            { metadata: { path: ['report_ban_operation_id'], equals: '' } },
          ],
          status: intake.status,
          evidence_revision: intake.evidence_revision,
          closed_at: intake.closed_at,
          confirmed_target_user_id: intake.confirmed_target_user_id,
          metadata: { equals: intake.metadata ?? Prisma.AnyNull },
        },
        data: {
          status: data.status,
          summary: data.summary,
          confirmed_target_user_id: data.confirmedTargetUserId,
          closed_at: data.closedAt,
          analysis_due_at: data.analysisDueAt,
          analysis_lease_token: data.analysisLeaseToken,
          analysis_lease_until: data.analysisLeaseUntil,
          metadata:
            data.metadata === undefined
              ? undefined
              : data.metadata === null
                ? Prisma.JsonNull
                : (data.metadata as Prisma.InputJsonValue),
          updated_at: new Date(),
        },
      });
      return (updated[0] as ReportIntake | undefined) ?? null;
    } catch (error) {
      this.handleError(error, 'updateReportIntakeIfCurrent');
    }
  }

  async confirmTargetIfUnset(
    id: string,
    data: {
      targetUserId: string;
      expectedMetadata: ReportIntake['metadata'];
      expectedEvidenceRevision?: number;
      expectedStatus?: ReportIntakeStatus;
      metadata: Record<string, unknown>;
    }
  ): Promise<ReportIntake | null> {
    try {
      const updated = await this.prisma.report_intakes.updateManyAndReturn({
        where: {
          id,
          status: data.expectedStatus ?? ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
          evidence_revision: data.expectedEvidenceRevision ?? 0,
          closed_at: null,
          OR: [
            { metadata: { path: ['report_ban_operation_id'], equals: Prisma.AnyNull } },
            { metadata: { path: ['report_ban_operation_id'], equals: '' } },
          ],
          confirmed_target_user_id: null,
          metadata: { equals: data.expectedMetadata ?? Prisma.AnyNull },
        },
        data: {
          confirmed_target_user_id: data.targetUserId,
          metadata: data.metadata as Prisma.InputJsonValue,
          updated_at: new Date(),
        },
      });
      return (updated[0] as ReportIntake | undefined) ?? null;
    } catch (error) {
      this.handleError(error, 'confirmReportIntakeTargetIfUnset');
    }
  }

  async addEvidence(data: ReportIntakeEvidenceCreate): Promise<ReportIntakeEvidence> {
    try {
      const createData: Prisma.report_intake_evidenceCreateInput = {
        report_intakes: { connect: { id: data.intakeId } },
        kind: data.kind as report_intake_evidence_kind,
        source_message_id: data.sourceMessageId ?? undefined,
        source_channel_id: data.sourceChannelId ?? undefined,
        attachment_id: data.attachmentId ?? undefined,
        content: data.content ?? undefined,
        metadata: (data.metadata as Prisma.InputJsonValue | null | undefined) ?? undefined,
      };

      const created = await this.prisma.report_intake_evidence.create({ data: createData });
      return created as ReportIntakeEvidence;
    } catch (error) {
      this.handleError(error, 'addReportIntakeEvidence');
    }
  }

  async listEvidence(intakeId: string): Promise<ReportIntakeEvidence[]> {
    try {
      const evidence = await this.prisma.report_intake_evidence.findMany({
        where: { intake_id: intakeId },
        orderBy: { created_at: 'asc' },
      });
      return evidence as ReportIntakeEvidence[];
    } catch (error) {
      this.handleError(error, 'listReportIntakeEvidence');
    }
  }
}
