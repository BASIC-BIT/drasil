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
  ReportIntakeCreate,
  ReportIntakeEvidence,
  ReportIntakeEvidenceCreate,
  ReportIntakeStatus,
  ReportIntakeUpdate,
} from './types';

const OPEN_INTAKE_STATUSES: ReportIntakeStatus[] = [
  ReportIntakeStatus.COLLECTING_EVIDENCE,
  ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
  ReportIntakeStatus.NEEDS_ADMIN_CONFIRMATION,
];

export interface ReportBanClaim {
  reportId: string;
  serverId: string;
  targetUserId: string;
  detectionEventId: string;
  operationId: string;
  attemptToken?: string;
}
export interface IReportIntakeRepository {
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
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

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
          confirmed_target_user_id: intake.confirmed_target_user_id,
          metadata: { equals: intake.metadata ?? Prisma.AnyNull },
        },
        data: {
          status: data.status,
          summary: data.summary,
          confirmed_target_user_id: data.confirmedTargetUserId,
          closed_at: data.closedAt,
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
      metadata: Record<string, unknown>;
    }
  ): Promise<ReportIntake | null> {
    try {
      const updated = await this.prisma.report_intakes.updateManyAndReturn({
        where: {
          id,
          status: ReportIntakeStatus.NEEDS_REPORTER_CONFIRMATION,
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
