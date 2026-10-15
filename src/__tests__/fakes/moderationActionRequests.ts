import { Prisma } from '../../db/prisma';
import { IModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import {
  ModerationActionRequest,
  ModerationActionRequestCreate,
  ModerationActionRequestStatus,
} from '../../repositories/types';
export class InMemoryModerationActionRequestRepository implements IModerationActionRequestRepository {
  public rows = new Map<string, ModerationActionRequest>();
  async enqueue(input: ModerationActionRequestCreate): Promise<ModerationActionRequest> {
    const existing = [...this.rows.values()].find(
      (row) => row.idempotency_key === input.idempotencyKey
    );
    if (existing) return existing;
    const row: ModerationActionRequest = {
      id: `request-${this.rows.size + 1}`,
      server_id: input.serverId,
      actor_id: input.actorId,
      actor_surface: input.actorSurface,
      action_type: input.actionType,
      target_user_id: input.targetUserId ?? null,
      report_intake_id: input.reportIntakeId ?? null,
      detection_event_id: input.detectionEventId ?? null,
      verification_event_id: input.verificationEventId ?? null,
      message_deletion_job_id: null,
      idempotency_key: input.idempotencyKey,
      status: ModerationActionRequestStatus.QUEUED,
      metadata: (input.metadata as Prisma.JsonValue) ?? {},
      result: {},
      requested_at: new Date(),
      updated_at: new Date(),
      started_at: null,
      completed_at: null,
      failed_at: null,
      last_error: null,
      attempts: 0,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async findById(id: string): Promise<ModerationActionRequest | null> {
    return this.rows.get(id) ?? null;
  }
  async claimNext(): Promise<ModerationActionRequest | null> {
    const row = [...this.rows.values()].find(
      (row) =>
        row.status === ModerationActionRequestStatus.QUEUED &&
        !(row.metadata as Prisma.JsonObject)?.report_ban_phase
    );
    if (!row) return null;
    const claimed = {
      ...row,
      status: ModerationActionRequestStatus.PROCESSING,
      updated_at: new Date(),
    };
    this.rows.set(row.id, claimed);
    return claimed;
  }
  async heartbeat(id: string): Promise<ModerationActionRequest | null> {
    return this.findById(id);
  }
  async mergeMetadata(
    id: string,
    patch: Prisma.JsonObject
  ): Promise<ModerationActionRequest | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const next = {
      ...row,
      metadata: { ...(row.metadata as Prisma.JsonObject), ...patch },
      updated_at: new Date(),
    };
    this.rows.set(id, next);
    return next;
  }
  async complete(
    id: string,
    result: Prisma.JsonValue = {}
  ): Promise<ModerationActionRequest | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const next = {
      ...row,
      status: ModerationActionRequestStatus.COMPLETED,
      result,
      completed_at: new Date(),
      updated_at: new Date(),
    };
    this.rows.set(id, next);
    return next;
  }
  async fail(id: string, error: string): Promise<ModerationActionRequest | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const next = { ...row, status: ModerationActionRequestStatus.FAILED, last_error: error };
    this.rows.set(id, next);
    return next;
  }
  async claimReportBanReconciliation(now: Date): Promise<ModerationActionRequest | null> {
    const row = [...this.rows.values()].find((row) => {
      const m = row.metadata as Prisma.JsonObject;
      return (
        Boolean(m.report_ban_phase) &&
        (m.report_ban_retry_at ? new Date(String(m.report_ban_retry_at)).getTime() : 0) <=
          now.getTime() &&
        (m.report_ban_lease_until
          ? new Date(String(m.report_ban_lease_until)).getTime()
          : (row.updated_at?.getTime() ?? 0) + 900_000) <= now.getTime()
      );
    });
    return row
      ? this.mergeMetadata(row.id, {
          report_ban_lease_until: new Date(now.getTime() + 900_000).toISOString(),
        })
      : null;
  }
}
