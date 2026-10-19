import {
  parseReportBanState,
  ReportBanTransition,
  reportBanTransitionPatch,
  canAdvanceReportBanPhase,
  ownedReportBanPatch,
  assertUnrelatedReportBanMetadata,
} from '../../utils/reportBanState';
import { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { IReportIntakeRepository } from '../../repositories/ReportIntakeRepository';
import { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { Prisma } from '../../db/prisma';
import { randomUUID } from 'crypto';
import {
  getReportBanAttemptToken,
  IModerationActionRequestRepository,
} from '../../repositories/ModerationActionRequestRepository';
import {
  ModerationActionRequest,
  ModerationActionRequestCreate,
  ModerationActionRequestStatus,
} from '../../repositories/types';
export class InMemoryModerationActionRequestRepository implements IModerationActionRequestRepository {
  constructor(
    private readonly banContext?: {
      cases: IVerificationEventRepository;
      reports: IReportIntakeRepository;
      detections: IDetectionEventsRepository;
    }
  ) {}
  public rows = new Map<string, ModerationActionRequest>();
  async enqueue(input: ModerationActionRequestCreate): Promise<ModerationActionRequest> {
    const existing = [...this.rows.values()].find(
      (row) => row.idempotency_key === input.idempotencyKey
    );
    if (existing) {
      if (
        existing.status !== ModerationActionRequestStatus.FAILED ||
        parseReportBanState(existing.metadata).report_ban_phase ||
        (existing.result as Prisma.JsonObject).observed_ban_result
      )
        return existing;
      const metadata = Object.fromEntries(
        Object.entries(existing.metadata as Prisma.JsonObject).filter(
          ([key]) => !key.startsWith('report_ban_')
        )
      );
      const retry = {
        ...existing,
        status: ModerationActionRequestStatus.QUEUED,
        result: {},
        metadata: {
          ...metadata,
          ...((input.metadata ?? {}) as Prisma.JsonObject),
          report_ban_attempt_token: randomUUID(),
        },
      } as ModerationActionRequest;
      this.rows.set(existing.id, retry);
      return retry;
    }
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
      metadata: {
        ...((input.metadata ?? {}) as Prisma.JsonObject),
        ...(input.actionType === 'ban_observed_detection'
          ? { report_ban_attempt_token: randomUUID() }
          : {}),
      } as Prisma.JsonValue,
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
  async adoptConfirmedReportBanCases(
    id: string,
    token: string
  ): Promise<ModerationActionRequest | null> {
    const current = await this.findById(id);
    return current && getReportBanAttemptToken(current) === token ? current : null;
  }
  async reviewUncertainReportBan(): Promise<ModerationActionRequest | null> {
    throw new Error('Review atomicity is tested with the Postgres repository.');
  }
  async claimReportBanCompletionAnalytics(id: string, token: string): Promise<boolean> {
    const current = this.rows.get(id);
    if (!current || getReportBanAttemptToken(current) !== token) return false;
    const metadata = current.metadata as Prisma.JsonObject;
    const result = (current.result as Prisma.JsonObject).observed_ban_result as
      | Prisma.JsonObject
      | undefined;
    if (result?.status !== 'banned' || metadata.report_ban_analytics_claimed_at) return false;
    this.rows.set(id, {
      ...current,
      metadata: { ...metadata, report_ban_analytics_claimed_at: new Date().toISOString() },
    });
    return true;
  }
  async claimNext(): Promise<ModerationActionRequest | null> {
    const row = [...this.rows.values()].find(
      (row) =>
        row.status === ModerationActionRequestStatus.QUEUED &&
        !parseReportBanState(row.metadata).report_ban_phase
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
    metadata: Prisma.JsonObject
  ): Promise<ModerationActionRequest | null> {
    assertUnrelatedReportBanMetadata(metadata);
    const row = this.rows.get(id);
    if (!row) return null;
    const next = {
      ...row,
      metadata: { ...(row.metadata as Prisma.JsonObject), ...metadata },
      updated_at: new Date(),
    };
    this.rows.set(id, next);
    return next;
  }
  async transitionReportBan(
    id: string,
    transition: ReportBanTransition,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (row.action_type !== 'ban_observed_detection')
      throw new Error('Not a report-ban operation.');
    if (getReportBanAttemptToken(row) !== expectedAttemptToken) return row;
    const current = parseReportBanState(row.metadata);
    const patch = reportBanTransitionPatch(transition);
    parseReportBanState(patch);
    if (!canAdvanceReportBanPhase(current, row.status, row.result, patch)) return row;
    if (patch.report_ban_phase === 'enforcement_started' && this.banContext) {
      const ids = patch.report_ban_case_ids ?? [];
      for (const caseId of ids) {
        const event = await this.banContext.cases.findById(caseId);
        if (
          event?.status !== 'pending' ||
          event.quarantine_attempt_id !== current.report_ban_attempt_id
        )
          return row;
      }
      for (const caseId of ids)
        await this.banContext.cases.patchMetadata(caseId, {
          report_ban_enforcement_operation_id: id,
        });
    }
    const owned = ownedReportBanPatch(current, patch);
    const next = {
      ...row,
      metadata: { ...(row.metadata as Prisma.JsonObject), ...owned },
      updated_at: new Date(),
    };
    this.rows.set(id, next);
    return next;
  }
  async complete(
    id: string,
    result: Prisma.JsonValue = {},
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (
      row.action_type === 'ban_observed_detection' &&
      getReportBanAttemptToken(row) !== expectedAttemptToken
    )
      return row;
    const receipt = (row.result as Prisma.JsonObject).observed_ban_result as
      | Prisma.JsonObject
      | undefined;
    const incoming = (result as Prisma.JsonObject).observed_ban_result as
      | Prisma.JsonObject
      | undefined;
    if (
      receipt?.status === 'banned' ||
      (receipt?.status === 'banned_updates_pending' && incoming?.status === 'ban_outcome_unknown')
    )
      return row;
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
  async fail(
    id: string,
    error: string,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (
      row.action_type === 'ban_observed_detection' &&
      getReportBanAttemptToken(row) !== expectedAttemptToken
    )
      return row;
    const receipt = (row.result as Prisma.JsonObject).observed_ban_result as
      | Prisma.JsonObject
      | undefined;
    if (
      parseReportBanState(row.metadata).report_ban_phase ||
      ['banned', 'banned_updates_pending', 'ban_outcome_unknown'].includes(String(receipt?.status))
    )
      return row;
    const next = { ...row, status: ModerationActionRequestStatus.FAILED, last_error: error };
    this.rows.set(id, next);
    return next;
  }
  async releaseReportBanPreparation(
    id: string,
    expectedPhase: 'preparing' | 'enforcement_started',
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (
      row.action_type === 'ban_observed_detection' &&
      getReportBanAttemptToken(row) !== expectedAttemptToken
    )
      return row;
    const metadata = parseReportBanState(row.metadata);
    if (
      metadata.report_ban_phase !== expectedPhase &&
      !(row.status === ModerationActionRequestStatus.FAILED && !metadata.report_ban_phase)
    )
      return row;
    const context = this.banContext;
    const candidates = metadata.report_ban_cases ?? [];
    if (context) {
      for (const candidate of candidates) {
        const event = await context.cases.findById(String(candidate.id));
        if (
          event?.status === 'pending' &&
          event.quarantine_attempt_id === metadata.report_ban_attempt_id
        ) {
          await context.cases.patchMetadata(event.id, {
            report_ban_enforcement_operation_id: null,
          });
          await context.cases.updateQuarantineAttempt(
            event.id,
            String(metadata.report_ban_attempt_id),
            {
              case_kind: candidate.case_kind ?? undefined,
              attention_state: candidate.attention_state ?? undefined,
              containment_status: candidate.containment_status ?? undefined,
              parked_at: candidate.parked_at ? new Date(candidate.parked_at) : null,
              parked_by: candidate.parked_by,
            }
          );
        }
      }
      if (row.detection_event_id)
        await context.detections.releaseObservedAction(
          row.detection_event_id,
          'ban',
          row.actor_id,
          id
        );
      if (row.report_intake_id)
        await context.reports.updateBan(row.report_intake_id, id, { release: true });
    }
    const next = {
      ...row,
      status: ModerationActionRequestStatus.FAILED,
      metadata: {
        ...(row.metadata as Prisma.JsonObject),
        report_ban_phase: null,
        report_ban_lease_until: null,
      },
    };
    this.rows.set(id, next);
    return next;
  }
  async claimReportBanReconciliation(now: Date): Promise<ModerationActionRequest | null> {
    const row = [...this.rows.values()].find((row) => {
      const m = parseReportBanState(row.metadata);
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
      ? this.transitionReportBan(
          row.id,
          {
            kind: 'renew_lease',
            report_ban_lease_until: new Date(now.getTime() + 900_000).toISOString(),
          },
          getReportBanAttemptToken(row)
        )
      : null;
  }
}
