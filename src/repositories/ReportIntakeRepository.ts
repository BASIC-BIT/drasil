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

export interface IReportIntakeRepository {
  create(data: ReportIntakeCreate): Promise<ReportIntake>;
  findById(id: string): Promise<ReportIntake | null>;
  findOpenByThreadId(threadId: string): Promise<ReportIntake | null>;
  findOpenByReporterAndServer(serverId: string, reporterId: string): Promise<ReportIntake | null>;
  update(id: string, data: ReportIntakeUpdate): Promise<ReportIntake | null>;
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
      const updateData: Prisma.report_intakesUpdateInput = {
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

      const updated = await this.prisma.report_intakes.update({
        where: { id },
        data: updateData,
      });
      return updated as ReportIntake;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to update non-existent report intake: ${id}`);
        return null;
      }
      this.handleError(error, 'updateReportIntake');
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
